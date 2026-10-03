/**
 * Phase A — stale partner safety incidents: classify, and (owner-run) resolve the test artefacts.
 *
 *   bun run scripts/phase-a-stale-incidents.ts --url "<postgres url>"                       # report only
 *   bun run scripts/phase-a-stale-incidents.ts --url "<postgres url>" --apply --actor <adminUserId>
 *
 * WHAT IT DECIDES
 * ---------------
 * An open incident is a TEST_ARTEFACT only when every one of these holds, each from a column, not
 * a guess: the reporting partner's address matches a provenance rule (`classifyUserEmail`), the
 * incident was opened by a script-driven SOS (`evidence.source = partner_sos`), and it is either
 * unlinked or linked to a booking that is already terminal or carries a number the booking-number
 * generator never minted. Anything else is NEEDS_HUMAN and this script never touches it.
 *
 * WHAT IT NEVER DOES
 * ------------------
 * It never deletes. It resolves through `partnerSafetyService.resolve` — the same transition the
 * admin console uses — so the activity log, the resolution note and the outbox event are written
 * exactly as they would be for a human. `--actor` must be an active admin user: the row records who
 * resolved it, and this script has no authority of its own to lend.
 */
import { PrismaClient } from "@prisma/client";
import { CANONICAL_BOOKING_NUMBER, classifyUserEmail } from "../src/lib/data-provenance";
import { resolveUserEmails } from "./lib/resolve-user-emails";

const APPLY = process.argv.includes("--apply");
const urlIdx = process.argv.indexOf("--url");
const url = urlIdx >= 0 ? process.argv[urlIdx + 1] : undefined;
const actorIdx = process.argv.indexOf("--actor");
const actor = actorIdx >= 0 ? process.argv[actorIdx + 1] : undefined;
if (!url) {
  console.error("REFUSING: --url is required. This script never inherits DATABASE_URL.");
  process.exit(2);
}
if (APPLY && !actor) {
  console.error("REFUSING: --apply needs --actor <adminUserId> — a resolution must name the admin who made it.");
  process.exit(2);
}
// The service layer reads DATABASE_URL at import; point it at the same database as --url so the
// canonical resolve path and this report cannot disagree about which database they touch.
process.env.DATABASE_URL = url;
const prisma = new PrismaClient({ datasources: { db: { url } } });

const TERMINAL = new Set(["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "REJECTED", "EXPIRED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"]);

type Verdict = "TEST_ARTEFACT" | "NEEDS_HUMAN";
type Row = {
  id: string; type: string; severity: string; status: string; createdAt: string; providerId: string;
  providerEmailRule: string | null; source: string | null; bookingNumber: string | null; bookingStatus: string | null;
  verdict: Verdict; because: string[];
};

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  console.log(`\n[phase-a incidents] ${APPLY ? "APPLY" : "REPORT (read-only)"} on "${db}"\n${"=".repeat(78)}`);

  const open = await prisma.partnerSafetyIncident.findMany({
    where: { status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } },
    orderBy: { createdAt: "asc" },
  });
  const providers = await prisma.provider.findMany({
    where: { id: { in: [...new Set(open.map((i) => i.providerId))] } },
    select: { id: true, userId: true },
  });
  const providerUser = new Map(providers.map((p) => [p.id, p.userId]));
  const { emails } = await resolveUserEmails(prisma, "phase-a-stale-incidents");
  const bookingIds = open.map((i) => i.bookingId).filter((x): x is string => !!x);
  const bookings = bookingIds.length
    ? await prisma.booking.findMany({ where: { id: { in: bookingIds } }, select: { id: true, bookingNumber: true, status: true } })
    : [];
  const bookingById = new Map(bookings.map((b) => [b.id, b]));

  const rows: Row[] = open.map((i) => {
    const ev = (i.evidence ?? {}) as Record<string, unknown>;
    const source = typeof ev.source === "string" ? ev.source : null;
    const email = emails.get(providerUser.get(i.providerId) ?? "") ?? null;
    const rule = classifyUserEmail(email);
    const b = i.bookingId ? bookingById.get(i.bookingId) : undefined;
    const because: string[] = [];
    let artefact = true;
    if (rule) because.push(`partner e-mail matches ${rule.ruleId}`); else { artefact = false; because.push("partner e-mail matches no provenance rule"); }
    if (source === "partner_sos") because.push("opened by the SOS path"); else { artefact = false; because.push(`source=${source ?? "unknown"}`); }
    if (!i.bookingId) because.push("no booking linked");
    else if (!b) { artefact = false; because.push("linked booking not found"); }
    else {
      const terminal = TERMINAL.has(b.status);
      const nonCanonical = !CANONICAL_BOOKING_NUMBER.test(b.bookingNumber);
      if (terminal) because.push(`booking ${b.bookingNumber} is ${b.status}`);
      if (nonCanonical) because.push(`booking number ${b.bookingNumber.split("-")[0]}- was not minted by the generator`);
      if (!terminal && !nonCanonical) { artefact = false; because.push(`booking ${b.bookingNumber} is live (${b.status})`); }
    }
    return {
      id: i.id, type: i.type, severity: i.severity, status: i.status, createdAt: i.createdAt.toISOString(), providerId: i.providerId,
      providerEmailRule: rule?.ruleId ?? null, source, bookingNumber: b?.bookingNumber ?? null, bookingStatus: b?.status ?? null,
      verdict: artefact ? "TEST_ARTEFACT" : "NEEDS_HUMAN", because,
    };
  });

  for (const r of rows) {
    console.log(`\n${r.id}  ${r.type}/${r.severity}  ${r.status}  opened ${r.createdAt.slice(0, 10)}  → ${r.verdict}`);
    for (const b of r.because) console.log(`    - ${b}`);
  }
  const artefacts = rows.filter((r) => r.verdict === "TEST_ARTEFACT");
  console.log(`\nopen incidents: ${rows.length}; test artefacts: ${artefacts.length}; needs a human: ${rows.length - artefacts.length}`);

  if (!APPLY) {
    console.log(`\n${"=".repeat(78)}\n[phase-a incidents] REPORT ONLY — nothing was written. Re-run with --apply --actor <adminUserId> to resolve the test artefacts.`);
    return;
  }

  const admin = await prisma.adminUser.findUnique({ where: { userId: actor! }, select: { isActive: true, role: { select: { name: true } } } });
  if (!admin?.isActive) {
    console.error(`REFUSING: --actor ${actor} is not an active admin user on "${db}".`);
    process.exit(2);
  }
  const { partnerSafetyService } = await import("../src/services/partner-safety.service");
  let resolved = 0;
  for (const r of artefacts) {
    const notes = `Phase A cleanup (2026-09-24): test artefact — ${r.because.join("; ")}. No person was at risk.`;
    const row = await partnerSafetyService.resolve(r.id, actor!, notes);
    if (row) resolved++;
    console.log(`resolved ${r.id} as ${admin.role.name} ${actor}`);
  }
  console.log(`\n[phase-a incidents] APPLIED — ${resolved} incident(s) resolved through the canonical admin path; ${rows.length - artefacts.length} left for a human.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
