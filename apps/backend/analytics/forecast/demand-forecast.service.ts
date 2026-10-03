/**
 * Demand Forecast Service — ARIMA_PLUS, production-grade.
 *
 * Extends the Phase 1 warehouse; does not replace it. Reuses the shared cacheService
 * rather than introducing a second caching layer.
 *
 * Consumed by: partner demand, admin analytics, surge, digital twin, partner earnings,
 * capacity planning. Because six surfaces depend on it, a BigQuery hiccup must degrade
 * gracefully instead of failing an admin page — see `forecastSafe`.
 */
import { BigQuery } from "@google-cloud/bigquery";
import { assertBqAdcAvailable } from "../../src/lib/bigquery-adc";
import { assertRowArray, withWarehouseDeadline } from "../../src/lib/warehouse-read";
import { ANALYTICS_CONFIG } from "../config";
import { recordForecastMetrics } from "../../src/lib/etl-metrics";
import { cacheService } from "../../src/services/cache.service";
import { logger } from "../../src/lib/logger";
import { incCounter } from "../../src/lib/metrics";
import { demandBaselineService } from "./demand-baseline.service";

const P = ANALYTICS_CONFIG.projectId;
const D = ANALYTICS_CONFIG.dataset;
const LOC = ANALYTICS_CONFIG.location;

let _bq: BigQuery | null = null;
// Same egress barrier as the src/ services (lib/bigquery-adc.ts): a NODE_ENV=test runtime without ADC
// must never reach the live warehouse.
const bq = () => {
  assertBqAdcAvailable();
  return (_bq ??= new BigQuery({ projectId: P }));
};

export type ForecastGranularity = "hourly" | "daily" | "weekly";
export type ForecastScope = "zone" | "city" | "partner_earnings";

/** Only combinations with a trained ARIMA_PLUS model in BigQuery are routable. */
const MODEL_MAP: Record<string, string> = {
  "zone:hourly": `${P}.${D}.model_demand_forecast`,
  "zone:daily": `${P}.${D}.model_demand_forecast_daily`,
  "zone:weekly": `${P}.${D}.model_demand_forecast_weekly`,
  "city:hourly": `${P}.${D}.model_city_demand_forecast`,
  "partner_earnings:hourly": `${P}.${D}.model_partner_earnings_forecast`,
};

const DEFAULT_HORIZONS: Record<ForecastGranularity, number> = { hourly: 24, daily: 7, weekly: 4 };

/** Upper bounds exist because horizon drives BigQuery cost; an unbounded value is a cost DoS. */
const MAX_HORIZONS: Record<ForecastGranularity, number> = { hourly: 168, daily: 90, weekly: 52 };

/** Redis TTL; ML.FORECAST is billed per call so repeat reads must not hit BigQuery. */
const FORECAST_CACHE_TTL_S = 300;
/** In-process L1 window on top of Redis, for burst reads from a dashboard. */
const FORECAST_L1_TTL_S = 60;
const METRICS_CACHE_TTL_S = 3600;
const METRICS_L1_TTL_S = 300;

/** Thrown for caller error (unknown scope/granularity) so routes can answer 400, not 500. */
export class ForecastUnavailableError extends Error {
  constructor(message: string, readonly reason: "UNKNOWN_MODEL" | "INVALID_INPUT" | "EXPIRED_HORIZON") {
    super(message);
    this.name = "ForecastUnavailableError";
  }
}

export type ForecastMeta = {
  model: string;
  scope: ForecastScope;
  granularity: ForecastGranularity;
  horizon: number;
  confidenceLevel: number;
  generatedAt: string;
  rowCount: number;
};

export type ForecastResult = { forecasts: Record<string, unknown>[]; meta: ForecastMeta };

export type SafeForecastResult =
  | (ForecastResult & { available: true; source: "warehouse" })
  /**
   * Served by the deterministic forecaster because the warehouse model could not answer.
   *
   * `source` is on every arm so a caller can never present a fallback as a warehouse forecast by
   * accident. `reason` says why the warehouse was not used, and is shown rather than swallowed.
   */
  | {
      available: true;
      source: "deterministic_fallback";
      reason: string;
      forecasts: Record<string, unknown>[];
      meta: ForecastMeta;
      degraded: boolean;
      limitations: string[];
    }
  | { available: false; source: "none"; reason: string; scope: ForecastScope; granularity: ForecastGranularity };

function resolveModelKey(scope: ForecastScope, granularity: ForecastGranularity): string {
  return scope === "partner_earnings" ? "partner_earnings:hourly" : `${scope}:${granularity}`;
}

/** Clamp rather than reject — an out-of-range horizon is a usability slip, not an attack. */
function clampHorizon(granularity: ForecastGranularity, requested?: number): number {
  const fallback = DEFAULT_HORIZONS[granularity];
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(Math.floor(requested), MAX_HORIZONS[granularity]));
}

/**
 * The latest instant any returned row describes, in epoch ms, or null when no row carries one.
 *
 * BigQuery hands timestamps back as `{ value: "..." }` objects rather than Dates, so this reads both
 * shapes. Returning null when the column is absent is deliberate: an unknown horizon must not be
 * treated as an expired one, or a model with a differently-named timestamp column would be
 * permanently refused.
 */
function latestForecastInstant(rows: Record<string, unknown>[]): number | null {
  let latest: number | null = null;
  for (const row of rows) {
    const raw = row.forecast_timestamp;
    const iso =
      raw && typeof raw === "object" && "value" in (raw as Record<string, unknown>)
        ? String((raw as { value: unknown }).value)
        : typeof raw === "string"
          ? raw
          : null;
    if (!iso) continue;
    const t = Date.parse(iso);
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t;
  }
  return latest;
}

function clampConfidence(requested?: number): number {
  if (requested === undefined || !Number.isFinite(requested)) return 0.9;
  return Math.max(0.5, Math.min(requested, 0.99));
}

export class DemandForecastService {
  /** Scope/granularity pairs that have a trained model — lets callers build valid UI. */
  listAvailableModels(): Array<{ scope: string; granularity: string; model: string }> {
    return Object.entries(MODEL_MAP).map(([key, model]) => {
      const [scope, granularity] = key.split(":");
      return { scope: scope!, granularity: granularity!, model: model.split(".").pop() ?? model };
    });
  }

  /** Full result with provenance metadata. Throws on caller error or BigQuery failure. */
  async forecastDetailed(
    scope: ForecastScope,
    granularity: ForecastGranularity,
    horizon?: number,
    confidenceLevel?: number,
  ): Promise<ForecastResult> {
    const model = MODEL_MAP[resolveModelKey(scope, granularity)];
    if (!model) {
      throw new ForecastUnavailableError(
        `No trained model for scope="${scope}" granularity="${granularity}". Available: ${Object.keys(MODEL_MAP).join(", ")}`,
        "UNKNOWN_MODEL",
      );
    }

    const h = clampHorizon(granularity, horizon);
    const conf = clampConfidence(confidenceLevel);

    return cacheService.getOrFetch(
      `forecast:${scope}:${granularity}:${h}:${conf}`,
      FORECAST_CACHE_TTL_S,
      async () => {
        const t0 = Date.now();
        // h and conf are numeric and clamped above, so interpolation is safe here.
        // Bounded: a hung warehouse used to hold the request open (lib/warehouse-read, X-88).
        const [rows] = await withWarehouseDeadline(bq().query({
          query: `SELECT * FROM ML.FORECAST(MODEL \`${model}\`, STRUCT(${h} AS horizon, ${conf} AS confidence_level))`,
          location: LOC,
        }));
        assertRowArray(rows, "ML.FORECAST");
        recordForecastMetrics(model.split(".").pop() ?? model, Date.now() - t0, h);
        /**
         * An expired horizon is worse than an outage, because it looks like a forecast.
         *
         * ML.FORECAST projects forward from the end of the model's *training* data, not from now.
         * `model_demand_forecast` was trained on data ending 2026-06-20, so today it returns 168
         * confident hourly points covering 2026-06-20 to 2026-06-27 — a week that ended 69 days
         * ago — and nothing in the response says so. Callers rendered them as the coming week.
         *
         * So the horizon is checked against the clock here, and a forecast that cannot describe any
         * future instant is refused rather than returned. `forecastSafe` turns that refusal into the
         * deterministic fallback.
         */
        const horizonEnd = latestForecastInstant(rows as Record<string, unknown>[]);
        if (horizonEnd !== null && horizonEnd < Date.now()) {
          const daysAgo = Math.floor((Date.now() - horizonEnd) / 86_400_000);
          throw new ForecastUnavailableError(
            `${model.split(".").pop() ?? model} can only forecast up to ${new Date(horizonEnd).toISOString()}, which ended ${daysAgo} days ago. ` +
            `ML.FORECAST projects from the end of training data, so this model cannot describe today until it is retrained.`,
            "EXPIRED_HORIZON",
          );
        }
        return {
          forecasts: rows as Record<string, unknown>[],
          meta: {
            model: model.split(".").pop() ?? model,
            scope,
            granularity,
            horizon: h,
            confidenceLevel: conf,
            generatedAt: new Date().toISOString(),
            rowCount: (rows as unknown[]).length,
          },
        };
      },
      FORECAST_L1_TTL_S,
    );
  }

  /**
   * Backward-compatible array form. Existing routes and the Phase 1 certification
   * script depend on this shape.
   */
  async forecast(
    scope: ForecastScope,
    granularity: ForecastGranularity,
    horizon?: number,
    confidenceLevel = 0.9,
  ): Promise<Record<string, unknown>[]> {
    const result = await this.forecastDetailed(scope, granularity, horizon, confidenceLevel);
    return result.forecasts;
  }

  /**
   * Never throws on infrastructure failure. Six product surfaces read forecasts; a
   * BigQuery outage should blank one widget, not 500 an entire admin page.
   * Caller errors still surface as `available: false` with the reason.
   */
  async forecastSafe(
    scope: ForecastScope,
    granularity: ForecastGranularity,
    horizon?: number,
    confidenceLevel?: number,
  ): Promise<SafeForecastResult> {
    try {
      const result = await this.forecastDetailed(scope, granularity, horizon, confidenceLevel);
      return { available: true, source: "warehouse", ...result };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!(err instanceof ForecastUnavailableError)) {
        logger.warn("forecast_unavailable", { scope, granularity, error: reason });
      }

      /**
       * A caller error is not a reason to serve a different model.
       *
       * Asking for a scope that has no model is a mistake in the request; answering it with a
       * fallback would hide the mistake and return numbers for something nobody asked about.
       */
      if (err instanceof ForecastUnavailableError && err.reason === "UNKNOWN_MODEL") {
        return { available: false, source: "none", reason, scope, granularity };
      }

      /**
       * Everything else — an outage, an expired horizon, a billing failure — falls back to the
       * deterministic forecaster, which needs only the series and beat every alternative on a
       * 14-day holdout. Zone/daily is the only shape it produces, so other scopes still return
       * unavailable rather than being answered with a series about something else.
       */
      // Zone/DAILY only: an hourly or weekly request used to receive daily points under
      // meta.granularity "hourly"/"weekly" (and a week-count horizon read as days) — independent
      // review, release certification 2026-09-20.
      if (scope !== "zone" || granularity !== "daily") {
        return { available: false, source: "none", reason, scope, granularity };
      }
      const fallback = await demandBaselineService.forecast(clampHorizon(granularity, horizon));
      if ("unavailable" in fallback) {
        return { available: false, source: "none", reason: `${reason} | fallback: ${fallback.reason}`, scope, granularity };
      }
      incCounter("demand_forecast_fallback_total", { scope, granularity });
      logger.warn("forecast_served_by_fallback", { scope, granularity, reason: reason.slice(0, 200) });
      return {
        available: true,
        source: "deterministic_fallback",
        reason,
        forecasts: fallback.points.map((p) => ({ forecast_date: p.date, forecast_value: p.predicted })),
        meta: {
          model: "demand_forecast_baseline",
          scope, granularity,
          horizon: fallback.points.length,
          confidenceLevel: 0,
          generatedAt: fallback.generatedAt,
          rowCount: fallback.points.length,
        },
        degraded: fallback.degraded,
        limitations: fallback.limitations,
      };
    }
  }

  /**
   * ML.EVALUATE metrics per trained model — the roadmap's "model metrics" requirement.
   * Reported honestly: a model that fails evaluation is returned with its error rather
   * than omitted, so a broken model cannot masquerade as a healthy roster.
   */
  async modelMetrics(): Promise<{
    models: Array<{ model: string; scope: string; granularity: string; metrics: Record<string, unknown> | null; error?: string }>;
    evaluatedAt: string;
  }> {
    return cacheService.getOrFetch(
      "forecast:model-metrics",
      METRICS_CACHE_TTL_S,
      async () => {
        const entries = Object.entries(MODEL_MAP);
        const models = await Promise.all(
          entries.map(async ([key, fq]) => {
            const [scope, granularity] = key.split(":");
            const shortName = fq.split(".").pop() ?? fq;
            try {
              const [rows] = await bq().query({
                query: `SELECT * FROM ML.EVALUATE(MODEL \`${fq}\`)`,
                location: LOC,
              });
              const first = (rows as Record<string, unknown>[])[0] ?? null;
              return { model: shortName, scope: scope!, granularity: granularity!, metrics: first };
            } catch (err) {
              return {
                model: shortName,
                scope: scope!,
                granularity: granularity!,
                metrics: null,
                error: err instanceof Error ? err.message.split("\n")[0] : String(err),
              };
            }
          }),
        );
        return { models, evaluatedAt: new Date().toISOString() };
      },
      METRICS_L1_TTL_S,
    );
  }

  async surgePlanning(limit = 100): Promise<Record<string, unknown>[]> {
    const n = Math.max(1, Math.min(Math.floor(Number(limit) || 100), 1000));
    return cacheService.getOrFetch(`forecast:surge:${n}`, FORECAST_CACHE_TTL_S, async () => {
      const [rows] = await withWarehouseDeadline(bq().query({
        query: `SELECT * FROM \`${P}.${D}.vw_surge_planning\` ORDER BY hour_ts DESC LIMIT ${n}`,
        location: LOC,
      }));
      return assertRowArray<Record<string, unknown>>(rows, "vw_surge_planning");
    }, FORECAST_L1_TTL_S);
  }

  async capacityPlanning(city?: string): Promise<Record<string, unknown>[]> {
    const filter = city ? `WHERE city = '${city.replace(/'/g, "''")}'` : "";
    return cacheService.getOrFetch(`forecast:capacity:${city ?? "all"}`, FORECAST_CACHE_TTL_S, async () => {
      const [rows] = await withWarehouseDeadline(bq().query({
        query: `
        SELECT city, zone_id, AVG(bookings) AS avg_hourly_demand, MAX(bookings) AS peak_demand,
               AVG(completed) AS avg_completed, AVG(revenue) AS avg_revenue
        FROM \`${P}.${D}_analytics.agg_hourly_demand\` ${filter}
        GROUP BY city, zone_id ORDER BY peak_demand DESC LIMIT 50`,
        location: LOC,
      }));
      return assertRowArray<Record<string, unknown>>(rows, "agg_hourly_demand");
    }, FORECAST_L1_TTL_S);
  }
}

export const demandForecastService = new DemandForecastService();
