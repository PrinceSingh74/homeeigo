import { describe, expect, it } from "bun:test";
import { PaymentStatus } from "@prisma/client";
import { validateAdminRefundAmount } from "../lib/payment-refund-rules";

const paid = (over: Partial<Parameters<typeof validateAdminRefundAmount>[1]> = {}) => ({
  amount: 500,
  amountPaid: 500,
  refundedAmount: 0,
  status: PaymentStatus.SUCCESS,
  ...over,
});

describe("validateAdminRefundAmount", () => {
  it("rejects zero, negative and non-finite amounts", () => {
    expect(validateAdminRefundAmount(0, paid())).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(validateAdminRefundAmount(-1, paid())).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(validateAdminRefundAmount(Number.NaN, paid())).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
    expect(validateAdminRefundAmount(Number.POSITIVE_INFINITY, paid())).toEqual({ ok: false, reason: "INVALID_AMOUNT" });
  });

  it("rejects more than what was paid", () => {
    expect(validateAdminRefundAmount(500.01, paid())).toEqual({ ok: false, reason: "AMOUNT_EXCEEDS_REFUNDABLE" });
    expect(validateAdminRefundAmount(500, paid())).toEqual({ ok: true });
  });

  it("accounts for earlier partial refunds", () => {
    const partial = paid({ refundedAmount: 200, status: PaymentStatus.PARTIALLY_REFUNDED });
    expect(validateAdminRefundAmount(300, partial)).toEqual({ ok: true });
    expect(validateAdminRefundAmount(300.5, partial)).toEqual({ ok: false, reason: "AMOUNT_EXCEEDS_REFUNDABLE" });
  });

  it("treats a partially refunded payment as still refundable, everything else as not", () => {
    expect(validateAdminRefundAmount(10, paid({ status: PaymentStatus.PARTIALLY_REFUNDED, refundedAmount: 100 }))).toEqual({ ok: true });
    for (const status of [
      PaymentStatus.PENDING,
      PaymentStatus.FAILED,
      PaymentStatus.REFUNDED,
      PaymentStatus.REFUNDING,
      PaymentStatus.INITIATED,
      PaymentStatus.PROCESSING,
    ]) {
      expect(validateAdminRefundAmount(10, paid({ status }))).toEqual({ ok: false, reason: "NOT_REFUNDABLE" });
    }
  });

  it("falls back to `amount` when amountPaid was never recorded", () => {
    expect(validateAdminRefundAmount(400, paid({ amountPaid: 0, amount: 400 }))).toEqual({ ok: true });
    expect(validateAdminRefundAmount(401, paid({ amountPaid: 0, amount: 400 }))).toEqual({ ok: false, reason: "AMOUNT_EXCEEDS_REFUNDABLE" });
  });
});
