import type { Condition } from "./types";

/**
 * Named conditions, defined in code.
 *
 * A workflow step carries a `conditionId`, not a condition body — the same separation 6A uses for
 * workflow definitions. The frozen definition in the database therefore references a condition by
 * name and can never carry one, so editing a database row cannot change what a running workflow
 * checks.
 */

const registry = new Map<string, Condition>();

export function registerCondition(id: string, condition: Condition): void {
  if (registry.has(id)) return;
  registry.set(id, condition);
}

export function getCondition(id: string): Condition | undefined {
  return registry.get(id);
}

export function listConditions(): string[] {
  return [...registry.keys()].sort();
}

/** Test-only: reset between cases. */
export function clearConditions(): void {
  registry.clear();
}

/** Conditions the first workflows need. Registered at boot alongside workflow definitions. */
export function registerAllConditions(): void {
  // Review request: ask only while the booking is still completed and still unrated.
  registerCondition("booking.completed_and_unrated", {
    and: [
      { field: "booking.status", operator: "equals", value: "COMPLETED" },
      { field: "rating.exists", operator: "equals", value: false },
    ],
  });

  /**
   * Follow-up: still completed, regardless of rating.
   *
   * Deliberately not `booking.completed_and_unrated` — the follow-up is a general check-in
   * ("did everything work out, do you need anything else"), not a request for a star rating, so a
   * customer who already rated the job is still a legitimate recipient. The only thing that must
   * still be true is that the booking itself was not later cancelled or disputed out from under it.
   */
  registerCondition("booking.still_completed", {
    field: "booking.status",
    operator: "equals",
    value: "COMPLETED",
  });

  /**
   * Payment recovery, asked of the booking rather than of a payment.
   *
   * Two clauses, because "still failed" and "still worth chasing" are not the same question. A
   * status that is not yet SUCCESS says the gateway has not confirmed anything; `amountPaid` at zero
   * says no money has actually landed by any route — a reconciliation, a webhook that arrived late,
   * a manual settlement. Chasing someone who has already paid is the failure mode this exists to
   * avoid, and status alone would not catch all of it.
   *
   * `payment.retryable` is deliberately absent: no such field exists on the model, in the service or
   * in any resolver, and inventing one would have meant inventing the data behind it.
   */
  registerCondition("booking.payment_still_recoverable", {
    and: [
      { field: "bookingPayment.exists", operator: "equals", value: true },
      { field: "bookingPayment.status", operator: "in", value: ["FAILED", "PENDING", "INITIATED", "PROCESSING"] },
      { field: "bookingPayment.amountPaid", operator: "equals", value: 0 },
      /**
       * Recovery is a pre-service conversation, so the eligible statuses are named explicitly.
       *
       * This was previously written as "not cancelled", on the reasoning that an allow-list
       * silently excludes any status nobody remembered to add. The payment-gate audit showed the
       * exclusion runs the other way and costs more: EN_ROUTE, IN_PROGRESS and COMPLETED all passed
       * "not cancelled", so a customer could be told "your payment didn't go through" while the
       * partner was standing at their door, or days after the job was finished. A new lifecycle
       * state arriving and being *excluded* until someone considers it is the safe failure; being
       * included by default is not.
       *
       * The three post-service cases are real needs, but they are different conversations with
       * different audiences — an ops alert while a partner is on site, and finance-owned dunning
       * after completion. Neither is this nudge, and neither is built.
       */
      { field: "booking.status", operator: "in", value: ["PENDING", "ACCEPTED", "ASSIGNED"] },
    ],
  });

  /**
   * An abandoned checkout: the order was opened and nothing ever came back.
   *
   * Deliberately NOT reusing `booking.payment_still_recoverable`. That condition accepts FAILED,
   * PENDING and PROCESSING as well, because a failed payment is its own recoverable state with its
   * own workflow. Here the only status that means "abandoned" is INITIATED — the gateway order
   * exists and the gateway never answered. A FAILED payment is `payment_recovery`'s to chase, and
   * letting both conditions match it would mean two different messages about the same money.
   *
   * `amountPaid` at zero is checked separately from status because money can arrive by a route
   * that never updates the payment row in time — a late webhook, a reconciliation, a manual
   * settlement. Chasing someone who has already paid is the failure this exists to avoid.
   *
   * Booking status is restricted to PENDING: once a booking is ACCEPTED or ASSIGNED a partner is
   * already committed, and "your checkout is incomplete" is the wrong thing to say to someone whose
   * service is under way.
   */
  registerCondition("booking.checkout_abandoned", {
    and: [
      { field: "bookingPayment.exists", operator: "equals", value: true },
      { field: "bookingPayment.status", operator: "equals", value: "INITIATED" },
      { field: "bookingPayment.amountPaid", operator: "equals", value: 0 },
      { field: "booking.status", operator: "equals", value: "PENDING" },
    ],
  });

  // Payment recovery: the stop condition is the money arriving, however it arrived.
  registerCondition("payment.still_failed", {
    field: "payment.status",
    operator: "in",
    value: ["FAILED", "PENDING", "INITIATED"],
  });

  // Dispatch stall: assigned, but the partner has not set off yet.
  registerCondition("booking.assigned_not_en_route", {
    and: [
      { field: "booking.status", operator: "in", value: ["ACCEPTED", "ASSIGNED"] },
      { field: "booking.enRouteAt", operator: "notExists" },
    ],
  });

  // ── Partner acquisition (Section 01) ────────────────────────────────────────
  registerCondition("partnerLead.unassigned", {
    field: "partnerLead.assignedToAdminId",
    operator: "notExists",
  });

  registerCondition("partnerLead.stale_pipeline", {
    field: "partnerLead.status",
    operator: "in",
    value: ["NEW", "CONTACTED", "INTERESTED"],
  });

  registerCondition("provider.onboarding_incomplete", {
    field: "provider.onboardingInProgress",
    operator: "equals",
    value: true,
  });

  registerCondition("provider.kyc_incomplete", {
    and: [
      { field: "provider.onboardingInProgress", operator: "equals", value: true },
      { field: "provider.kycSubmitted", operator: "equals", value: false },
    ],
  });

  registerCondition("provider.training_incomplete", {
    and: [
      { field: "provider.isApproved", operator: "equals", value: false },
      { field: "provider.trainingComplete", operator: "equals", value: false },
    ],
  });

  registerCondition("provider.approval_pending", {
    field: "provider.isApproved",
    operator: "equals",
    value: false,
  });

  registerCondition("provider.changes_requested", {
    field: "provider.changesRequested",
    operator: "equals",
    value: true,
  });

  /**
   * Whether this partner is a working partner — the dispatch composite, as a condition.
   *
   * All six clauses are stated rather than summarised into one derived boolean. A resolver field
   * called `eligible` would move the policy into the resolver, where it could drift from
   * `matching.service.ts` without anything failing; written out here, the condition and the
   * dispatcher can be read side by side and seen to agree.
   *
   * Every clause is an `equals` against a boolean the resolver already exposes, so a missing field
   * fails closed with UNKNOWN_FIELD rather than silently dropping a clause from the conjunction.
   */
  registerCondition("provider.morning_eligible", {
    and: [
      { field: "provider.isActive", operator: "equals", value: true },
      { field: "provider.isApproved", operator: "equals", value: true },
      { field: "provider.isBanned", operator: "equals", value: false },
      { field: "provider.userBanned", operator: "equals", value: false },
      { field: "provider.complianceRestricted", operator: "equals", value: false },
      { field: "provider.paused", operator: "equals", value: false },
    ],
  });

  // ── Section 09 — compliance, payout, rating, availability ─────────────────
  registerCondition("provider.compliance_d30", {
    field: "provider.complianceD30",
    operator: "equals",
    value: true,
  });

  registerCondition("provider.compliance_d7", {
    field: "provider.complianceD7",
    operator: "equals",
    value: true,
  });

  registerCondition("provider.compliance_restricted", {
    field: "provider.complianceRestricted",
    operator: "equals",
    value: true,
  });

  registerCondition("provider.payout_still_failed", {
    field: "provider.hasFailedPayout",
    operator: "equals",
    value: true,
  });

  registerCondition("provider.rating_needs_coaching", {
    field: "provider.ratingNeedsCoaching",
    operator: "equals",
    value: true,
  });

  registerCondition("provider.still_offline", {
    and: [
      { field: "provider.isOnline", operator: "equals", value: false },
      { field: "provider.isActive", operator: "equals", value: true },
      { field: "provider.isBanned", operator: "equals", value: false },
    ],
  });
}
