/**
 * Closes the age-policy VALUES for every live business service: an EXPLICIT product policy of
 * NO_AGE_RESTRICTION (customerPolicy.age.mode = "NONE", version 1) — but only where the service's
 * own catalogue carries NO age evidence. A service whose published configuration mentions an age,
 * a minor, or an adults-only / elderly audience is NOT written: it prints OWNER_DECISION_REQUIRED
 * with the evidence, because the right value there is a human decision, not a default.
 *
 * The population is read from the database (active, business-origin services), never from a list:
 * services published after the Phase 10 draft was written are covered too.
 *
 * This is a versioned product decision, revisable per service at any time, and NEVER a statement
 * about law. Booking snapshots freeze the policy; decisions are recorded append-only by the engine.
 *
 *   bun run scripts/phase10-apply-age-policy.ts --url "<url>" [--apply --actor-id <SUPER_ADMIN>] [--allow-live]
 */
import { PrismaClient } from "@prisma/client";

export const AGE_POLICY = { age: { mode: "NONE" as const }, version: 1 };

/**
 * Statements about WHO MAY BOOK by age. Mentions of age-defined people in the home ("an adult must be
 * present", "tell us if anyone is elderly or an infant", an audience of seniors as recipients) are
 * requirements or warnings about the household, not a booking-age rule, and do not block NONE.
 */
const AGE_TERMS: RegExp[] = [
  /\b\d{1,2}\s*\+/, // "18+"
  /\b(under|over|above|below|at least|minimum|min\.?)\s+(the\s+)?(age\s+(of\s+)?)?\d{1,2}\b/i,
  /\b\d{1,2}\s*(years?|yrs?)\s*(old|of age|and (above|over|older))\b/i,
  /\bage\s+(limit|restriction|requirement|eligibility)s?\b/i,
  /\bminimum\s+age\b/i,
  /\badults?[- ]only\b/i,
  /\bminors?\b/i,
];
/** Keys whose values are identifiers, not published statements (`adult-present` is a requirement id). */
const IDENTIFIER_KEYS = new Set(["id", "code", "slug", "key", "requirementId", "itemId"]);
/** Keys that are server bookkeeping or media, not published catalogue statements. */
const IGNORED_KEYS = new Set(["media", "video", "requirementItems", "customerPolicy"]);

/** Every catalogue string that mentions an age or an age-defined audience, with its path. */
export function ageEvidence(catalogConfig: unknown, extra: Record<string, string | null | undefined> = {}): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") {
      if (AGE_TERMS.some((re) => re.test(v))) out.push({ path, text: v.length > 160 ? `${v.slice(0, 157)}…` : v });
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!(path === "" && IGNORED_KEYS.has(k)) && !IDENTIFIER_KEYS.has(k)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(catalogConfig ?? {}, "");
  for (const [k, v] of Object.entries(extra)) if (typeof v === "string") walk(v, `service.${k}`);
  return out;
}

export type AgeDecision = "IDENTICAL" | "APPLY_NONE" | "OWNER_DECISION_REQUIRED" | "KEEP_EXISTING";

/** What this script does for one service. An existing, different policy is never overwritten. */
export function ageDecision(catalogConfig: unknown, extra: Record<string, string | null | undefined> = {}): { decision: AgeDecision; evidence: Array<{ path: string; text: string }> } {
  const cur = ((catalogConfig ?? {}) as { customerPolicy?: unknown }).customerPolicy ?? null;
  if (cur && JSON.stringify(cur) === JSON.stringify(AGE_POLICY)) return { decision: "IDENTICAL", evidence: [] };
  if (cur) return { decision: "KEEP_EXISTING", evidence: [] };
  const evidence = ageEvidence(catalogConfig, extra);
  return evidence.length ? { decision: "OWNER_DECISION_REQUIRED", evidence } : { decision: "APPLY_NONE", evidence: [] };
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
    const onlyIdx = process.argv.indexOf("--services");
    const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1]!.split(",").map((s) => s.trim()).filter(Boolean) : null;
    console.log(`\n[age-policy] ${APPLY ? "APPLY" : "REPORT"} on "${db}" — NO_AGE_RESTRICTION v1 where the catalogue carries no age evidence\n${"=".repeat(70)}`);
    const { catalogService } = await import("../src/services/catalog.service");
    const services = await prisma.service.findMany({
      where: { isActive: true, dataOrigin: null, ...(only ? { slug: { in: only } } : {}) },
      select: { id: true, slug: true, name: true, description: true, version: true, catalogConfig: true },
      orderBy: { slug: "asc" },
    });
    const tally: Record<string, number> = { IDENTICAL: 0, APPLY_NONE: 0, OWNER_DECISION_REQUIRED: 0, KEEP_EXISTING: 0, ERROR: 0 };
    for (const svc of services) {
      const { decision, evidence } = ageDecision(svc.catalogConfig, { name: svc.name, description: svc.description });
      tally[decision]!++;
      if (decision === "IDENTICAL") continue;
      if (decision === "KEEP_EXISTING") { console.log(`${svc.slug}: KEEP_EXISTING ${JSON.stringify((svc.catalogConfig as { customerPolicy?: unknown }).customerPolicy)} (an explicit policy is never overwritten)`); continue; }
      if (decision === "OWNER_DECISION_REQUIRED") {
        console.log(`${svc.slug}: OWNER_DECISION_REQUIRED — the catalogue mentions an age or an age-defined audience; not written:`);
        for (const e of evidence.slice(0, 5)) console.log(`    ${e.path}: ${JSON.stringify(e.text)}`);
        continue;
      }
      console.log(`${svc.slug}: customerPolicy null → NONE v1 ${APPLY ? "(applying)" : "(would apply)"}`);
      if (!APPLY) continue;
      const cur = (svc.catalogConfig ?? {}) as Record<string, unknown>;
      const r = await catalogService.update(svc.id, { catalogConfig: { ...cur, customerPolicy: AGE_POLICY } as never, expectedVersion: svc.version, changeReason: "Age policy: explicit NO_AGE_RESTRICTION v1 (product decision; the catalogue carries no age evidence for this service)" }, actorId!);
      if ("error" in r && r.error) { tally.ERROR!++; tally.APPLY_NONE!--; console.log(`  → ERROR ${r.error}`); }
    }
    console.log(`${"=".repeat(70)}\n[age-policy] services=${services.length} ${APPLY ? "applied" : "would-apply"}=${tally.APPLY_NONE} identical=${tally.IDENTICAL} owner-decision=${tally.OWNER_DECISION_REQUIRED} kept=${tally.KEEP_EXISTING} errors=${tally.ERROR}`);
    if (tally.ERROR) process.exitCode = 1;
    // catalogService.update audits fire-and-forget; wait for them before the process exits.
    const { AuditLogService } = await import("../src/services/audit-log.service");
    const left = await AuditLogService.drain();
    if (left) { console.error(`WARNING: ${left} audit write(s) still pending at exit`); process.exitCode = 1; }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });
