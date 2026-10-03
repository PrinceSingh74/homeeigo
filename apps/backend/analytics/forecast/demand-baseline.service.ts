import { buildDemandDataset, type DemandPoint } from "./demand-evaluation.service";
import { deterministicArtifactHash } from "../../src/services/ml-registry.service";
import { logger } from "../../src/lib/logger";
import { warehouseUnavailable, DEMAND_FORECAST_UNAVAILABLE } from "../../src/lib/warehouse-read";
import { incCounter } from "../../src/lib/metrics";

/**
 * Phase 12 — the deterministic demand forecaster.
 *
 * ── Why the simplest model is the candidate ────────────────────────────────────
 *
 * A 14-day temporal holdout on this platform's real daily series measured:
 *
 *     NAIVE            MAE 1.6429   RMSE 3.3912   MASE 0.2479
 *     MEDIAN           MAE 2.6429   RMSE 3.4330
 *     SEASONAL_NAIVE   MAE 2.9286   RMSE 5.2712
 *     MEAN             MAE 4.4780   RMSE 4.6964
 *
 * "Tomorrow looks like today" was the most accurate forecaster available, by a wide margin, on a
 * series whose mean is 6.06 bookings/day. Phase 12 says complexity is justified only when it creates
 * measurable value; here it did not, so the candidate is the rule that won rather than a model
 * chosen because it sounds like machine learning.
 *
 * ── It is also the fail-safe ───────────────────────────────────────────────────
 *
 * The warehouse forecast is a BigQuery ML.FORECAST call. When BigQuery is unreachable — which it has
 * been for the ETL since billing lapsed — the existing path returns nothing. This forecaster needs
 * only the series, so it answers when the warehouse cannot, and it says which of the two produced
 * the numbers rather than presenting them identically.
 *
 * ── What it is not ─────────────────────────────────────────────────────────────
 *
 * It is not an improvement on ARIMA. It is the measured floor that any future model has to clear
 * before it earns the right to serve, and it is registered with exactly that framing.
 */

export const DEMAND_BASELINE_FEATURE_VERSION = "demand.daily.v1";
export const DEMAND_BASELINE_CODE_VERSION = "demand.baseline.v1";
export const DEMAND_BASELINE_MODEL_NAME = "demand_forecast_baseline";

/**
 * The rule, as data.
 *
 * Kept as a declared object so the artifact hash is computed from the actual decision procedure. A
 * rule-based model has no file to hash; hashing its specification is what lets a registry row still
 * mean "this exact behaviour" rather than "something called v1".
 */
export const BASELINE_SPEC = {
  strategy: "NAIVE_LAST_OBSERVED",
  description: "Every forecast day equals the last observed day of the series.",
  selectedBy: "14-day temporal holdout against SEASONAL_NAIVE, MEAN and MEDIAN on the real daily series",
  /**
   * A forecast is never negative. Demand is a count, and a negative count is not a low forecast, it
   * is a broken one — the warehouse path has no such clamp and can return them.
   */
  floor: 0,
  rounding: "none",
} as const;

export const BASELINE_ARTIFACT_HASH = deterministicArtifactHash(BASELINE_SPEC);

export type BaselineForecastPoint = { date: string; predicted: number };

export type BaselineForecast = {
  points: BaselineForecastPoint[];
  /** What the forecast was computed from, so a number can be traced to a series. */
  basis: { lastObservedDate: string; lastObservedValue: number; datasetVersion: string; observedDays: number };
  /** Age of the newest observation. A forecast from stale data is stated, never silently served. */
  dataAgeDays: number;
  degraded: boolean;
  limitations: string[];
  featureVersion: string;
  codeVersion: string;
  artifactHash: string;
  generatedAt: string;
};

export const demandBaselineService = {
  /**
   * Forecast the next `horizonDays` days.
   *
   * Returns limitations rather than throwing them away. A caller that wants to render a chart can;
   * a caller that wants to decide staffing can see that the series is three weeks old first.
   */
  async forecast(horizonDays = 7): Promise<BaselineForecast | { unavailable: true; reason: string }> {
    const horizon = Math.max(1, Math.min(Math.floor(horizonDays) || 7, 90));
    /**
     * X-89: this is `forecastSafe`'s fallback, awaited inside its catch block — and it reads the same
     * warehouse. When the warehouse is down it threw straight out of the method documented as never
     * throwing (GET /api/analytics/forecast/zone/daily → 500). An outage is now the same
     * `unavailable` answer an empty aggregate already gives; a query defect still throws.
     */
    let dataset: Awaited<ReturnType<typeof buildDemandDataset>>;
    try {
      dataset = await buildDemandDataset();
    } catch (err) {
      const unavailable = warehouseUnavailable(err, {
        reasonCode: DEMAND_FORECAST_UNAVAILABLE,
        logEvent: "demand_baseline_source_unavailable",
        reason: "The demand aggregate could not be read from the warehouse.",
      });
      if (!unavailable) throw err;
      incCounter("demand_baseline_forecasts_total", { result: "unavailable" });
      return { unavailable: true, reason: `${unavailable.reason} (${unavailable.cause}); no forecast was produced.` };
    }
    if (dataset.points.length === 0) {
      incCounter("demand_baseline_forecasts_total", { result: "unavailable" });
      return { unavailable: true, reason: "The demand aggregate is empty; there is no series to forecast from." };
    }

    const last = dataset.points[dataset.points.length - 1]!;
    const value = Math.max(BASELINE_SPEC.floor, last.demand);

    /**
     * The forecast runs from tomorrow, not from the day after the last observation.
     *
     * ── The bug this fixes ──────────────────────────────────────────────────────
     *
     * This used to start at `lastObserved + 1`. With the pipeline dead for 22 days that produced
     * 2026-08-14 to 2026-08-20 and called it a forecast — a window that had already passed. The
     * fallback was committing the exact error it exists to prevent, and it was the E2E assertion
     * "every forecast point is in the future" that caught it, not review.
     *
     * Carrying the last observed level forward is what a naive forecaster does; dating those points
     * in the past is not. So the dates are the real upcoming days, and the distance between the last
     * observation and today is reported rather than hidden inside them.
     */
    const todayUtc = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const points: BaselineForecastPoint[] = [];
    for (let h = 1; h <= horizon; h++) {
      points.push({ date: new Date(todayUtc + h * 86_400_000).toISOString().slice(0, 10), predicted: value });
    }

    const limitations = [...dataset.warnings];
    if (dataset.ageDays > 1) {
      limitations.push(
        `The last observation is ${dataset.ageDays} days old, so every forecast day carries the level from ${last.date} across a ${dataset.ageDays}-day gap. This is an extrapolation, not a measurement of recent demand.`,
      );
    }
    /**
     * The final day of a series is the one most likely to be partially loaded, and a naive
     * forecaster propagates it to every horizon step. Saying so is the difference between a
     * forecast and a number.
     */
    if (last.imputed) {
      limitations.push(
        "The last point in the series was imputed as 0 because no aggregate row existed for that day; every forecast day inherits that value.",
      );
    }

    const degraded = dataset.ageDays > 7 || last.imputed;
    incCounter("demand_baseline_forecasts_total", { result: degraded ? "degraded" : "ok" });
    logger.info("demand_baseline_forecast", {
      horizon, datasetVersion: dataset.datasetVersion, dataAgeDays: dataset.ageDays, degraded,
    });

    return {
      points,
      basis: {
        lastObservedDate: last.date, lastObservedValue: last.demand,
        datasetVersion: dataset.datasetVersion, observedDays: dataset.observedDays,
      },
      dataAgeDays: dataset.ageDays,
      degraded,
      limitations,
      featureVersion: DEMAND_BASELINE_FEATURE_VERSION,
      codeVersion: DEMAND_BASELINE_CODE_VERSION,
      artifactHash: BASELINE_ARTIFACT_HASH,
      generatedAt: new Date().toISOString(),
    };
  },

  /**
   * Forecast a specific set of dates from a supplied history.
   *
   * Exists so shadow mode can ask "what would this model have said on that day, knowing only what
   * was knowable then". Taking the history as an argument is what keeps that honest — a forecaster
   * that reads the current series would be answering with the outcome in hand.
   */
  forecastFrom(history: DemandPoint[], dates: string[]): BaselineForecastPoint[] {
    const last = history[history.length - 1];
    const value = last ? Math.max(BASELINE_SPEC.floor, last.demand) : 0;
    return dates.map((date) => ({ date, predicted: value }));
  },
};
