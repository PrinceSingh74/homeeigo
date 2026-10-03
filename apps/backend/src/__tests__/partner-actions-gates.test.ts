/**
 * X-50 / X-51 — the partner action list agrees with what the server will actually allow.
 *
 * Found on the emulator: a rework visit (fee waived, no payment row) showed "Payment confirmation pending"
 * although start/accept exempt it, and a job on safety hold offered Start — the app then sent the
 * customer a PIN for a job that could not begin. Pure policy, no Prisma.
 */
import { describe, expect, test } from "bun:test";
import { getAvailableJobActions } from "../lib/job-action-policy";
import { partnerFollowUpFromSnapshot } from "../lib/booking-case-policy";

const at = new Date("2026-09-29T10:00:00Z");
const arrived = { status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, startOtpVerifiedAt: null, now: at };
const HOLD = { ok: false, blocking: 1, message: "Work is on safety hold — prohibited condition reported: Gas smell. Our safety team must clear it first." };

describe("safety gate in the partner action list", () => {
  test("a closed gate disables Start with the safety message, over the OTP and requirement messages", () => {
    const r = getAvailableJobActions({
      ...arrived,
      paymentStatus: "SUCCESS",
      requirementGate: { ok: false, blocking: 1, message: "Before starting, resolve: water" },
      safetyGate: HOLD,
    });
    expect(r.disabledReasons.START_SERVICE).toBe(HOLD.message);
    expect(r.requiredGates).toContain("SAFETY_CLEARED");
  });

  test("a closed gate disables Complete mid-job", () => {
    const r = getAvailableJobActions({ status: "IN_PROGRESS", startedAt: at, paymentStatus: "SUCCESS", safetyGate: HOLD, now: at });
    expect(r.availableActions).toContain("COMPLETE_SERVICE");
    expect(r.disabledReasons.COMPLETE_SERVICE).toBe(HOLD.message);
  });

  test("an open gate changes nothing", () => {
    const base = getAvailableJobActions({ ...arrived, paymentStatus: "SUCCESS" });
    const open = getAvailableJobActions({ ...arrived, paymentStatus: "SUCCESS", safetyGate: { ok: true, blocking: 0, message: "No safety hold" } });
    expect(open).toEqual(base);
    expect(open.disabledReasons.START_SERVICE).toBe("Customer OTP required");
  });
});

describe("server payment exemption in the partner action list", () => {
  const accepted = { status: "ACCEPTED", now: at };

  test("an unpaid booking without an exemption still waits for its money", () => {
    const r = getAvailableJobActions({ ...accepted, paymentStatus: "PENDING" });
    expect(r.disabledReasons.START_NAVIGATION).toBe("Payment confirmation pending");
    expect(r.requiredGates).toContain("PAYMENT_SETTLED");
  });

  test("an exempt booking (waived-fee follow-up / audited override) can be worked", () => {
    const r = getAvailableJobActions({ ...accepted, paymentStatus: "PENDING", paymentExempt: true });
    expect(r.disabledReasons.START_NAVIGATION).toBeUndefined();
    expect(r.requiredGates).not.toContain("PAYMENT_SETTLED");
  });

  test("no exemption survives money going back", () => {
    for (const paymentStatus of ["REFUNDED", "REFUNDING", "EXPIRED"]) {
      const r = getAvailableJobActions({ ...accepted, paymentStatus, paymentExempt: true });
      expect(r.disabledReasons.START_NAVIGATION).toBe("Payment confirmation pending");
    }
  });
});

describe("partnerFollowUpFromSnapshot", () => {
  test("reads the case service's followUp block, numbers only", () => {
    const snap = { followUp: { kind: "REWORK", parentBookingId: "cid1", parentBookingNumber: "HOMIGO-20260928-03288", caseId: "case1", caseNumber: "CASE-20260928-6E5C3B8B" } };
    expect(partnerFollowUpFromSnapshot(snap)).toEqual({ kind: "REWORK", parentBookingNumber: "HOMIGO-20260928-03288", caseNumber: "CASE-20260928-6E5C3B8B" });
    expect(JSON.stringify(partnerFollowUpFromSnapshot(snap))).not.toContain("cid1");
  });

  test("REVISIT is a follow-up too; anything else is an ordinary booking", () => {
    expect(partnerFollowUpFromSnapshot({ followUp: { kind: "REVISIT" } })).toEqual({ kind: "REVISIT", parentBookingNumber: null, caseNumber: null });
    for (const s of [null, undefined, [], "x", {}, { followUp: null }, { followUp: { kind: "STANDARD" } }, { followUp: [] }]) {
      expect(partnerFollowUpFromSnapshot(s)).toBeNull();
    }
  });
});
