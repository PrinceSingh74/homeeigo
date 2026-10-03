/**
 * Provenance report and backfill — read-only by default.
 *
 * Classifies historical rows using the rules in `src/lib/data-provenance.ts`, shows what each label
 * would be and the exact evidence behind it, and writes **nothing** unless `--apply` is passed.
 *
 *   bun run scripts/provenance-report.ts --url "<postgres url>"            # report only
 *   bun run scripts/provenance-report.ts --url "<postgres url>" --apply    # write data_origin
 *
 * `--apply` sets `data_origin` ONLY where it is currently NULL and a rule fires. It never
 * overwrites an existing value, never deletes a row, and never promotes an unclassified row to
 * REAL — uncertain history stays UNKNOWN, because an unclassified row is counted as business and
 * inventing a label to tidy a report is exactly the failure this column exists to prevent.
 *
 * The target is always explicit. `prisma.config.ts` loads dotenv, and a data-writing script that
 * inherits `DATABASE_URL` is how a backfill ends up on the wrong database.
 */
import { PrismaClient } from "@prisma/client";
import {
  ALL_RULES,
  classifyBookingFromRefunds,
  classifyRefundReason,
  classifyUserEmail,
  type Classification,
  classifyBookingNumber,
} from "../src/lib/data-provenance";
import { resolveUserEmails } from "./lib/resolve-user-emails";

const argOf = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const url = argOf("url");
const APPLY = process.argv.includes("--apply");

if (!url) {
  console.error("REFUSING: --url is required. This script never inherits DATABASE_URL.");
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

type Row = { table: string; id: string; origin: string; ruleId: string; because: string; evidence: string; createdAt: string; related?: string };

async function main() {
  const [{ db }] = await prisma.$queryRawUnsafe<{ db: string }[]>("SELECT current_database() AS db");
  console.log(`\n[provenance] ${APPLY ? "APPLY" : "REPORT (read-only)"} on "${db}"\n${"=".repeat(78)}`);

  const proposed: Row[] = [];

  // ── refund_requests ───────────────────────────────────────────────────────────────────────────
  const refunds = await prisma.refundRequest.findMany({
    select: { id: true, reason: true, createdAt: true, dataOrigin: true, paymentId: true },
  });

  /**
   * `RefundRequest` holds `paymentId` as a scalar, not a relation, so the booking is resolved in a
   * second query rather than an include. One lookup for the whole set — a per-row query here would
   * turn a report into an N+1 over every refund in the database.
   */
  const paymentToBooking = new Map<string, string>();
  const paymentIds = [...new Set(refunds.map((r) => r.paymentId).filter((x): x is string => !!x))];
  if (paymentIds.length > 0) {
    const payments = await prisma.payment.findMany({
      where: { id: { in: paymentIds } },
      select: { id: true, bookingId: true },
    });
    for (const p of payments) if (p.bookingId) paymentToBooking.set(p.id, p.bookingId);
  }

  const bookingEvidence = new Map<string, Classification[]>();
  /** Earliest classified refund per booking — the time the harness touched it. */
  const firstRefundAt = new Map<string, Date>();
  for (const r of refunds) {
    const c = classifyRefundReason(r.reason);
    if (!c) continue;
    const bookingId = r.paymentId ? paymentToBooking.get(r.paymentId) : undefined;
    if (bookingId) {
      const list = bookingEvidence.get(bookingId) ?? [];
      list.push(c);
      bookingEvidence.set(bookingId, list);
      const prev = firstRefundAt.get(bookingId);
      if (!prev || r.createdAt < prev) firstRefundAt.set(bookingId, r.createdAt);
    }
    if (r.dataOrigin == null) {
      proposed.push({
        table: "refund_requests", id: r.id, origin: c.origin, ruleId: c.ruleId, because: c.because,
        evidence: c.evidence, createdAt: r.createdAt.toISOString().slice(0, 10),
        related: bookingId ? `booking:${bookingId}` : undefined,
      });
    }
  }

  // ── users ─────────────────────────────────────────────────────────────────────────────────────
  const users = await prisma.user.findMany({ select: { id: true, email: true, createdAt: true, dataOrigin: true } });
  // Addresses are resolved plaintext-or-encrypted: `users.email` is NULL for ~90% of accounts after
  // PII encryption, and classifying that column alone left almost every fixture account UNKNOWN.
  // Decrypting writes one audited DATA_DECRYPTED row per encrypted address (see the helper).
  const { emails, decrypted, failed } = await resolveUserEmails(prisma, "provenance-backfill");
  console.log(`
user e-mails resolved: ${emails.size} (decrypted ${decrypted}, undecryptable ${failed})`);
  for (const u of users) {
    const c = classifyUserEmail(emails.get(u.id) ?? null);
    if (!c || u.dataOrigin != null) continue;
    proposed.push({
      table: "users", id: u.id, origin: c.origin, ruleId: c.ruleId, because: c.because,
      evidence: c.evidence, createdAt: u.createdAt.toISOString().slice(0, 10),
    });
  }

  // ── bookings (non-canonical booking number) ───────────────────────────────────────────────────
  // Structural evidence: only `lib/booking-number.ts` mints numbers, and it mints one format. A
  // number it could not have produced was written by a script. Rows already labelled are skipped.
  const numbered = await prisma.booking.findMany({
    where: { dataOrigin: null, NOT: { bookingNumber: { startsWith: "HOMIGO-" } } },
    select: { id: true, bookingNumber: true, createdAt: true },
  });
  for (const b of numbered) {
    const c = classifyBookingNumber(b.bookingNumber);
    if (!c) continue;
    proposed.push({
      table: "bookings", id: b.id, origin: c.origin, ruleId: c.ruleId, because: c.because,
      evidence: c.evidence, createdAt: b.createdAt.toISOString().slice(0, 10), related: `number:${b.bookingNumber}`,
    });
  }
  console.log(`
bookings with a non-canonical number: ${numbered.length}`);

  // ── bookings (inherited from their refunds) ───────────────────────────────────────────────────
  if (bookingEvidence.size > 0) {
    const bookings = await prisma.booking.findMany({
      where: { id: { in: [...bookingEvidence.keys()] } },
      select: { id: true, createdAt: true, dataOrigin: true, userId: true },
    });
    const accountCreated = new Map(users.map((u) => [u.id, u.createdAt]));
    let notSameRun = 0;
    for (const b of bookings) {
      // Inheritance needs the account, booking and refund to come from one run; see
      // `classifyBookingFromRefunds`. Anything else stays UNKNOWN and is counted, not labelled.
      const c = classifyBookingFromRefunds(bookingEvidence.get(b.id) ?? [], {
        accountCreatedAt: accountCreated.get(b.userId) ?? b.createdAt,
        bookingCreatedAt: b.createdAt,
        firstRefundAt: firstRefundAt.get(b.id) ?? b.createdAt,
      });
      if (!c) notSameRun++;
      if (!c || b.dataOrigin != null) continue;
      proposed.push({
        table: "bookings", id: b.id, origin: c.origin, ruleId: c.ruleId, because: c.because,
        evidence: c.evidence, createdAt: b.createdAt.toISOString().slice(0, 10),
        related: `refunds:${(bookingEvidence.get(b.id) ?? []).length}`,
      });
    }
    console.log(
      `
bookings with a classified refund: ${bookings.length}; left UNKNOWN because the refund did not ` +
        `come from the run that created the booking: ${notSameRun} (see classifyBookingFromRefunds)`,
    );
  }

  // ── summary ───────────────────────────────────────────────────────────────────────────────────
  const byTable = new Map<string, Map<string, number>>();
  for (const p of proposed) {
    const m = byTable.get(p.table) ?? new Map<string, number>();
    m.set(p.origin, (m.get(p.origin) ?? 0) + 1);
    byTable.set(p.table, m);
  }

  const totals = {
    refund_requests: refunds.length,
    users: users.length,
    bookings: await prisma.booking.count(),
  };

  console.log("\nPROPOSED CLASSIFICATIONS (rows currently UNKNOWN that a rule can label)\n");
  for (const [table, origins] of byTable) {
    const classified = [...origins.values()].reduce((a, b) => a + b, 0);
    const total = totals[table as keyof typeof totals] ?? 0;
    console.log(`  ${table}  —  ${classified} of ${total} rows (${((classified / Math.max(total, 1)) * 100).toFixed(1)}%)`);
    for (const [origin, n] of [...origins.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`      ${origin.padEnd(26)} ${n}`);
    }
  }
  if (proposed.length === 0) console.log("  (nothing to classify — every row is either already labelled or unmatched)");

  console.log(`\n  UNCLASSIFIED rows remain UNKNOWN (NULL) and are counted as business by analytics-scope.`);

  console.log(`\nRULE LEGEND\n`);
  for (const r of ALL_RULES) console.log(`  ${r.id.padEnd(34)} -> ${r.origin.padEnd(26)} ${r.because}`);

  console.log(`\nSAMPLE (first 15)\n`);
  for (const p of proposed.slice(0, 15)) {
    console.log(
      `  ${p.createdAt}  ${p.table.padEnd(16)} ${p.origin.padEnd(26)} ${p.ruleId.padEnd(30)} "${p.evidence}"` +
        (p.related ? `  [${p.related}]` : ""),
    );
  }

  if (!APPLY) {
    console.log(`\n${"=".repeat(78)}\n[provenance] REPORT ONLY — nothing was written. Re-run with --apply to persist.`);
    return;
  }

  // ── apply ─────────────────────────────────────────────────────────────────────────────────────
  let written = 0;
  for (const p of proposed) {
    const data = { dataOrigin: p.origin as never };
    // `dataOrigin: null` in the filter makes this idempotent and non-destructive: an existing label
    // is never overwritten, so a re-run cannot change a decision somebody already made.
    if (p.table === "refund_requests") {
      written += (await prisma.refundRequest.updateMany({ where: { id: p.id, dataOrigin: null }, data })).count;
    } else if (p.table === "users") {
      written += (await prisma.user.updateMany({ where: { id: p.id, dataOrigin: null }, data })).count;
    } else if (p.table === "bookings") {
      written += (await prisma.booking.updateMany({ where: { id: p.id, dataOrigin: null }, data })).count;
    }
  }
  console.log(`\n${"=".repeat(78)}\n[provenance] APPLIED — ${written} row(s) labelled. No row was deleted or overwritten.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
