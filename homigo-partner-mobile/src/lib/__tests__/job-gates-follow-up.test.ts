/**
 * Found on the emulator (2026-09-29): a job on safety hold offered "Start job" (the customer was sent
 * a PIN for a job the server refused to start), and a fee-waived rework visit could not be worked —
 * "On my way" read "Payment confirmation pending" although the server exempts it. The mirror now
 * takes the server's safety gate and payment exemption from /actions, and the rework job says what it is.
 *
 * Run: `node --test src/lib/__tests__/job-gates-follow-up.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAvailableJobActions } from "../job-action-policy.ts";
import { followUpLine } from "../follow-up.ts";

const at = "2026-09-29T10:00:00.000Z";
const HOLD = { ok: false, blocking: 1, message: "Work is on safety hold — prohibited condition reported: Gas smell. Our safety team must clear it first." };

test("a safety hold disables Start with the server's sentence, over the requirement message", () => {
  const r = getAvailableJobActions({
    status: "EN_ROUTE",
    enRouteAt: at,
    arrivedAt: at,
    paymentStatus: "success",
    requirementGate: { ok: false, blocking: 1, message: "Before starting, resolve: socket" },
    safetyGate: HOLD,
  });
  assert.equal(r.primaryAction, "START_SERVICE");
  assert.equal(r.disabledReasons.START_SERVICE, HOLD.message);
  assert.ok(r.requiredGates.includes("SAFETY_CLEARED"));
});

test("a safety hold mid-job disables Complete", () => {
  const r = getAvailableJobActions({ status: "IN_PROGRESS", startedAt: at, paymentStatus: "success", safetyGate: HOLD });
  assert.equal(r.disabledReasons.COMPLETE_SERVICE, HOLD.message);
});

test("an open safety gate changes nothing", () => {
  const base = getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, paymentStatus: "success" });
  const open = getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: at, arrivedAt: at, paymentStatus: "success", safetyGate: { ok: true, blocking: 0, message: "No safety hold" } });
  assert.deepEqual(open, base);
});

test("the server's payment exemption lets a rework visit be worked; without it the job waits for money", () => {
  const waiting = getAvailableJobActions({ status: "ASSIGNED", paymentStatus: "pending" });
  assert.equal(waiting.disabledReasons.START_NAVIGATION, "Payment confirmation pending");
  const exempt = getAvailableJobActions({ status: "ASSIGNED", paymentStatus: "pending", paymentExempt: true });
  assert.equal(exempt.disabledReasons.START_NAVIGATION, undefined);
  assert.ok(!exempt.requiredGates.includes("PAYMENT_SETTLED"));
});

test("no exemption survives money going back", () => {
  for (const paymentStatus of ["refunded", "REFUNDING", "expired"]) {
    const r = getAvailableJobActions({ status: "ASSIGNED", paymentStatus, paymentExempt: true });
    assert.equal(r.disabledReasons.START_NAVIGATION, "Payment confirmation pending");
  }
});

test("a rework / revisit job says what it repairs; an ordinary job says nothing", () => {
  assert.equal(
    followUpLine({ kind: "REWORK", parentBookingNumber: "HOMIGO-20260928-03288", caseNumber: "CASE-20260928-6E5C3B8B" }),
    "Rework visit — for booking HOMIGO-20260928-03288, case CASE-20260928-6E5C3B8B",
  );
  assert.equal(followUpLine({ kind: "REVISIT", parentBookingNumber: null, caseNumber: null }), "Revisit (inspection)");
  assert.equal(followUpLine(null), null);
  assert.equal(followUpLine(undefined), null);
  assert.equal(followUpLine({ kind: "STANDARD", parentBookingNumber: "X", caseNumber: null }), null);
});
