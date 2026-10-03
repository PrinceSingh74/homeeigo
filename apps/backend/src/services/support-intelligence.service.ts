import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { supportContextService, type SupportContextScope } from "./support-context.service";
import { supportClassificationService } from "./support-classification.service";
import { supportResolutionService } from "./support-resolution.service";
import { supportAutomationEligibilityService } from "./support-automation-eligibility.service";
import { supportPriorityService } from "./support-priority.service";
import { supportRecommendationStore } from "./support-recommendation-store.service";
import { SUPPORT_AUTOMATION_FLAG, supportAutomationPolicy } from "./support-automation-policy.config";
import {
  SUPPORT_INTELLIGENCE_RULES_VERSION,
  type AutomationEligibility,
  type PriorityExplanation,
  type ResolutionRecommendation,
  type SupportClassification,
  type SupportTicketContext,
} from "./support-intelligence.types";

/**
 * Phase 10 — the one place the support intelligence pipeline is assembled.
 *
 * ── The five stages stay five stages ───────────────────────────────────────────
 *
 *   context      what the systems of record say
 *   classification what the model understood
 *   recommendation what the rules suggest a person do
 *   eligibility   whether automation may act (today: no, structurally)
 *   execution     absent from this file entirely
 *
 * There is no `execute()` here and no import of any executor. A caller that wants to act on a
 * recommendation goes to the existing support, finance, booking or partner service, under a human's
 * instruction and the existing RBAC — which is exactly the path a support agent already uses.
 *
 * ── Read-only ──────────────────────────────────────────────────────────────────
 *
 * Nothing in this pipeline writes. It does not update the ticket's category from the model's intent,
 * because a model's reading is not a correction to what the customer chose, and silently rewriting
 * the declared category would destroy the evidence the classification was judged against.
 */

export type SupportIntelligenceResult = {
  context: SupportTicketContext;
  classification: SupportClassification;
  /** The authoritative priority with its reasons. The model's view is inside, never instead of it. */
  priority: PriorityExplanation;
  recommendation: ResolutionRecommendation;
  eligibility: AutomationEligibility;
  /**
   * The audit row this analysis was recorded as, or null when the write failed.
   *
   * Null is not an error for the caller: an agent must still see their advice if the audit write
   * failed. It does mean this analysis cannot later be compared against what the human did.
   */
  recommendationId: string | null;
  humanDecisions: string[];
  featureFlag: { key: string; enabled: boolean };
  policyStatus: string;
  generatedAt: string;
  rulesVersion: string;
  timings: { totalMs: number; contextMs: number; classificationMs: number };
};

export const supportIntelligenceService = {
  /**
   * Analyse one ticket end to end.
   *
   * Returns `null` only when the ticket does not exist or the actor may not see it — the same answer
   * for both, so a probe cannot distinguish "no such ticket" from "not yours".
   */
  async analyze(
    ticketId: string,
    scope: SupportContextScope,
  ): Promise<SupportIntelligenceResult | null> {
    const t0 = Date.now();
    const generatedAt = new Date().toISOString();

    const context = await supportContextService.build(ticketId, scope);
    if (!context) return null;
    const contextMs = Date.now() - t0;

    // Subject and description are read here rather than carried through the context type: they are
    // untrusted prose, and only the classifier has a fenced place to put them.
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { subject: true, description: true },
    });

    const c0 = Date.now();
    const classification = await supportClassificationService.classify(context, {
      subject: ticket?.subject ?? "",
      description: ticket?.description ?? "",
      actorId: scope.actorUserId,
    });
    const classificationMs = Date.now() - c0;

    const recommendation = supportResolutionService.recommend(context, classification);
    const [eligibility, priority] = await Promise.all([
      supportAutomationEligibilityService.evaluate(context, classification, recommendation),
      supportPriorityService.explain(context, classification),
    ]);

    /**
     * Record the advice before returning it.
     *
     * Deliberately after the decision and before the response: recording first would log advice that
     * was never shown, and recording later would leave a window where an agent acted on something
     * the audit has no row for. Older open recommendations for this ticket are expired so the audit
     * holds one live piece of advice per ticket rather than a pile of superseded ones.
     */
    const stored = await supportRecommendationStore.record(
      context, classification, recommendation, eligibility, Date.now() - t0,
    );
    if (stored) {
      await supportRecommendationStore.expireSuperseded(ticketId, stored.recommendationKey);
    }

    let flagEnabled: boolean;
    try {
      const { evaluateFlag } = await import("./feature-flag.service");
      flagEnabled = (await evaluateFlag(SUPPORT_AUTOMATION_FLAG)).enabled;
    } catch {
      flagEnabled = false;
    }

    incCounter("support_intelligence_analyses_total", {
      intent: classification.intent ?? "NONE",
      action: recommendation.action,
      eligible: String(eligibility.eligible),
    });
    logger.info("support_intelligence_analyzed", {
      ticketId,
      intent: classification.intent,
      action: recommendation.action,
      classificationState: classification.state,
      eligible: eligibility.eligible,
    });

    return {
      context,
      classification,
      priority,
      recommendation,
      eligibility,
      recommendationId: stored?.id ?? null,
      humanDecisions: supportAutomationEligibilityService.humanDecisions(),
      featureFlag: { key: SUPPORT_AUTOMATION_FLAG, enabled: flagEnabled },
      policyStatus: supportAutomationPolicy.status,
      generatedAt,
      rulesVersion: SUPPORT_INTELLIGENCE_RULES_VERSION,
      timings: { totalMs: Date.now() - t0, contextMs, classificationMs },
    };
  },
};
