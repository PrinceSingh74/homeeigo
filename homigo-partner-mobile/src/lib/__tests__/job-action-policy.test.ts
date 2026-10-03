/**
 * The client mirror must not offer work on a booking that is already closed.
 *
 * This file exists because the mirror derives its stage from TIMESTAMPS, and a CUSTOMER_NO_SHOW row
 * still carries the `arrivedAt` that produced it. Before the status was read first, this mirror
 * derived ARRIVED and put "Start service" in front of a partner on a booking that had already been
 * closed and refunded — and an EXPIRED booking fell all the way to OFFERED, offering Accept on a
 * slot the server had released.
 *
 * Run: `node --test src/lib/__tests__/job-action-policy.test.ts` from homigo-partner-mobile.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getAvailableJobActions } from "../job-action-policy.ts";

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

const CLOSED = ["EXPIRED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"] as const;

for (const status of CLOSED) {
  test(`${status} offers nothing, however complete the timestamps look`, () => {
    const r = getAvailableJobActions({
      status,
      enRouteAt: minutesAgo(90),
      arrivedAt: minutesAgo(60),
      paymentStatus: "SUCCESS",
    } as never);
    assert.equal(r.stage, status);
    assert.deepEqual(r.availableActions, []);
    assert.equal(r.primaryAction, null);
  });
}

test("the identical row on a live status is still a live job", () => {
  const r = getAvailableJobActions({
    status: "EN_ROUTE",
    enRouteAt: minutesAgo(90),
    arrivedAt: minutesAgo(60),
    paymentStatus: "SUCCESS",
  } as never);
  assert.equal(r.stage, "ARRIVED");
  assert.equal(r.primaryAction, "START_SERVICE");
});
