/**
 * §45 / O6 — what it costs to move a booking.
 *
 * Owner-authorised policy, `reschedule.v1`:
 *
 *   >= 2 hours before the appointment   FREE
 *   <  2 hours before the appointment   25% of the applicable service subtotal
 *   after the service has started       not permitted at all
 *
 * Three properties this module exists to hold:
 *
 * 1. **The number lives here, once.** 25% is `LATE_FEE_BPS`, not a literal scattered through the
 *    booking service and three clients. Changing it is a NEW VERSION, not an edit, because bookings
 *    already placed were sold under the old one.
 * 2. **Integer paise, rounded once, half-up.** The arithmetic goes through `percentToRupeePaise`,
 *    the same centralised helper the quote engine uses, so a reschedule fee rounds exactly the way
 *    every other amount on the platform rounds. Floats never touch it.
 * 3. **It can never exceed what we actually hold.** The fee is capped at the service subtotal AND
 *    at the captured amount. A booking with nothing captured has a fee of zero — not a debt.
 *
 * Pure: no database, no clock of its own, no client input.
 */

import { percentToRupeePaise, toPaise, toRupees } from "./pricing-policy";

export const RESCHEDULE_POLICY_VERSION = "reschedule.v1";

/** Hours before the appointment at or above which a move is free. Inclusive, like the free cancellation tier. */
export const RESCHEDULE_FREE_MIN_HOURS = 2;

/** 25%, in basis points. Owner-authorised 2026-09-23. */
export const LATE_FEE_BPS = 2_500;

export type ReschedulePolicy = {
  version: string;
  freeMinHours: number;
  lateFeeBps: number;
};

export const RESCHEDULE_POLICY: ReschedulePolicy = {
  version: RESCHEDULE_POLICY_VERSION,
  freeMinHours: RESCHEDULE_FREE_MIN_HOURS,
  lateFeeBps: LATE_FEE_BPS,
};

export type RescheduleDisposition =
  /** Two hours or more out: no fee. */
  | "FREE"
  /** Under two hours: the late fee applies. */
  | "LATE_FEE"
  /** The service already started. §45: not a reschedule at all. */
  | "NOT_PERMITTED";

export type RescheduleDecision = {
  version: string;
  disposition: RescheduleDisposition;
  /** Basis points actually applied — 0 on a free move, so a reader never has to infer it. */
  feeBps: number;
  feeAmountPaise: number;
  /** The same amount in rupees, for display. Derived from the paise, never computed separately. */
  feeAmount: number;
  /** What the percentage was taken of, after capping. Lets support explain the number. */
  chargeableSubtotalPaise: number;
  hoursUntilAppointment: number | null;
  message: string;
};

/**
 * Read a frozen policy off a booking snapshot.
 *
 * Validated rather than trusted: a snapshot written by an older build may be missing, malformed, or
 * carry a version we no longer recognise. A half-parsed policy silently charging the wrong
 * percentage is worse than falling back to the published one, so anything unusable returns null and
 * the caller uses `RESCHEDULE_POLICY`.
 */
export function reschedulePolicyFromSnapshot(snapshot: unknown): ReschedulePolicy | null {
  if (!snapshot || typeof snapshot !== "object") return null;
  const policy = (snapshot as { policy?: { reschedule?: unknown } }).policy?.reschedule;
  if (!policy || typeof policy !== "object") return null;
  const p = policy as Partial<ReschedulePolicy>;
  if (typeof p.version !== "string" || p.version.length === 0) return null;
  if (typeof p.freeMinHours !== "number" || !Number.isFinite(p.freeMinHours) || p.freeMinHours < 0) return null;
  if (!Number.isInteger(p.lateFeeBps) || (p.lateFeeBps as number) < 0 || (p.lateFeeBps as number) > 10_000) return null;
  return { version: p.version, freeMinHours: p.freeMinHours, lateFeeBps: p.lateFeeBps as number };
}

function decision(
  policy: ReschedulePolicy,
  disposition: RescheduleDisposition,
  feeAmountPaise: number,
  chargeableSubtotalPaise: number,
  hours: number | null,
  message: string,
): RescheduleDecision {
  return {
    version: policy.version,
    disposition,
    feeBps: disposition === "LATE_FEE" ? policy.lateFeeBps : 0,
    feeAmountPaise,
    feeAmount: toRupees(feeAmountPaise),
    chargeableSubtotalPaise,
    hoursUntilAppointment: hours,
    message,
  };
}

/**
 * @param scheduledDate the appointment being moved AWAY from — the tier is decided by how close the
 *        EXISTING appointment is, never by the slot the client is asking for. Using the requested
 *        slot would let a client dodge the late tier by picking a distant new time.
 * @param subtotal      the applicable service subtotal, in rupees.
 * @param capturedAmount what has actually been captured and is still held, in rupees. The fee can
 *        never exceed it.
 */
export function evaluateReschedule(input: {
  scheduledDate: Date;
  bookingStatus: string;
  subtotal?: number;
  capturedAmount?: number;
  now?: Date;
  policy?: ReschedulePolicy | null;
}): RescheduleDecision {
  const policy = input.policy ?? RESCHEDULE_POLICY;
  const now = input.now ?? new Date();
  const status = String(input.bookingStatus).toUpperCase();

  if (status === "IN_PROGRESS" || status === "COMPLETED") {
    return decision(policy, "NOT_PERMITTED", 0, 0, null, "The service has already started and cannot be moved.");
  }

  const hours = (input.scheduledDate.getTime() - now.getTime()) / 3_600_000;
  if (hours >= policy.freeMinHours) {
    return decision(policy, "FREE", 0, 0, hours, "Free to reschedule.");
  }

  // The base is the subtotal, capped by what is actually held. Both are clamped at zero first so a
  // negative or absent input can never produce a negative fee or a negative cap.
  const subtotalPaise = toPaise(Math.max(0, input.subtotal ?? 0));
  const capturedPaise = toPaise(Math.max(0, input.capturedAmount ?? 0));
  const chargeableSubtotalPaise = Math.min(subtotalPaise, capturedPaise);
  const feeAmountPaise = percentToRupeePaise(chargeableSubtotalPaise, policy.lateFeeBps);

  return decision(
    policy,
    "LATE_FEE",
    feeAmountPaise,
    chargeableSubtotalPaise,
    hours,
    feeAmountPaise > 0
      ? `Rescheduling under ${policy.freeMinHours} hours before the appointment carries a ${policy.lateFeeBps / 100}% fee.`
      : `Rescheduling under ${policy.freeMinHours} hours before the appointment carries a fee, but nothing has been captured to charge it against.`,
  );
}

/** True when this decision names a real, non-zero amount the customer owes. */
export function rescheduleFeeIsChargeable(d: RescheduleDecision): boolean {
  return d.disposition === "LATE_FEE" && d.feeAmountPaise > 0;
}
