import crypto from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { toInputJsonObject } from "../lib/json-input";
import type { SupportRecommendationState } from "@prisma/client";
import type {
  AutomationEligibility,
  ResolutionRecommendation,
  SupportClassification,
  SupportTicketContext,
} from "./support-intelligence.types";

/**
 * Phase 10, Capabilities 7 and 12 — recording what the AI advised, so a human decision can be
 * compared against it.
 *
 * ── Why this exists at all ─────────────────────────────────────────────────────
 *
 * Without a persisted recommendation there is no way to answer the questions the directive asks for:
 * recommendation acceptance, human override rate, duplicate execution, idempotency. There is also no
 * audit trail — an agent's reply and the advice that preceded it would live in different worlds, and
 * "AI suggested" would be indistinguishable from "a person decided".
 *
 * ── Dedupe is structural, not best-effort ──────────────────────────────────────
 *
 * `recommendationKey` is a hash of (ticket, rules version, context fingerprint) with a UNIQUE index
 * behind it. Re-analysing an unchanged ticket updates one row rather than accumulating a new
 * recommendation per page load — which is what would otherwise happen, since the admin panel
 * re-queries whenever an agent opens a ticket. The database enforces it; the code merely asks.
 *
 * ── This service records; it never decides ─────────────────────────────────────
 *
 * No lifecycle transition happens on its own. `markActed` is called by the support routes when a
 * *person* does something, and it writes down who and what. Nothing here can move a recommendation
 * to EXECUTED by itself, because nothing here executes.
 */

/**
 * A fingerprint of the facts the recommendation was made from.
 *
 * Chosen so that a genuinely changed ticket produces a new key while a re-read of an unchanged one
 * does not: message count moves when someone writes, the signal states move when a booking or
 * payment appears, and the action moves when any of that changes the advice. Deliberately excludes
 * timestamps — including `generatedAt` would defeat dedupe entirely, giving a fresh row per request.
 */
function contextFingerprint(
  ctx: SupportTicketContext,
  cls: SupportClassification,
  rec: ResolutionRecommendation,
): string {
  const parts = [
    ctx.ticketId,
    ctx.status,
    String(ctx.messageCount),
    ctx.booking.state, ctx.payment.state, ctx.refund.state, ctx.partner.state,
    String(cls.intent), cls.state,
    rec.action, rec.risk,
  ].join("|");
  return crypto.createHash("sha256").update(parts).digest("hex").slice(0, 32);
}

export const supportRecommendationStore = {
  /**
   * Record one recommendation, or refresh the existing row for the same facts.
   *
   * Never throws: a support agent must still see their advice if the audit write fails, so a failure
   * is logged and counted rather than propagated. The returned id is null in that case, and callers
   * treat that as "not recorded" rather than as an error.
   */
  async record(
    ctx: SupportTicketContext,
    cls: SupportClassification,
    rec: ResolutionRecommendation,
    eligibility: AutomationEligibility,
    latencyMs: number,
  ): Promise<{ id: string; recommendationKey: string; created: boolean } | null> {
    const fingerprint = contextFingerprint(ctx, cls, rec);
    const recommendationKey = `${ctx.ticketId}:${ctx.rulesVersion}:${fingerprint}`;

    /**
     * The initial lifecycle is decided by the recommendation's own risk, not by anything a model
     * said. Anything needing a person starts at REVIEW_REQUIRED so it can never be mistaken for
     * advice somebody already cleared.
     */
    const lifecycle: SupportRecommendationState = rec.requiresHumanReview
      ? "REVIEW_REQUIRED"
      : "RECOMMENDATION";

    try {
      const existing = await prisma.supportAiRecommendation.findUnique({
        where: { recommendationKey },
        select: { id: true, lifecycle: true },
      });

      // A recommendation a human has already acted on is never rewritten by a later read.
      if (existing && existing.lifecycle !== "RECOMMENDATION" && existing.lifecycle !== "REVIEW_REQUIRED") {
        return { id: existing.id, recommendationKey, created: false };
      }

      const data = {
        ticketId: ctx.ticketId,
        rulesVersion: ctx.rulesVersion,
        recommendationKey,
        intent: cls.intent,
        sentiment: cls.sentiment,
        modelConfidence: cls.modelConfidence,
        classificationState: cls.state,
        usedFallback: cls.usedFallback,
        provider: cls.provider,
        model: cls.model,
        action: rec.action,
        risk: rec.risk,
        requiresHumanReview: rec.requiresHumanReview,
        lifecycle,
        evidence: toInputJsonObject({ items: rec.evidence }) ?? {},
        limitations: rec.limitations,
        eligibilityChecks: toInputJsonObject({ checks: eligibility.checks, blocking: eligibility.blockingReasons }) ?? {},
        automationEligible: eligibility.eligible,
        latencyMs,
      };

      const row = await prisma.supportAiRecommendation.upsert({
        where: { recommendationKey },
        create: data,
        update: {
          // Only the volatile parts refresh; identity and the human's verdict never do.
          classificationState: data.classificationState,
          modelConfidence: data.modelConfidence,
          provider: data.provider,
          model: data.model,
          usedFallback: data.usedFallback,
          eligibilityChecks: data.eligibilityChecks,
          automationEligible: data.automationEligible,
          latencyMs: data.latencyMs,
        },
        select: { id: true },
      });

      incCounter("support_recommendations_total", {
        action: rec.action, risk: rec.risk, created: String(!existing),
      });
      return { id: row.id, recommendationKey, created: !existing };
    } catch (err) {
      incCounter("support_recommendation_write_failures_total", {});
      logger.warn("support_recommendation_record_failed", {
        ticketId: ctx.ticketId, error: String(err).slice(0, 200),
      });
      return null;
    }
  },

  /**
   * Record that a person acted on a ticket, and whether they followed the advice.
   *
   * Called from the existing support routes when an agent responds, escalates or resolves — the
   * actions that already existed. This service does not perform any of them; it observes that they
   * happened and writes down the comparison.
   *
   * `overridden` is the measurement the directive asks for: it is true when the human's action
   * differs from what was recommended, which is what makes "human override rate" a real number
   * rather than an estimate.
   */
  async markActed(input: {
    ticketId: string;
    actorId: string;
    actedAction: string;
    lifecycle: Extract<SupportRecommendationState, "APPROVED" | "REJECTED" | "EXECUTED" | "FAILED">;
    approvalId?: string;
    failureReason?: string;
  }): Promise<{ matched: boolean; overridden: boolean | null }> {
    try {
      /**
       * The newest recommendation that has not yet reached a terminal state.
       *
       * `APPROVED` is included deliberately. The real sequence an agent follows is
       * REVIEW_REQUIRED → APPROVED → EXECUTED: they accept the advice, then carry it out. An
       * earlier version matched only the two open states, so accepting advice and *then* acting on
       * it left the execution unrecorded — the smoke test caught it stalling at APPROVED. EXECUTED,
       * FAILED, REJECTED and EXPIRED remain terminal and are never revisited.
       */
      const open = await prisma.supportAiRecommendation.findFirst({
        where: {
          ticketId: input.ticketId,
          lifecycle: { in: ["RECOMMENDATION", "REVIEW_REQUIRED", "APPROVED"] },
        },
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true },
      });
      if (!open) return { matched: false, overridden: null };

      const overridden = open.action !== input.actedAction;

      await prisma.supportAiRecommendation.update({
        where: { id: open.id },
        data: {
          lifecycle: input.lifecycle,
          actedBy: input.actorId,
          actedAt: new Date(),
          actedAction: input.actedAction,
          overridden,
          approvalId: input.approvalId,
          failureReason: input.failureReason,
        },
      });

      incCounter("support_recommendation_outcomes_total", {
        lifecycle: input.lifecycle,
        overridden: String(overridden),
        recommended: open.action,
        acted: input.actedAction,
      });
      logger.info("support_recommendation_acted", {
        ticketId: input.ticketId,
        recommended: open.action,
        acted: input.actedAction,
        overridden,
        lifecycle: input.lifecycle,
        // The actor is recorded so an audit can tell a human decision from an AI suggestion.
        actorId: input.actorId,
      });
      return { matched: true, overridden };
    } catch (err) {
      logger.warn("support_recommendation_mark_acted_failed", {
        ticketId: input.ticketId, error: String(err).slice(0, 200),
      });
      return { matched: false, overridden: null };
    }
  },

  /**
   * A person explicitly accepted or rejected the advice, without necessarily executing anything yet.
   *
   * Distinct from `markActed`: that one observes a support action that already happened and infers
   * agreement from what was done. This one records a deliberate verdict on the recommendation
   * itself, which is the difference between "the agent escalated" and "the agent agreed this should
   * be escalated". `APPROVED` is not `EXECUTED` — accepting advice and carrying it out are two
   * events, and an audit that conflates them cannot show an accepted recommendation nobody acted on.
   */
  async recordVerdict(input: {
    ticketId: string;
    actorId: string;
    verdict: "APPROVED" | "REJECTED";
    note?: string;
  }): Promise<{ matched: boolean; recommendationId: string | null }> {
    try {
      const open = await prisma.supportAiRecommendation.findFirst({
        where: { ticketId: input.ticketId, lifecycle: { in: ["RECOMMENDATION", "REVIEW_REQUIRED"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, action: true },
      });
      if (!open) return { matched: false, recommendationId: null };

      await prisma.supportAiRecommendation.update({
        where: { id: open.id },
        data: {
          lifecycle: input.verdict,
          actedBy: input.actorId,
          actedAt: new Date(),
          // A verdict is about the recommendation, so the acted action is the recommended one.
          actedAction: open.action,
          overridden: input.verdict === "REJECTED",
          failureReason: input.note?.slice(0, 500),
        },
      });

      incCounter("support_recommendation_verdicts_total", { verdict: input.verdict });
      logger.info("support_recommendation_verdict", {
        ticketId: input.ticketId, recommendationId: open.id,
        verdict: input.verdict, actorId: input.actorId, recommended: open.action,
      });
      return { matched: true, recommendationId: open.id };
    } catch (err) {
      logger.warn("support_recommendation_verdict_failed", {
        ticketId: input.ticketId, error: String(err).slice(0, 200),
      });
      return { matched: false, recommendationId: null };
    }
  },

  /**
   * Expire open recommendations for a ticket whose facts have moved on.
   *
   * Called when a newer recommendation supersedes older open ones, so the audit does not accumulate
   * advice that was never acted on and can no longer be. EXPIRED is distinct from REJECTED on
   * purpose: nobody turned this down, it simply stopped being about the current ticket.
   */
  async expireSuperseded(ticketId: string, keepRecommendationKey: string): Promise<number> {
    try {
      const result = await prisma.supportAiRecommendation.updateMany({
        where: {
          ticketId,
          recommendationKey: { not: keepRecommendationKey },
          lifecycle: { in: ["RECOMMENDATION", "REVIEW_REQUIRED"] },
        },
        data: { lifecycle: "EXPIRED" },
      });
      if (result.count > 0) {
        incCounter("support_recommendations_expired_total", {});
      }
      return result.count;
    } catch (err) {
      logger.warn("support_recommendation_expire_failed", {
        ticketId, error: String(err).slice(0, 200),
      });
      return 0;
    }
  },
};

/**
 * Read the recommendation history for one ticket.
 *
 * Separate from the store object so a read surface cannot accidentally reach the write helpers. The
 * history is what makes a lifecycle observable: without it the UI can show the current advice but
 * not what was advised before, who acted, or whether they followed it.
 */
export const supportRecommendationReader = {
  async history(ticketId: string, limit = 20) {
    return prisma.supportAiRecommendation.findMany({
      where: { ticketId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, createdAt: true, updatedAt: true, rulesVersion: true,
        intent: true, sentiment: true, modelConfidence: true, classificationState: true,
        usedFallback: true, provider: true, model: true,
        action: true, risk: true, requiresHumanReview: true,
        lifecycle: true, actedBy: true, actedAt: true, actedAction: true, overridden: true,
        approvalId: true, failureReason: true, automationEligible: true, latencyMs: true,
        limitations: true,
        // `evidence` and `eligibilityChecks` are returned so the UI can reconstruct the decision
        // rather than asking the operator to trust a summary.
        evidence: true, eligibilityChecks: true,
      },
    });
  },

  /** The single open recommendation an agent would be acting on, if there is one. */
  async open(ticketId: string) {
    return prisma.supportAiRecommendation.findFirst({
      where: { ticketId, lifecycle: { in: ["RECOMMENDATION", "REVIEW_REQUIRED"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, action: true, risk: true, lifecycle: true, requiresHumanReview: true },
    });
  },
};
