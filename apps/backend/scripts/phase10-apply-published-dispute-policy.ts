/**
 * Encodes the platform's PUBLISHED quality-dispute promise on every live business service, so the
 * complaint and warranty engines have a policy to evaluate. Without it, every service freezes
 * `complaintWindowDays = 0` and `warranty.enabled = false`, and a customer cannot report an issue on
 * any booking at all (`COMPLAINT_WINDOW_NOT_CONFIGURED`).
 *
 * Source — the owner's own published Refund & Cancellation Policy, not an assumption:
 *   apps/web/src/lib/legal/legal-data.ts, "Quality Disputes & Rework":
 *     "If the service didn't meet HOMEEIGO's standards, raise a dispute within 48 hours of completion
 *      through in-app support with photos where possible. We'll first offer a free rework by a
 *      professional; if that isn't feasible or acceptable, we may issue a partial or full refund based
 *      on a fair review."
 *   (the same 48-hour rule appears in legal-data.ts "Refund Policy" and content.ts "quality dispute").
 *
 * Mapping, clause by clause (nothing beyond the text):
 *   "within 48 hours of completion"          → quality.complaintWindowDays = 2, warranty.durationDays = 2, startEvent COMPLETION
 *   "didn't meet HOMEEIGO's standards"        → eligibleIssueTypes QUALITY + INCOMPLETE (damage, behaviour, billing are not in the text)
 *   "with photos where possible"              → proofRequired = false
 *   "first offer a free rework"               → reworkFirst = true, rework.fee = WAIVED
 *   "may issue a partial or full refund"      → refundAllowed = true (a case still decides; one refund per case)
 *
 * A service that already carries a DIFFERENT explicit warranty / rework / complaint window is left
 * alone (KEEP_EXISTING). Idempotent; the population is read from the database.
 *
 *   bun run scripts/phase10-apply-published-dispute-policy.ts --url "<url>" [--apply --actor-id <SUPER_ADMIN>] [--allow-live]
 */
import { PrismaClient } from "@prisma/client";

type Cfg = Record<string, unknown>;

/** apps/web/src/lib/legal/legal-data.ts, "Quality Disputes & Rework" — verbatim. */
export const PUBLISHED_GUARANTEE =
  "If the service didn't meet HOMEEIGO's standards, raise a dispute within 48 hours of completion through in-app support with photos where possible. We'll first offer a free rework by a professional; if that isn't feasible or acceptable, we may issue a partial or full refund based on a fair review.";

/** apps/web/src/lib/legal/legal-data.ts, "Limitation of Liability" — verbatim. */
export const PUBLISHED_LIABILITY =
  "To the maximum extent permitted by law, HOMEEIGO acts as an intermediary and is not liable for indirect, incidental or consequential damages. Our aggregate liability for any claim is limited to the amount you paid for the specific service giving rise to the claim. Nothing limits liability that cannot be excluded by law.";

export const PUBLISHED_DAMAGE_POLICY = `Damage is not part of the free-rework promise. If something is damaged during a visit, report it in the app within 48 hours of completion, with photos where possible, and our team will review it. ${PUBLISHED_LIABILITY}`;

export const PUBLISHED_DISPUTE_POLICY = {
  complaintWindowDays: 2,
  warranty: {
    enabled: true,
    durationDays: 2,
    startEvent: "COMPLETION" as const,
    eligibleIssueTypes: ["QUALITY", "INCOMPLETE"] as Array<"QUALITY" | "INCOMPLETE">,
    exclusions: [] as string[],
    proofRequired: false,
    reworkFirst: true,
    refundAllowed: true,
    /**
     * The customer-facing texts, shown verbatim on the service page and frozen with each booking.
     * `guarantee` IS the published "Quality Disputes & Rework" clause, word for word.
     * `damagePolicy` says only what is already true: damage is not in that promise (see
     * eligibleIssueTypes), it can still be reported inside the same 48-hour window (a complaint case,
     * which the team triages), and liability is the published "Limitation of Liability" clause, word
     * for word. The test pins both clauses to apps/web/src/lib/legal/legal-data.ts.
     */
    guarantee: PUBLISHED_GUARANTEE,
    damagePolicy: PUBLISHED_DAMAGE_POLICY,
  },
  rework: { fee: "WAIVED" as const },
};

/** The two customer-facing texts. A service whose warranty matches the policy except for these is upgraded. */
const TEXT_KEYS = ["guarantee", "damagePolicy"] as const;
function withoutTexts(warranty: unknown): Cfg {
  const w = { ...((warranty && typeof warranty === "object" ? warranty : {}) as Cfg) };
  for (const k of TEXT_KEYS) delete w[k];
  return w;
}

const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Cfg)[k])}`).join(",")}}` : JSON.stringify(v ?? null);

export type DisputeDecision = "IDENTICAL" | "APPLY" | "KEEP_EXISTING";

/** What this script does for one service config, and the config it would write. */
export function disputePolicyDecision(catalogConfig: unknown): { decision: DisputeDecision; next: Cfg | null; conflicts: string[] } {
  const cur = (catalogConfig && typeof catalogConfig === "object" && !Array.isArray(catalogConfig) ? catalogConfig : {}) as Cfg;
  const quality = (cur.quality ?? {}) as Cfg;
  const P = PUBLISHED_DISPUTE_POLICY;
  const conflicts: string[] = [];
  // The terms decide whether a policy is the owner's own. The two texts are compared separately: a
  // service that carries the published terms without them (applied before they existed) is upgraded;
  // one whose texts were written differently by hand is the owner's wording and is kept.
  if (cur.warranty != null && stable(withoutTexts(cur.warranty)) !== stable(withoutTexts(P.warranty))) conflicts.push("warranty");
  const curWarranty = (cur.warranty ?? {}) as Cfg;
  for (const k of TEXT_KEYS) if (curWarranty[k] != null && curWarranty[k] !== P.warranty[k]) conflicts.push(`warranty.${k}`);
  if (cur.rework != null && stable(cur.rework) !== stable(P.rework)) conflicts.push("rework");
  if (quality.complaintWindowDays != null && quality.complaintWindowDays !== P.complaintWindowDays) conflicts.push("quality.complaintWindowDays");
  if (quality.warrantyDays != null && quality.warrantyDays !== 0 && quality.warrantyDays !== P.warranty.durationDays) conflicts.push("quality.warrantyDays");
  if (quality.notApplicable === true) conflicts.push("quality.notApplicable");
  if (conflicts.length) return { decision: "KEEP_EXISTING", next: null, conflicts };
  const identical =
    cur.warranty != null && cur.rework != null && quality.complaintWindowDays === P.complaintWindowDays && TEXT_KEYS.every((k) => curWarranty[k] === P.warranty[k]);
  if (identical) return { decision: "IDENTICAL", next: null, conflicts: [] };
  const next: Cfg = { ...cur, quality: { ...quality, complaintWindowDays: P.complaintWindowDays }, warranty: { ...P.warranty }, rework: { ...P.rework } };
  delete next.requirementItems;
  return { decision: "APPLY", next, conflicts: [] };
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
    const { validateOnTarget } = await import("./phase10-content-apply-plan");
    const { catalogService } = await import("../src/services/catalog.service");
    console.log(`\n[dispute-policy] ${APPLY ? "APPLY" : "REPORT"} on "${db}" — published 48-hour dispute + free-rework promise\n${"=".repeat(70)}`);
    const services = await prisma.service.findMany({ where: { isActive: true, dataOrigin: null }, select: { id: true, slug: true, version: true, catalogConfig: true }, orderBy: { slug: "asc" } });
    const tally: Record<string, number> = { IDENTICAL: 0, APPLY: 0, KEEP_EXISTING: 0, INVALID: 0, ERROR: 0 };
    for (const svc of services) {
      const { decision, next, conflicts } = disputePolicyDecision(svc.catalogConfig);
      if (decision === "KEEP_EXISTING") { tally.KEEP_EXISTING!++; console.log(`${svc.slug}: KEEP_EXISTING (explicit ${conflicts.join(", ")} differs — an owner-set policy is never overwritten)`); continue; }
      if (decision === "IDENTICAL") { tally.IDENTICAL!++; continue; }
      const problems = validateOnTarget(next!);
      if (problems.length) { tally.INVALID!++; console.log(`${svc.slug}: INVALID_ON_TARGET ${problems.slice(0, 2).join("; ")}`); continue; }
      tally.APPLY!++;
      console.log(`${svc.slug}: ${APPLY ? "APPLY" : "WOULD_APPLY"} complaintWindowDays=2 · warranty 2 days (QUALITY, INCOMPLETE; rework first; refund allowed) · rework fee WAIVED`);
      if (!APPLY) continue;
      const r = await catalogService.update(svc.id, { catalogConfig: next as never, expectedVersion: svc.version, changeReason: "Published quality-dispute policy (Refund & Cancellation Policy, 'Quality Disputes & Rework'): 48-hour dispute window, free rework first, partial/full refund after review" }, actorId!);
      if ("error" in r && r.error) { tally.ERROR!++; tally.APPLY!--; console.log(`  → ERROR ${r.error}`); }
    }
    console.log(`${"=".repeat(70)}\n[dispute-policy] services=${services.length} ${APPLY ? "applied" : "would-apply"}=${tally.APPLY} identical=${tally.IDENTICAL} kept=${tally.KEEP_EXISTING} invalid=${tally.INVALID} errors=${tally.ERROR}`);
    if (tally.ERROR || tally.INVALID) process.exitCode = 1;
    const { AuditLogService } = await import("../src/services/audit-log.service");
    const left = await AuditLogService.drain();
    if (left) { console.error(`WARNING: ${left} audit write(s) still pending at exit`); process.exitCode = 1; }
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.main) main().catch((e) => { console.error(e); process.exit(1); });
