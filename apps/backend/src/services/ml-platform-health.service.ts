import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { setGauge, registerScrapeSampler } from "../lib/metrics";
import { BigQuery } from "@google-cloud/bigquery";
import { assertBqAdcAvailable } from "../lib/bigquery-adc";
import { mlRegistryService } from "./ml-registry.service";

/**
 * Phase 12 — whether the ML platform is in a state where its predictions mean anything.
 *
 * ── The failure this exists to make impossible ─────────────────────────────────
 *
 * Every model in the warehouse registry reported `TRAINED / production` and healthy while:
 *
 *   - the ETL had failed on every run for 22 days (billing disabled on the GCP project),
 *   - the newest booking in the warehouse was 22 days old,
 *   - and `model_demand_forecast` could only forecast 2026-06-20 to 2026-06-27 — a window that had
 *     ended 69 days earlier — because ML.FORECAST projects forward from the end of *training* data,
 *     not from today.
 *
 * The demand endpoint kept answering, with a confidence score, and nothing anywhere said the numbers
 * described a week in June. A model registry that reports status without freshness is not reporting
 * health; it is reporting that a row exists.
 *
 * ── Serviceability is a verdict, not a gauge ───────────────────────────────────
 *
 * `serviceable` is false when the platform cannot honestly answer a question about now. Callers are
 * expected to degrade — the deterministic baseline forecaster exists for exactly this — rather than
 * present stale output as current.
 */

export const ML_HEALTH_RULES_VERSION = "ml.health.v1";

/** Beyond this a daily aggregate is describing history, not the present. */
const FRESHNESS_WARN_DAYS = 3;
const FRESHNESS_FAIL_DAYS = 7;

const P = process.env.GCP_PROJECT_ID ?? "homigo-497619";
const CURATED = process.env.BQ_DATASET ?? "homigo_analytics";
const LOC = process.env.BQ_LOCATION ?? "asia-south1";

let _bq: BigQuery | null = null;
/**
 * Refuses before constructing the client under NODE_ENV=test without ADC — see
 * lib/bigquery-adc.ts. Without it this module made LIVE warehouse calls during tests, so the
 * suite's result depended on network reachability and on what the warehouse happened to hold.
 */
const bq = () => {
  assertBqAdcAvailable();
  return (_bq ??= new BigQuery({ projectId: P }));
};

export type HealthCheck = {
  name: string;
  state: "OK" | "WARN" | "FAIL" | "UNKNOWN";
  detail: string;
  measured: Record<string, unknown>;
};

export type MlPlatformHealth = {
  serviceable: boolean;
  checks: HealthCheck[];
  /** The single sentence an operator should read first. */
  summary: string;
  generatedAt: string;
  rulesVersion: string;
};

const daysSince = (d: Date | string | null | undefined): number | null => {
  if (!d) return null;
  const t = typeof d === "string" ? Date.parse(d) : d.getTime();
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86_400_000) : null;
};

/** Names of warehouse models the warehouse itself calls production. */
function warehouseProductionNames(models: Array<{ model_name: string; lifecycle: string }>): string[] {
  return models.filter((m) => m.lifecycle === "production").map((m) => m.model_name);
}

export const mlPlatformHealthService = {
  /**
   * Whether the pipeline that feeds every model is running.
   *
   * Read from `etl_job_executions` rather than from a heartbeat: a scheduler that runs on time and
   * fails every time is not healthy, and a heartbeat cannot tell the difference.
   */
  async etlHealth(): Promise<HealthCheck> {
    const rows = await prisma.$queryRawUnsafe<Array<{ last_success: Date | null; failed_since: bigint; jobs: bigint }>>(`
      SELECT (SELECT MAX(started_at) FROM etl_job_executions WHERE status = 'SUCCEEDED') AS last_success,
             (SELECT COUNT(*) FROM etl_job_executions WHERE status = 'FAILED'
                AND started_at > COALESCE((SELECT MAX(started_at) FROM etl_job_executions WHERE status = 'SUCCEEDED'), '1970-01-01')) AS failed_since,
             (SELECT COUNT(DISTINCT job_id) FROM etl_job_executions) AS jobs
    `);
    const r = rows[0];
    const age = daysSince(r?.last_success ?? null);
    const failedSince = Number(r?.failed_since ?? 0);
    const measured = { lastSuccessAt: r?.last_success ?? null, lastSuccessAgeDays: age, failedRunsSinceLastSuccess: failedSince, distinctJobs: Number(r?.jobs ?? 0) };

    if (age === null) return { name: "etl_pipeline", state: "UNKNOWN", detail: "No ETL execution has ever succeeded, so pipeline health cannot be established.", measured };
    if (age > FRESHNESS_FAIL_DAYS) {
      return {
        name: "etl_pipeline", state: "FAIL", measured,
        detail: `The ETL last succeeded ${age} days ago and has failed ${failedSince} time(s) since. Every model downstream is training and serving on frozen data.`,
      };
    }
    if (age > FRESHNESS_WARN_DAYS) {
      return { name: "etl_pipeline", state: "WARN", detail: `The ETL last succeeded ${age} days ago.`, measured };
    }
    return { name: "etl_pipeline", state: "OK", detail: `The ETL last succeeded ${age} day(s) ago.`, measured };
  },

  /** How old the newest warehouse observation is. Distinct from ETL health: a job can succeed and load nothing. */
  async warehouseFreshness(): Promise<HealthCheck> {
    try {
      const [rows] = await bq().query({
        query: `SELECT MAX(created_at) AS newest, COUNT(*) AS n FROM \`${P}.${CURATED}.fact_bookings\``,
        location: LOC,
      });
      const row = (rows as Array<{ newest: { value: string } | null; n: number }>)[0];
      const newest = row?.newest?.value ?? null;
      const age = daysSince(newest);
      const measured = { newestBookingAt: newest, ageDays: age, rows: Number(row?.n ?? 0) };
      if (age === null) return { name: "warehouse_freshness", state: "UNKNOWN", detail: "The warehouse holds no dated bookings.", measured };
      if (age > FRESHNESS_FAIL_DAYS) {
        return { name: "warehouse_freshness", state: "FAIL", measured, detail: `The newest booking in the warehouse is ${age} days old. Any prediction drawn from it describes the past.` };
      }
      if (age > FRESHNESS_WARN_DAYS) return { name: "warehouse_freshness", state: "WARN", detail: `The newest warehouse booking is ${age} days old.`, measured };
      return { name: "warehouse_freshness", state: "OK", detail: `The newest warehouse booking is ${age} day(s) old.`, measured };
    } catch (err) {
      return {
        name: "warehouse_freshness", state: "UNKNOWN",
        detail: `The warehouse could not be read: ${String(err).split("\n")[0].slice(0, 160)}`,
        measured: {},
      };
    }
  },

  /**
   * Whether the production forecast model can still say anything about today.
   *
   * ML.FORECAST projects forward from the end of the model's *training* data, not from now. A model
   * trained to 2026-06-20 with a 168-hour horizon can only ever describe 2026-06-20 to 2026-06-27,
   * however recently it is queried. Nothing in the serving path checked that, so an expired horizon
   * was indistinguishable from a current forecast.
   */
  async forecastHorizon(): Promise<HealthCheck> {
    try {
      const [rows] = await bq().query({
        query: `
          SELECT MIN(forecast_timestamp) AS lo, MAX(forecast_timestamp) AS hi,
                 COUNTIF(prediction_interval_lower_bound < 0) AS negative_bounds,
                 COUNTIF(forecast_value < 0) AS negative_points, COUNT(*) AS n
            FROM ML.FORECAST(MODEL \`${P}.${CURATED}.model_demand_forecast\`, STRUCT(168 AS horizon, 0.8 AS confidence_level))`,
        location: LOC,
      });
      const r = (rows as Array<{ lo: { value: string }; hi: { value: string }; negative_bounds: number; negative_points: number; n: number }>)[0];
      const hi = r?.hi?.value ?? null;
      const expiredDays = daysSince(hi);
      const measured = {
        forecastFrom: r?.lo?.value ?? null, forecastTo: hi,
        horizonExpiredDays: expiredDays, points: Number(r?.n ?? 0),
        negativeLowerBounds: Number(r?.negative_bounds ?? 0),
        negativePointForecasts: Number(r?.negative_points ?? 0),
      };
      if (expiredDays === null) return { name: "forecast_horizon", state: "UNKNOWN", detail: "The production forecast model returned no horizon.", measured };
      if (expiredDays > 0) {
        return {
          name: "forecast_horizon", state: "FAIL", measured,
          detail: `The production demand model can only forecast up to ${hi}, which ended ${expiredDays} days ago. It cannot answer a question about today, and callers must fall back to the deterministic forecaster.`,
        };
      }
      const negatives = Number(r?.negative_bounds ?? 0);
      if (negatives > 0) {
        return {
          name: "forecast_horizon", state: "WARN", measured,
          detail: `The horizon is current, but ${negatives} of ${measured.points} prediction intervals have a negative lower bound. Demand is a count; a negative bound is an invalid interval, not a low one.`,
        };
      }
      return { name: "forecast_horizon", state: "OK", detail: `The production model forecasts through ${hi}.`, measured };
    } catch (err) {
      return {
        name: "forecast_horizon", state: "UNKNOWN",
        detail: `The production forecast model could not be queried: ${String(err).split("\n")[0].slice(0, 160)}`,
        measured: {},
      };
    }
  },

  /**
   * Whether every model the warehouse claims is in production has a governed version here.
   *
   * The warehouse registry and this platform's governance registry answer different questions, and
   * reconciliation is what stops them drifting into two competing truths. A warehouse model with no
   * governed version is serving without an approval on record.
   */
  async registryReconciliation(): Promise<HealthCheck> {
    let warehouseModels: Array<{ model_name: string; lifecycle: string }> = [];
    try {
      const [rows] = await bq().query({
        query: `SELECT model_name, lifecycle FROM \`${P}.${CURATED}.model_registry\``,
        location: LOC,
      });
      warehouseModels = rows as typeof warehouseModels;
    } catch {
      return { name: "registry_reconciliation", state: "UNKNOWN", detail: "The warehouse registry could not be read.", measured: {} };
    }
    /**
     * The governance registry may not exist in every database.
     *
     * The Phase-12 migration is applied to the isolated databases only, so this table is absent in
     * production. An absent registry is a real and reportable state — it means nothing is governed
     * here — and it must not take the whole health endpoint down with it, which is what an uncaught
     * "table does not exist" did before an E2E run against that database found it.
     */
    let governed: Awaited<ReturnType<typeof mlRegistryService.list>>;
    try {
      governed = await mlRegistryService.list();
    } catch (err) {
      return {
        name: "registry_reconciliation", state: "UNKNOWN",
        detail:
          `The governance registry could not be read in this database, so no warehouse model can be reconciled against an approval. ` +
          `${warehouseProductionNames(warehouseModels).length} warehouse model(s) are marked production. ` +
          `Cause: ${String(err).split("\n")[0].slice(0, 140)}`,
        measured: {
          warehouseModels: warehouseModels.length,
          warehouseProduction: warehouseProductionNames(warehouseModels).length,
          governedRegistryAvailable: false,
        },
      };
    }
    const governedNames = new Set(governed.map((g) => g.modelName));
    const warehouseProduction = warehouseModels.filter((m) => m.lifecycle === "production").map((m) => m.model_name);
    const ungoverned = warehouseProduction.filter((n) => !governedNames.has(n));
    const measured = {
      warehouseModels: warehouseModels.length,
      warehouseProduction: warehouseProduction.length,
      governedModels: governed.length,
      ungovernedProductionModels: ungoverned,
    };
    if (ungoverned.length > 0) {
      return {
        name: "registry_reconciliation", state: "WARN", measured,
        detail: `${ungoverned.length} warehouse model(s) are marked production with no governed version recorded here: ${ungoverned.join(", ")}. They are serving without an approval on record.`,
      };
    }
    return { name: "registry_reconciliation", state: "OK", detail: "Every warehouse production model has a governed version.", measured };
  },

  /** Every check, and the one verdict that follows from them. */
  async health(): Promise<MlPlatformHealth> {
    const checks = await Promise.all([
      this.etlHealth(),
      this.warehouseFreshness(),
      this.forecastHorizon(),
      this.registryReconciliation(),
    ]);
    const failed = checks.filter((c) => c.state === "FAIL");
    const serviceable = failed.length === 0;
    const summary = serviceable
      ? `The ML platform is serviceable: ${checks.filter((c) => c.state === "OK").length}/${checks.length} checks OK.`
      : `The ML platform is NOT serviceable — ${failed.map((c) => c.name).join(", ")} failed. Predictions drawn from it describe the past, and callers should use their deterministic fallback.`;

    setGauge("ml_platform_serviceable", serviceable ? 1 : 0);
    for (const c of checks) {
      setGauge("ml_platform_check_state", c.state === "OK" ? 1 : c.state === "WARN" ? 0.5 : 0, { check: c.name });
    }
    // Logged on CHANGE, not on every sample.
    //
    // `health()` runs from a scrape sampler, so before this the same warning was written on every
    // Prometheus scrape — thousands of identical lines describing one long-standing condition (the
    // ETL has not succeeded since BigQuery billing was disabled). That is not observability, it is
    // noise that buries the line that matters: the moment the set of failing checks CHANGES.
    //
    // Nothing is suppressed. `ml_platform_serviceable` and `ml_platform_check_state` are still set
    // on every single sample above, which is the channel an alert should watch. The log keeps the
    // first occurrence, every transition (including recovery), and an hourly heartbeat so a
    // long-running outage cannot fall out of the logs entirely.
    noteServiceability(serviceable, failed.map((c) => c.name));

    return { serviceable, checks, summary, generatedAt: new Date().toISOString(), rulesVersion: ML_HEALTH_RULES_VERSION };
  },
};

/**
 * Publish platform health as gauges.
 *
 * Registered as a scrape sampler so the value is computed when Prometheus asks, rather than by a
 * timer this service would have to own. A stale gauge describing staleness would be its own joke.
 */
/**
 * Remembers what was last reported so the warning marks transitions rather than samples.
 * Module-level on purpose: the sampler is a singleton, and a per-call cache would never hit.
 */
const SERVICEABILITY_HEARTBEAT_MS = 60 * 60 * 1000;
let lastReportedKey: string | null = null;
let lastReportedAt = 0;

function noteServiceability(serviceable: boolean, failedChecks: string[]): void {
  const key = serviceable ? "OK" : failedChecks.slice().sort().join(",");
  const now = Date.now();
  const changed = key !== lastReportedKey;
  if (!changed && now - lastReportedAt < SERVICEABILITY_HEARTBEAT_MS) return;
  lastReportedKey = key;
  lastReportedAt = now;

  if (serviceable) {
    // Recovery is worth a line of its own — otherwise the logs only ever show the bad state.
    if (changed) logger.info("ml_platform_serviceable", { category: "APPLICATION" });
    return;
  }
  logger.warn("ml_platform_not_serviceable", {
    category: "APPLICATION",
    failed: failedChecks,
    // Says which kind of line this is, so a reader can tell a new failure from a standing one.
    transition: changed ? "changed" : "ongoing",
  });
}
export function registerMlPlatformHealthSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      await mlPlatformHealthService.health();
    } catch {
      /* leave last-known gauges rather than reporting a healthy zero */
    }
  });
}
