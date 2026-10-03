import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { SUPPORT_INTELLIGENCE_RULES_VERSION, SUPPORT_REASON } from "./support-intelligence.types";
import { SUPPORT_AUTOMATION_FLAG, supportAutomationPolicy } from "./support-automation-policy.config";

/**
 * Phase 10, Capability 12 — support intelligence observability.
 *
 * ── Only metrics with a source ─────────────────────────────────────────────────
 *
 * The directive lists roughly twenty measures. Most are computable from
 * `support_ai_recommendations` and `support_tickets`. Some are not, and those are returned as
 * explicit `unmeasurable` entries naming the missing source rather than as a zero — a dashboard
 * reading "actual automation rate: 0%" is indistinguishable from one reading "we never measured it",
 * and only one of those is true here.
 *
 * ── Counts, not opinions ───────────────────────────────────────────────────────
 *
 * Every number is a GROUP BY over rows the platform actually wrote. Nothing is modelled or
 * projected, and every rate carries its denominator so a 100% acceptance rate over two tickets
 * cannot be mistaken for a trend.
 */

export type MeasuredRate = {
  value: number | null;
  numerator: number;
  denominator: number;
  /** Present when the rate could not be computed. Never replaced by 0. */
  reasonCode?: string;
};

function rate(numerator: number, denominator: number): MeasuredRate {
  if (denominator === 0) {
    return { value: null, numerator, denominator, reasonCode: SUPPORT_REASON.INSUFFICIENT_EVIDENCE };
  }
  return { value: Math.round((numerator / denominator) * 10000) / 10000, numerator, denominator };
}

function tally(rows: Array<{ k: string | null; n: number }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.k ?? "NONE"] = r.n;
  return out;
}

export const supportIntelligenceAnalyticsService = {
  /**
   * Aggregate everything measurable about the support intelligence layer.
   *
   * Read-only. Returns explicit unmeasurable entries rather than omitting them, so the gap between
   * what the directive asks for and what the platform can answer is visible on the dashboard rather
   * than only in a document.
   */
  async summary(): Promise<Record<string, unknown>> {
    const generatedAt = new Date().toISOString();

    try {
      const q = <T>(sql: string) => prisma.$queryRawUnsafe<T[]>(sql);
      const REC = "support_ai_recommendations";

      const [
        ticketVolume, classified, byIntent, bySentiment, byAction, byRisk,
        byLifecycle, byProvider, byClassificationState, outcomes, latency, ticketPriority,
      ] = await Promise.all([
        q<{ n: number }>("SELECT count(*)::int n FROM support_tickets"),
        q<{ n: number }>(`SELECT count(DISTINCT ticket_id)::int n FROM ${REC}`),
        q<{ k: string | null; n: number }>(`SELECT intent k, count(*)::int n FROM ${REC} GROUP BY 1`),
        q<{ k: string | null; n: number }>(`SELECT sentiment k, count(*)::int n FROM ${REC} GROUP BY 1`),
        q<{ k: string | null; n: number }>(`SELECT action k, count(*)::int n FROM ${REC} GROUP BY 1`),
        q<{ k: string | null; n: number }>(`SELECT risk k, count(*)::int n FROM ${REC} GROUP BY 1`),
        q<{ k: string | null; n: number }>(`SELECT lifecycle::text k, count(*)::int n FROM ${REC} GROUP BY 1`),
        q<{ k: string | null; n: number }>(`SELECT provider k, count(*)::int n FROM ${REC} GROUP BY 1`),
        q<{ k: string | null; n: number }>(`SELECT classification_state k, count(*)::int n FROM ${REC} GROUP BY 1`),
        q<{ total: number; acted: number; overridden: number; fallback: number; eligible: number; executed: number; failed: number }>(
          `SELECT count(*)::int total,
                  count(*) FILTER (WHERE acted_at IS NOT NULL)::int acted,
                  count(*) FILTER (WHERE overridden IS TRUE)::int overridden,
                  count(*) FILTER (WHERE used_fallback IS TRUE)::int fallback,
                  count(*) FILTER (WHERE automation_eligible IS TRUE)::int eligible,
                  count(*) FILTER (WHERE lifecycle = 'EXECUTED')::int executed,
                  count(*) FILTER (WHERE lifecycle = 'FAILED')::int failed
             FROM ${REC}`),
        q<{ p50: number | null; p95: number | null; max: number | null }>(
          `SELECT percentile_disc(0.5) WITHIN GROUP (ORDER BY latency_ms)::int p50,
                  percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms)::int p95,
                  max(latency_ms)::int max
             FROM ${REC} WHERE latency_ms IS NOT NULL`),
        q<{ k: string | null; n: number }>("SELECT priority_level::text k, count(*)::int n FROM support_tickets GROUP BY 1"),
      ]);

      const o = outcomes[0] ?? { total: 0, acted: 0, overridden: 0, fallback: 0, eligible: 0, executed: 0, failed: 0 };

      return {
        generatedAt,
        rulesVersion: SUPPORT_INTELLIGENCE_RULES_VERSION,
        ticketVolume: ticketVolume[0]?.n ?? 0,
        recommendationsRecorded: o.total,
        /** Share of tickets that have ever been analysed. */
        classificationCoverage: rate(classified[0]?.n ?? 0, ticketVolume[0]?.n ?? 0),
        distributions: {
          intent: tally(byIntent),
          sentiment: tally(bySentiment),
          action: tally(byAction),
          risk: tally(byRisk),
          lifecycle: tally(byLifecycle),
          provider: tally(byProvider),
          classificationState: tally(byClassificationState),
          /** From the ticket table: the authoritative priority, not the model's suggestion. */
          ticketPriority: tally(ticketPriority),
        },
        rates: {
          /** A person acted on the advice at all. */
          recommendationActedOn: rate(o.acted, o.total),
          /** They acted differently from what was advised. Denominator is acted-on, not total. */
          humanOverride: rate(o.overridden, o.acted),
          /** The model did not answer, or its output was rejected. */
          fallback: rate(o.fallback, o.total),
          automationEligible: rate(o.eligible, o.total),
          executed: rate(o.executed, o.total),
          failedExecution: rate(o.failed, o.total),
        },
        latencyMs: latency[0] ?? { p50: null, p95: null, max: null },
        automation: {
          stage: supportAutomationPolicy.stage,
          policyStatus: supportAutomationPolicy.status,
          confidenceThreshold: supportAutomationPolicy.confidenceThreshold,
          featureFlag: SUPPORT_AUTOMATION_FLAG,
          /** No executor exists, so this is structurally zero rather than merely unobserved. */
          actualAutomatedExecutions: 0,
        },
        /**
         * Measures the directive names that this platform has no source for, listed by name with the
         * missing source. An absent metric and a zero metric are different claims.
         */
        unmeasurable: [
          { metric: "resolutionOutcomeQuality", reasonCode: SUPPORT_REASON.SOURCE_NOT_IMPLEMENTED, missingSource: "no outcome-quality signal exists on a resolved ticket" },
          { metric: "unsafeRecommendationRate", reasonCode: SUPPORT_REASON.SOURCE_NOT_IMPLEMENTED, missingSource: "no reviewer marks a recommendation unsafe, so there is nothing to count" },
          { metric: "duplicateExecutionAttempts", reasonCode: SUPPORT_REASON.AUTOMATION_NOT_ELIGIBLE, missingSource: "no executor exists, so no execution can be duplicated" },
          { metric: "staleContextRate", reasonCode: SUPPORT_REASON.SOURCE_NOT_IMPLEMENTED, missingSource: "context freshness is evaluated per request and not persisted" },
        ],
      };
    } catch (err) {
      logger.warn("support_intelligence_analytics_unavailable", { error: String(err).slice(0, 200) });
      return {
        generatedAt,
        state: "SOURCE_UNAVAILABLE",
        reasonCode: SUPPORT_REASON.SOURCE_UNAVAILABLE,
        // No zeros. An unreadable source reports as unreadable.
        detail: "Support intelligence analytics could not be read.",
      };
    }
  },
};
