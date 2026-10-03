/**
 * Phase 12 — demand forecast evaluation: dataset, baselines, candidate, comparison.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────
 *
 * `model_demand_forecast` was registered `TRAINED / production` with metrics
 * `{aic: 512.59, order: "(1,1,0)", variance: 0.402}`. Those are **in-sample fit statistics**, not
 * forecast accuracy: AIC says how well ARIMA fit the data it was trained on, and says nothing about
 * how far ahead-of-time predictions land from what actually happened. `ML.EVALUATE` on an ARIMA_PLUS
 * model returns the same fit statistics, so the metric endpoint could not answer the only question
 * that matters — is this better than doing nothing?
 *
 * This module answers it. Temporal holdout, real baselines, measured error.
 *
 * ── The baselines are the point ────────────────────────────────────────────────
 *
 * A forecast that cannot beat "tomorrow looks like today" is not a forecast, it is a cost. So the
 * comparison set is deliberately unflattering:
 *
 *   NAIVE            tomorrow = today                    (the honest null hypothesis)
 *   SEASONAL_NAIVE   tomorrow = same weekday last week   (captures weekly rhythm for free)
 *   MEAN             tomorrow = mean of the training window
 *   MEDIAN           tomorrow = median of the training window (robust to the seeding spike)
 *
 * If ARIMA does not beat these, that is the finding, and it is reported as the finding.
 *
 * ── Time ordering is not negotiable ────────────────────────────────────────────
 *
 * The split is by date, never random. A random split on a temporal series lets the model see
 * Wednesday while predicting Tuesday, which produces excellent numbers and a useless model.
 */
import crypto from "node:crypto";
import { BigQuery } from "@google-cloud/bigquery";
import { assertBqAdcAvailable } from "../../src/lib/bigquery-adc";
import { ANALYTICS_CONFIG, BQ_DATASETS } from "../config";
import { logger } from "../../src/lib/logger";
import { assertRowArray, withWarehouseDeadline, warehouseUnavailable, DEMAND_FORECAST_UNAVAILABLE } from "../../src/lib/warehouse-read";

const P = ANALYTICS_CONFIG.projectId;
const CURATED = ANALYTICS_CONFIG.dataset;
const ANALYTICS = BQ_DATASETS.analytics;
const LOC = ANALYTICS_CONFIG.location;

let _bq: BigQuery | null = null;
// Same egress barrier as the src/ services (lib/bigquery-adc.ts): a NODE_ENV=test runtime without ADC
// must never reach the live warehouse.
const bq = () => {
  assertBqAdcAvailable();
  return (_bq ??= new BigQuery({ projectId: P }));
};
async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const [rows] = await bq().query({ query: sql, location: LOC });
  return rows as T[];
}

/**
 * The candidate model name.
 *
 * Deliberately distinct from `model_demand_forecast`. Training a candidate must never overwrite the
 * model currently serving traffic — that is promotion by side effect, and Phase 12 forbids it.
 */
export const CANDIDATE_MODEL = "model_demand_forecast_candidate";

/** One observation. `imputed` marks a calendar gap this module filled, never a real observation. */
export type DemandPoint = { date: string; demand: number; imputed: boolean };

export type DemandDataset = {
  points: DemandPoint[];
  /** sha256 over the observed series. Two runs with the same hash saw the same data. */
  datasetVersion: string;
  source: string;
  firstDate: string;
  lastDate: string;
  calendarDays: number;
  observedDays: number;
  imputedDays: number;
  duplicateDates: string[];
  /** How stale the newest observation is, at build time. A model cannot forecast from nothing. */
  ageDays: number;
  warnings: string[];
};

/**
 * Build the demand dataset from the **live** analytics-layer aggregate.
 *
 * ── Which table, and why it matters ────────────────────────────────────────────
 *
 * There are two `agg_hourly_demand` tables in this warehouse — one in the curated dataset and one in
 * the analytics layer — with identical schemas. The ETL (`etl.aggregates`, `bqLayer: "analytics"`)
 * writes the analytics-layer copy. The curated copy stopped being written on 2026-06-20 and
 * `vw_train_demand` still reads it, which is why the production model trains on 44 rows that end
 * two and a half months before the newest booking. This module reads the live one.
 */
export async function buildDemandDataset(): Promise<DemandDataset> {
  const source = `${P}.${ANALYTICS}.agg_daily_demand`;
  // Bounded (lib/warehouse-read): an unanswering warehouse used to hold the admin request open.
  const raw = await withWarehouseDeadline(q<{ d: { value: string } | string; bookings: number | string; n: number | string }>(`
    SELECT DATE(day_ts) AS d, SUM(bookings) AS bookings, COUNT(*) AS n
      FROM \`${source}\`
     GROUP BY d
     ORDER BY d
  `));
  assertRowArray(raw, "agg_daily_demand");

  const warnings: string[] = [];
  const duplicateDates: string[] = [];
  const observed = raw.map((r) => {
    const date = typeof r.d === "string" ? r.d : r.d.value;
    if (Number(r.n) > 1) duplicateDates.push(date);
    return { date, demand: Number(r.bookings) };
  });

  if (observed.length === 0) {
    return {
      points: [], datasetVersion: "empty", source, firstDate: "", lastDate: "",
      calendarDays: 0, observedDays: 0, imputedDays: 0, duplicateDates: [], ageDays: -1,
      warnings: ["The demand aggregate is empty; no dataset could be built."],
    };
  }

  if (duplicateDates.length > 0) {
    /**
     * Summed rather than dropped, and reported either way.
     *
     * A duplicate date in a daily aggregate is a pipeline defect, and silently keeping one row would
     * understate demand while silently dropping both would lose a day. Summing is the arithmetic the
     * aggregate itself intends; naming the dates is what lets someone fix the pipeline.
     */
    warnings.push(
      `${duplicateDates.length} date(s) appear more than once in the aggregate and were summed: ${duplicateDates.join(", ")}. This is a pipeline defect, not a property of demand.`,
    );
  }

  // ── Fill calendar gaps explicitly ──────────────────────────────────────────
  /**
   * A missing day in a bookings aggregate means "no bookings", not "unknown".
   *
   * That distinction has to be made deliberately: leaving the gap lets ARIMA_PLUS interpolate a
   * value it was never shown, and every baseline below would silently index the wrong lag. The
   * filled points are flagged `imputed` so nothing downstream can mistake them for observations.
   */
  const byDate = new Map(observed.map((o) => [o.date, o.demand]));
  const firstDate = observed[0]!.date;
  const lastDate = observed[observed.length - 1]!.date;
  const points: DemandPoint[] = [];
  const day = 86_400_000;
  for (let t = Date.parse(`${firstDate}T00:00:00Z`); t <= Date.parse(`${lastDate}T00:00:00Z`); t += day) {
    const date = new Date(t).toISOString().slice(0, 10);
    const hit = byDate.get(date);
    points.push({ date, demand: hit ?? 0, imputed: hit === undefined });
  }

  const imputedDays = points.filter((p) => p.imputed).length;
  if (imputedDays > 0) {
    warnings.push(`${imputedDays} calendar day(s) had no aggregate row and were filled with 0 bookings.`);
  }

  const ageDays = Math.floor((Date.now() - Date.parse(`${lastDate}T00:00:00Z`)) / day);
  if (ageDays > 7) {
    warnings.push(
      `The newest observation is ${ageDays} days old. A forecast issued today is extrapolating from stale data, and its error against reality will be larger than any holdout measured here.`,
    );
  }

  const datasetVersion = crypto
    .createHash("sha256")
    .update(points.map((p) => `${p.date}:${p.demand}:${p.imputed ? 1 : 0}`).join("|"))
    .digest("hex")
    .slice(0, 16);

  return {
    points, datasetVersion, source, firstDate, lastDate,
    calendarDays: points.length, observedDays: observed.length, imputedDays,
    duplicateDates, ageDays, warnings,
  };
}

// ── Metrics ──────────────────────────────────────────────────────────────────

export type ErrorMetrics = {
  n: number;
  mae: number;
  rmse: number;
  /** Mean error. Negative = under-forecasting. Separated from MAE because direction matters. */
  bias: number;
  medianAbsoluteError: number;
  /**
   * Mean absolute scaled error, scaled by the in-sample naive error.
   *
   * MASE is the metric this series can actually support. MAPE is not reported: demand here reaches
   * 1 booking/day, and dividing an absolute error by 1 turns a one-booking miss into 100% error,
   * which makes MAPE a measure of how small the denominators were. MASE < 1 means "better than
   * naive on the training window"; > 1 means worse.
   */
  mase: number | null;
  /** Named, never silently omitted. */
  notReported: Array<{ metric: string; reason: string }>;
};

function metrics(actual: number[], predicted: number[], naiveScale: number | null): ErrorMetrics {
  const n = Math.min(actual.length, predicted.length);
  let absSum = 0, sqSum = 0, errSum = 0;
  const abs: number[] = [];
  for (let i = 0; i < n; i++) {
    const e = predicted[i]! - actual[i]!;
    absSum += Math.abs(e);
    sqSum += e * e;
    errSum += e;
    abs.push(Math.abs(e));
  }
  abs.sort((a, b) => a - b);
  const round = (x: number) => Math.round(x * 10000) / 10000;
  const mae = n === 0 ? 0 : absSum / n;
  return {
    n,
    mae: round(mae),
    rmse: round(n === 0 ? 0 : Math.sqrt(sqSum / n)),
    bias: round(n === 0 ? 0 : errSum / n),
    medianAbsoluteError: round(n === 0 ? 0 : abs[Math.floor(n / 2)]!),
    mase: naiveScale && naiveScale > 0 ? round(mae / naiveScale) : null,
    notReported: [
      {
        metric: "MAPE / SMAPE",
        reason:
          "Daily demand reaches 1 booking. Percentage error divided by a denominator of 1 measures the size of the denominator, not forecast quality. MASE is reported instead.",
      },
    ],
  };
}

/** In-sample mean absolute change — the scale MASE divides by. */
function naiveScaleOf(train: number[]): number | null {
  if (train.length < 2) return null;
  let s = 0;
  for (let i = 1; i < train.length; i++) s += Math.abs(train[i]! - train[i - 1]!);
  return s / (train.length - 1);
}

// ── Baselines ────────────────────────────────────────────────────────────────

export type Baseline = { name: string; description: string; predictions: number[] };

/**
 * Every baseline forecasts the whole horizon from the training window only.
 *
 * That is what the production model has to do too. A baseline allowed to peek one step at a time
 * would be solving an easier problem and would make the model look worse than it is.
 */
export function baselines(train: number[], horizon: number): Baseline[] {
  const last = train[train.length - 1] ?? 0;
  const mean = train.length ? train.reduce((a, b) => a + b, 0) / train.length : 0;
  const sorted = [...train].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;

  const seasonal: number[] = [];
  for (let h = 0; h < horizon; h++) {
    // Same weekday, most recent complete week available in training.
    const idx = train.length - 7 + (h % 7);
    seasonal.push(idx >= 0 ? train[idx]! : last);
  }

  return [
    { name: "NAIVE", description: "Tomorrow equals the last observed day.", predictions: Array(horizon).fill(last) },
    { name: "SEASONAL_NAIVE", description: "Each day equals the same weekday of the last training week.", predictions: seasonal },
    { name: "MEAN", description: "Every day equals the training-window mean.", predictions: Array(horizon).fill(mean) },
    { name: "MEDIAN", description: "Every day equals the training-window median; robust to the seeding spike.", predictions: Array(horizon).fill(median) },
  ];
}

// ── Candidate ────────────────────────────────────────────────────────────────

export type CandidateResult =
  | { trained: true; predictions: number[]; modelRef: string; order: string | null; aic: number | null }
  | { trained: false; reason: string; modelRef: string };

/**
 * Train an ARIMA_PLUS candidate on the training split only and forecast the holdout.
 *
 * ── Trained on the split, not on everything ────────────────────────────────────
 *
 * The candidate never sees the holdout. That is the entire reason this is a fair comparison and the
 * reason the production model's AIC is not one: AIC was computed on the same rows the model was fit
 * to, so it cannot be compared with an out-of-sample error at all.
 */
export async function trainAndForecastCandidate(
  train: DemandPoint[],
  horizon: number,
): Promise<CandidateResult> {
  const modelRef = `${P}.${CURATED}.${CANDIDATE_MODEL}`;
  /**
   * ARIMA_PLUS needs enough history to identify an order at all. Below this the fit is arithmetic
   * on noise, and reporting its forecast as a candidate would be dressing up a random walk.
   */
  const MIN_TRAIN_POINTS = 30;
  if (train.length < MIN_TRAIN_POINTS) {
    return { trained: false, modelRef, reason: `Only ${train.length} training points; ARIMA_PLUS needs at least ${MIN_TRAIN_POINTS} to identify an order.` };
  }

  const values = train.map((p) => `SELECT DATE('${p.date}') AS ts, ${p.demand} AS demand`).join(" UNION ALL ");
  try {
    await q(`
      CREATE OR REPLACE MODEL \`${modelRef}\`
      OPTIONS(model_type='ARIMA_PLUS', time_series_timestamp_col='ts', time_series_data_col='demand',
              horizon=${horizon}, auto_arima=TRUE, data_frequency='DAILY', holiday_region='IN')
      AS ${values}
    `);
  } catch (err) {
    return { trained: false, modelRef, reason: `Candidate training failed: ${String(err).split("\n")[0].slice(0, 200)}` };
  }

  let order: string | null = null;
  let aic: number | null = null;
  try {
    const ev = await q<{ non_seasonal_p: number; non_seasonal_d: number; non_seasonal_q: number; AIC: number }>(
      `SELECT non_seasonal_p, non_seasonal_d, non_seasonal_q, AIC FROM ML.ARIMA_EVALUATE(MODEL \`${modelRef}\`)`,
    );
    if (ev[0]) {
      order = `(${ev[0].non_seasonal_p},${ev[0].non_seasonal_d},${ev[0].non_seasonal_q})`;
      aic = Number(ev[0].AIC);
    }
  } catch { /* fit statistics are optional context, never the verdict */ }

  const fc = await q<{ v: number }>(`
    SELECT forecast_value AS v
      FROM ML.FORECAST(MODEL \`${modelRef}\`, STRUCT(${horizon} AS horizon, 0.8 AS confidence_level))
     ORDER BY forecast_timestamp
  `);
  return { trained: true, modelRef, order, aic, predictions: fc.map((r) => Number(r.v)) };
}

// ── The evaluation ───────────────────────────────────────────────────────────

export type ModelComparison = {
  name: string;
  kind: "BASELINE" | "CANDIDATE" | "PRODUCTION";
  description: string;
  metrics: ErrorMetrics | null;
  unavailableReason?: string;
};

export type DemandEvaluation = {
  dataset: {
    version: string; source: string; firstDate: string; lastDate: string;
    calendarDays: number; observedDays: number; imputedDays: number;
    duplicateDates: string[]; ageDays: number; warnings: string[];
  };
  split: { trainDays: number; testDays: number; trainEnd: string; testStart: string; testEnd: string };
  results: ModelComparison[];
  /** Lowest MAE among everything that produced a forecast. Stated, never assumed to be the candidate. */
  best: { name: string; kind: string; mae: number } | null;
  /** The honest headline: did the candidate beat every baseline? */
  candidateBeatsAllBaselines: boolean | null;
  verdict: string;
  evaluatedAt: string;
  rulesVersion: string;
};

export const DEMAND_EVAL_RULES_VERSION = "demand.eval.v1";

export const demandEvaluationService = {
  /**
   * Run a temporal holdout evaluation.
   *
   * Returns a verdict in words as well as numbers, because "MAE 3.1 vs 3.0" invites the reader to
   * round in the direction they hoped for.
   */
  async evaluate(opts: { testDays?: number } = {}): Promise<DemandEvaluation> {
    const evaluatedAt = new Date().toISOString();
    /**
     * The warehouse did not answer (X-88): there is no dataset, so there is no comparison. Stated as
     * a verdict in the same form as INSUFFICIENT_DATA — never a 500, never a number. A query that is
     * itself wrong still throws (lib/warehouse-read): that is a defect, not an outage.
     */
    let dataset: DemandDataset;
    try {
      dataset = await buildDemandDataset();
    } catch (err) {
      const unavailable = warehouseUnavailable(err, {
        reasonCode: DEMAND_FORECAST_UNAVAILABLE,
        logEvent: "demand_evaluation_source_unavailable",
        reason: "The demand aggregate could not be read from the warehouse.",
      });
      if (!unavailable) throw err;
      return {
        dataset: {
          version: "unavailable", source: `${P}.${ANALYTICS}.agg_daily_demand`, firstDate: "", lastDate: "",
          calendarDays: 0, observedDays: 0, imputedDays: 0, duplicateDates: [], ageDays: -1,
          warnings: [`${unavailable.reason} (${unavailable.cause})`],
        },
        split: { trainDays: 0, testDays: 0, trainEnd: "", testStart: "", testEnd: "" },
        results: [],
        best: null,
        candidateBeatsAllBaselines: null,
        verdict:
          `SOURCE_UNAVAILABLE — the demand aggregate could not be read from the warehouse (${unavailable.cause}). ` +
          "No comparison was run, and no model is claimed to be better than any other.",
        evaluatedAt,
        rulesVersion: DEMAND_EVAL_RULES_VERSION,
      };
    }
    const testDays = Math.max(1, Math.min(opts.testDays ?? 14, 60));

    const base = {
      dataset: {
        version: dataset.datasetVersion, source: dataset.source,
        firstDate: dataset.firstDate, lastDate: dataset.lastDate,
        calendarDays: dataset.calendarDays, observedDays: dataset.observedDays,
        imputedDays: dataset.imputedDays, duplicateDates: dataset.duplicateDates,
        ageDays: dataset.ageDays, warnings: dataset.warnings,
      },
      evaluatedAt,
      rulesVersion: DEMAND_EVAL_RULES_VERSION,
    };

    if (dataset.points.length < testDays + 30) {
      return {
        ...base,
        split: { trainDays: 0, testDays: 0, trainEnd: "", testStart: "", testEnd: "" },
        results: [],
        best: null,
        candidateBeatsAllBaselines: null,
        verdict:
          `INSUFFICIENT_DATA — ${dataset.points.length} calendar days available; a ${testDays}-day holdout ` +
          `needs at least ${testDays + 30}. No comparison was run, and no model is claimed to be better than any other.`,
      };
    }

    const cut = dataset.points.length - testDays;
    const train = dataset.points.slice(0, cut);
    const test = dataset.points.slice(cut);
    const trainVals = train.map((p) => p.demand);
    const actual = test.map((p) => p.demand);
    const scale = naiveScaleOf(trainVals);

    const results: ModelComparison[] = baselines(trainVals, testDays).map((b) => ({
      name: b.name,
      kind: "BASELINE" as const,
      description: b.description,
      metrics: metrics(actual, b.predictions, scale),
    }));

    const candidate = await trainAndForecastCandidate(train, testDays);
    if (candidate.trained) {
      results.push({
        name: "ARIMA_PLUS_CANDIDATE",
        kind: "CANDIDATE",
        description: `ARIMA_PLUS trained on the ${train.length}-day training split only${candidate.order ? `, order ${candidate.order}` : ""}.`,
        metrics: metrics(actual, candidate.predictions, scale),
      });
    } else {
      results.push({
        name: "ARIMA_PLUS_CANDIDATE", kind: "CANDIDATE",
        description: "ARIMA_PLUS trained on the training split only.",
        metrics: null, unavailableReason: candidate.reason,
      });
    }

    /**
     * The production model is deliberately **not** re-forecast into this holdout.
     *
     * It was fit on data that includes the holdout window, so any error it showed here would be
     * in-sample and flattering. Comparing it would be the leakage this module exists to prevent, so
     * it is listed as present and explicitly not scored.
     */
    results.push({
      name: "model_demand_forecast (production)",
      kind: "PRODUCTION",
      description: "The model currently serving forecasts.",
      metrics: null,
      unavailableReason:
        "Not scored on this holdout: its training window overlaps the test window, so any error here would be in-sample and not comparable with the out-of-sample figures above.",
    });

    const scored = results.filter((r) => r.metrics !== null) as Array<ModelComparison & { metrics: ErrorMetrics }>;
    const best = scored.length
      ? scored.reduce((a, b) => (b.metrics.mae < a.metrics.mae ? b : a))
      : null;

    const cand = scored.find((r) => r.kind === "CANDIDATE");
    const baseScores = scored.filter((r) => r.kind === "BASELINE");
    const candidateBeatsAllBaselines = cand && baseScores.length
      ? baseScores.every((b) => cand.metrics.mae < b.metrics.mae)
      : null;

    let verdict: string;
    if (!cand) {
      verdict = `NO_CANDIDATE — ${results.find((r) => r.kind === "CANDIDATE")?.unavailableReason ?? "the candidate did not train."}`;
    } else if (candidateBeatsAllBaselines) {
      verdict =
        `CANDIDATE_BETTER — ARIMA_PLUS MAE ${cand.metrics.mae} beat every baseline on a ${testDays}-day holdout ` +
        `(best baseline ${baseScores.reduce((a, b) => (b.metrics.mae < a.metrics.mae ? b : a)).name} at ` +
        `${baseScores.reduce((a, b) => (b.metrics.mae < a.metrics.mae ? b : a)).metrics.mae}). Promotion still requires shadow evaluation and human approval.`;
    } else {
      const winner = best!;
      verdict =
        `CANDIDATE_NOT_BETTER — ARIMA_PLUS MAE ${cand.metrics.mae} did not beat every baseline; ` +
        `${winner.name} is lowest at MAE ${winner.metrics.mae}. On this data a forecasting model is not ` +
        `justified over the baseline, and promoting one would add cost and operational surface for no measured gain.`;
    }

    logger.info("demand_evaluation_complete", {
      datasetVersion: dataset.datasetVersion, testDays,
      best: best?.name ?? null, candidateBeatsAllBaselines,
    });

    return {
      ...base,
      split: {
        trainDays: train.length, testDays: test.length,
        trainEnd: train[train.length - 1]!.date,
        testStart: test[0]!.date, testEnd: test[test.length - 1]!.date,
      },
      results,
      best: best ? { name: best.name, kind: best.kind, mae: best.metrics.mae } : null,
      candidateBeatsAllBaselines,
      verdict,
    };
  },
};
