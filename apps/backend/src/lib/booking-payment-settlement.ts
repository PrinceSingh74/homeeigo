import { BookingStatus, PaymentStatus, Prisma } from "@prisma/client";
import { paymentDispositionFor } from "./booking-state-machine";
import { incCounter } from "./metrics";
import { logger } from "./logger";
import { setBookingAuditContext } from "./booking-audit-context";

export type PaymentDisposition = "APPLY" | "REFUND";

/**
 * A payment row that has already captured money. A replayed capture (verify retry, duplicate or
 * late webhook) for the SAME gateway payment is "already reconciled" in every one of these — not
 * only SUCCESS. Checking SUCCESS alone let a replay after a refund write SUCCESS over REFUNDED and
 * re-open the booking's refund intent.
 */
export const CAPTURED_PAYMENT_STATUSES: readonly PaymentStatus[] = [
  PaymentStatus.SUCCESS,
  PaymentStatus.REFUNDING,
  PaymentStatus.PARTIALLY_REFUNDED,
  PaymentStatus.REFUNDED,
];
export const isCapturedPaymentStatus = (s: PaymentStatus) => CAPTURED_PAYMENT_STATUSES.includes(s);

/**
 * The ONE write that records "money for this booking has been captured" on the booking row.
 *
 * Every settlement path — Razorpay verify, Razorpay webhook, wallet-only, split (verify or
 * webhook) — calls this inside its own money transaction, after it has locked its payment row.
 *
 *  - The booking row is locked here, so this serialises with cancel (which re-checks
 *    payment_status under its own guard) and with accept.
 *  - Lifecycle status is NEVER written. Paying is not accepting, and paying a cancelled booking
 *    is not un-cancelling it.
 *  - A booking that can no longer be served (cancelled / rejected) still records the money — it
 *    was captured — and is marked for a full refund in the same transaction (refundStatus
 *    "pending", refundAmount = captured). That committed row is the durable refund intent: the
 *    post-commit hook starts the refund, and `recoverStrandedCancellationRefunds` finishes it if
 *    the process dies first.
 */
export async function applyBookingPaymentSuccess(
  tx: Prisma.TransactionClient,
  bookingId: string,
  opts: { capturedAmount: number; source: string; paymentMethod?: string },
): Promise<{ disposition: PaymentDisposition; status: BookingStatus }> {
  await setBookingAuditContext(tx, { reason: `payment captured (${opts.source})` });
  const rows = await tx.$queryRaw<Array<{ status: BookingStatus }>>`
    SELECT status FROM bookings WHERE id = ${bookingId} FOR UPDATE
  `;
  const row = rows[0];
  if (!row) throw new Error("BOOKING_NOT_FOUND");

  const disposition = paymentDispositionFor(row.status);
  if (disposition === "APPLY") {
    await tx.booking.update({
      where: { id: bookingId },
      data: {
        paymentStatus: PaymentStatus.SUCCESS,
        ...(opts.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
      },
    });
    return { disposition, status: row.status };
  }

  const refundAmount = Math.round(Math.max(0, opts.capturedAmount) * 100) / 100;
  await tx.booking.update({
    where: { id: bookingId },
    data: {
      paymentStatus: PaymentStatus.SUCCESS,
      ...(opts.paymentMethod ? { paymentMethod: opts.paymentMethod } : {}),
      refundStatus: refundAmount > 0 ? "pending" : "none",
      refundAmount,
    },
  });
  incCounter("booking_payment_after_terminal_total", { source: opts.source, status: row.status });
  logger.warn("booking_payment_after_terminal", {
    category: "PAYMENT",
    bookingId,
    status: row.status,
    source: opts.source,
    refundAmount,
  });
  return { disposition, status: row.status };
}
