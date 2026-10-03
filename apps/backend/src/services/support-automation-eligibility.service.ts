import { evaluateFlag, currentEnvironment } from "./feature-flag.service";
import {
  SUPPORT_AUTOMATION_FLAG,
  SUPPORT_HUMAN_DECISIONS,
  isAutomationAuthorized,
  supportAutomationPolicy,
  type SupportAutomationPolicy,
} from "./support-automation-policy.config";
import {
  SUPPORT_INTELLIGENCE_RULES_VERSION,
  SUPPORT_REASON,
  type AutomationEligibility,
  type ResolutionRecommendation,
  type SupportClassification,
  type SupportReason,
  type SupportTicketContext,
} from "./support-intelligence.types";

/**
 * Phase 10, Capabilities 9 and 10 — may automation run this, and the answer today.
 *
 * ── Every clause is evaluated, even when an earlier one already said no ────────
 *
 * A bare "not eligible" teaches nobody anything. The engine runs all nine checks and reports each
 * one's verdict, so the eventual policy conversation starts from evidence: *which* clause fails, on
 * *what proportion* of real tickets, and what would change if a threshold existed. That is how the
 * threshold gets chosen later — from observed behaviour rather than from taste.
 *
 * ── The answer today is no, structurally ───────────────────────────────────────
 *
 * `supportAutomationPolicy` ships UNSET: no confidence threshold, no automatable intents, stage
 * RECOMMENDATION_ONLY. `POLICY_ALLOWED` therefore fails on every ticket, and it fails for a reason
 * that cannot be argued away by a good model score. The feature flag is absent as well, so two
 * independent gates are shut.
 *
 * ── Why this engine cannot execute ─────────────────────────────────────────────
 *
 * It returns a verdict. It has no executor, imports none, and the one place a caller could act on
 * `eligible: true` does not exist yet — Capability 10's controlled-automation path is deliberately
 * unbuilt while the policy is unset, because building an executor for a decision nobody has made is
 * how a rehearsal becomes a live action.
 */

/** Actions considered low-risk *only* if a human ever declares them so. Empty until then. */
const RISK_BY_ACTION: Record<ResolutionRecommendation["risk"], boolean> = {
  LOW: true,
  MEDIUM: false,
  HIGH: false,
};

export const supportAutomationEligibilityService = {
  /**
   * Evaluate every eligibility clause for one ticket.
   *
   * Never throws and never mutates. A flag-store failure returns a failed check, not an exception,
   * because "we could not read the flag" must behave exactly like "the flag is off".
   */
  async evaluate(
    ctx: SupportTicketContext,
    cls: SupportClassification,
    rec: ResolutionRecommendation,
    policy: SupportAutomationPolicy = supportAutomationPolicy,
  ): Promise<AutomationEligibility> {
    const checks: AutomationEligibility["checks"] = [];
    const blocking: SupportReason[] = [];

    const add = (name: string, passed: boolean, detail: string, reason?: SupportReason) => {
      checks.push({ name, passed, detail });
      if (!passed && reason && !blocking.includes(reason)) blocking.push(reason);
    };

    // 1. Risk — from the recommendation's own classification, not from the model's tone.
    add(
      "LOW_RISK",
      RISK_BY_ACTION[rec.risk],
      `Recommended action ${rec.action} is risk ${rec.risk}.`,
      SUPPORT_REASON.AUTOMATION_NOT_ELIGIBLE,
    );

    // 2. Human review — a recommendation that demands a person is never automatable.
    add(
      "NO_HUMAN_REVIEW_REQUIRED",
      !rec.requiresHumanReview,
      rec.requiresHumanReview
        ? `${rec.action} requires human review.`
        : `${rec.action} does not require human review.`,
      SUPPORT_REASON.HUMAN_DECISION_REQUIRED,
    );

    /**
     * 3. Confidence — the clause that cannot pass today, and the reason is stated rather than hidden.
     *
     * With no approved threshold there is nothing to compare against. Comparing to a default would
     * mean inventing the policy this module exists to withhold.
     */
    const threshold = policy.confidenceThreshold;
    add(
      "HIGH_CONFIDENCE",
      threshold !== null && cls.modelConfidence !== null && cls.modelConfidence >= threshold,
      threshold === null
        ? `No approved confidence threshold exists. Model self-reported ${cls.modelConfidence ?? "none"}, which cannot be compared to anything.`
        : `Model self-reported ${cls.modelConfidence ?? "none"} against threshold ${threshold}.`,
      threshold === null ? SUPPORT_REASON.POLICY_UNSET : SUPPORT_REASON.AUTOMATION_NOT_ELIGIBLE,
    );

    // 4. Policy — is this intent on a human-approved automatable list at all.
    add(
      "POLICY_ALLOWED",
      cls.intent !== null && policy.automatableIntents.includes(cls.intent),
      policy.automatableIntents.length === 0
        ? `No intent has been approved for automation.`
        : `Approved intents: ${policy.automatableIntents.join(", ")}; this ticket is ${cls.intent}.`,
      SUPPORT_REASON.POLICY_UNSET,
    );

    // 5. Classification actually succeeded — a fallback guess never drives automation.
    add(
      "CLASSIFICATION_RELIABLE",
      cls.state === "CLASSIFIED" && !cls.usedFallback,
      `Classification state ${cls.state}, fallback used: ${cls.usedFallback}.`,
      SUPPORT_REASON.INSUFFICIENT_EVIDENCE,
    );

    // 6. Required context present — automation on a ticket with no readable booking is guesswork.
    const contextComplete = ctx.limitations.length === 0;
    add(
      "REQUIRED_CONTEXT_PRESENT",
      contextComplete,
      contextComplete ? `All context signals resolved.` : `Unresolved: ${ctx.limitations.join("; ")}`,
      SUPPORT_REASON.INSUFFICIENT_EVIDENCE,
    );

    // 7. Data freshness — a stale read must not authorise an action taken now.
    const stale = [ctx.booking, ctx.payment, ctx.refund, ctx.partner].filter((s) => s.freshness === "STALE");
    add(
      "DATA_FRESH",
      stale.length === 0,
      stale.length === 0 ? `No stale signals.` : `${stale.length} signal(s) stale.`,
      SUPPORT_REASON.DATA_STALE,
    );

    // 8. Feature flag — fail-closed. A missing row and an unreadable store both read as off.
    let flagEnabled: boolean;
    try {
      flagEnabled = (await evaluateFlag(SUPPORT_AUTOMATION_FLAG)).enabled;
    } catch {
      flagEnabled = false;
    }
    add(
      "FEATURE_FLAG_ENABLED",
      flagEnabled,
      flagEnabled ? `${SUPPORT_AUTOMATION_FLAG} is enabled.` : `${SUPPORT_AUTOMATION_FLAG} is off or absent.`,
      SUPPORT_REASON.AUTOMATION_NOT_ELIGIBLE,
    );

    /**
     * 9. No high-risk condition — the catch-all the directive names, and it is not a duplicate of
     * `LOW_RISK`.
     *
     * `LOW_RISK` asks about the recommended action. This asks about the *ticket*: money in play, a
     * partner's standing at stake, or a classification the platform could not make reliably. A LOW
     * action on a refund ticket is still a refund ticket, and automating it because the action
     * looked harmless is exactly the failure this clause exists to catch.
     */
    const highRiskIntents = new Set(["REFUND", "PAYMENT", "PARTNER_ISSUE"]);
    const highRiskCondition =
      (cls.intent !== null && highRiskIntents.has(cls.intent)) ||
      rec.risk === "HIGH" ||
      cls.state !== "CLASSIFIED";
    add(
      "NO_HIGH_RISK_CONDITION",
      !highRiskCondition,
      highRiskCondition
        ? `High-risk condition present: intent ${cls.intent}, action risk ${rec.risk}, classification ${cls.state}.`
        : `No high-risk condition: intent ${cls.intent}, action risk ${rec.risk}.`,
      SUPPORT_REASON.AUTOMATION_NOT_ELIGIBLE,
    );

    /**
     * 10. Environment — where this is running, and whether automation is permitted here.
     *
     * Read through `currentEnvironment()`, the same helper the feature-flag service uses, so a flag
     * enabled for `dev` and this clause always agree about which environment they are in. Production
     * is refused outright and separately from every other clause: the whole point of an environment
     * gate is that it cannot be satisfied by a good confidence score or an enabled flag.
     */
    const env = currentEnvironment();
    const envAllowed = env !== "production" && env !== "prod";
    add(
      "ENVIRONMENT_ALLOWED",
      envAllowed,
      envAllowed
        ? `Environment "${env}" permits development automation.`
        : `Environment "${env}" is production; support automation is not permitted from this code path.`,
      SUPPORT_REASON.AUTOMATION_NOT_ELIGIBLE,
    );

    /**
     * 11. Executor — named in the directive's model, and the honest answer today is "there is none".
     *
     * Omitting this clause would have been the most flattering possible error: every other gate
     * could one day pass, and the engine would report `eligible: true` for an action nothing in the
     * platform can carry out. Support automation has no executor by design — Capability 10's
     * actuator is deliberately unbuilt while the policy is UNSET — so this clause fails on every
     * ticket and says exactly why.
     */
    add(
      "EXECUTOR_AVAILABLE",
      false,
      "No support automation executor exists. The actuator is deliberately unbuilt while the automation policy is UNSET.",
      SUPPORT_REASON.AUTOMATION_NOT_ELIGIBLE,
    );

    // 12. Governance — the policy itself must be approved, not merely populated.
    const authorized = isAutomationAuthorized(policy);
    add(
      "GOVERNANCE_ALLOWED",
      authorized,
      authorized
        ? `Policy approved at stage ${policy.stage}.`
        : `Policy status ${policy.status} at stage ${policy.stage}; automation is not authorised.`,
      SUPPORT_REASON.HUMAN_DECISION_REQUIRED,
    );

    const eligible = checks.every((c) => c.passed);

    return {
      // Belt and braces: even if every clause somehow passed, an unauthorised policy wins.
      eligible: eligible && authorized,
      checks,
      blockingReasons: blocking,
      stage: authorized ? policy.stage : "RECOMMENDATION_ONLY",
      rulesVersion: SUPPORT_INTELLIGENCE_RULES_VERSION,
    };
  },

  /** The decisions blocking automation, surfaced with the verdict rather than buried in a doc. */
  humanDecisions(): string[] {
    return [...SUPPORT_HUMAN_DECISIONS];
  },
};
