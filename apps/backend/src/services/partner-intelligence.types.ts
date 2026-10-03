/**
 * The canonical Partner Intelligence contract.
 *
 * One shared, bounded shape that every partner capability reads from — zone recommendations,
 * earnings coaching, shift planning, performance nudges, the morning briefing and the copilot.
 * Signal aggregation lives in `partner-intelligence.service.ts` and NOWHERE else; ranking,
 * coaching and planning are separate services that consume this.
 *
 * Two rules run through the whole file:
 *
 * 1. **A missing signal is a state, never a value.** Nothing here degrades to `0`, `false`, `""`,
 *    an empty array or a made-up confidence. If demand could not be fetched, `demand.state` says
 *    so and `demand.value` is `null`. Downstream code — and especially the LLM that eventually
 *    explains this — must be able to tell "no jobs nearby" from "we could not find out".
 * 2. **Every time-sensitive fact carries when it was true.** A forecast and a realised total are
 *    not interchangeable, and neither is a GPS fix from ten seconds ago and one from an hour ago.
 */

/** Why a signal is not `OK`. Never inferred — always set by the collector that failed. */
export type SignalState =
  /** Present and usable. */
  | "OK"
  /** The source could not be reached, or returned nothing. */
  | "UNAVAILABLE"
  /** Present but too old to describe as current. Value is still returned, clearly aged. */
  | "STALE"
  /** Real data exists but there is not enough of it to say anything responsibly. */
  | "INSUFFICIENT_DATA"
  /** A model was required and is not answering. Deliberately distinct from UNAVAILABLE. */
  | "MODEL_UNAVAILABLE";

/**
 * What KIND of time a value refers to. Mixing these silently is how a trailing total gets
 * described as a forecast — the exact defect corrected in Item 0.
 */
export type Freshness =
  /** True right now (a live GPS fix within the platform's presence window). */
  | "REAL_TIME"
  /** True very recently; safe to describe as current with a caveat. */
  | "NEAR_REAL_TIME"
  /** Already happened. Realised, not predicted. */
  | "HISTORICAL"
  /** Has not happened yet. A model or rule produced it. */
  | "FORECAST"
  /** Does not meaningfully change (zone geometry, profile). */
  | "STATIC"
  /** Genuinely not known. */
  | "UNKNOWN";

/**
 * A single signal with its provenance.
 *
 * `observedAt` is when the underlying fact was true — NOT when this object was built. For a
 * forecast that is the time the forecast is *for*; for a GPS fix it is the fix timestamp; for a
 * trailing total it is the end of the window.
 */
export type Signal<T> = {
  state: SignalState;
  /** `null` whenever `state !== "OK"`, and for `STALE` the aged value is still provided. */
  value: T | null;
  /** Where it came from, e.g. `db:locations`, `bigquery:arima_plus`, `openweather`. */
  source: string | null;
  observedAt: string | null;
  freshness: Freshness;
  /** `null` when the producer does not express confidence. Never fabricated to fill the field. */
  confidence: number | null;
  /** Machine-readable explanation when `state !== "OK"`, e.g. `NO_LOCATION_ON_FILE`. */
  reasonCode?: string;
};

/** Graded location age. Thresholds are documented in the service and versioned with the rules. */
export type LocationFreshnessState = "LIVE" | "RECENT" | "STALE" | "EXPIRED" | "UNAVAILABLE";

export type PartnerIdentity = {
  providerId: string;
  businessName: string | null;
  city: string | null;
  isActive: boolean;
  isOnline: boolean;
};

export type PartnerLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  updatedAt: string;
  ageSeconds: number;
  freshnessState: LocationFreshnessState;
};

export type DemandOutlook = {
  horizonHours: number;
  totalPredicted: number;
  points: unknown[];
};

export type ZoneSupply = {
  zoneId: string;
  name: string;
  city: string | null;
  /** Zone centre — carried on the density snapshot, and the only source of zone geometry here. */
  centerLat: number;
  centerLng: number;
  providers: number;
  densityPerKm2: number;
};

export type ZoneSurge = {
  zoneId: string;
  name: string;
  predictedSurge: number;
  weatherSurge: number;
};

export type WeatherNow = {
  condition: string | null;
  temperatureC: number | null;
  severity: string | null;
  /** From the existing weather service — not recomputed here. */
  surgeMultiplier: number;
  etaAdjustmentFactor: number;
};

export type JobsSnapshot = {
  activeCount: number;
  todayCompletedCount: number;
  /** Bookings currently assigned to this partner and not yet finished. */
  assigned: Array<{ bookingId: string; status: string; scheduledDate: string | null }>;
};

export type EarningsSnapshot = {
  todayRealised: number;
  trailing7dRealised: number;
  trailing30dRealised: number;
  /** GROSS job value — comparable to booking totals. */
  averagePerJob: number;
  /** NET take-home per job — the figure to use against any realised (net) amount. */
  averageNetPerJob: number;
  /** Forward-looking only where a real model backs it — see Item 0. */
  todayOpportunity: number | null;
};

export type PerformanceSnapshot = {
  rating: number;
  totalRatings: number;
  completionRate: number;
  acceptanceRate: number;
  cancellationRate: number;
  responseRate: number;
  avgResponseTimeMinutes: number;
  /** Completed jobs in the window. Trend language MUST be gated on this. */
  sampleSize: number;
};

/**
 * Canonical, UNRANKED zone candidates.
 *
 * Deliberately not scored or ordered here. Ranking is `zone-recommendation.service.ts`'s job;
 * mixing the two would mean every consumer inherits one service's opinion of what "best" means,
 * and would make the ranking impossible to change without touching aggregation.
 */
export type ZoneCandidate = {
  zoneId: string;
  name: string;
  city: string | null;
  centerLat: number;
  centerLng: number;
  /** Straight-line distance from the partner's last known position; `null` without a location. */
  distanceKm: number | null;
  supply: number | null;
  densityPerKm2: number | null;
  predictedSurge: number | null;
  /** From the platform's existing zone scoring — carried through, NOT recomputed. */
  platformScore: number | null;
  demandScore: number | null;
  earningScore: number | null;
  serviceHealth: number | null;
};

/**
 * Versions stamped on every context so an explanation can be traced back to the logic that
 * produced it. `rulesVersion` moves when the deterministic thresholds in this layer change.
 */
export type IntelligenceVersions = {
  rulesVersion: string;
  models: Record<string, string | null>;
};

export type PartnerIntelligenceContext = {
  partner: PartnerIdentity;
  location: Signal<PartnerLocation>;
  demand: Signal<DemandOutlook>;
  supply: Signal<ZoneSupply[]>;
  surge: Signal<ZoneSurge[]>;
  weather: Signal<WeatherNow>;
  jobs: Signal<JobsSnapshot>;
  earnings: Signal<EarningsSnapshot>;
  performance: Signal<PerformanceSnapshot>;
  /** Unranked candidates for downstream ranking services. */
  zoneCandidates: Signal<ZoneCandidate[]>;
  generatedAt: string;
  versions: IntelligenceVersions;
};

/** Convenience constructors so no collector hand-rolls a signal and forgets a field. */
export const signalOk = <T>(
  value: T,
  source: string,
  observedAt: string | null,
  freshness: Freshness,
  confidence: number | null = null,
): Signal<T> => ({ state: "OK", value, source, observedAt, freshness, confidence });

export const signalMissing = <T>(
  state: Exclude<SignalState, "OK">,
  reasonCode: string,
  source: string | null = null,
): Signal<T> => ({
  state,
  value: null,
  source,
  observedAt: null,
  freshness: "UNKNOWN",
  confidence: null,
  reasonCode,
});
