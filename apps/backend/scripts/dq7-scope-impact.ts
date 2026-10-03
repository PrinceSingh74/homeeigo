/**
 * What would actually change if the business-analytics call sites were scoped to real activity?
 *
 * DQ-7 is easy to argue about and hard to argue with numbers, so this produces the numbers. For the
 * headline metrics on the admin dashboard, the executive KPIs and the refund console, it computes
 * the value the code returns today and the value it would return scoped to the business population,
 * and prints both.
 *
 * It does not need the `data_origin` column and does not write anything. Classification is done in
 * memory with the same rules `src/lib/data-provenance.ts` uses for the backfill, so the answer here
 * and the answer after the column lands are the same answer.
 *
 *   bun run scripts/dq7-scope-impact.ts --url "<postgres url>"
 *
 * `--url` is mandatory for the reason `verify-migration-authority.ts` documents: a script that
 * inherits DATABASE_URL is a script that eventually reports on the wrong database.
 */
import { PrismaClient } from "@prisma/client";
import {
  classifyBookingFromRefunds,
  classifyRefundReason,
  classifyUserEmail,
  type Classification,
} from "../src/lib/data-provenance";
import type { DataOrigin } from "@prisma/client";
import { isBusinessRow } from "../src/lib/analytics-scope";
import { resolveUserEmails } from "./lib/resolve-user-emails";

const i = process.argv.indexOf("--url");
const url = i >= 0 ? process.argv[i + 1] : undefined;
if (!url) {
  console.error("REFUSING: --url is required. This script never reads DATABASE_URL from the environment.");
  process.exit(2);
}

const prisma = new PrismaClient({ datasources: { db: { url } } });

function pct(part: number, whole: number): string {
  return whole === 0 ? "  n/a" : `${((part / whole) * 100).toFixed(1)}%`;
}

function line(label: string, all: number, business: number, unit = "") {
  const excluded = all - business;
  console.log(
    `  ${label.padEnd(38)} all=${String(all).padStart(8)}${unit}  business=${String(business).padStart(8)}${unit}` +
      `  excluded=${String(excluded).padStart(7)} (${pct(excluded, all)})`,
  );
}

async function main() {
  const [{ current_database: db }] = await prisma.$queryRawUnsafe<{ current_database: string }[]>(
    "SELECT current_database()",
  );
  console.log(`[dq7-impact] target database: ${db}\n`);

  // ── Classify every row once, in memory ────────────────────────────────────────────────────────
  // Explicit selects throughout: the generated client declares `dataOrigin`, and on a database where
  // the migration has not landed a bare find throws P2022.
  const users = await prisma.user.findMany({ select: { id: true, email: true, role: true, createdAt: true } });
  // `.origin`, not the Classification object. Passing the object to `isBusinessRow` happens to give
  // the right answer today only because every rule in data-provenance emits an INFERRED_* value, so
  // an object compares unequal to "REAL" and is excluded. The day a rule classifies something as
  // REAL that accident reverses silently.
  // Plaintext-or-encrypted, via the same helper the backfill uses (see scripts/lib). This script
  // used to classify `users.email`, which is NULL for ~90% of accounts after PII encryption.
  const { emails, decrypted } = await resolveUserEmails(prisma, "dq7-impact");
  console.log(`(user e-mails resolved: ${emails.size}, of which decrypted: ${decrypted} — each audited)
`);
  const userOrigin = new Map<string, DataOrigin | null>(
    users.map((u) => [u.id, classifyUserEmail(emails.get(u.id) ?? "")?.origin ?? null]),
  );

  const refunds = await prisma.refundRequest.findMany({
    // RefundRequest carries `paymentId`, not `bookingId` — the booking is one hop further out.
    select: { id: true, reason: true, status: true, paymentId: true, createdAt: true },
  });
  const refundOrigin = new Map<string, DataOrigin | null>(
    refunds.map((r) => [r.id, classifyRefundReason(r.reason ?? "")?.origin ?? null]),
  );

  const payments = await prisma.payment.findMany({ select: { id: true, bookingId: true } });
  const bookingIdForPayment = new Map(payments.map((p) => [p.id, p.bookingId]));

  // A booking inherits from its customer, and from a refund raised against it ONLY when the same
  // run made the account, the booking and the refund — via `classifyBookingFromRefunds`, the same
  // function the backfill uses. This script used to re-implement the rule inline without that
  // condition, and the "GMV overstated by 22%" figure it produced rested entirely on the
  // uncorroborated version: 100 of the 103 bookings it excluded were classified only through a
  // refund, from 5 established accounts, 99 of them not created in the same run as the refund.
  const bookings = await prisma.booking.findMany({
    select: {
      id: true, userId: true, status: true, paymentStatus: true, finalAmount: true, totalAmount: true, createdAt: true,
    },
  });
  const accountCreated = new Map(users.map((u) => [u.id, u.createdAt]));
  const refundEvidence = new Map<string, { list: Classification[]; first: Date }>();
  for (const r of refunds) {
    const bookingId = r.paymentId ? bookingIdForPayment.get(r.paymentId) : undefined;
    const c = classifyRefundReason(r.reason ?? "");
    if (!bookingId || !c) continue;
    const cur = refundEvidence.get(bookingId) ?? { list: [], first: r.createdAt };
    cur.list.push(c);
    if (r.createdAt < cur.first) cur.first = r.createdAt;
    refundEvidence.set(bookingId, cur);
  }
  const bookingOrigin = new Map<string, DataOrigin | null>(
    bookings.map((b) => {
      const fromUser = userOrigin.get(b.userId) ?? null;
      if (fromUser) return [b.id, fromUser] as const;
      const ev = refundEvidence.get(b.id);
      const fromRefund = ev
        ? classifyBookingFromRefunds(ev.list, {
            accountCreatedAt: accountCreated.get(b.userId) ?? b.createdAt,
            bookingCreatedAt: b.createdAt,
            firstRefundAt: ev.first,
          })?.origin ?? null
        : null;
      return [b.id, fromRefund] as const;
    }),
  );

  const isBizUser = (id: string) => isBusinessRow(userOrigin.get(id));
  const isBizBooking = (id: string) => isBusinessRow(bookingOrigin.get(id));

  // ── Category A metrics, both ways ─────────────────────────────────────────────────────────────
  console.log("admin dashboard (src/services/admin.service.ts:39-44)");
  const customers = users.filter((u) => u.role === "CUSTOMER");
  line("total customers", customers.length, customers.filter((u) => isBizUser(u.id)).length);
  line("total bookings", bookings.length, bookings.filter((b) => isBizBooking(b.id)).length);
  const completed = bookings.filter((b) => b.status === "COMPLETED");
  line("completed bookings", completed.length, completed.filter((b) => isBizBooking(b.id)).length);

  const paid = bookings.filter((b) => b.paymentStatus === "SUCCESS");
  const gmvAll = paid.reduce((a, b) => a + Number(b.finalAmount ?? 0), 0);
  const gmvBiz = paid.filter((b) => isBizBooking(b.id)).reduce((a, b) => a + Number(b.finalAmount ?? 0), 0);
  line("GMV (finalAmount, paid)", Math.round(gmvAll), Math.round(gmvBiz), " INR");

  console.log("\nexecutive KPIs (src/services/geo-intelligence.service.ts:431-437)");
  const revAll = completed.reduce((a, b) => a + Number(b.totalAmount ?? 0), 0);
  const revBiz = completed.filter((b) => isBizBooking(b.id)).reduce((a, b) => a + Number(b.totalAmount ?? 0), 0);
  line("completed revenue", Math.round(revAll), Math.round(revBiz), " INR");
  const cancelled = bookings.filter((b) => b.status.startsWith("CANCELLED"));
  line("cancelled bookings", cancelled.length, cancelled.filter((b) => isBizBooking(b.id)).length);

  console.log("\nrefund console (src/services/refund-workflow.service.ts:194-207)");
  line("refund requests (total)", refunds.length, refunds.filter((r) => isBusinessRow(refundOrigin.get(r.id))).length);
  for (const status of ["COMPLETED", "REJECTED", "FAILED", "INDETERMINATE"]) {
    const rs = refunds.filter((r) => r.status === status);
    line(`  ${status.toLowerCase()}`, rs.length, rs.filter((r) => isBusinessRow(refundOrigin.get(r.id))).length);
  }

  console.log("\nclassification breakdown");
  const dist = new Map<string, number>();
  for (const o of [...userOrigin.values(), ...refundOrigin.values()]) {
    const k: string = o ?? "UNKNOWN (null)";
    dist.set(k, (dist.get(k) ?? 0) + 1);
  }
  for (const [k, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(28)} ${String(n).padStart(7)}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
