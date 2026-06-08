import { describe, expect, test } from "bun:test";
import { PaymentStatus } from "@prisma/client";
import { resolveBookingCancelActor } from "../lib/booking-cancel-auth";
import { resolveAppleAccountEmail } from "../lib/apple-identity";
import { validateAdminRefundAmount } from "../lib/payment-refund-rules";

describe("BLOCKER 1 — booking cancel authorization", () => {
  test("customer can cancel own booking", () => {
    const r = resolveBookingCancelActor("user-1", undefined, {
      userId: "user-1",
      providerId: "prov-1",
    });
    expect(r).toEqual({ allowed: true, cancelledBy: "user" });
  });

  test("assigned provider can cancel booking", () => {
    const r = resolveBookingCancelActor("user-2", "prov-1", {
      userId: "user-1",
      providerId: "prov-1",
    });
    expect(r).toEqual({ allowed: true, cancelledBy: "provider" });
  });

  test("stranger cannot cancel via forged provider role", () => {
    const r = resolveBookingCancelActor("user-2", undefined, {
      userId: "user-1",
      providerId: "prov-1",
    });
    expect(r).toEqual({ allowed: false });
  });

  test("wrong provider cannot cancel", () => {
    const r = resolveBookingCancelActor("user-2", "prov-99", {
      userId: "user-1",
      providerId: "prov-1",
    });
    expect(r).toEqual({ allowed: false });
  });
});

describe("BLOCKER 3 — Apple OAuth identity", () => {
  test("uses verified id_token email only", () => {
    expect(resolveAppleAccountEmail({ email: "Real@Apple.com", sub: "sub-1" })).toBe(
      "real@apple.com",
    );
  });

  test("rejects missing token email", () => {
    expect(() => resolveAppleAccountEmail({ sub: "sub-1" })).toThrow("Email not provided by Apple");
  });
});

describe("BLOCKER 5 — admin refund caps", () => {
  const base = {
    amount: 1000,
    amountPaid: 1000,
    refundedAmount: 0,
    status: PaymentStatus.SUCCESS,
  };

  test("rejects zero amount", () => {
    expect(validateAdminRefundAmount(0, base).ok).toBe(false);
  });

  test("rejects over-refund", () => {
    expect(validateAdminRefundAmount(1001, base).ok).toBe(false);
  });

  test("allows partial refund within cap", () => {
    expect(validateAdminRefundAmount(400, base).ok).toBe(true);
  });

  test("respects prior refunded amount", () => {
    expect(validateAdminRefundAmount(600, { ...base, refundedAmount: 500 }).ok).toBe(false);
    expect(validateAdminRefundAmount(500, { ...base, refundedAmount: 500 }).ok).toBe(true);
  });
});
