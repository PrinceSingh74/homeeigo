/**
 * What support automation is allowed to do, and the deliberate fact that nobody has decided yet.
 *
 * ── What discovery actually found ──────────────────────────────────────────────
 *
 * The support domain already carries two **real, authoritative** policies, and this file does not
 * touch either:
 *
 *   - **SLA**, in `support-ticket.service.ts`: HIGH 2 h, NORMAL 24 h, LOW 48 h.
 *   - **Priority**, in `resolvePriority()`: membership or `prioritySupport` -> HIGH, else NORMAL.
 *
 * What does *not* exist anywhere is an automation policy: no confidence threshold, no low-risk
 * action list, no escalation timing, no compensation rule. Those are business decisions, and this
 * module holds the gap open instead of closing it with a number that looks reasonable.
 *
 * ── The number that must not be invented ───────────────────────────────────────
 *
 * `confidenceThreshold` is the single most tempting value in Phase 10. "0.8 feels right" is not a
 * policy — it is a guess wearing a policy's clothes, and on a refund ticket it is the difference
 * between a human reading the case and a machine closing it. There is no industry default to borrow
 * and no measured accuracy to derive one from: the model reports a self-assessed confidence that
 * nothing in this platform has validated against outcomes.
 *
 * So it is `null`, and `isAutomationAuthorized()` returns false while it is.
 *
 * ── Fail closed ────────────────────────────────────────────────────────────────
 *
 * Shipped state is `stage: "RECOMMENDATION_ONLY"` with everything null. Nothing may execute a
 * support action automatically. The eligibility engine still runs, still evaluates every clause, and
 * still reports what it *would* conclude — which is how the thresholds get chosen later, from
 * observed behaviour rather than from taste.
 */

import type { SupportIntent } from "./support-intelligence.types";

/** The rollout ladder. Nothing skips a rung. */
export const AUTOMATION_STAGES = [
  "OFF",
  "SHADOW",
  "RECOMMENDATION_ONLY",
  "HUMAN_IN_THE_LOOP",
  "CONTROLLED_AUTOMATION",
] as const;
export type AutomationStage = (typeof AUTOMATION_STAGES)[number];

export type SupportAutomationPolicy = {
  readonly stage: AutomationStage;
  /**
   * Minimum model confidence for automated execution. `null` means UNSET.
   *
   * Not "use 0.8 for now". There is no default, because the model's confidence has never been
   * measured against whether its classifications were right.
   */
  readonly confidenceThreshold: number | null;
  /** Intents whose actions a human has cleared for automation. Empty means none. */
  readonly automatableIntents: readonly SupportIntent[];
  /** How long a ticket may sit before escalation review. `null` means UNSET. */
  readonly escalationAfterMinutes: number | null;
  readonly status: "UNSET" | "APPROVED";
};

/**
 * The shipped policy.
 *
 * Deliberately not environment-driven. An env var would let a deployment invent the business
 * decision this module exists to withhold, and "someone set SUPPORT_CONFIDENCE_THRESHOLD in prod"
 * is not a decision anybody reviewed.
 */
export const supportAutomationPolicy: SupportAutomationPolicy = Object.freeze({
  stage: "RECOMMENDATION_ONLY",
  confidenceThreshold: null,
  automatableIntents: Object.freeze([]) as readonly SupportIntent[],
  escalationAfterMinutes: null,
  status: "UNSET",
});

/** The decisions a human owes, named so they are tracked rather than rediscovered. */
export const SUPPORT_HUMAN_DECISIONS = [
  "SUPPORT_AUTOMATION_CONFIDENCE_THRESHOLD_HUMAN_DECISION_REQUIRED",
  "SUPPORT_LOW_RISK_ACTION_TAXONOMY_HUMAN_DECISION_REQUIRED",
  "SUPPORT_ESCALATION_TIMING_HUMAN_DECISION_REQUIRED",
  "SUPPORT_COMPENSATION_POLICY_HUMAN_DECISION_REQUIRED",
] as const;

/** The feature flag gating any automated support execution. Absent means off. */
export const SUPPORT_AUTOMATION_FLAG = "SUPPORT_INTELLIGENCE_AUTOMATION" as const;

/**
 * Whether support automation may execute anything at all.
 *
 * All four conditions, or none. A stage without a threshold would automate on any confidence; a
 * threshold without an approved stage is a number nobody signed off.
 */
export function isAutomationAuthorized(
  policy: SupportAutomationPolicy = supportAutomationPolicy,
): boolean {
  return (
    policy.status === "APPROVED" &&
    policy.stage === "CONTROLLED_AUTOMATION" &&
    policy.confidenceThreshold !== null &&
    policy.automatableIntents.length > 0
  );
}

/**
 * Refuses a threshold that was reverse-engineered from a model's own output.
 *
 * Callable rather than a comment, and asserted by test. The specific mistake it catches: reading a
 * live classification's `modelConfidence`, rounding it down, and calling that the policy. That is
 * not a threshold — it is the model grading its own homework, and it would pass every ticket it was
 * derived from.
 */
export function assertThresholdIsNotDerivedFromModel(args: {
  threshold: number | null;
  observedModelConfidences: number[];
  humanApproved?: boolean;
}): { ok: true } | { ok: false; reason: string } {
  if (args.threshold === null) return { ok: true };
  if (args.humanApproved === true) return { ok: true };
  if (args.observedModelConfidences.some((c) => Math.abs(c - args.threshold!) < 1e-9)) {
    return {
      ok: false,
      reason:
        `Threshold ${args.threshold} equals an observed model confidence. A model's self-reported ` +
        `number is not a measurement of its accuracy, so it cannot become the bar it must clear. ` +
        `Set humanApproved only if a person chose this value on its own merits.`,
    };
  }
  return { ok: true };
}
