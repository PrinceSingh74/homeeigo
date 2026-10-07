/**
 * The client mirror of the backend's `getAvailableJobActions` (apps/backend/src/lib/job-action-policy.ts).
 *
 * Two things are pinned here.
 *
 * 1. A closed booking offers nothing. The mirror derives its stage from TIMESTAMPS, and a
 *    CUSTOMER_NO_SHOW row still carries the `arrivedAt` that produced it. Before the status was read
 *    first, this mirror derived ARRIVED and put "Start service" in front of a partner on a booking
 *    that had already been closed and refunded — and an EXPIRED booking fell all the way to OFFERED,
 *    offering Accept on a slot the server had released.
 *
 * 2. Parity with the backend at ARRIVED: REPORT_NO_SHOW is on offer at the door, disabled until the
 *    wait is served, and the wait runs from the LATER of the arrival and the booked time.
 *
 * Run: `node --test src/lib/__tests__/job-action-policy.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getAvailableJobActions,
  NO_SHOW_GRACE_MINUTES,
  primaryActionLabel,
  primaryControlState,
  START_OTP_REASON,
} from "../job-action-policy.ts";

const NOW = new Date("2026-10-07T10:00:00.000Z");
const at = (minutesFromNow: number) => new Date(NOW.getTime() + minutesFromNow * 60_000).toISOString();
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const CLOSED = ["EXPIRED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"] as const;

for (const status of CLOSED) {
  test(`${status} offers nothing, however complete the timestamps look`, () => {
    for (const wire of [status, status.toLowerCase()]) {
      const r = getAvailableJobActions({ status: wire, enRouteAt: minutesAgo(90), arrivedAt: minutesAgo(60), paymentStatus: "SUCCESS" });
      assert.equal(r.stage, status);
      assert.deepEqual(r.availableActions, []);
      assert.equal(r.primaryAction, null);
    }
  });
}

test("cancelled and rejected stay terminal too", () => {
  for (const status of ["cancelled_by_user", "cancelled_by_provider"]) {
    assert.equal(getAvailableJobActions({ status, arrivedAt: minutesAgo(5) }).stage, "CANCELLED");
  }
  assert.equal(getAvailableJobActions({ status: "rejected" }).stage, "REJECTED");
});

test("the identical row on a live status is still a live job", () => {
  const r = getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: minutesAgo(90), arrivedAt: minutesAgo(60), paymentStatus: "SUCCESS" });
  assert.equal(r.stage, "ARRIVED");
  assert.equal(r.primaryAction, "START_SERVICE");
});

/* ---- parity with the backend at ARRIVED ---- */

const arrivedJob = (over: Record<string, unknown> = {}) => ({
  status: "en_route",
  enRouteAt: at(-60),
  arrivedAt: at(-20),
  scheduledDate: at(-30),
  paymentStatus: "success",
  now: NOW,
  ...over,
});

test("the grace period is the backend's (lib/no-show-policy.ts), read from its source", () => {
  const policy = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "apps", "backend", "src", "lib", "no-show-policy.ts"), "utf8");
  const m = policy.match(/graceMinutes:\s*(\d+),/);
  assert.ok(m, "graceMinutes not found in the backend policy");
  assert.equal(NO_SHOW_GRACE_MINUTES, Number(m[1]));
});

test("at the door: REPORT_NO_SHOW is offered, and nowhere else", () => {
  assert.ok(getAvailableJobActions(arrivedJob()).availableActions.includes("REPORT_NO_SHOW"));
  for (const job of [
    { status: "pending" },
    { status: "accepted" },
    { status: "en_route", enRouteAt: at(-10) },
    { status: "in_progress", arrivedAt: at(-30), startedAt: at(-5) },
    { status: "completed", arrivedAt: at(-90), completedAt: at(-5) },
  ]) {
    assert.equal(getAvailableJobActions({ ...job, now: NOW }).availableActions.includes("REPORT_NO_SHOW"), false, job.status);
  }
});

test("once the wait is served the report is enabled", () => {
  const r = getAvailableJobActions(arrivedJob({ arrivedAt: at(-NO_SHOW_GRACE_MINUTES), scheduledDate: at(-60) }));
  assert.equal(r.disabledReasons.REPORT_NO_SHOW, undefined);
});

test("before that it is disabled with the minutes left", () => {
  const r = getAvailableJobActions(arrivedJob({ arrivedAt: at(-4), scheduledDate: at(-60) }));
  assert.equal(r.disabledReasons.REPORT_NO_SHOW, `Available in ${NO_SHOW_GRACE_MINUTES - 4} min`);
});

test("the wait runs from the LATER of arrival and booked time — an early arrival does not shorten it", () => {
  // Arrived 40 min ago, but the appointment began only 5 min ago: 5 minutes waited, not 40.
  const r = getAvailableJobActions(arrivedJob({ arrivedAt: at(-40), scheduledDate: at(-5) }));
  assert.equal(r.disabledReasons.REPORT_NO_SHOW, `Available in ${NO_SHOW_GRACE_MINUTES - 5} min`);
});

test("while the booked time is still ahead: 'Available after the booked time'", () => {
  const r = getAvailableJobActions(arrivedJob({ arrivedAt: at(-40), scheduledDate: at(10) }));
  assert.equal(r.disabledReasons.REPORT_NO_SHOW, "Available after the booked time");
});

test("an arrival the clocks put in the future counts as no wait at all", () => {
  const r = getAvailableJobActions(arrivedJob({ arrivedAt: at(3), scheduledDate: at(-60) }));
  assert.equal(r.disabledReasons.REPORT_NO_SHOW, `Available in ${NO_SHOW_GRACE_MINUTES} min`);
});

test("with no booked time on the row the wait runs from the arrival", () => {
  const r = getAvailableJobActions(arrivedJob({ arrivedAt: at(-20), scheduledDate: null }));
  assert.equal(r.disabledReasons.REPORT_NO_SHOW, undefined);
});

/* ---- gates ---- */

test("the start-PIN gate reads as the backend words it, but never disables the button that opens the PIN sheet", () => {
  const r = getAvailableJobActions(arrivedJob());
  assert.ok(r.requiredGates.includes("START_OTP_VERIFIED"));
  assert.equal(r.disabledReasons.START_SERVICE, START_OTP_REASON);
  assert.deepEqual(primaryControlState(r), { action: "START_SERVICE", disabled: false, reason: null });
});

test("payment pending disables accept / navigation / start, and wins over the PIN wording", () => {
  const r = getAvailableJobActions(arrivedJob({ paymentStatus: "pending" }));
  assert.equal(r.disabledReasons.START_SERVICE, "Payment confirmation pending");
  assert.ok(r.requiredGates.includes("PAYMENT_SETTLED"));
  assert.deepEqual(primaryControlState(r), { action: "START_SERVICE", disabled: true, reason: "Payment confirmation pending" });
});

test("the server's payment exemption lifts it — unless the money went back", () => {
  assert.equal(getAvailableJobActions({ status: "accepted", paymentStatus: "pending", paymentExempt: true }).disabledReasons.START_NAVIGATION, undefined);
  assert.equal(getAvailableJobActions({ status: "accepted", paymentStatus: "refunded", paymentExempt: true }).disabledReasons.START_NAVIGATION, "Payment confirmation pending");
});

test("a blocked requirement gate disables Start with the server's sentence", () => {
  const r = getAvailableJobActions(arrivedJob({ requirementGate: { ok: false, blocking: 1, message: "Water supply must be confirmed." } }));
  assert.equal(r.disabledReasons.START_SERVICE, "Water supply must be confirmed.");
  assert.ok(r.requiredGates.includes("REQUIREMENTS_RESOLVED"));
  assert.equal(primaryControlState(r).disabled, true);
});

test("a safety hold disables Start and Complete with the server's sentence", () => {
  const hold = { ok: false, blocking: 1, message: "Work is on safety hold." };
  assert.equal(getAvailableJobActions(arrivedJob({ safetyGate: hold })).disabledReasons.START_SERVICE, "Work is on safety hold.");
  const working = getAvailableJobActions({ status: "in_progress", startedAt: at(-5), paymentStatus: "success", safetyGate: hold });
  assert.equal(working.disabledReasons.COMPLETE_SERVICE, "Work is on safety hold.");
  assert.ok(working.requiredGates.includes("SAFETY_CLEARED"));
});

test("stages and primary actions along the live path", () => {
  const stages = [
    [{ status: "pending" }, "OFFERED", "ACCEPT"],
    [{ status: "assigned" }, "ACCEPTED", "START_NAVIGATION"],
    [{ status: "en_route" }, "EN_ROUTE", "MARK_ARRIVED"],
    [{ status: "accepted", arrivedAt: at(-1) }, "ARRIVED", "START_SERVICE"],
    [{ status: "in_progress" }, "IN_PROGRESS", "COMPLETE_SERVICE"],
    [{ status: "completed" }, "COMPLETED", null],
  ] as const;
  for (const [job, stage, primary] of stages) {
    const r = getAvailableJobActions({ ...job, now: NOW });
    assert.equal(r.stage, stage);
    assert.equal(r.primaryAction, primary);
  }
  assert.equal(primaryActionLabel("MARK_ARRIVED"), "I've arrived");
  assert.equal(primaryActionLabel(null), null);
});
