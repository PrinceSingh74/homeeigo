/**
 * Section 03 — pure policy + privacy (no Prisma native path).
 */
import { describe, expect, test } from "bun:test";
import { getAvailableJobActions } from "../lib/job-action-policy";
import { maskPhoneForPartner } from "../lib/pii-normalize";
import { deriveJobState, isJobTerminalOutcome } from "../lib/partner-job-fsm";
import { NO_SHOW_POLICY } from "../lib/no-show-policy";

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

/**
 * The statuses that close a booking outside the happy path.
 *
 * These exist because `deriveJobState` reads timestamps: a CUSTOMER_NO_SHOW row still carries the
 * `arrivedAt` that produced it, and before this was fixed it derived as ARRIVED — so the partner
 * app offered "Start service" on a booking that was already closed and refunded. EXPIRED fell all
 * the way through to OFFERED and offered Accept on a released slot.
 */
describe("a closed booking offers the partner nothing", () => {
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  for (const status of ["EXPIRED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"]) {
    test(`${status} is terminal on the job axis even with every timestamp set`, () => {
      const r = getAvailableJobActions({
        status,
        enRouteAt: minutesAgo(90),
        arrivedAt: minutesAgo(60),
        paymentStatus: "SUCCESS",
      });
      expect(r.stage).toBe(status as never);
      expect(isJobTerminalOutcome(r.stage)).toBe(true);
      expect(r.availableActions).toEqual([]);
      expect(r.primaryAction).toBeNull();
    });
  }

  test("the same row without the status is still a live job — the guard is the status, not the shape", () => {
    const live = getAvailableJobActions({
      status: "EN_ROUTE",
      enRouteAt: minutesAgo(90),
      arrivedAt: minutesAgo(60),
      paymentStatus: "SUCCESS",
    });
    expect(live.stage).toBe("ARRIVED");
    expect(live.primaryAction).toBe("START_SERVICE");
  });

  test("deriveJobState reads the status before any timestamp", () => {
    expect(deriveJobState({ status: "CUSTOMER_NO_SHOW", arrivedAt: minutesAgo(30), startedAt: minutesAgo(10) })).toBe("CUSTOMER_NO_SHOW");
    expect(deriveJobState({ status: "EXPIRED" })).toBe("EXPIRED");
  });
});

describe("§52 — the partner is offered the no-show only where the evidence can exist", () => {
  const NOW = new Date("2026-12-24T10:00:00.000Z");
  const arrivedMinutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

  test("not offered before arrival — there is nothing to report from", () => {
    const r = getAvailableJobActions({ status: "EN_ROUTE", enRouteAt: arrivedMinutesAgo(30), paymentStatus: "SUCCESS", now: NOW });
    expect(r.stage).toBe("EN_ROUTE");
    expect(r.availableActions).not.toContain("REPORT_NO_SHOW");
  });

  test("offered at the door, but disabled while the wait is still running", () => {
    const waited = NO_SHOW_POLICY.graceMinutes - 6;
    const r = getAvailableJobActions({ status: "EN_ROUTE", arrivedAt: arrivedMinutesAgo(waited), paymentStatus: "SUCCESS", now: NOW });
    expect(r.stage).toBe("ARRIVED");
    expect(r.availableActions).toContain("REPORT_NO_SHOW");
    expect(r.disabledReasons.REPORT_NO_SHOW).toBe("Available in 6 min");
    // and it never becomes the thing the partner is pushed towards
    expect(r.primaryAction).toBe("START_SERVICE");
  });

  /** The wait is counted from the later of the arrival and the booked time: a customer is not late for an appointment that has not begun. */
  test("a partner who came early waits from the booked time, and before it the label says so", () => {
    const early = getAvailableJobActions({ status: "EN_ROUTE", arrivedAt: arrivedMinutesAgo(40), scheduledDate: arrivedMinutesAgo(5), paymentStatus: "SUCCESS", now: NOW });
    expect(early.availableActions).toContain("REPORT_NO_SHOW");
    expect(early.disabledReasons.REPORT_NO_SHOW).toBe(`Available in ${NO_SHOW_POLICY.graceMinutes - 5} min`);
    const notYet = getAvailableJobActions({ status: "EN_ROUTE", arrivedAt: arrivedMinutesAgo(40), scheduledDate: new Date(NOW.getTime() + 30 * 60_000), paymentStatus: "SUCCESS", now: NOW });
    expect(notYet.disabledReasons.REPORT_NO_SHOW).toBe("Available after the booked time");
    const late = getAvailableJobActions({ status: "EN_ROUTE", arrivedAt: arrivedMinutesAgo(NO_SHOW_POLICY.graceMinutes), scheduledDate: arrivedMinutesAgo(120), paymentStatus: "SUCCESS", now: NOW });
    expect(late.disabledReasons.REPORT_NO_SHOW).toBeUndefined();
  });

  test("enabled once the grace period has actually been served", () => {
    const r = getAvailableJobActions({ status: "EN_ROUTE", arrivedAt: arrivedMinutesAgo(NO_SHOW_POLICY.graceMinutes), paymentStatus: "SUCCESS", now: NOW });
    expect(r.availableActions).toContain("REPORT_NO_SHOW");
    expect(r.disabledReasons.REPORT_NO_SHOW).toBeUndefined();
  });

  test("an arrival in the future disables it rather than enabling it", () => {
    const r = getAvailableJobActions({ status: "EN_ROUTE", arrivedAt: new Date(NOW.getTime() + 60_000), paymentStatus: "SUCCESS", now: NOW });
    expect(r.disabledReasons.REPORT_NO_SHOW).toBe(`Available in ${NO_SHOW_POLICY.graceMinutes} min`);
  });

  test("once the job has started it is no longer on offer", () => {
    const r = getAvailableJobActions({ status: "IN_PROGRESS", arrivedAt: arrivedMinutesAgo(60), startedAt: arrivedMinutesAgo(40), paymentStatus: "SUCCESS", now: NOW });
    expect(r.availableActions).not.toContain("REPORT_NO_SHOW");
  });
});
