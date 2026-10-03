import { PaymentStatus } from "@prisma/client";

export function validateAdminRefundAmount(
  amount: number,
  payment: { amount: number; amountPaid: number; refundedAmount: number; status: PaymentStatus },
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "INVALID_AMOUNT" };
  }
  // A partially refunded payment still has a refundable remainder; only the max check below
  // decides whether this particular amount fits.
  /**
   * EXPIRED is refundable ONLY when a capture was actually recorded against the row.
   *
   * PAYMENT_PENDING_TTL can close a booking's window moments before the gateway captures. The money
   * then genuinely exists while the row says EXPIRED, and O10 refunds it — through this one
   * authority, never a side path. `amountPaid > 0` is the evidence that a capture was recorded; an
   * EXPIRED row with nothing captured has nothing to refund and is still refused.
   */
  const capturedAfterExpiry = payment.status === PaymentStatus.EXPIRED && (payment.amountPaid ?? 0) > 0;
  if (
    payment.status !== PaymentStatus.SUCCESS &&
    payment.status !== PaymentStatus.PARTIALLY_REFUNDED &&
    !capturedAfterExpiry
  ) {
    return { ok: false, reason: "NOT_REFUNDABLE" };
  }
  const maxRefundable = (payment.amountPaid || payment.amount) - (payment.refundedAmount ?? 0);
  if (amount > maxRefundable) {
    return { ok: false, reason: "AMOUNT_EXCEEDS_REFUNDABLE" };
  }
  return { ok: true };
}
