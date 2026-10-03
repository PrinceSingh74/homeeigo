import {
  INSIGHT_RULES_VERSION,
  insightScope,
  insightState,
} from "./partner-insight-evidence.types";
import type {
  EvidenceScope,
  ExplainableInsight,
  InsightCapability,
  InsightEvidence,
} from "./partner-insight-evidence.types";
import { sanitizeInput } from "../ai/security/prompt-security";
import type { ZoneRecommendation } from "./zone-recommendation.service";
import type { EarningsPlan } from "./earnings-coach.service";
import type { ShiftPlan } from "./shift-planning.service";
import type { Nudge } from "./performance-nudges.service";
import type { ZoneSurgeDecision } from "./surge-alert.service";
import type { MorningBrief } from "./morning-intelligence.types";
import type { Signal } from "./partner-intelligence.types";

/**
 * Item 8 — the one place a partner-facing "why?" is answered.
 *
 * ── Projection, not computation ────────────────────────────────────────────────
 *
 * Every function here takes a result that some other service already produced and re-expresses it.
 * There is no arithmetic on a score, no re-ranking, no re-derivation of an amount, and no threshold
 * comparison — an adapter that computed anything would be a second opinion about a question another
 * capability already owns, and the two would eventually disagree in front of a partner.
 *
 * ── Prose is generated from codes, never the reverse ───────────────────────────
 *
 * `STATEMENTS` maps a reason code to a sentence. Nothing reads a sentence to decide anything, and no
 * sentence carries a number that is not also in the evidence. That ordering is what makes the
 * negative test in the suite meaningful: rewriting a sentence changes no evidence, and deleting a
 * piece of evidence degrades the insight instead of quietly leaving the sentence standing.
 *
 * ── What is never said ─────────────────────────────────────────────────────────
 *
 * No causation, and no money the platform has not measured. "Demand is elevated in this zone" is a
 * restatement of a measurement; "you will earn more there" is a forecast about a payout, and the
 * surge discovery in Item 7 established that zone demand reaches no partner's payout at all. The
 * statement table contains no sentence of the second kind, and a test asserts it.
 */

/**
 * Free text that reaches an explanation is sanitised at the boundary.
 *
 * Zone names and service names are operator-authored and reach both a partner's screen and, if a
 * language model is ever attached, a prompt. `sanitizeInput` is the platform's existing guard and is
 * reused rather than reimplemented; it is applied here — where untrusted text enters the evidence —
 * rather than at render time, so every consumer of an insight gets the same already-safe value.
 */
function safeLabel(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const cleaned = sanitizeInput(String(raw));
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Sentences, keyed by reason code.
 *
 * Deliberately flat and deliberately dull. Each states what was measured; none explains why it
 * happened, and none promises what will happen next.
 */
const STATEMENTS: Record<string, string> = {
  ZONE_RANKED_FIRST: "This zone ranks highest right now on the signals available.",
  ZONE_RANKED: "This zone is ranked on the signals available.",
  ZONE_RANKING_PLATFORM_ONLY:
    "This ranking comes from platform-wide demand and supply, not from your own history.",
  EARNINGS_REALISED_ONLY: "This shows what you have already earned. It is not a projection.",
  EARNINGS_OPPORTUNITY_ESTIMATED:
    "This is an estimate from your own past jobs, with a stated range — not a guarantee.",
  EARNINGS_INSUFFICIENT_HISTORY:
    "There is not enough of your history yet to estimate this responsibly.",
  SHIFT_WINDOWS_FROM_HISTORY: "These hours come from when you have historically worked most.",
  SHIFT_NO_WINDOWS: "Your history does not yet show a clear pattern of hours.",
  PERFORMANCE_CHANGE_SIGNIFICANT:
    "This metric moved by more than the measurement error for your sample size.",
  PERFORMANCE_INSUFFICIENT_HISTORY:
    "There is not enough activity in this window to say whether anything changed.",
  SURGE_PRESSURE_OBSERVED:
    "This zone currently has more active jobs than available partners. This reflects job availability, not your pay rate.",
  SURGE_NOT_EVALUATED: "No alerting threshold has been set, so no judgement is made about this zone.",
  MORNING_BRIEF_PARTIAL: "Some signals were unavailable, so this brief is incomplete.",
  MORNING_BRIEF_GROUNDED: "This brief is built from signals that were all available.",
  EVIDENCE_UNAVAILABLE: "The information needed for this is not available.",
};

/** The sentence for a code, or an explicit admission that none exists. Never invented at runtime. */
function statementFor(reasonCode: string): string {
  return STATEMENTS[reasonCode] ?? STATEMENTS.EVIDENCE_UNAVAILABLE!;
}

/**
 * Which capability's facts are inherently about the partner.
 *
 * Written per signal rather than per capability, because most capabilities mix scopes: a zone
 * recommendation weighs platform-wide demand alongside this partner's own history in that zone, and
 * calling the whole thing personal because one input was would be the exact overstatement `scope`
 * exists to prevent.
 */
const ZONE_SIGNAL_SCOPE: Record<string, EvidenceScope> = {
  UNMET_DEMAND: "ZONE_SPECIFIC",
  SURGE: "ZONE_SPECIFIC",
  DEMAND_TREND: "ZONE_SPECIFIC",
  COMPETITION: "ZONE_SPECIFIC",
  TRAVEL: "PARTNER_SPECIFIC",
  PARTNER_HISTORY: "PARTNER_SPECIFIC",
};

const COACH_SIGNAL_SCOPE: Record<string, EvidenceScope> = {
  REALISED_TODAY: "PARTNER_SPECIFIC",
  AVG_NET_PER_JOB: "PARTNER_SPECIFIC",
  JOBS_NEEDED: "PARTNER_SPECIFIC",
  THROUGHPUT: "PARTNER_SPECIFIC",
  TIME_WINDOW: "PARTNER_SPECIFIC",
  ZONES: "ZONE_SPECIFIC",
  DEMAND: "PLATFORM_WIDE",
};

const SHIFT_SIGNAL_SCOPE: Record<string, EvidenceScope> = {
  WINDOWS: "PARTNER_SPECIFIC",
  ZONES: "ZONE_SPECIFIC",
  AVAILABILITY: "PARTNER_SPECIFIC",
  WEATHER: "ZONE_SPECIFIC",
  DEMAND: "PLATFORM_WIDE",
  LOCATION: "PARTNER_SPECIFIC",
  ACTIVE_JOBS: "PARTNER_SPECIFIC",
};

function assemble(
  capability: InsightCapability,
  reasonCode: string,
  evidence: InsightEvidence[],
  capabilityRulesVersion: string | null,
  confidence: number | null,
  models: Record<string, string | null> = {},
): ExplainableInsight {
  return {
    capability,
    reasonCode,
    scope: insightScope(evidence),
    evidence,
    confidence,
    state: insightState(evidence),
    statement: statementFor(reasonCode),
    generatedAt: new Date().toISOString(),
    versions: {
      insightRulesVersion: INSIGHT_RULES_VERSION,
      capabilityRulesVersion,
      models,
    },
  };
}

export const partnerInsightExplainer = {
  /**
   * Why this zone is ranked where it is.
   *
   * The rank and score are carried, never recomputed. `ZONE_RANKING_PLATFORM_ONLY` is chosen when
   * no partner-specific dimension contributed — the case where calling it "your best zone" would be
   * false, and the one the reason code exists to make visible.
   */
  explainZone(rec: ZoneRecommendation, rulesVersion: string): ExplainableInsight {
    const evidence: InsightEvidence[] = rec.reasons.map((r) => ({
      signal: r.code,
      scope: ZONE_SIGNAL_SCOPE[r.code] ?? "ZONE_SPECIFIC",
      source: r.source,
      value: r.value,
      observedAt: r.observedAt,
      /** Zone reasons predate the freshness field; absent is reported as UNKNOWN, never as fresh. */
      freshness: "UNKNOWN",
      confidence: null,
      state: r.state,
      ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}),
    }));

    const personal = evidence.some(
      (e) => e.scope === "PARTNER_SPECIFIC" && (e.state === "CONTRIBUTED" || e.state === "OK"),
    );
    const reasonCode = !personal
      ? "ZONE_RANKING_PLATFORM_ONLY"
      : rec.rank === 1
        ? "ZONE_RANKED_FIRST"
        : "ZONE_RANKED";

    return assemble("ZONE_RECOMMENDATION", reasonCode, evidence, rulesVersion, rec.confidence);
  },

  /** Why this earnings figure. Realised and estimated are never merged into one number. */
  explainEarnings(plan: EarningsPlan): ExplainableInsight {
    const evidence: InsightEvidence[] = plan.reasons.map((r) => ({
      signal: r.code,
      scope: COACH_SIGNAL_SCOPE[r.code] ?? "PLATFORM_WIDE",
      source: r.source,
      value: r.value,
      ...(r.code === "REALISED_TODAY" || r.code === "AVG_NET_PER_JOB" ? { unit: "INR" } : {}),
      observedAt: r.observedAt,
      freshness: r.code === "REALISED_TODAY" ? "HISTORICAL" : "UNKNOWN",
      confidence: null,
      state: r.state,
      definition: r.detail,
      ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}),
    }));

    const reasonCode = plan.opportunity
      ? "EARNINGS_OPPORTUNITY_ESTIMATED"
      : plan.realized
        ? "EARNINGS_REALISED_ONLY"
        : "EARNINGS_INSUFFICIENT_HISTORY";

    return assemble(
      "EARNINGS_OPPORTUNITY",
      reasonCode,
      evidence,
      plan.rulesVersion,
      plan.opportunity?.confidence ?? null,
    );
  },

  /** Why these hours. The windows come from the partner's own history or they do not exist. */
  explainShift(plan: ShiftPlan): ExplainableInsight {
    const evidence: InsightEvidence[] = plan.reasons.map((r) => ({
      signal: r.code,
      scope: SHIFT_SIGNAL_SCOPE[r.code] ?? "PLATFORM_WIDE",
      source: r.source,
      value: r.value,
      observedAt: r.observedAt,
      freshness: r.freshness,
      confidence: null,
      state: r.state === "STALE" ? "STALE" : r.state,
      definition: r.detail,
      ...(r.reasonCode ? { reasonCode: r.reasonCode } : {}),
    }));

    const reasonCode = plan.recommendedWindows.length > 0 ? "SHIFT_WINDOWS_FROM_HISTORY" : "SHIFT_NO_WINDOWS";
    return assemble("SHIFT_RECOMMENDATION", reasonCode, evidence, plan.rulesVersion, plan.confidence);
  },

  /**
   * Why this nudge. Item 5's evidence is already the richest on the platform and is carried whole.
   *
   * `definition` comes from the producer so a partner and a reviewer read the same denominator, and
   * `adjustedChange` versus `significanceThreshold` stays recomputable from the published numbers.
   */
  explainNudge(nudge: Nudge, rulesVersion: string): ExplainableInsight {
    const e = nudge.evidence;
    const evidence: InsightEvidence[] = [
      {
        signal: e.metric,
        scope: "PARTNER_SPECIFIC",
        source: e.source,
        value: e.currentValue,
        observedAt: e.observedAt,
        freshness: "HISTORICAL",
        confidence: e.confidence,
        state: e.state === "OK" ? "OK" : "INSUFFICIENT_HISTORY",
        definition: e.definition,
        ...(e.reasonCode ? { reasonCode: e.reasonCode } : {}),
      },
      {
        signal: `${e.metric}_BASELINE`,
        scope: "PARTNER_SPECIFIC",
        source: e.source,
        value: e.baselineValue,
        observedAt: e.period.baselineTo,
        freshness: "HISTORICAL",
        confidence: e.confidence,
        state: e.baselineValue === null ? "INSUFFICIENT_DATA" : "OK",
        definition: `Baseline over ${e.period.baselineFrom} to ${e.period.baselineTo}, n=${e.baselineSample}`,
      },
      {
        signal: `${e.metric}_SIGNIFICANCE`,
        scope: "PARTNER_SPECIFIC",
        source: e.source,
        value: e.adjustedChange,
        observedAt: e.observedAt,
        freshness: "HISTORICAL",
        confidence: e.confidence,
        state: e.significant ? "OK" : "INSUFFICIENT_DATA",
        definition: `Adjusted change compared against a threshold of ${e.significanceThreshold}`,
      },
    ];

    const reasonCode = e.significant ? "PERFORMANCE_CHANGE_SIGNIFICANT" : "PERFORMANCE_INSUFFICIENT_HISTORY";
    return assemble("PERFORMANCE_NUDGE", reasonCode, evidence, rulesVersion, e.confidence);
  },

  /**
   * Why this zone is (or is not) flagged for surge.
   *
   * Everything here is zone-scoped: the surge signal says nothing about an individual partner, and
   * labelling it otherwise would be the "your surge" version of the "your best zone" overstatement.
   */
  explainSurge(decision: ZoneSurgeDecision): ExplainableInsight {
    const r = decision.reading;
    const evidence: InsightEvidence[] = r
      ? [
          {
            signal: "SURGE_PRESSURE",
            scope: "ZONE_SPECIFIC",
            source: null,
            value: r.surge,
            unit: "multiplier",
            observedAt: decision.observedAt,
            freshness: decision.signalState === "OK" ? "NEAR_REAL_TIME" : "UNKNOWN",
            confidence: decision.confidence,
            state: decision.signalState === "OK" ? "OK" : "STALE",
            definition: "Zone demand pressure from the platform surge model. Not a pay multiplier.",
            rulesVersion: decision.rulesVersion,
            ...(decision.reasonCode ? { reasonCode: decision.reasonCode } : {}),
          },
          {
            signal: "ACTIVE_JOBS",
            scope: "ZONE_SPECIFIC",
            source: null,
            value: r.activeBookings,
            unit: "jobs",
            observedAt: decision.observedAt,
            freshness: decision.signalState === "OK" ? "NEAR_REAL_TIME" : "UNKNOWN",
            confidence: decision.confidence,
            state: decision.signalState === "OK" ? "OK" : "STALE",
          },
          {
            signal: "AVAILABLE_PARTNERS",
            scope: "ZONE_SPECIFIC",
            source: null,
            value: r.supply,
            unit: "partners",
            observedAt: decision.observedAt,
            freshness: decision.signalState === "OK" ? "NEAR_REAL_TIME" : "UNKNOWN",
            confidence: decision.confidence,
            state: decision.signalState === "OK" ? "OK" : "STALE",
            /** The source's own anomalies travel with the evidence rather than being smoothed away. */
            ...(r.anomalies.length > 0 ? { reasonCode: r.anomalies.join(",") } : {}),
          },
        ]
      : [];

    const reasonCode =
      decision.decision === "ALERT_WORTHY" ? "SURGE_PRESSURE_OBSERVED" : "SURGE_NOT_EVALUATED";
    return assemble("SURGE_OPPORTUNITY", reasonCode, evidence, decision.rulesVersion, decision.confidence);
  },

  /**
   * Why the morning brief says what it says.
   *
   * The brief already carries eight signals with full provenance, so this is the thinnest adapter of
   * the six — it renames fields and adds a scope, and that is all it is allowed to do.
   */
  explainMorningBrief(brief: MorningBrief): ExplainableInsight {
    /**
     * Typed as `Signal<unknown>` rather than cast.
     *
     * The eight signals carry different payload types, and the first version of this reached for
     * `as unknown as` to line them up — which would have switched off exactly the checking that
     * makes this adapter safe. `Signal<T>` is only read here for its envelope (state, source,
     * observedAt, freshness, confidence, reasonCode), and every `Signal<T>` is assignable to
     * `Signal<unknown>` because `value` is covariant, so the honest annotation is also the one that
     * compiles.
     */
    const pairs: Array<[string, EvidenceScope, Signal<unknown>]> = [
      ["DEMAND", "PLATFORM_WIDE", brief.demand],
      ["SUPPLY", "ZONE_SPECIFIC", brief.supply],
      ["SURGE", "ZONE_SPECIFIC", brief.surge],
      ["WEATHER", "ZONE_SPECIFIC", brief.weather],
      ["LOCATION", "PARTNER_SPECIFIC", brief.location],
      ["JOBS", "PARTNER_SPECIFIC", brief.jobs],
      ["EARNINGS", "PARTNER_SPECIFIC", brief.earningsSignal],
      ["PERFORMANCE", "PARTNER_SPECIFIC", brief.performanceSignal],
    ];

    const evidence: InsightEvidence[] = pairs.map(([signal, scope, sig]) => ({
      signal,
      scope,
      source: sig.source,
      /**
       * Always null, and deliberately so.
       *
       * The eight signals carry heterogeneous payloads — a demand forecast, a weather snapshot, an
       * array of zone supply — none of which fits `number | string`. The first version put the
       * signal's own name here as a stand-in for "present", which made `value` mean nothing while
       * looking like it meant something: a test reading it found the string "DEMAND" where a
       * measurement belonged.
       *
       * A brief-level explanation answers which signals were available and how fresh they were; the
       * measurements themselves belong to the per-capability insights, where they have a unit and a
       * definition. Reporting no value is the honest version of that, and `state` plus `freshness`
       * carry the whole of what this adapter actually knows.
       */
      value: null,
      observedAt: sig.observedAt,
      freshness: sig.freshness,
      confidence: sig.confidence,
      state: sig.state,
      definition: `Availability and freshness of the ${signal} signal in this brief`,
      ...(sig.reasonCode ? { reasonCode: sig.reasonCode } : {}),
    }));

    const reasonCode = brief.state === "OK" ? "MORNING_BRIEF_GROUNDED" : "MORNING_BRIEF_PARTIAL";
    return assemble(
      "MORNING_BRIEF",
      reasonCode,
      evidence,
      brief.versions.morningRulesVersion,
      brief.confidence,
      brief.versions.models,
    );
  },

  /** Exposed so a test can assert the sentence table rather than restate it. */
  statements(): Readonly<Record<string, string>> {
    return STATEMENTS;
  },

  /** Exposed for the same reason: zone and service names reaching an insight are sanitised. */
  sanitizeLabel(raw: string | null | undefined): string | null {
    return safeLabel(raw);
  },
};
