/**
 * Phase 10 — owner ATTESTATION of content that is already live. Appends; never rewrites history.
 *
 * On 2026-09-29 the 25 approved contents were applied to homigo_db from an approval file signed
 * "YOUR NAME"; the audit rows of that apply (activity_logs) say so and stay exactly as they are. This
 * script lets the real owner put their name on that exact content: for every DRAFT_FOR_OWNER_REVIEW
 * service whose live execution / safety / quality content is IDENTICAL to the approved draft, it writes
 * one PHASE10_CONTENT_APPROVAL_ATTESTED audit row naming the service, the full content hash (what was
 * approved — later versions that changed other keys keep it), the current version, the owner and what
 * it supersedes. Nothing in the catalogue changes.
 *
 *   # report (read-only)
 *   bun run scripts/phase10-attest-approval.ts --url "$DB_URL" --approved-by "$OWNER_NAME"
 *   # write the attestation rows
 *   bun run scripts/phase10-attest-approval.ts --url "$DB_URL" --approved-by "$OWNER_NAME" \
 *       --apply --actor-id <SUPER_ADMIN user id> [--allow-live]
 *   [--note "<text>"]             how the approval was given (e.g. "in writing by the owner; executed by …")
 *   [--services a,b]              only these slugs
 *   [--map slug=serviceId,…]      attest a draft slug on a different service (fixtures) — test DB only
 *
 * Refuses: a placeholder approver ("YOUR NAME", "<your name>", empty, "$OWNER" …) · --apply without an
 * active SUPER_ADMIN actor · --apply on a database whose name lacks "test" without --allow-live.
 * Per service: content that differs from the draft is NOT_IDENTICAL (never attested); a service that
 * already carries a real approval or attestation of this content hash is SKIP_ALREADY_PROVEN.
 * The verifier gate "C approval provenance" reads the same rows (scripts/lib/approval-provenance.ts).
 */
import { PrismaClient } from "@prisma/client";
import { DRAFT, DRAFT_VERSION } from "./data/phase-10-execution-safety-content-draft";
import { ATTESTATION_ACTION, classifyApprovalProvenance } from "./lib/approval-provenance";
import { isValidApproverName } from "./lib/approver-name";
import { buildNextConfig, contentHash, diffManaged } from "./phase10-content-apply-plan";

const argv = process.argv.slice(2);
const arg = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const die = (m: string): never => { console.error(`[attest-approval] refusing: ${m}`); process.exit(2); };

async function main() {
  const url = arg("--url");
  const approvedBy = arg("--approved-by");
  const actorId = arg("--actor-id");
  const APPLY = argv.includes("--apply");
  if (!url) die("--url <postgres url> is required");
  if (!isValidApproverName(approvedBy)) die("placeholder approver — --approved-by must be the approving owner's real name");
  if (APPLY && !actorId) die("--apply needs --actor-id <SUPER_ADMIN user id>");
  const note = arg("--note");
  if (note !== undefined && (note.trim().length < 3 || /^<[^>]*>$/.test(note.trim()))) die("--note must describe how the approval was given (not a placeholder)");

  process.env.DATABASE_URL = url!;
  const prisma = new PrismaClient({ datasources: { db: { url: url! } } });
  try {
    const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
    if (APPLY && !/test/i.test(db) && !argv.includes("--allow-live")) die(`"${db}" is live; --apply needs --allow-live`);
    if (/test/i.test(db)) process.env.NODE_ENV = "test";
    const map = new Map((arg("--map") ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split("=") as [string, string]));
    if (map.size && !/test/i.test(db)) die("--map is for test databases only");
    const only = arg("--services")?.split(",").map((s) => s.trim()).filter(Boolean);
    if (APPLY) {
      const a = await prisma.user.findUnique({ where: { id: actorId! }, select: { adminProfile: { select: { isActive: true, role: { select: { name: true } } } } } });
      if (!a?.adminProfile?.isActive || a.adminProfile.role.name !== "SUPER_ADMIN") die("--actor-id is not an active SUPER_ADMIN on this database");
    }
    console.log(`\n[attest-approval] ${APPLY ? "APPLY" : "REPORT"} on "${db}" · approver "${approvedBy}" · draft ${DRAFT_VERSION}\n${"=".repeat(78)}`);

    const slugs = Object.entries(DRAFT).filter(([s, d]) => d.status === "DRAFT_FOR_OWNER_REVIEW" && (!only || only.includes(s))).map(([s]) => s).sort();
    const rows = await prisma.activityLog.findMany({
      where: { action: "ADMIN_ACTION", OR: [{ description: { contains: "Phase 10 execution/safety/quality content" } }, { description: { contains: ATTESTATION_ACTION } }] },
      select: { description: true },
      orderBy: { createdAt: "desc" }, // newest first, as classifyApprovalProvenance expects
    });
    const { AuditLogService } = APPLY ? await import("../src/services/audit-log.service") : { AuditLogService: null };
    const tally: Record<string, number> = {};
    const count = (k: string) => { tally[k] = (tally[k] ?? 0) + 1; };
    for (const slug of slugs) {
      const mapped = map.get(slug);
      const svc = await prisma.service.findFirst({ where: mapped ? { id: mapped } : { slug, dataOrigin: null, isActive: true }, select: { id: true, version: true, catalogConfig: true } });
      if (!svc) { count("NOT_FOUND"); console.log(`${slug}: NOT_FOUND (no active business service)`); continue; }
      const cfg = svc.catalogConfig;
      if (diffManaged(cfg, buildNextConfig(cfg, DRAFT[slug]!)).length) { count("NOT_IDENTICAL"); console.log(`${slug}: NOT_IDENTICAL — live content is not the approved draft; nothing is attested`); continue; }
      const hash = contentHash(slug);
      const target = { serviceId: svc.id, version: svc.version, contentHash: hash };
      const now = classifyApprovalProvenance(rows.filter((r) => r.description?.includes(svc.id)), target);
      if (now.kind === "APPROVED" || now.kind === "ATTESTED") { count("SKIP_ALREADY_PROVEN"); console.log(`${slug}: SKIP_ALREADY_PROVEN (${now.kind} by ${now.approver})`); continue; }
      const supersedes = now.kind === "PLACEHOLDER" ? `apply signed by placeholder "${now.approver}"` : "apply with no recorded approver";
      if (!APPLY) { count("WOULD_ATTEST"); console.log(`${slug}: WOULD_ATTEST v${svc.version} hash ${hash.slice(0, 16)} (supersedes: ${supersedes})`); continue; }
      await AuditLogService!.record("ADMIN_ACTION", "success", {
        userId: actorId,
        reason: `Phase 10 content approval attested by ${approvedBy} for ${slug} v${svc.version}`,
        details: { action: ATTESTATION_ACTION, serviceId: svc.id, slug, version: svc.version, contentHash: hash, draftVersion: DRAFT_VERSION, approvedBy, attestedAt: new Date().toISOString(), supersedes, ...(note ? { note: note.trim().slice(0, 300) } : {}) },
      });
      count("ATTESTED");
      console.log(`${slug}: ATTESTED v${svc.version} hash ${hash.slice(0, 16)} (supersedes: ${supersedes})`);
    }
    console.log(`${"=".repeat(78)}\n[attest-approval] ${Object.entries(tally).map(([k, n]) => `${n} ${k}`).join(" · ") || "nothing to do"}`);
    if (tally.NOT_FOUND || tally.NOT_IDENTICAL) process.exitCode = 1;
    if (AuditLogService) {
      const left = await AuditLogService.drain();
      if (left) { console.error(`WARNING: ${left} audit write(s) still pending at exit`); process.exitCode = 1; }
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });
