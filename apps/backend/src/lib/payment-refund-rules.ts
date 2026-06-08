import { PaymentStatus } from "@prisma/client";

export function validateAdminRefundAmount(
  amount: number,
  payment: { amount: number; amountPaid: number; refundedAmount: number; status: PaymentStatus },
): { ok: true } | { ok: false; reason: string } {
  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "INVALID_AMOUNT" };
  }
  if (payment.status !== PaymentStatus.SUCCESS) {
    return { ok: false, reason: "NOT_REFUNDABLE" };
  }
  const maxRefundable = (payment.amountPaid || payment.amount) - (payment.refundedAmount ?? 0);
  if (amount > maxRefundable) {
    return { ok: false, reason: "AMOUNT_EXCEEDS_REFUNDABLE" };
  }
  return { ok: true };
}
