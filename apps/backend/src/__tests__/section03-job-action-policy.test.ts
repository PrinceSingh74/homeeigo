/**
 * Section 03 — pure policy + privacy (no Prisma native path).
 */
import { describe, expect, test } from "bun:test";
import { getAvailableJobActions } from "../lib/job-action-policy";
import { maskPhoneForPartner } from "../lib/pii-normalize";

describe("Section 03 job-action-policy (pure)", () => {
  test("maps timestamps to conceptual ARRIVED without new BookingStatus", () => {
    const r = getAvailableJobActions({
      status: "EN_ROUTE",
      enRouteAt: new Date(),
      arrivedAt: new Date(),
      paymentStatus: "SUCCESS",
    });
    expect(r.stage).toBe("ARRIVED");
    expect(r.primaryAction).toBe("START_SERVICE");
    expect(r.availableActions).toContain("CALL_CUSTOMER");
    expect(r.availableActions).toContain("OPEN_CHAT");
  });

  test("blocks start when payment unsettled", () => {
    const r = getAvailableJobActions({
      status: "EN_ROUTE",
      enRouteAt: new Date(),
      arrivedAt: new Date(),
      paymentStatus: "PENDING",
    });
    expect(r.requiredGates).toContain("PAYMENT_SETTLED");
    expect(r.disabledReasons.START_SERVICE).toMatch(/Payment/i);
  });

  test("in progress primary is complete", () => {
    const r = getAvailableJobActions({
      status: "IN_PROGRESS",
      startedAt: new Date(),
      paymentStatus: "SUCCESS",
    });
    expect(r.primaryAction).toBe("COMPLETE_SERVICE");
  });

  test("COMPLETED stays on the job axis — not EARNING_POSTED", () => {
    const r = getAvailableJobActions({
      status: "COMPLETED",
      completedAt: new Date(),
      paymentStatus: "SUCCESS",
    });
    expect(r.stage).toBe("COMPLETED");
    expect(r.stage).not.toBe("EARNINGS_POSTED" as never);
  });
});

describe("Section 03 privacy helpers", () => {
  test("maskPhoneForPartner never leaks full India mobile", () => {
    const masked = maskPhoneForPartner("+919876543210");
    expect(masked).not.toContain("9876543210");
    expect(masked).toContain("3210");
    expect(masked).toMatch(/••••/);
  });
});
