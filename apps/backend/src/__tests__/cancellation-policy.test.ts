import { describe, expect, test } from "bun:test";
import { cancellationPolicyService, CANCELLATION_POLICY_V1 } from "../services/cancellation-policy.service";

describe("CancellationPolicyService", () => {
  const scheduled = new Date("2026-12-25T14:00:00Z");

  test("provider cancel is always full refund", () => {
    const q = cancellationPolicyService.calculate({
      paidAmount: 500,
      scheduledDate: scheduled,
      bookingStatus: "ACCEPTED",
      cancelledBy: "provider",
    });
    expect(q.refundAmount).toBe(500);
    expect(q.feeAmount).toBe(0);
    expect(q.tier).toBe("provider_cancel");
  });

  test("user cancel >24h is free", () => {
    const now = new Date("2026-12-23T10:00:00Z");
    const q = cancellationPolicyService.calculate({
      paidAmount: 1000,
      scheduledDate: scheduled,
      bookingStatus: "PENDING",
      cancelledBy: "user",
      now,
    });
    expect(q.refundAmount).toBe(1000);
    expect(q.feePercent).toBe(0);
  });

  /**
   * Owner decision 2026-09-23 (§54) published cancellation.v2: 2 hours or more before the service is
   * now free, where v1 charged 10% between 2 and 24 hours. Both are asserted — the active policy for
   * a new booking, and v1 for a booking that froze it — because the whole point of versioning is
   * that yesterday's booking keeps yesterday's terms.
   */
  test("v2 (active): 2-24 hours before service is free", () => {
    const now = new Date("2026-12-25T02:00:00Z");
    const q = cancellationPolicyService.calculate({
      paidAmount: 1000,
      scheduledDate: scheduled,
      bookingStatus: "ACCEPTED",
      cancelledBy: "user",
      now,
    });
    expect(q.refundAmount).toBe(1000);
    expect(q.feeAmount).toBe(0);
    expect(q.tier).toBe("free");
  });

  test("v1 (frozen on an older booking): the same cancellation still charges 10%", () => {
    const now = new Date("2026-12-25T02:00:00Z");
    const q = cancellationPolicyService.calculate({
      paidAmount: 1000,
      scheduledDate: scheduled,
      bookingStatus: "ACCEPTED",
      cancelledBy: "user",
      now,
      policy: CANCELLATION_POLICY_V1,
    });
    expect(q.refundAmount).toBe(900);
    expect(q.feeAmount).toBe(100);
    expect(q.tier).toBe("standard");
  });

  test("in progress customer cancel is 50%", () => {
    const q = cancellationPolicyService.calculate({
      paidAmount: 800,
      scheduledDate: scheduled,
      bookingStatus: "IN_PROGRESS",
      cancelledBy: "user",
    });
    expect(q.refundAmount).toBe(400);
    expect(q.tier).toBe("in_progress");
  });

  test("wallet payments hint instant refund", () => {
    const q = cancellationPolicyService.calculate({
      paidAmount: 200,
      scheduledDate: scheduled,
      bookingStatus: "PENDING",
      cancelledBy: "user",
      paymentMethod: "wallet",
      now: new Date("2026-12-20T10:00:00Z"),
    });
    expect(q.refundMethodHint).toBe("wallet_instant");
  });
});
