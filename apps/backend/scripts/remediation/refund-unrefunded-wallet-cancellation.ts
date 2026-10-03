/**
 * Remediate ONE wallet-paid booking that was cancelled but refunded ₹0 (the pre-Option-B defect).
 *
 * Owner-approved use only. Dry-run by default: prints the booking's money state and the exact entries
 * the fix would write, and changes nothing. With --execute it refunds through the production refund
 * path (`bookingRefundService.processCancellationRefund`, the Option B wallet branch) — the same
 * ceiling, lock, idempotency keys and journal every new cancellation uses — so it can be run twice
 * without paying twice.
 *
 *   # dry run
 *   bun scripts/remediation/refund-unrefunded-wallet-cancellation.ts <BOOKING_NUMBER> <AMOUNT_INR> <APPROVER_USER_ID>
 *   # execute (a non-test database also needs the approval token to match exactly)
 *   REMEDIATION_APPROVAL="<BOOKING_NUMBER>:<AMOUNT_INR>" bun scripts/remediation/refund-unrefunded-wallet-cancellation.ts \
 *       <BOOKING_NUMBER> <AMOUNT_INR> <APPROVER_USER_ID> --execute
 *
 * Refuses: an unknown booking; a booking not CANCELLED; not paid from the wallet; one with a payments
 * row (not wallet-only); one already refunded; an amount above what the wallet paid.
 */
import "../../src/load-env";

const [bookingNumber, amountArg, approverId] = process.argv.slice(2);
const EXECUTE = process.argv.includes("--execute");
if (!bookingNumber || !amountArg || !approverId) {
  console.error("usage: <BOOKING_NUMBER> <AMOUNT_INR> <APPROVER_USER_ID> [--execute]");
  process.exit(2);
}
const amount = Math.round(Number(amountArg) * 100) / 100;
if (!Number.isFinite(amount) || amount <= 0) { console.error("REFUSED: amount must be positive"); process.exit(2); }

const prisma = (await import("../../src/lib/prisma")).default;
const { bookingRefundService } = await import("../../src/services/booking-refund.service");
const db = ((await prisma.$queryRawUnsafe(`SELECT current_database() AS d`)) as Array<{ d: string }>)[0]!.d;
const isTestDb = /_test$/.test(db);

const booking = await prisma.booking.findFirst({ where: { bookingNumber } });
const refuse = (why: string) => { console.error(`REFUSED: ${why}`); process.exit(3); };
if (!booking || !booking.userId) refuse(`booking ${bookingNumber} not found in ${db}`);
const b = booking!;
if (!String(b.status).startsWith("CANCELLED")) refuse(`status is ${b.status}, not cancelled`);
if (b.paymentMethod !== "wallet" || b.paymentStatus !== "SUCCESS") refuse(`not a wallet-paid booking (${b.paymentMethod}/${b.paymentStatus})`);
if (await prisma.payment.findUnique({ where: { bookingId: b.id } })) refuse("has a payments row — not a wallet-only booking");
const refunds = await prisma.walletTransaction.findMany({ where: { referenceId: b.id, type: "REFUND", status: "COMPLETED" } });
if (refunds.length > 0) refuse(`already refunded (${refunds.length} wallet refund(s))`);
const remaining = await bookingRefundService.refundableRemaining(b.id, b.userId!);
if (remaining === null || amount > remaining) refuse(`amount ${amount} exceeds what the wallet paid and is still refundable (${remaining})`);

const user = await prisma.user.findUniqueOrThrow({ where: { id: b.userId! }, select: { walletBalance: true } });
const plan = {
  database: db,
  booking: { id: b.id, bookingNumber, status: b.status, finalAmount: b.finalAmount, refundAmount: b.refundAmount, refundStatus: b.refundStatus },
  refundableRemaining: remaining,
  willWrite: {
    walletTransaction: { type: "REFUND", amount, referenceType: "booking_cancel_refund", idempotencyKey: `wallet-cancel-refund:${b.id}` },
    journal: { idempotencyKey: `wallet_booking_refund:${b.id}`, lines: [{ account: "PLATFORM_ESCROW", debit: amount }, { account: "CUSTOMER_WALLET", credit: amount }] },
    customerWallet: { before: user.walletBalance, after: Math.round((user.walletBalance + amount) * 100) / 100 },
    booking: { refundAmount: amount, refundStatus: "processed" },
  },
};
console.log(JSON.stringify({ mode: EXECUTE ? "EXECUTE" : "DRY-RUN", ...plan }, null, 1));
if (!EXECUTE) { await prisma.$disconnect(); process.exit(0); }

if (!isTestDb && process.env.REMEDIATION_APPROVAL !== `${bookingNumber}:${amount}`) {
  refuse(`database ${db} is not a test database: REMEDIATION_APPROVAL must equal "${bookingNumber}:${amount}"`);
}
const result = await bookingRefundService.processCancellationRefund({
  bookingId: b.id,
  userId: b.userId!,
  actorUserId: approverId,
  reason: `Remediation: cancellation refund owed since ${b.cancelledAt?.toISOString().slice(0, 10)} (approved)`,
  cancelledBy: b.cancelledBy === "provider" ? "provider" : "user",
  refundAmount: amount,
});
if (result.status === "processed") {
  await prisma.booking.update({ where: { id: b.id }, data: { refundAmount: amount, refundStatus: "processed" } });
}
console.log(JSON.stringify({ result }, null, 1));
await prisma.$disconnect();
process.exit(result.status === "processed" ? 0 : 1);
