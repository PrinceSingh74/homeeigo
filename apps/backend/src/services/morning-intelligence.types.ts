import type {
  DemandOutlook,
  EarningsSnapshot,
  JobsSnapshot,
  PartnerIdentity,
  PartnerLocation,
  PerformanceSnapshot,
  Signal,
  WeatherNow,
  ZoneSupply,
  ZoneSurge,
} from "./partner-intelligence.types";
import type { TimeWindow } from "./earnings-coach.service";
import type { Nudge } from "./performance-nudges.service";

/**
 * The morning brief: what a partner would need to answer "how should I approach today?"
 *
 * ── Composition, not calculation ───────────────────────────────────────────────
 *
 * Nothing here computes a business fact. Demand, weather, zones, earnings, windows and performance
 * are each produced by the service that already owns that question — Items 1 through 5 — and this
 * type is the shape they arrive in. A second definition of "your best zone" would be a second
 * answer to the same question, and the first thing to disagree with itself.
 *
 * ── Signals keep their provenance ──────────────────────────────────────────────
 *
 * Every `Signal<T>` is carried through whole. A brief that flattened `STALE` demand into a number,
 * or `INSUFFICIENT_DATA` earnings into zero, would read as confident and be wrong in the one way a
 * partner cannot detect. `state`, `freshness`, `confidence`, `observedAt` and `reasonCode` survive
 * to the edge so the reader can tell "quiet morning" from "we don't know".
 */

export const MORNING_INTELLIGENCE_RULES_VERSION = "morning.rules.v1";

/**
 * Why a partner is or is not eligible for a brief.
 *
 * The vocabulary is the canonical dispatch composite from `matching.service.ts`, one code per
 * clause, so an ineligible partner produces a reason a human can act on rather than a bare false.
 */
export const MORNING_ELIGIBILITY_REASON = {
  ELIGIBLE: "ELIGIBLE",
  PROVIDER_NOT_FOUND: "PROVIDER_NOT_FOUND",
  NOT_ACTIVE: "NOT_ACTIVE",
  NOT_APPROVED: "NOT_APPROVED",
  BANNED: "BANNED",
  USER_BANNED: "USER_BANNED",
  COMPLIANCE_RESTRICTED: "COMPLIANCE_RESTRICTED",
  PAUSED: "PAUSED",
} as const;

export type MorningEligibilityReason =
  (typeof MORNING_ELIGIBILITY_REASON)[keyof typeof MORNING_ELIGIBILITY_REASON];

export type MorningEligibility = {
  eligible: boolean;
  reason: MorningEligibilityReason;
  /** Every clause that failed, not only the first — an operator fixing one wants to see the rest. */
  failedClauses: MorningEligibilityReason[];
};

/**
 * Overall usability of the brief.
 *
 * `PARTIAL` is a first-class outcome rather than a degraded `OK`. Most real mornings will be partial
 * — a partner with no GPS fix, or a demand model that has not refreshed — and calling that `OK`
 * would hide exactly the thing the reader needs to weigh.
 */
export type MorningBriefState =
  | "OK"
  | "PARTIAL"
  | "INELIGIBLE"
  | "PROVIDER_NOT_FOUND";

export type MorningZone = {
  zoneId: string;
  name: string;
  score: number;
  rank: number;
  distanceKm: number | null;
};

/**
 * Earnings split exactly as Item 3 defines it.
 *
 * `realized` is ledger fact. `opportunity` is an estimate with a stated range and sample size, and
 * is null without a partner-set target — there is no target here, so it is expected to be null and
 * must not be filled in with a guess. `feasibility` is a band, never a promise.
 */
export type MorningEarnings = {
  realized: {
    today: number;
    trailing7d: number;
    trailing30d: number;
    currency: "INR";
  } | null;
  opportunity: {
    averageNetPerJob: number;
    standardError: number;
    sampleSize: number;
    confidence: number;
  } | null;
  feasibility: {
    band: string;
    typicalJobsPerActiveDay: number | null;
    bestObservedDay: number | null;
  } | null;
  /** Item-3 signals that were unavailable, carried verbatim. */
  degraded: string[];
};

export type MorningPerformance = {
  state: "OK" | "INSUFFICIENT_HISTORY" | "PROVIDER_NOT_FOUND";
  windowDays: number;
  /** Canonical Item-5 output. Never recomputed here. */
  nudges: Nudge[];
  reasonCode?: string;
};

/** Every rules/model version that contributed, so a brief can be reproduced from its own record. */
export type MorningVersions = {
  morningRulesVersion: string;
  contextRulesVersion: string;
  zoneRulesVersion: string | null;
  coachRulesVersion: string | null;
  shiftRulesVersion: string | null;
  nudgeRulesVersion: string | null;
  models: Record<string, string | null>;
};

export type MorningBrief = {
  state: MorningBriefState;
  /** The partner's own local calendar date, `YYYY-MM-DD`. The brief's identity, with providerId. */
  localDate: string;
  timezone: string;
  /** True when the zone came from the platform default rather than the partner's profile. */
  timezoneFallback: boolean;

  partner: PartnerIdentity | null;
  eligibility: MorningEligibility;

  location: Signal<PartnerLocation>;
  demand: Signal<DemandOutlook>;
  supply: Signal<ZoneSupply[]>;
  surge: Signal<ZoneSurge[]>;
  weather: Signal<WeatherNow>;
  jobs: Signal<JobsSnapshot>;
  earningsSignal: Signal<EarningsSnapshot>;
  performanceSignal: Signal<PerformanceSnapshot>;

  topZones: MorningZone[];
  recommendedWindows: TimeWindow[];
  recommendedStart: string | null;
  recommendedEnd: string | null;
  earnings: MorningEarnings;
  performance: MorningPerformance;

  /**
   * Share of the brief's inputs that were usable, 0-1, and the confidence that follows from it.
   *
   * Derived from the signals actually present rather than asserted, so a brief assembled on a bad
   * morning cannot report the same confidence as one assembled on a good one.
   */
  coverage: number;
  confidence: number;

  /** Machine-readable notes about what was missing or aged. Never prose, never partner-facing. */
  reasonCodes: string[];
  generatedAt: string;
  versions: MorningVersions;
};

/**
 * The natural-language layer, and the fact that it is optional.
 *
 * `summary` is presentation only. It is derived from an already-complete `MorningBrief` and can
 * never be the source of a number: if the provider is unavailable the brief is unchanged and this is
 * simply absent. Anything that reads a value out of `summary` instead of out of the brief has
 * reintroduced the failure mode this separation exists to prevent.
 */
export type MorningBriefPresentation = {
  brief: MorningBrief;
  summary: string | null;
  summarySource: "LLM" | "DETERMINISTIC" | "UNAVAILABLE";
  summaryReasonCode?: string;
};
