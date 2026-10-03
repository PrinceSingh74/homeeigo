/**
 * §52 / §53 — no-show.
 *
 * Owner-authorised defaults, 2026-09-23:
 *   provider grace / wait period      15 minutes
 *   customer no-show fee              50% of the service subtotal, CAPPED at what was captured
 *   provider no-show                  a distinct outcome; the customer is never charged for it
 *
 * Two rules matter more than the numbers:
 *
 * 1. **A customer is never marked no-show because the clock passed.** The evaluator requires real
 *    operational evidence — the partner actually arrived (`arrivedAt`), the booking was in a state
 *    where the customer could have answered, and the grace period elapsed AFTER that arrival. A
 *    booking that nobody travelled to cannot produce a customer no-show, however late it gets.
 *
 * 2. **Provider fault never becomes customer fault.** They are separate outcomes with separate
 *    money, and this module will not convert one into the other.
 *
 * Pure: no database, no clock of its own, no GPS. Nothing here infers arrival from a location ping —
 * `arrivedAt` is written by the arrival path, and if it is absent the honest answer is "no evidence",
 * not "probably arrived".
 */

export const NO_SHOW_POLICY_VERSION = "no_show.v1";

export type NoShowPolicy = {
  version: string;
  /** How long the partner waits at the door before a customer no-show can even be considered. */
  graceMinutes: number;
  /** Percentage of the service subtotal the customer forfeits, capped at the captured amount. */
  customerNoShowFeePercent: number;
  /** What the customer gets back when the PARTNER did not turn up. */
  providerNoShowRefundPercent: number;
};

export const NO_SHOW_POLICY: NoShowPolicy = {
  version: NO_SHOW_POLICY_VERSION,
  graceMinutes: 15,
  customerNoShowFeePercent: 50,
  providerNoShowRefundPercent: 100,
};

export type CustomerNoShowRefusal =
  /** No `arrivedAt`: nobody has evidence that anyone went. */
  | "NO_ARRIVAL_EVIDENCE"
  /** The partner arrived but has not waited the grace period yet. */
  | "GRACE_NOT_ELAPSED"
  /** The job started, finished, or was already closed — a no-show is no longer the question. */
  | "BOOKING_NOT_AWAITING_CUSTOMER"
  /** Arrival is recorded in the future relative to `now`; the clocks disagree, so decide nothing. */
  | "ARRIVAL_IN_FUTURE";

export type CustomerNoShowVerdict =
  | { eligible: true; waitedMinutes: number }
  | { eligible: false; reason: CustomerNoShowRefusal; waitedMinutes: number | null };

/** Statuses in which the partner is at the door and the customer has not yet let them start. */
const AWAITING_CUSTOMER = new Set(["ASSIGNED", "EN_ROUTE", "ACCEPTED"]);

export function evaluateCustomerNoShow(input: {
  status: string;
  arrivedAt: Date | null | undefined;
  now?: Date;
  policy?: NoShowPolicy;
}): CustomerNoShowVerdict {
  const policy = input.policy ?? NO_SHOW_POLICY;
  const now = input.now ?? new Date();

  if (!AWAITING_CUSTOMER.has(input.status)) {
    return { eligible: false, reason: "BOOKING_NOT_AWAITING_CUSTOMER", waitedMinutes: null };
  }
  if (!input.arrivedAt) {
    // The one that matters most: without arrival there is no no-show, only an unstarted booking.
    return { eligible: false, reason: "NO_ARRIVAL_EVIDENCE", waitedMinutes: null };
  }
  const waitedMs = now.getTime() - input.arrivedAt.getTime();
  if (waitedMs < 0) return { eligible: false, reason: "ARRIVAL_IN_FUTURE", waitedMinutes: null };

  const waitedMinutes = Math.floor(waitedMs / 60_000);
  if (waitedMinutes < policy.graceMinutes) {
    return { eligible: false, reason: "GRACE_NOT_ELAPSED", waitedMinutes };
  }
  return { eligible: true, waitedMinutes };
}

/**
 * What the customer keeps when they were the no-show.
 *
 * The fee is a percentage of the SUBTOTAL but can never exceed what was actually captured — a
 * customer who paid nothing owes nothing here, and a customer who paid a deposit cannot be charged
 * more than the deposit by this path.
 */
export function customerNoShowSettlement(input: {
  subtotal: number;
  capturedAmount: number;
  alreadyRefunded?: number;
  policy?: NoShowPolicy;
}): { feeAmount: number; refundAmount: number; feePercent: number } {
  const policy = input.policy ?? NO_SHOW_POLICY;
  const captured = Math.max(0, input.capturedAmount) - Math.max(0, input.alreadyRefunded ?? 0);
  const uncapped = (Math.max(0, input.subtotal) * policy.customerNoShowFeePercent) / 100;
  const feeAmount = Math.round(Math.min(uncapped, Math.max(0, captured)) * 100) / 100;
  const refundAmount = Math.round(Math.max(0, captured - feeAmount) * 100) / 100;
  return { feeAmount, refundAmount, feePercent: policy.customerNoShowFeePercent };
}

/**
 * What the customer gets when the PARTNER did not turn up.
 *
 * Whole, by default: the customer did nothing wrong, and charging them for a partner's absence is
 * the failure §53 exists to prevent.
 */
export function providerNoShowSettlement(input: {
  capturedAmount: number;
  alreadyRefunded?: number;
  policy?: NoShowPolicy;
}): { feeAmount: number; refundAmount: number } {
  const policy = input.policy ?? NO_SHOW_POLICY;
  const captured = Math.max(0, input.capturedAmount) - Math.max(0, input.alreadyRefunded ?? 0);
  const refundAmount = Math.round(((Math.max(0, captured) * policy.providerNoShowRefundPercent) / 100) * 100) / 100;
  return { feeAmount: Math.round(Math.max(0, captured - refundAmount) * 100) / 100, refundAmount };
}
