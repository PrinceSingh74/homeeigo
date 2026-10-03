import {
  SUPPORT_INTELLIGENCE_RULES_VERSION,
  SUPPORT_REASON,
  type ResolutionAction,
  type ResolutionRecommendation,
  type SupportClassification,
  type SupportTicketContext,
} from "./support-intelligence.types";

/**
 * Phase 10, Capability 6 — what a human should look at next.
 *
 * ── Deterministic on purpose ───────────────────────────────────────────────────
 *
 * The model classified; the *recommendation* is rules over the classification plus authoritative
 * context. That split is the point. A model free to pick the next action could pick
 * `RESOLVE_WITH_STANDARD_RESPONSE` on a refund dispute because the prose sounded calm, and nothing
 * downstream would know the difference between a reasoned choice and a fluent one.
 *
 * So every action below is reachable only through a named rule, and every rule states the evidence
 * it consulted. `reason` is assembled from those facts, never quoted from the model.
 *
 * ── What is never recommended ──────────────────────────────────────────────────
 *
 * There is no `ISSUE_REFUND`, no `CANCEL_BOOKING`, no `PENALISE_PARTNER`. The strongest money-facing
 * action in the vocabulary is `REVIEW_REFUND` — a request that a person look, not an instruction to
 * pay. Phase 10 recommends reviews; the existing finance, booking and partner services execute, and
 * only when a human tells them to.
 */

/** Actions that touch money, an account, or a partner's standing. Always human-reviewed. */
const HIGH_RISK_ACTIONS: ReadonlySet<ResolutionAction> = new Set([
  "REVIEW_REFUND", "REVIEW_PAYMENT", "REVIEW_BOOKING", "CONTACT_PARTNER", "ESCALATE",
]);

type Ev = ResolutionRecommendation["evidence"];

function sig(name: string, s: { state: string; value: unknown; source: string }): Ev[number] {
  const v = s.state === "OK" && s.value !== null
    ? JSON.stringify(s.value).slice(0, 160)
    : s.state;
  return { signal: name, value: v, source: s.source };
}

export const supportResolutionService = {
  /**
   * Recommend a next action.
   *
   * Ordered so that a missing fact beats a confident guess: if the context needed to answer the
   * ticket is absent, the recommendation is to ask for it, not to proceed on the model's reading.
   */
  recommend(ctx: SupportTicketContext, cls: SupportClassification): ResolutionRecommendation {
    const evidence: Ev = [
      { signal: "intent", value: String(cls.intent), source: cls.usedFallback ? "deterministic-fallback" : `model:${cls.provider ?? "unknown"}` },
      { signal: "classificationState", value: cls.state, source: "supportClassificationService" },
      sig("booking", ctx.booking), sig("payment", ctx.payment), sig("refund", ctx.refund),
    ];
    const limitations = [...ctx.limitations];

    const build = (action: ResolutionAction, reason: string, risk: ResolutionRecommendation["risk"], reasonCode?: ResolutionRecommendation["reasonCode"]): ResolutionRecommendation => ({
      action, reason, evidence, risk,
      requiresHumanReview: HIGH_RISK_ACTIONS.has(action) || risk !== "LOW",
      limitations,
      reasonCode,
      rulesVersion: SUPPORT_INTELLIGENCE_RULES_VERSION,
    });

    /**
     * A ticket the classifier could not read is not a GENERAL ticket.
     *
     * `OUTPUT_INVALID` and `MODEL_UNAVAILABLE` both fall back to a keyword guess, and treating that
     * guess as a basis for a money-facing recommendation would launder a failure into a decision.
     */
    if (cls.state === "OUTPUT_INVALID" || cls.state === "MODEL_UNAVAILABLE") {
      limitations.push(`Classification degraded (${cls.state}); intent came from the deterministic fallback.`);
    }

    // 1. No linked booking on a ticket that is about one — ask, do not assume.
    if ((cls.intent === "BOOKING" || cls.intent === "DELAY" || cls.intent === "SERVICE_QUALITY")
        && ctx.booking.state !== "OK") {
      return build(
        "REQUEST_MORE_INFORMATION",
        `The ticket is about a booking but no booking is linked (${ctx.booking.state}). Ask the customer for the booking reference before assessing.`,
        "LOW",
        SUPPORT_REASON.INSUFFICIENT_EVIDENCE,
      );
    }

    // 2. Money-facing intents route to a review, never to an amount.
    if (cls.intent === "REFUND") {
      if (ctx.payment.state !== "OK") {
        return build(
          "REVIEW_PAYMENT",
          `A refund was requested but the payment record is ${ctx.payment.state}. A person must establish the payment before any refund question can be answered.`,
          "HIGH",
          SUPPORT_REASON.INSUFFICIENT_EVIDENCE,
        );
      }
      const existing = ctx.refund.state === "OK" ? (ctx.refund.value?.requests ?? 0) : null;
      return build(
        "REVIEW_REFUND",
        existing && existing > 0
          ? `A refund request already exists for this payment (latest status ${ctx.refund.value?.latestStatus ?? "unknown"}). A person must review it; no amount is proposed here.`
          : `Refund intent with a readable payment record and no existing refund request. A person must decide eligibility and amount through the finance path.`,
        "HIGH",
      );
    }

    if (cls.intent === "PAYMENT") {
      return build(
        "REVIEW_PAYMENT",
        ctx.payment.state === "OK"
          ? `Payment record reads status ${ctx.payment.value?.status}. A person must compare it against what the customer describes; the platform does not infer payment outcomes from ticket text.`
          : `Payment record is ${ctx.payment.state}, so the customer's account of the charge cannot be checked automatically.`,
        "HIGH",
      );
    }

    /**
     * 3. Delay — the distinction the directive insists on.
     *
     * A customer saying "nobody came" is a *reported* delay. A booking still in a pre-completion
     * state past its scheduled time is a *verified* one. The recommendation names which it has, and
     * never asserts a delay the booking record does not support.
     */
    if (cls.intent === "DELAY") {
      const b = ctx.booking.value;
      const scheduled = b?.scheduledDate ? Date.parse(b.scheduledDate) : null;
      const verified = scheduled !== null && Number.isFinite(scheduled)
        && Date.now() > scheduled
        && b?.completedAt === null;
      return build(
        verified ? "ESCALATE" : "EXPLAIN_STATUS",
        verified
          ? `Verified delay: booking ${b?.number} was scheduled for ${b?.scheduledDate} and has no completion time. Operational review needed.`
          : `Reported delay only. Booking state is ${b?.status ?? ctx.booking.state}; the record does not by itself confirm a delay, so explain the current status rather than assert one.`,
        verified ? "MEDIUM" : "LOW",
      );
    }

    // 4. Partner issues go to a person. No automatic disciplinary path exists, by design.
    if (cls.intent === "PARTNER_ISSUE") {
      return build(
        "CONTACT_PARTNER",
        ctx.partner.state === "OK"
          ? `Complaint concerns partner ${ctx.partner.value?.businessName ?? ctx.partner.value?.providerId}. A person must gather the partner's account before any action; no restriction or penalty is proposed.`
          : `Complaint concerns a partner, but the partner record is ${ctx.partner.state} for this actor. Escalate to someone authorised to read it.`,
        "MEDIUM",
      );
    }

    if (cls.intent === "SERVICE_QUALITY") {
      return build(
        "ESCALATE",
        `Service-quality complaint against booking ${ctx.booking.value?.number ?? "unknown"} (state ${ctx.booking.value?.status ?? ctx.booking.state}). A person must assess severity; the platform does not conclude that a service failed from the customer's description alone.`,
        "MEDIUM",
      );
    }

    if (cls.intent === "BOOKING") {
      return build(
        "REVIEW_BOOKING",
        `Booking ${ctx.booking.value?.number} is in state ${ctx.booking.value?.status}. Any cancellation or reschedule must go through the booking service under a person's instruction.`,
        "HIGH",
      );
    }

    // 5. SLA breach outranks a routine GENERAL answer.
    if (ctx.slaBreached === true) {
      return build(
        "ESCALATE",
        `The first-response SLA has elapsed (due ${ctx.slaDueAt}) and no first response is recorded. Escalation is warranted regardless of intent.`,
        "MEDIUM",
      );
    }

    /**
     * 6. GENERAL with everything present.
     *
     * This is the only LOW-risk terminal recommendation, and it still does not send anything — it
     * proposes that an agent send a standard reply.
     */
    if (ctx.messageCount <= 1) {
      return build(
        "REQUEST_MORE_INFORMATION",
        `General enquiry with a single message and no linked booking or payment. More detail is needed before anything can be assessed.`,
        "LOW",
        SUPPORT_REASON.INSUFFICIENT_EVIDENCE,
      );
    }

    return build(
      "RESOLVE_WITH_STANDARD_RESPONSE",
      `General enquiry with ${ctx.messageCount} messages and no money, booking or partner dimension detected. An agent may answer with the standard response.`,
      "LOW",
    );
  },
};
