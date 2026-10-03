/**
 * Provenance for executive facts.
 *
 * ── Why this layer exists ──────────────────────────────────────────────────────
 *
 * `executiveReportingService.buildExecutiveReport()` already produces real, ledger-derived numbers
 * and exports them as PDF, CSV and XLSX. What it does not produce is any way to answer "where did
 * this number come from, what period is it about, and how current is it?" — the whole report carries
 * one `generatedAt` and nothing else.
 *
 * That absence is not cosmetic. Discovery found that `getOverview(periodDays)` returns three
 * different kinds of number under one period label: a rolling-window flow (GMV over N days), an
 * all-time total (every refund ever issued), and point-in-time balances (wallet, gift card, provider
 * payable). Presented together they look like one coherent period, and one of them —
 * `netRevenue = gmv - refunds` — subtracts an all-time total from a rolling window.
 *
 * Measured on live data on 2026-08-30: over 7 days GMV was 9,894 with **zero** refunds inside the
 * window, yet `netRevenue` reported **-2,018.7**, because 11,912.7 of refunds from as far back as
 * 2026-06-12 were subtracted. The shorter the period, the worse it gets — 120.4% of GMV at 7 days,
 * 47.3% at 30, 0% at 90 (where the window finally contains every refund).
 *
 * This layer does not fix that. It makes it visible: `periodBasis` labels what each number is
 * actually about, and a fact whose inputs disagree is `DATA_QUALITY_ISSUE` rather than a clean
 * number. The authoritative service stays authoritative.
 */

/**
 * What kind of time a number describes.
 *
 * The distinction the finance overview currently loses. `MIXED` is a real and deliberate value: it
 * marks a figure derived from inputs on different bases, which is a fact about the figure rather
 * than a flaw in this type.
 */
export type PeriodBasis =
  /** A named calendar period — "August 2026", "week of the 24th". */
  | "CALENDAR"
  /** A trailing window ending now — "the last 30 days". */
  | "ROLLING"
  /** A balance as it stands right now. Has no period at all. */
  | "POINT_IN_TIME"
  /** Everything ever recorded, unbounded. */
  | "ALL_TIME"
  /** Has not happened yet. */
  | "FORECAST"
  /** Computed from other facts on a single consistent basis. */
  | "DERIVED"
  /** Computed from facts on *different* bases. Always suspect; never silently presented as clean. */
  | "MIXED";

export type ExecutivePeriod = {
  basis: PeriodBasis;
  /** Window bounds where the basis has them. Null for POINT_IN_TIME and ALL_TIME. */
  from: string | null;
  to: string | null;
  /** Length in days where meaningful. Null otherwise — never 0 as a stand-in. */
  days: number | null;
  /** The platform timezone the window was computed in. */
  timezone: string;
};

/**
 * How current a fact is.
 *
 * Deliberately coarse. No global staleness threshold is invented here: a fact is STALE only when its
 * own producing domain says so (as demand does through `isDemandForecastStale`), and UNKNOWN when
 * the source publishes no observation time at all. Guessing an age is how a stale forecast becomes
 * today's truth.
 */
export type FactFreshness = "FRESH" | "STALE" | "UNKNOWN" | "UNAVAILABLE";

/**
 * Whether a fact can be relied on.
 *
 * `DATA_QUALITY_ISSUE` is the one that earns its place: the value exists and is arithmetically what
 * the source produced, but something about how it was assembled makes it unsafe to read at face
 * value. `netRevenue` is the current example.
 */
export type FactState =
  | "OK"
  | "UNKNOWN"
  | "STALE"
  | "UNAVAILABLE"
  | "INSUFFICIENT_DATA"
  | "MODEL_UNAVAILABLE"
  | "DATA_QUALITY_ISSUE";

export type ExecutiveFact<T> = {
  value: T | null;
  /** e.g. `INR`, `percent`, `count`, `multiplier`. Absent for categorical values. */
  unit?: string;
  period: ExecutivePeriod;
  /** Where the number came from, e.g. `finance-dashboard:getOverview`, `bigquery:arima_plus`. */
  source: string;
  /**
   * When the underlying fact was true — not when this object was built.
   *
   * For a database aggregate this is the moment the query ran, because the aggregate genuinely
   * describes the database at that instant. For a cached or modelled value it is the source's own
   * timestamp, never the current clock.
   */
  observedAt: string | null;
  freshness: FactFreshness;
  state: FactState;
  /** Only when the producing system publishes one. Never defaulted, never averaged. */
  confidence: number | null;
  rulesVersion: string | null;
  modelVersion: string | null;
  /** Machine-readable explanation whenever `state !== "OK"`. */
  reasonCode?: string;
  /** How the number is defined, where the producer states one or where the basis needs saying. */
  definition?: string;
};

export const EXECUTIVE_CONTEXT_RULES_VERSION = "exec.context.v1";

/** Reason codes this layer can attach. Stable, machine-readable, never derived from prose. */
export const EXEC_REASON = {
  /** Inputs came from different period bases — the `netRevenue` case. */
  MIXED_PERIOD_BASIS: "MIXED_PERIOD_BASIS",
  /** A ratio whose denominator was zero. Undefined, not zero. */
  UNDEFINED_DENOMINATOR: "UNDEFINED_DENOMINATOR",
  /** The source cannot distinguish a true zero from an undefined result. */
  MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED: "MARGIN_SEMANTICS_HUMAN_DECISION_REQUIRED",
  /** The producing service threw or returned nothing. */
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
  /** No such source exists in this platform yet. */
  SOURCE_NOT_IMPLEMENTED: "SOURCE_NOT_IMPLEMENTED",
  /** A model answered but its horizon has elapsed. */
  FORECAST_STALE: "FORECAST_STALE",
  /** The source publishes no observation timestamp, so age cannot be established. */
  OBSERVED_AT_UNAVAILABLE: "OBSERVED_AT_UNAVAILABLE",
} as const;

export type ExecReason = (typeof EXEC_REASON)[keyof typeof EXEC_REASON];

/** One executive domain. A domain with no authoritative source is absent, never filled with zeros. */
export type ExecutiveDomain =
  | "REVENUE"
  | "FINANCE"
  | "DEMAND"
  | "SUPPLY"
  | "FRAUD"
  | "CUSTOMERS"
  | "PARTNERS"
  | "GEO"
  | "WEATHER"
  | "OPERATIONS"
  | "FORECASTS"
  | "DIGITAL_TWIN";

export type ExecutiveIntelligenceContext = {
  /** The period the caller asked for. Individual facts may legitimately be on another basis. */
  requestedPeriod: ExecutivePeriod;
  /** Facts keyed by domain, then by fact name. Absent domains are genuinely absent. */
  domains: Partial<Record<ExecutiveDomain, Record<string, ExecutiveFact<number | string>>>>;
  /** Domains that could not be assembled at all, with the reason. */
  unavailableDomains: Array<{ domain: ExecutiveDomain; reasonCode: string }>;
  /** Facts whose state is not OK, collected so a reader sees the caveats without hunting. */
  caveats: Array<{ domain: ExecutiveDomain; fact: string; state: FactState; reasonCode: string }>;
  generatedAt: string;
  rulesVersion: string;
  /** Model versions actually reported by producing systems. Never invented. */
  modelVersions: Record<string, string | null>;
};

/** Constructor for a usable fact. */
export function fact<T>(args: {
  value: T;
  unit?: string;
  period: ExecutivePeriod;
  source: string;
  observedAt: string | null;
  freshness?: FactFreshness;
  confidence?: number | null;
  rulesVersion?: string | null;
  modelVersion?: string | null;
  definition?: string;
}): ExecutiveFact<T> {
  return {
    value: args.value,
    ...(args.unit ? { unit: args.unit } : {}),
    period: args.period,
    source: args.source,
    observedAt: args.observedAt,
    freshness: args.freshness ?? (args.observedAt ? "FRESH" : "UNKNOWN"),
    state: "OK",
    confidence: args.confidence ?? null,
    rulesVersion: args.rulesVersion ?? null,
    modelVersion: args.modelVersion ?? null,
    ...(args.definition ? { definition: args.definition } : {}),
  };
}

/** Constructor for a fact that is present but must not be read at face value. */
export function suspectFact<T>(
  base: ExecutiveFact<T>,
  reasonCode: ExecReason,
  definition?: string,
): ExecutiveFact<T> {
  return {
    ...base,
    state: "DATA_QUALITY_ISSUE",
    reasonCode,
    ...(definition ? { definition } : {}),
  };
}

/** Constructor for an absent fact. The value is null; it is never a zero standing in for absence. */
export function missingFact<T>(args: {
  state: Exclude<FactState, "OK">;
  reasonCode: string;
  source: string;
  period: ExecutivePeriod;
  unit?: string;
  definition?: string;
}): ExecutiveFact<T> {
  return {
    value: null,
    ...(args.unit ? { unit: args.unit } : {}),
    period: args.period,
    source: args.source,
    observedAt: null,
    freshness: args.state === "STALE" ? "STALE" : "UNAVAILABLE",
    state: args.state,
    confidence: null,
    rulesVersion: null,
    modelVersion: null,
    reasonCode: args.reasonCode,
    ...(args.definition ? { definition: args.definition } : {}),
  };
}
