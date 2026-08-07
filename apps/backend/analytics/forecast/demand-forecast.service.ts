/**
 * Demand Forecast Service — ARIMA_PLUS upgrade (extends, does not replace).
 */
import { BigQuery } from "@google-cloud/bigquery";
import { ANALYTICS_CONFIG } from "../config";
import { recordForecastMetrics } from "../../src/lib/etl-metrics";

const P = ANALYTICS_CONFIG.projectId;
const D = ANALYTICS_CONFIG.dataset;
const LOC = ANALYTICS_CONFIG.location;

let _bq: BigQuery | null = null;
const bq = () => (_bq ??= new BigQuery({ projectId: P }));

export type ForecastGranularity = "hourly" | "daily" | "weekly" | "monthly";
export type ForecastScope = "zone" | "city" | "partner_earnings";

const MODEL_MAP: Record<string, string> = {
  "zone:hourly": `${P}.${D}.model_demand_forecast`,
  "zone:daily": `${P}.${D}.model_demand_forecast_daily`,
  "zone:weekly": `${P}.${D}.model_demand_forecast_weekly`,
  "city:hourly": `${P}.${D}.model_city_demand_forecast`,
  "partner_earnings:hourly": `${P}.${D}.model_partner_earnings_forecast`,
};

const DEFAULT_HORIZONS: Record<ForecastGranularity, number> = {
  hourly: 24,
  daily: 7,
  weekly: 4,
  monthly: 3,
};

export class DemandForecastService {
  async forecast(
    scope: ForecastScope,
    granularity: ForecastGranularity,
    horizon?: number,
    confidenceLevel = 0.9,
  ): Promise<Record<string, unknown>[]> {
    const modelKey = scope === "partner_earnings" ? "partner_earnings:hourly" : `${scope === "city" ? "city" : "zone"}:${granularity}`;
    const model = MODEL_MAP[modelKey];
    if (!model) throw new Error(`No model for scope=${scope} granularity=${granularity}`);

    const h = horizon ?? DEFAULT_HORIZONS[granularity];
    const t0 = Date.now();
    const [rows] = await bq().query({
      query: `SELECT * FROM ML.FORECAST(MODEL \`${model}\`, STRUCT(${h} AS horizon, ${confidenceLevel} AS confidence_level))`,
      location: LOC,
    });
    recordForecastMetrics(model.split(".").pop() ?? model, Date.now() - t0, h);
    return rows as Record<string, unknown>[];
  }

  async surgePlanning(limit = 100): Promise<Record<string, unknown>[]> {
    const [rows] = await bq().query({
      query: `SELECT * FROM \`${P}.${D}.vw_surge_planning\` ORDER BY hour_ts DESC LIMIT ${limit}`,
      location: LOC,
    });
    return rows as Record<string, unknown>[];
  }

  async capacityPlanning(city?: string): Promise<Record<string, unknown>[]> {
    const filter = city ? `WHERE city = '${city.replace(/'/g, "''")}'` : "";
    const [rows] = await bq().query({
      query: `
        SELECT city, zone_id, AVG(bookings) AS avg_hourly_demand, MAX(bookings) AS peak_demand,
               AVG(completed) AS avg_completed, AVG(revenue) AS avg_revenue
        FROM \`${P}.${D}_analytics.agg_hourly_demand\` ${filter}
        GROUP BY city, zone_id ORDER BY peak_demand DESC LIMIT 50`,
      location: LOC,
    });
    return rows as Record<string, unknown>[];
  }
}

export const demandForecastService = new DemandForecastService();
