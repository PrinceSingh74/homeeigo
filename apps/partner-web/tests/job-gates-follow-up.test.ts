/**
 * Found on the emulator (2026-09-29) and true of this mirror too: a job on safety hold offered Start,
 * and a fee-waived rework visit read "Payment confirmation pending" although the server exempts it.
 * The mirror takes the server's safety gate (from /actions) and payment exemption (list row or
 * /actions); a rework visit says what it follows up on. Run from `apps/partner-web`: `bun test tests`.
 */
import { describe, expect, test } from "bun:test";
import { getAvailableJobActions, primaryControlState } from "@/lib/job-action-policy";
import { followUpLine } from "@/lib/follow-up";

const at = "2026-09-29T10:00:00.000Z";
const HOLD = { ok: false, blocking: 1, message: "Work is on safety hold — prohibited condition reported: Gas smell. Our safety team must clear it first." };

describe("safety gate", () => {
  test("a hold disables Start with the server's sentence, over the requirement message", () => {
    const r = getAvailableJobActions({
      status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, paymentStatus: "SUCCESS",
      requirementGate: { ok: false, blocking: 1, message: "Before starting, resolve: socket" },
      safetyGate: HOLD,
    });
    expect(r.disabledReasons.START_SERVICE).toBe(HOLD.message);
    expect(r.requiredGates).toContain("SAFETY_CLEARED");
  });

  test("a hold mid-job disables Complete; an open gate changes nothing", () => {
    expect(getAvailableJobActions({ status: "IN_PROGRESS", startedAt: at, paymentStatus: "SUCCESS", safetyGate: HOLD }).disabledReasons.COMPLETE_SERVICE).toBe(HOLD.message);
    const base = getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, paymentStatus: "SUCCESS" });
    expect(getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, paymentStatus: "SUCCESS", safetyGate: { ok: true, blocking: 0, message: "No safety hold" } })).toEqual(base);
  });
});

describe("payment exemption", () => {
  test("exempt rework can be worked; unexempt waits; returned money is never exempt", () => {
    expect(getAvailableJobActions({ status: "ASSIGNED", paymentStatus: "pending" }).disabledReasons.START_NAVIGATION).toBe("Payment confirmation pending");
    const exempt = getAvailableJobActions({ status: "ASSIGNED", paymentStatus: "pending", paymentExempt: true });
    expect(exempt.disabledReasons.START_NAVIGATION).toBeUndefined();
    expect(exempt.requiredGates).not.toContain("PAYMENT_SETTLED");
    for (const paymentStatus of ["refunded", "REFUNDING", "expired"]) {
      expect(getAvailableJobActions({ status: "ASSIGNED", paymentStatus, paymentExempt: true }).disabledReasons.START_NAVIGATION).toBe("Payment confirmation pending");
    }
  });
});

describe("followUpLine", () => {
  test("rework / revisit say what they follow up on; ordinary bookings say nothing", () => {
    expect(followUpLine({ kind: "REWORK", parentBookingNumber: "HOMIGO-20260928-03288", caseNumber: "CASE-20260928-6E5C3B8B" }))
      .toBe("Rework visit — for booking HOMIGO-20260928-03288, case CASE-20260928-6E5C3B8B");
    expect(followUpLine({ kind: "REVISIT", parentBookingNumber: null, caseNumber: null })).toBe("Revisit (inspection)");
    expect(followUpLine(null)).toBeNull();
    expect(followUpLine({ kind: "STANDARD", parentBookingNumber: "X", caseNumber: null })).toBeNull();
  });
});

// Found in the X-60 browser proof (2026-09-29): with a hold placed while the job page was open, the
// safety panel showed the hold but the action card's "Start job" stayed ENABLED — the card chose WHICH
// button from the policy but never applied the policy's disabled reason (the server still refused).
describe("primary control state (the card's button)", () => {
  test("a hold disables the Start button and gives the safety sentence as the reason", () => {
    const r = getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, paymentStatus: "SUCCESS", safetyGate: HOLD });
    expect(primaryControlState(r)).toEqual({ action: "START_SERVICE", disabled: true, reason: HOLD.message });
  });
  test("an open gate leaves Start enabled; payment pending disables On my way", () => {
    const open = getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, paymentStatus: "SUCCESS" });
    expect(primaryControlState(open)).toEqual({ action: "START_SERVICE", disabled: false, reason: null });
    const unpaid = getAvailableJobActions({ status: "ASSIGNED", paymentStatus: "pending" });
    expect(primaryControlState(unpaid)).toMatchObject({ action: "START_NAVIGATION", disabled: true, reason: "Payment confirmation pending" });
  });
  test("no primary action: nothing to disable", () => {
    expect(primaryControlState({ stage: "COMPLETED" as never, availableActions: [], primaryAction: null, requiredGates: [], disabledReasons: {} })).toEqual({ action: null, disabled: false, reason: null });
  });
});
