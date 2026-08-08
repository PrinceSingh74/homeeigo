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
import { ANALYTICS_CONFIG } from "../config";
import { recordForecastMetrics } from "../../src/lib/etl-metrics";
import { cacheService } from "../../src/services/cache.service";
import { logger } from "../../src/lib/logger";

const P = ANALYTICS_CONFIG.projectId;
const D = ANALYTICS_CONFIG.dataset;
const LOC = ANALYTICS_CONFIG.location;

let _bq: BigQuery | null = null;
const bq = () => (_bq ??= new BigQuery({ projectId: P }));

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
  constructor(message: string, readonly reason: "UNKNOWN_MODEL" | "INVALID_INPUT") {
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
  | (ForecastResult & { available: true })
  | { available: false; reason: string; scope: ForecastScope; granularity: ForecastGranularity };

function resolveModelKey(scope: ForecastScope, granularity: ForecastGranularity): string {
  return scope === "partner_earnings" ? "partner_earnings:hourly" : `${scope}:${granularity}`;
}

/** Clamp rather than reject — an out-of-range horizon is a usability slip, not an attack. */
function clampHorizon(granularity: ForecastGranularity, requested?: number): number {
  const fallback = DEFAULT_HORIZONS[granularity];
  if (requested === undefined || !Number.isFinite(requested)) return fallback;
  return Math.max(1, Math.min(Math.floor(requested), MAX_HORIZONS[granularity]));
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
        const [rows] = await bq().query({
          query: `SELECT * FROM ML.FORECAST(MODEL \`${model}\`, STRUCT(${h} AS horizon, ${conf} AS confidence_level))`,
          location: LOC,
        });
        recordForecastMetrics(model.split(".").pop() ?? model, Date.now() - t0, h);
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
      return { available: true, ...result };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (!(err instanceof ForecastUnavailableError)) {
        logger.warn("forecast_unavailable", { scope, granularity, error: reason });
      }
      return { available: false, reason, scope, granularity };
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
      const [rows] = await bq().query({
        query: `SELECT * FROM \`${P}.${D}.vw_surge_planning\` ORDER BY hour_ts DESC LIMIT ${n}`,
        location: LOC,
      });
      return rows as Record<string, unknown>[];
    }, FORECAST_L1_TTL_S);
  }

  async capacityPlanning(city?: string): Promise<Record<string, unknown>[]> {
    const filter = city ? `WHERE city = '${city.replace(/'/g, "''")}'` : "";
    return cacheService.getOrFetch(`forecast:capacity:${city ?? "all"}`, FORECAST_CACHE_TTL_S, async () => {
      const [rows] = await bq().query({
        query: `
        SELECT city, zone_id, AVG(bookings) AS avg_hourly_demand, MAX(bookings) AS peak_demand,
               AVG(completed) AS avg_completed, AVG(revenue) AS avg_revenue
        FROM \`${P}.${D}_analytics.agg_hourly_demand\` ${filter}
        GROUP BY city, zone_id ORDER BY peak_demand DESC LIMIT 50`,
        location: LOC,
      });
      return rows as Record<string, unknown>[];
    }, FORECAST_L1_TTL_S);
  }
}

export const demandForecastService = new DemandForecastService();
