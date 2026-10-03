import type { Freshness, SignalState } from "./partner-intelligence.types";

/**
 * The canonical answer to "why did the system recommend this?"
 *
 * ── Why a normalising layer rather than a sixth reason type ────────────────────
 *
 * Five capabilities already explain themselves, and each grew its own shape:
 *
 *   ZoneReason      code, state, value, subScore, weight, source, observedAt, reasonCode
 *   CoachReason     code, state, value, detail, source, observedAt, reasonCode
 *   ShiftReason     code, state, value, detail, source, observedAt, freshness, reasonCode
 *   MetricEvidence  metric, state, definition, values, samples, significance, period, confidence
 *   ZoneSurgeDecision  zoneId, decision, reading, policy, signalState, observedAt, confidence
 *
 * They agree on most of it and differ in exactly the places that matter — only ShiftReason carries
 * freshness, only MetricEvidence carries confidence, only ZoneReason carries a weight. A partner
 * asking "why?" should not get five different answers to the same question depending on which screen
 * they asked from.
 *
 * So this is a projection, not a replacement. Each capability keeps its own contract, its own tests
 * and its own rules version; the adapters in `partner-insight-explainer.service.ts` map what is
 * already computed into the shape below. Nothing here recomputes a score, a rank, an amount or a
 * threshold, and a capability that stopped producing a field simply produces evidence that says so.
 *
 * ── Scope is the guard against a specific lie ──────────────────────────────────
 *
 * "Your best zone" is only true if partner-specific evidence produced it. Zone ranking is dominated
 * by platform-wide demand and supply, with a small partner-history weight that is often absent — so
 * a zone insight built entirely from global signals must not be described as personal. `scope` makes
 * that checkable rather than a matter of wording discipline, and `insightScope()` below derives the
 * insight's scope from its evidence instead of letting a caller assert one.
 */

/** Who a piece of evidence is about. The narrowest true answer, never the most flattering. */
export type EvidenceScope =
  /** Derived from this partner's own history, location or jobs. */
  | "PARTNER_SPECIFIC"
  /** True of a zone, for every partner in it. */
  | "ZONE_SPECIFIC"
  /** True of the platform as a whole. */
  | "PLATFORM_WIDE";

/**
 * One fact an insight rests on.
 *
 * `value` is deliberately `number | string | null` — the union the existing reason types already
 * use between them — and `null` is a real answer meaning the fact was not available, never zero.
 */
export type InsightEvidence = {
  /** Stable machine code for the signal, e.g. `DEMAND`, `AVG_NET_PER_JOB`. Never derived from prose. */
  signal: string;
  scope: EvidenceScope;
  /** Where the number came from, e.g. `bigquery:arima_plus`, `db:earnings`. */
  source: string | null;
  value: number | string | null;
  /** e.g. `INR`, `jobs`, `percentage_points`, `multiplier`. Absent when the value is categorical. */
  unit?: string;
  observedAt: string | null;
  freshness: Freshness;
  /** Reused from the producing service. Never invented to fill the field. */
  confidence: number | null;
  /**
   * Why this evidence is in the state it is in.
   *
   * Present on missing and degraded evidence, and optional on contributing evidence — the same
   * convention the existing reason types already follow.
   */
  reasonCode?: string;
  /** The producing capability's own state, carried through rather than flattened. */
  state: SignalState | "CONTRIBUTED" | "INSUFFICIENT_HISTORY";
  rulesVersion?: string;
  modelVersion?: string | null;
  /** How the number is defined, where the producer states one. Never generated here. */
  definition?: string;
};

/** Which capability produced the insight. One code per capability, no free text. */
export type InsightCapability =
  | "ZONE_RECOMMENDATION"
  | "EARNINGS_OPPORTUNITY"
  | "SHIFT_RECOMMENDATION"
  | "PERFORMANCE_NUDGE"
  | "SURGE_OPPORTUNITY"
  | "MORNING_BRIEF";

/**
 * Whether the insight can be stood behind.
 *
 * `INCOMPLETE` exists so that removing a required source degrades the explanation rather than
 * inviting a substitute: an insight whose evidence no longer supports it says so and keeps the
 * evidence it does have.
 */
export type InsightState = "GROUNDED" | "INCOMPLETE" | "UNAVAILABLE";

export type ExplainableInsight = {
  capability: InsightCapability;
  /** Stable code for the claim itself, e.g. `ZONE_RANKED_FIRST`. Machine-readable, not prose. */
  reasonCode: string;
  /**
   * Derived from the evidence, never asserted by a caller.
   *
   * An insight is only PARTNER_SPECIFIC when at least one contributing fact actually is.
   */
  scope: EvidenceScope;
  evidence: InsightEvidence[];
  /**
   * Carried from the producing capability where it publishes one, otherwise null.
   *
   * Never averaged across evidence items and never defaulted to 0.8: a confidence the platform did
   * not compute is a confidence the platform does not have.
   */
  confidence: number | null;
  state: InsightState;
  /** Deterministic sentence built from reason codes. Present with or without any language model. */
  statement: string;
  generatedAt: string;
  versions: {
    insightRulesVersion: string;
    /** The producing capability's own rules version, so an insight names what generated it. */
    capabilityRulesVersion: string | null;
    models: Record<string, string | null>;
  };
};

export const INSIGHT_RULES_VERSION = "insight.rules.v1";

/**
 * The insight's scope, derived from the evidence that actually contributed.
 *
 * Missing evidence is ignored: a partner-history fact that was unavailable cannot make an insight
 * personal. With nothing contributing the answer is the broadest scope present, because an insight
 * with no usable partner-specific evidence is not about the partner however it is worded.
 */
export function insightScope(evidence: InsightEvidence[]): EvidenceScope {
  const contributing = evidence.filter(
    (e) => e.state === "OK" || e.state === "CONTRIBUTED" || e.state === "STALE",
  );
  const pool = contributing.length > 0 ? contributing : evidence;
  if (pool.some((e) => e.scope === "PARTNER_SPECIFIC")) return "PARTNER_SPECIFIC";
  if (pool.some((e) => e.scope === "ZONE_SPECIFIC")) return "ZONE_SPECIFIC";
  return "PLATFORM_WIDE";
}

/**
 * Whether an insight rests on anything usable.
 *
 * `GROUNDED` needs at least one contributing fact — an explanation composed entirely of "this was
 * unavailable" is honest but is not a recommendation, and calling it grounded would let a screen
 * present absence as advice.
 */
export function insightState(evidence: InsightEvidence[]): InsightState {
  if (evidence.length === 0) return "UNAVAILABLE";
  const contributing = evidence.filter((e) => e.state === "OK" || e.state === "CONTRIBUTED");
  if (contributing.length === 0) return "UNAVAILABLE";
  const degraded = evidence.filter(
    (e) => e.state !== "OK" && e.state !== "CONTRIBUTED",
  );
  return degraded.length > 0 ? "INCOMPLETE" : "GROUNDED";
}
