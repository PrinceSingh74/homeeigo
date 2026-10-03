import prisma from "../lib/prisma";
import { PRESENCE_STALE_SEC } from "../lib/partner-presence.config";
import { resolveModelIdentity } from "../lib/model-identity";
import { logger } from "../lib/logger";
import { geoIntelligenceService } from "./geo-intelligence.service";
import { isDemandForecastStale } from "./shift-planning.service";

/**
 * Phase 9, Capability 4 — demand / supply warnings.
 *
 * ── What the sources actually are ──────────────────────────────────────────────
 *
 * Traced, not assumed:
 *
 *   supply         `Location` rows whose provider `isOnline`, counted inside a zone.
 *                  POINT_IN_TIME, ZONE scope. Not "available", not "eligible", not capacity.
 *   activeBookings bookings in an active status whose address is inside a zone.
 *                  POINT_IN_TIME, ZONE scope.
 *   demand24h      bookings created in the last 24 h inside a zone. ROLLING, ZONE scope.
 *   forecast       BigQuery ARIMA. FORECAST, and GLOBAL: its only `zone_id` is the literal
 *                  string "unzoned", so a zone-level join is impossible.
 *
 * ── Why no imbalance warning is emitted today ──────────────────────────────────
 *
 * Only one pair is structurally comparable — `activeBookings` against `supply`, both point-in-time
 * and both zone-scoped. Its supply term is measurably unusable:
 *
 *   40 providers are `isOnline`; only 7 have a `Location` row at all, so supply undercounts by 82.5%
 *   those 7 locations are 4.3 to 71.6 days old (median 23.5 days)
 *   0 of 7 fall within the platform's 60-second presence window
 *
 * "supply = 1" therefore means "one provider was online and last reported a position weeks ago". A
 * warning built on that would be an artefact of missing telemetry rather than an operational fact.
 *
 * ── What is emitted ────────────────────────────────────────────────────────────
 *
 * The structural verdicts, which need no threshold: `SCOPE_MISMATCH`, `TIME_MISMATCH`,
 * `SUPPLY_UNAVAILABLE`, `DEMAND_FORECAST_STALE`. Those are facts about whether a comparison is
 * possible at all.
 *
 * `DEMAND_PRESSURE` and `SUPPLY_CONSTRAINT` are withheld, because deciding how much imbalance
 * warrants attention is a business threshold and none exists — the surge policy that would carry it
 * is UNSET, and inventing one here would be the same mistake in a new place.
 */

export const DEMAND_SUPPLY_RULES_VERSION = "exec.ds.v1";

/**
 * The platform's presence window, matching tracking semantics. Not a business threshold.
 * Imported from the canonical config rather than restated — see tracking.service.
 */
export const PRESENCE_TTL_SEC = PRESENCE_STALE_SEC;

export type WarningState =
  | "DEMAND_SUPPLY_BALANCED"
  | "DEMAND_PRESSURE"
  | "SUPPLY_CONSTRAINT"
  | "DEMAND_FORECAST_STALE"
  | "DEMAND_UNAVAILABLE"
  | "SUPPLY_UNAVAILABLE"
  | "SCOPE_MISMATCH"
  | "TIME_MISMATCH"
  | "INSUFFICIENT_DATA"
  | "INCOMPARABLE"
  | "THRESHOLD_UNSET";

export const DS_REASON = {
  SUPPLY_TELEMETRY_INCOMPLETE: "SUPPLY_TELEMETRY_INCOMPLETE",
  SUPPLY_TELEMETRY_STALE: "SUPPLY_TELEMETRY_STALE",
  FORECAST_GLOBAL_SCOPE: "FORECAST_GLOBAL_SCOPE",
  FORECAST_STALE: "DEMAND_FORECAST_STALE",
  ROLLING_VS_POINT_IN_TIME: "ROLLING_VS_POINT_IN_TIME",
  THRESHOLD_UNSET: "DEMAND_SUPPLY_THRESHOLD_HUMAN_DECISION_REQUIRED",
  NO_ZONES: "NO_ZONES",
  SOURCE_UNAVAILABLE: "SOURCE_UNAVAILABLE",
} as const;

/**
 * The imbalance policy, deliberately unset.
 *
 * Same shape as the surge and anomaly policies. Nothing may be called pressure or constraint until a
 * human decides what magnitude of imbalance deserves attention.
 */
export type DemandSupplyPolicy = {
  readonly enabled: boolean;
  readonly pressureThreshold: number | null;
  readonly status: "UNSET" | "APPROVED";
};

export const demandSupplyPolicy: DemandSupplyPolicy = Object.freeze({
  enabled: false,
  pressureThreshold: null,
  status: "UNSET",
});

export function isDemandSupplyPolicyApproved(p: DemandSupplyPolicy = demandSupplyPolicy): boolean {
  return p.enabled && p.status === "APPROVED" && p.pressureThreshold !== null;
}

/** Classification of a proposed comparison, before any value is looked at. */
export type ComparisonKind =
  | "CURRENT_VS_CURRENT"
  | "FORECAST_VS_FORECAST"
  | "CURRENT_VS_FORECAST"
  | "CURRENT_VS_STALE"
  | "ROLLING_VS_POINT_IN_TIME";

export type SupplyQuality = {
  onlineProviders: number;
  withLocationRow: number;
  /** Providers online but invisible to the supply count, because they have no location row. */
  invisible: number;
  /** Age in seconds of the freshest counted location, or null when none is counted. */
  freshestAgeSec: number | null;
  medianAgeSec: number | null;
  withinPresenceWindow: number;
  usable: boolean;
  reasonCode?: string;
};

export type ZoneWarning = {
  zoneId: string;
  /** Display only. Two active zones share a name, so this is never an identity. */
  zoneName: string;
  state: WarningState;
  comparison: ComparisonKind | null;
  demandValue: number | null;
  demandBasis: "POINT_IN_TIME" | "ROLLING" | "FORECAST" | null;
  supplyValue: number | null;
  supplyBasis: "POINT_IN_TIME" | null;
  scope: "ZONE";
  evidence: Array<{ signal: string; value: number | string | null; source: string }>;
  confidence: number | null;
  observedAt: string | null;
  reasonCode: string;
  rulesVersion: string;
};

export type DemandSupplyAssessment = {
  zones: ZoneWarning[];
  /** The global forecast, reported separately because it cannot be joined to a zone. */
  globalForecast: {
    state: WarningState;
    value: number | null;
    horizonHours: number | null;
    observedAt: string | null;
    confidence: number | null;
    modelVersion: string | null;
    scope: "GLOBAL";
    reasonCode: string;
  };
  supplyQuality: SupplyQuality;
  generatedAt: string;
  rulesVersion: string;
};

export const demandSupplyWarningService = {
  /**
   * Measure whether the supply signal can be trusted at all.
   *
   * Both failures are structural, not threshold judgements: a provider with no location row cannot
   * be counted by a location-based supply metric, and a position older than the platform's own
   * presence window is not evidence of where anyone is now.
   */
  async measureSupplyQuality(now: Date = new Date()): Promise<SupplyQuality> {
    const [onlineProviders, locs] = await Promise.all([
      prisma.provider.count({ where: { isOnline: true } }),
      prisma.location.findMany({
        where: { provider: { isOnline: true } },
        select: { lastUpdated: true },
      }),
    ]);

    const ages = locs
      .map((l) => Math.round((now.getTime() - l.lastUpdated.getTime()) / 1000))
      .sort((a, b) => a - b);
    const withinPresenceWindow = ages.filter((a) => a <= PRESENCE_TTL_SEC).length;
    const invisible = onlineProviders - locs.length;

    const q: SupplyQuality = {
      onlineProviders,
      withLocationRow: locs.length,
      invisible,
      freshestAgeSec: ages.length > 0 ? ages[0]! : null,
      medianAgeSec: ages.length > 0 ? ages[Math.floor(ages.length / 2)]! : null,
      withinPresenceWindow,
      usable: false,
    };

    if (locs.length === 0) return { ...q, reasonCode: DS_REASON.SUPPLY_TELEMETRY_INCOMPLETE };
    if (withinPresenceWindow === 0) return { ...q, reasonCode: DS_REASON.SUPPLY_TELEMETRY_STALE };
    if (invisible > 0) return { ...q, reasonCode: DS_REASON.SUPPLY_TELEMETRY_INCOMPLETE };
    return { ...q, usable: true };
  },

  /**
   * Classify a proposed comparison before looking at any value.
   *
   * Kept separate from the assessment so the rule is testable on its own, and so an invalid pairing
   * is refused on its shape rather than on its numbers.
   */
  classifyComparison(
    demandBasis: "POINT_IN_TIME" | "ROLLING" | "FORECAST",
    supplyBasis: "POINT_IN_TIME",
    demandScope: "ZONE" | "GLOBAL",
    supplyScope: "ZONE" | "GLOBAL",
    demandStale: boolean,
  ): { kind: ComparisonKind | null; state: WarningState | null; reasonCode: string | null } {
    if (demandScope !== supplyScope) {
      return { kind: null, state: "SCOPE_MISMATCH", reasonCode: DS_REASON.FORECAST_GLOBAL_SCOPE };
    }
    if (demandBasis === "ROLLING") {
      return {
        kind: "ROLLING_VS_POINT_IN_TIME",
        state: "TIME_MISMATCH",
        reasonCode: DS_REASON.ROLLING_VS_POINT_IN_TIME,
      };
    }
    if (demandBasis === "FORECAST") {
      if (demandStale) {
        return { kind: "CURRENT_VS_STALE", state: "DEMAND_FORECAST_STALE", reasonCode: DS_REASON.FORECAST_STALE };
      }
      return { kind: "CURRENT_VS_FORECAST", state: "INCOMPARABLE", reasonCode: DS_REASON.ROLLING_VS_POINT_IN_TIME };
    }
    void supplyBasis;
    return { kind: "CURRENT_VS_CURRENT", state: null, reasonCode: null };
  },

  /**
   * Assess every zone, plus the global forecast reported on its own.
   *
   * The forecast is never folded into a zone verdict — it has no zone, and pretending otherwise is
   * the specific error `SCOPE_MISMATCH` exists to name.
   */
  async assess(opts?: { now?: Date; policy?: DemandSupplyPolicy }): Promise<DemandSupplyAssessment> {
    const now = opts?.now ?? new Date();
    const policy = opts?.policy ?? demandSupplyPolicy;
    const generatedAt = now.toISOString();

    const supplyQuality = await this.measureSupplyQuality(now);

    const [surge, forecast] = await Promise.all([
      geoIntelligenceService.surgePrediction().catch((err) => {
        logger.warn("demand_supply_surge_unavailable", { error: String(err).slice(0, 200) });
        return null;
      }),
      geoIntelligenceService.demandForecast(24).catch((err) => {
        logger.warn("demand_supply_source_unavailable", { error: String(err).slice(0, 200) });
        return null;
      }),
    ]);

    /**
     * The registry version, not the provenance string. `forecast.source` is "bigquery:arima_plus";
     * putting it in a field named modelVersion gave this surface a different identity for the same
     * model than the forecast explainer reports. See lib/model-identity.ts.
     */
    const demandIdentity = await resolveModelIdentity("model_demand_forecast");
    const fcData = forecast?.data as { horizonHours?: number; totalPredicted?: number; points?: unknown[] } | null;
    const fcStale = fcData ? isDemandForecastStale(forecast?.freshness ?? null, fcData, now.getTime()) : true;

    const globalForecast: DemandSupplyAssessment["globalForecast"] = fcData && Array.isArray(fcData.points) && fcData.points.length > 0
      ? {
          state: fcStale ? "DEMAND_FORECAST_STALE" : "INSUFFICIENT_DATA",
          value: fcData.totalPredicted ?? null,
          horizonHours: fcData.horizonHours ?? null,
          observedAt: forecast?.freshness ?? null,
          confidence: forecast?.confidence ?? null,
          modelVersion: demandIdentity?.version ?? null,
          scope: "GLOBAL",
          /**
           * Even a fresh forecast cannot become a zone warning: its only `zone_id` is the literal
           * "unzoned", so there is nothing to join it to.
           */
          reasonCode: fcStale ? DS_REASON.FORECAST_STALE : DS_REASON.FORECAST_GLOBAL_SCOPE,
        }
      : {
          state: "DEMAND_UNAVAILABLE",
          value: null, horizonHours: null, observedAt: null, confidence: null,
          modelVersion: demandIdentity?.version ?? null, scope: "GLOBAL",
          reasonCode: DS_REASON.SOURCE_UNAVAILABLE,
        };

    const rows = Array.isArray(surge?.data) ? (surge!.data as Array<Record<string, unknown>>) : [];
    const zones: ZoneWarning[] = rows.map((r) => {
      const demandValue = Number(r.activeBookings ?? 0);
      const supplyValue = Number(r.supply ?? 0);
      const evidence: ZoneWarning["evidence"] = [
        { signal: "ACTIVE_BOOKINGS", value: demandValue, source: "db:bookings(active)" },
        { signal: "ONLINE_PROVIDERS_IN_ZONE", value: supplyValue, source: "db:locations(provider.isOnline)" },
        { signal: "SUPPLY_ONLINE_TOTAL", value: supplyQuality.onlineProviders, source: "db:providers" },
        { signal: "SUPPLY_WITH_LOCATION", value: supplyQuality.withLocationRow, source: "db:locations" },
        { signal: "SUPPLY_FRESHEST_AGE_SEC", value: supplyQuality.freshestAgeSec, source: "computed" },
        { signal: "SUPPLY_WITHIN_PRESENCE_WINDOW", value: supplyQuality.withinPresenceWindow, source: "computed" },
      ];

      const base = {
        zoneId: String(r.zoneId ?? ""),
        zoneName: String(r.name ?? ""),
        comparison: "CURRENT_VS_CURRENT" as ComparisonKind,
        demandValue,
        demandBasis: "POINT_IN_TIME" as const,
        supplyValue,
        supplyBasis: "POINT_IN_TIME" as const,
        scope: "ZONE" as const,
        evidence,
        confidence: surge?.confidence ?? null,
        observedAt: surge?.freshness ?? null,
        rulesVersion: DEMAND_SUPPLY_RULES_VERSION,
      };

      /**
       * Supply quality is checked before any imbalance is considered.
       *
       * A comparison whose denominator is 82.5% incomplete and weeks stale cannot produce an
       * operational verdict, whatever the numbers happen to be.
       */
      if (!supplyQuality.usable) {
        return {
          ...base,
          supplyValue: null,
          state: "SUPPLY_UNAVAILABLE",
          reasonCode: supplyQuality.reasonCode ?? DS_REASON.SUPPLY_TELEMETRY_INCOMPLETE,
        };
      }

      if (!isDemandSupplyPolicyApproved(policy)) {
        return { ...base, state: "THRESHOLD_UNSET", reasonCode: DS_REASON.THRESHOLD_UNSET };
      }

      const threshold = policy.pressureThreshold as number;
      const ratio = supplyValue > 0 ? demandValue / supplyValue : demandValue > 0 ? Infinity : 0;
      if (ratio >= threshold) {
        return { ...base, state: "DEMAND_PRESSURE", reasonCode: "RATIO_AT_OR_ABOVE_THRESHOLD" };
      }
      return { ...base, state: "DEMAND_SUPPLY_BALANCED", reasonCode: "RATIO_BELOW_THRESHOLD" };
    });

    return { zones, globalForecast, supplyQuality, generatedAt, rulesVersion: DEMAND_SUPPLY_RULES_VERSION };
  },
};
