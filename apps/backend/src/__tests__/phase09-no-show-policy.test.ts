/**
 * §52 / §53 — no-show, the rules only.
 *
 * Owner defaults 2026-09-23: 15-minute grace, customer no-show 50% capped at what was captured,
 * provider no-show never charges the customer.
 *
 * The two assertions that matter most are negative ones: a customer is never a no-show merely
 * because time passed, and a partner's absence never becomes the customer's fault.
 *
 * Pure and clock-free.
 */
import { describe, expect, test } from "bun:test";
import {
  NO_SHOW_POLICY,
  NO_SHOW_POLICY_VERSION,
  customerNoShowSettlement,
  evaluateCustomerNoShow,
  providerNoShowSettlement,
} from "../lib/no-show-policy";

const NOW = new Date("2026-12-24T10:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("the owner's defaults are what the module carries", () => {
  test("15-minute grace, 50% customer fee, 100% back on a provider no-show", () => {
    expect(NO_SHOW_POLICY).toMatchObject({
      version: NO_SHOW_POLICY_VERSION,
      graceMinutes: 15,
      customerNoShowFeePercent: 50,
      providerNoShowRefundPercent: 100,
    });
  });
});

describe("a customer is never a no-show just because the clock passed", () => {
  test("no arrival recorded — however late — is NOT a no-show", () => {
    for (const status of ["ASSIGNED", "EN_ROUTE", "ACCEPTED"]) {
      const v = evaluateCustomerNoShow({ status, arrivedAt: null, now: NOW });
      expect(v.eligible).toBe(false);
      if (!v.eligible) expect(v.reason).toBe("NO_ARRIVAL_EVIDENCE");
    }
  });

  test("arrived, but the grace period has not elapsed", () => {
    const v = evaluateCustomerNoShow({ status: "EN_ROUTE", arrivedAt: minutesAgo(14), now: NOW });
    expect(v.eligible).toBe(false);
    if (!v.eligible) {
      expect(v.reason).toBe("GRACE_NOT_ELAPSED");
      expect(v.waitedMinutes).toBe(14);
    }
  });

  test("exactly the grace period is enough; a minute more certainly is", () => {
    expect(evaluateCustomerNoShow({ status: "EN_ROUTE", arrivedAt: minutesAgo(15), now: NOW }).eligible).toBe(true);
    expect(evaluateCustomerNoShow({ status: "EN_ROUTE", arrivedAt: minutesAgo(40), now: NOW }).eligible).toBe(true);
  });

  test("a job that already started, finished or closed is no longer the question", () => {
    for (const status of ["IN_PROGRESS", "COMPLETED", "CANCELLED_BY_USER", "EXPIRED", "REJECTED"]) {
      const v = evaluateCustomerNoShow({ status, arrivedAt: minutesAgo(60), now: NOW });
      expect(v.eligible).toBe(false);
      if (!v.eligible) expect(v.reason).toBe("BOOKING_NOT_AWAITING_CUSTOMER");
    }
  });

  test("an arrival timestamp in the future decides nothing rather than guessing", () => {
    const v = evaluateCustomerNoShow({ status: "EN_ROUTE", arrivedAt: new Date(NOW.getTime() + 60_000), now: NOW });
    expect(v.eligible).toBe(false);
    if (!v.eligible) expect(v.reason).toBe("ARRIVAL_IN_FUTURE");
  });
});

describe("what the customer no-show actually costs", () => {
  test("50% of the subtotal when the whole amount was captured", () => {
    expect(customerNoShowSettlement({ subtotal: 1000, capturedAmount: 1000 })).toEqual({
      feeAmount: 500,
      refundAmount: 500,
      feePercent: 50,
    });
  });

  test("the fee is CAPPED at what was captured — a deposit is not a blank cheque", () => {
    // Half of 1000 is 500, but only 200 was ever taken.
    const s = customerNoShowSettlement({ subtotal: 1000, capturedAmount: 200 });
    expect(s.feeAmount).toBe(200);
    expect(s.refundAmount).toBe(0);
  });

  test("a customer who paid nothing owes nothing on this path", () => {
    expect(customerNoShowSettlement({ subtotal: 1000, capturedAmount: 0 })).toMatchObject({
      feeAmount: 0,
      refundAmount: 0,
    });
  });

  test("an earlier refund reduces what is left to settle, and never goes negative", () => {
    const s = customerNoShowSettlement({ subtotal: 1000, capturedAmount: 1000, alreadyRefunded: 900 });
    expect(s.feeAmount).toBe(100); // only 100 remains
    expect(s.refundAmount).toBe(0);
    const over = customerNoShowSettlement({ subtotal: 1000, capturedAmount: 1000, alreadyRefunded: 5000 });
    expect(over.feeAmount).toBe(0);
    expect(over.refundAmount).toBe(0);
  });

  test("fee plus refund never exceeds what was captured", () => {
    for (const [subtotal, captured, refunded] of [[1000, 1000, 0], [1000, 400, 0], [750, 750, 250], [0, 500, 0], [333.33, 333.33, 0]]) {
      const s = customerNoShowSettlement({ subtotal: subtotal!, capturedAmount: captured!, alreadyRefunded: refunded! });
      expect(Math.round((s.feeAmount + s.refundAmount) * 100) / 100).toBeLessThanOrEqual(captured! - refunded!);
      expect(s.feeAmount).toBeGreaterThanOrEqual(0);
      expect(s.refundAmount).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("a partner's absence is never charged to the customer", () => {
  test("the customer gets everything still refundable", () => {
    expect(providerNoShowSettlement({ capturedAmount: 1000 })).toEqual({ feeAmount: 0, refundAmount: 1000 });
    expect(providerNoShowSettlement({ capturedAmount: 1000, alreadyRefunded: 300 })).toEqual({
      feeAmount: 0,
      refundAmount: 700,
    });
  });

  test("a provider no-show settlement never produces a customer fee", () => {
    for (const captured of [0, 1, 999.99, 25000]) {
      expect(providerNoShowSettlement({ capturedAmount: captured }).feeAmount).toBe(0);
    }
  });

  test("the two outcomes are genuinely different money for the same booking", () => {
    const captured = 1000;
    const customer = customerNoShowSettlement({ subtotal: captured, capturedAmount: captured });
    const provider = providerNoShowSettlement({ capturedAmount: captured });
    expect(customer.refundAmount).not.toBe(provider.refundAmount);
    expect(provider.refundAmount).toBeGreaterThan(customer.refundAmount);
  });
});
