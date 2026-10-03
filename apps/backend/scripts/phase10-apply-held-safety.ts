/**
 * Applies the six HELD drafts (OWNER_APPROVAL_REQUIRED / SAFETY_HOLD) onto their live services,
 * through the canonical admin write: `safety`, `quality`, and the NON-METHOD execution steps
 * (arrival / scope / safety check / quality check / closeout). Method-dependent WORK steps stay
 * withheld on purpose — gas handling, height work and treatment procedures need method facts nobody
 * may invent — and this script REFUSES a held draft that carries a WORK step.
 *
 *   bun run scripts/phase10-apply-held-safety.ts --url "<postgres url>" [--apply --actor-id <SUPER_ADMIN>] [--allow-live]
 *
 * Idempotent: content is compared as the database stores it (schema-normalised), so a second run
 * prints SKIP_IDENTICAL for every service and bumps no version.
 */
import { PrismaClient } from "@prisma/client";
import { DRAFT, type ServiceDraft } from "./data/phase-10-execution-safety-content-draft";
import { buildNextConfig, diffManaged, untouchedKeysPreserved, validateOnTarget } from "./phase10-content-apply-plan";

export const HELD_SLUGS = Object.entries(DRAFT).filter(([, d]) => d.status !== "DRAFT_FOR_OWNER_REVIEW").map(([slug]) => slug).sort();

/** WORK steps a held draft carries — must be empty; a held service never gets a method step. */
export function heldWorkSteps(d: ServiceDraft): string[] {
  const steps = ((d.execution as { steps?: Array<{ id?: string; kind?: string }> } | undefined)?.steps ?? []);
  return steps.filter((s) => s.kind === "WORK").map((s) => s.id ?? "?");
}

async function main() {
  const APPLY = process.argv.includes("--apply");
  const urlIdx = process.argv.indexOf("--url");
  const url = urlIdx >= 0 ? process.argv[urlIdx + 1] : undefined;
  const actorIdx = process.argv.indexOf("--actor-id");
  const actorId = actorIdx >= 0 ? process.argv[actorIdx + 1] : undefined;
  if (!url) { console.error("REFUSING: --url required"); process.exit(2); }
  if (APPLY && !actorId) { console.error("REFUSING: --apply needs --actor-id"); process.exit(2); }
  process.env.DATABASE_URL = url;
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
    if (APPLY && !/test/i.test(db) && !process.argv.includes("--allow-live")) {
      console.error(`REFUSING: "${db}" is live; --apply needs --allow-live`);
      process.exit(2);
    }
    if (/test/i.test(db)) process.env.NODE_ENV = "test";
    if (APPLY) {
      const a = await prisma.user.findUnique({ where: { id: actorId! }, select: { adminProfile: { select: { isActive: true, role: { select: { name: true } } } } } });
      if (!a?.adminProfile?.isActive || a.adminProfile.role.name !== "SUPER_ADMIN") { console.error("REFUSING: --actor-id is not an active SUPER_ADMIN on this database"); process.exit(2); }
    }
    console.log(`\n[held-safety] ${APPLY ? "APPLY" : "REPORT"} on "${db}"\n${"=".repeat(70)}`);
    const { catalogService } = await import("../src/services/catalog.service");
    let failed = 0;
    for (const slug of HELD_SLUGS) {
      const d = DRAFT[slug]!;
      const work = heldWorkSteps(d);
      if (work.length) { failed++; console.log(`${slug}: REFUSED_WORK_STEP (${work.join(",")}) — a held service carries no method step`); continue; }
      const svc = await prisma.service.findFirst({ where: { slug, dataOrigin: null }, select: { id: true, version: true, catalogConfig: true } });
      if (!svc) { failed++; console.log(`${slug}: NOT_FOUND`); continue; }
      const next = buildNextConfig(svc.catalogConfig, d);
      if (!untouchedKeysPreserved(svc.catalogConfig, next)) { failed++; console.log(`${slug}: INTERNAL_ERROR (a non-managed key would change)`); continue; }
      const problems = validateOnTarget(next);
      if (problems.length) { failed++; console.log(`${slug}: INVALID_ON_TARGET ${problems.slice(0, 3).join("; ")}`); continue; }
      const diff = diffManaged(svc.catalogConfig, next);
      console.log(`${slug} (${d.status}): ${diff.length ? `${APPLY ? "APPLY" : "WOULD_APPLY"} ${diff.map((x) => x.key).join(", ")}` : "SKIP_IDENTICAL"} · WORK steps withheld`);
      if (!APPLY || !diff.length) continue;
      const r = await catalogService.update(svc.id, { catalogConfig: next as never, expectedVersion: svc.version, changeReason: `Phase 10 held service ${slug}: safety + quality + non-method execution steps; WORK steps withheld pending verified method facts (${d.status})` }, actorId!);
      if ("error" in r && r.error) { failed++; console.log(`  → ERROR ${r.error}`); continue; }
      console.log(`  → version ${(r as { service?: { version?: number } }).service?.version ?? "?"}`);
    }
    console.log(`${"=".repeat(70)}\n[held-safety] ${APPLY ? "DONE" : "report only"}${failed ? ` · ${failed} FAILED` : ""}`);
    if (failed) process.exitCode = 1;
    // catalogService.update audits fire-and-forget; wait for them before the process exits.
    const { AuditLogService } = await import("../src/services/audit-log.service");
    const left = await AuditLogService.drain();
    if (left) { console.error(`WARNING: ${left} audit write(s) still pending at exit`); process.exitCode = 1; }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });
