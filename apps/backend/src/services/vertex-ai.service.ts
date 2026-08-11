/**
 * HOMIGO Geo-Intelligence — Vertex AI + BigQuery ML serving layer.
 *
 * Numeric predictions run as BigQuery ML (in-warehouse, where the data lives):
 *   - demand forecast        ML.FORECAST(model_demand_forecast)         [LIVE]
 *   - ETA prediction         ML.PREDICT(model_eta)                      [foundation]
 *   - provider availability  vw_provider_availability                   [LIVE]
 *   - fake-GPS / fraud-loc    vw_fake_gps_signals                       [LIVE]
 *
 * Natural-language geo reasoning runs on Vertex AI Gemini (asia-south1) via the
 * @google-cloud/aiplatform SDK. All auth is ADC — no key files in the repo.
 */
import { BigQuery } from "@google-cloud/bigquery";
import { incCounter, observeHist } from "../lib/metrics";

const PROJECT_ID = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const DATASET = process.env.BQ_DATASET ?? "homigo_analytics";
const LOCATION = process.env.BQ_LOCATION ?? "asia-south1";
const FQ = (t: string) => `\`${PROJECT_ID}.${DATASET}.${t}\``;

let _bq: BigQuery | null = null;
function bq(): BigQuery {
  if (!_bq) _bq = new BigQuery({ projectId: PROJECT_ID });
  return _bq;
}
async function query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const [rows] = await bq().query({ query: sql, location: LOCATION });
  return rows as T[];
}

/** Instrumented BQML inference — emits prediction volume, latency and error rate per model. */
async function infer<T>(model: string, run: () => Promise<T[]>): Promise<T[]> {
  const t0 = Date.now();
  incCounter("model_inference_total", { model });
  try {
    return await run();
  } catch (e) {
    incCounter("model_inference_errors_total", { model });
    throw e;
  } finally {
    observeHist("model_inference_latency_seconds", (Date.now() - t0) / 1000, { model });
  }
}

export type DemandForecastPoint = { zone_id: string; hour: string; predicted: number; lo: number; hi: number };

/** Per-zone hourly demand forecast for the next `horizon` hours (ARIMA_PLUS). */
export async function forecastDemand(horizon = 12): Promise<DemandForecastPoint[]> {
  return infer("model_demand_forecast", () => query<DemandForecastPoint>(`
    SELECT zone_id,
           FORMAT_TIMESTAMP('%Y-%m-%d %H:00', forecast_timestamp) AS hour,
           ROUND(forecast_value, 2) AS predicted,
           ROUND(prediction_interval_lower_bound, 2) AS lo,
           ROUND(prediction_interval_upper_bound, 2) AS hi
    FROM ML.FORECAST(MODEL ${FQ("model_demand_forecast")}, STRUCT(${horizon} AS horizon, 0.8 AS confidence_level))
    ORDER BY zone_id, forecast_timestamp
  `));
}

/** Recent suspected GPS spoofing (implied speed > 120 km/h between consecutive fixes). */
export async function detectFakeGps(limit = 50): Promise<Array<{ provider_hash: string; booking_id: string | null; implied_kmh: number; jump_meters: number; lat: number; lng: number; ts: string }>> {
  return query(`
    SELECT provider_hash, booking_id, ROUND(implied_kmh, 1) AS implied_kmh, ROUND(jump_meters, 1) AS jump_meters,
           lat, lng, FORMAT_TIMESTAMP('%Y-%m-%d %H:%M:%S', ts) AS ts
    FROM ${FQ("vw_fake_gps_signals")}
    WHERE is_suspicious = TRUE
    ORDER BY ts DESC
    LIMIT ${limit}
  `);
}

/** Provider-availability / load profile by zone × hour-of-day. */
export async function providerAvailability(): Promise<Array<{ zone_id: string; hour_of_day: number; active_providers: number; load_per_provider: number }>> {
  return query(`
    SELECT zone_id, hour_of_day, active_providers, ROUND(load_per_provider, 2) AS load_per_provider
    FROM ${FQ("vw_provider_availability")}
    ORDER BY load_per_provider DESC
    LIMIT 50
  `);
}

/**
 * ETA prediction via ML.PREDICT(model_eta). Returns null if the model is not yet
 * trained (requires realised-travel labels) — callers fall back to the live Google
 * route ETA, so this degrades gracefully.
 */
export async function predictEta(f: {
  distanceKm: number; hourOfDay: number; dayOfWeek: number; weatherTempC?: number; weatherSurge?: number; city?: string; category?: string;
}): Promise<number | null> {
  try {
    const rows = await query<{ eta: number }>(`
      SELECT ROUND(predicted_label_duration_min, 1) AS eta
      FROM ML.PREDICT(MODEL ${FQ("model_eta")}, (
        SELECT ${f.distanceKm} AS distance_km, ${f.hourOfDay} AS hour_of_day, ${f.dayOfWeek} AS day_of_week,
               ${f.weatherTempC ?? 0} AS weather_temp_c, ${f.weatherSurge ?? 1} AS weather_surge,
               '${(f.city ?? "").replace(/'/g, "")}' AS city, '${(f.category ?? "").replace(/'/g, "")}' AS category))
    `);
    return rows[0]?.eta ?? null;
  } catch {
    return null; // model not trained yet → caller uses Google route ETA
  }
}

// `geoIntelligenceNarrative` was removed here (Phase 3, ADR-019).
//
// It called Vertex `generateContent` directly, so it was a second path to a model
// provider sitting outside the AI Gateway — no auth, RBAC, prompt-injection screening,
// rate limiting, audit or cost accounting. It had no callers anywhere in the repository,
// verified before deletion, so nothing regressed.
//
// If an operations narrative is wanted again, route it through `invokeAiGateway` with an
// ADMIN actor. Do not reintroduce a direct provider call: the single-entry rule is what
// makes the platform's AI controls enforceable.
//
// Numeric prediction below (BigQuery ML) is NOT an LLM path and legitimately stays here.
