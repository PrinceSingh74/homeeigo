import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { analyticsWhereVia } from "../lib/analytics-scope";

/**
 * Phase 9, Capability 3 — revenue anomaly intelligence.
 *
 * ── What the data said ─────────────────────────────────────────────────────────
 *
 * Measured on `homigo_db`, 2026-08-30, over the full span of real payments
 * (2026-06-09 to 2026-08-29, 82 calendar days in Asia/Kolkata):
 *
 *   174 successful payments
 *   54 of 82 days had zero activity (65.9%)
 *   median daily GMV = 0        MAD = 0
 *   mean 830.62, stddev 2364.79, CV 2.85
 *   excluding zero days: n = 28, median 1656, mean 2432.54, stddev 3532.78, CV 1.45
 *   largest day 2026-06-12 = 18,963 — 5.4x the next highest, 11.5x the non-zero median
 *   Sunday: 11 of 11 days zero
 *
 * Every baseline a detector could use is degenerate on that shape:
 *
 * - A robust baseline (modified z-score, `0.6745*(x - median)/MAD`) divides by a MAD of exactly
 *   zero. Undefined for every point, not merely imprecise.
 * - A classical baseline has stddev larger than its own mean and is dominated by a single day;
 *   with n = 28 the estimate moves substantially depending on whether that one day is included.
 * - A day-of-week baseline has zero variance on Sunday and 11 observations per weekday.
 *
 * So the honest conclusion is not "we need a business threshold". It is that **this data cannot
 * support any baseline yet**, and a detector that produced anomalies from it would be producing
 * them from arithmetic noise.
 *
 * ── What this service therefore does ───────────────────────────────────────────
 *
 * It measures the baseline at runtime and refuses when the measurement is degenerate. The gates are
 * mathematical facts rather than chosen numbers — a MAD of zero makes a modified z-score undefined,
 * a series of fewer than two points has no variance, a zero median makes a relative deviation a
 * division by zero. None of them is a policy in disguise.
 *
 * When the data eventually supports a baseline, a threshold is still required before anything is
 * called anomalous, and that threshold is a business decision recorded as UNSET.
 */

export const REVENUE_ANOMALY_RULES_VERSION = "exec.anomaly.v1";

/**
 * The detector's own honesty about its method.
 *
 * `STATISTICAL` and never `ML`: there is no model here, no training window and no learned
 * parameters. Labelling arithmetic as a model would fabricate metadata the platform does not have.
 */
export const DETECTION_METHOD = "STATISTICAL" as const;

export type AnomalyState =
  /** A baseline existed and the point was compared against it. */
  | "EVALUATED"
  /** Fewer usable observations than the statistic requires. */
  | "INSUFFICIENT_DATA"
  /** Enough points, but the baseline is mathematically degenerate. */
  | "UNSTABLE_BASELINE"
  /** The source itself is flagged. */
  | "DATA_QUALITY_ISSUE"
  /** A baseline exists but no approved threshold does, so nothing may be called anomalous. */
  | "THRESHOLD_UNSET";

export const ANOMALY_REASON = {
  MAD_ZERO: "BASELINE_MAD_ZERO",
  MEDIAN_ZERO: "BASELINE_MEDIAN_ZERO",
  TOO_FEW_POINTS: "BASELINE_TOO_FEW_POINTS",
  OUTLIER_DOMINATED: "BASELINE_OUTLIER_DOMINATED",
  THRESHOLD_UNSET: "REVENUE_ANOMALY_THRESHOLD_UNSET",
  METRIC_EXCLUDED: "METRIC_EXCLUDED_PENDING_SEMANTICS",
  NO_SERIES: "NO_SERIES_AVAILABLE",
} as const;

/**
 * The anomaly policy, deliberately unset.
 *
 * Same shape as the surge policy and the morning schedule: no threshold, no enabled flag, and a
 * status that separates "somebody typed a number" from "somebody decided one". Not environment
 * driven, because an env var would let a deployment invent the business decision.
 */
export type RevenueAnomalyPolicy = {
  readonly enabled: boolean;
  /** Deviation at which a point is called anomalous. `null` = undecided. */
  readonly threshold: number | null;
  readonly status: "UNSET" | "APPROVED";
};

export const revenueAnomalyPolicy: RevenueAnomalyPolicy = Object.freeze({
  enabled: false,
  threshold: null,
  status: "UNSET",
});

export function isAnomalyPolicyApproved(p: RevenueAnomalyPolicy = revenueAnomalyPolicy): boolean {
  return p.enabled && p.status === "APPROVED" && p.threshold !== null;
}

/**
 * Metrics excluded from anomaly detection, and why.
 *
 * `netRevenue` and anything derived from it carry the period mismatch found in Capability 1 —
 * rolling-window GMV minus an all-time refund total. Running a detector over a figure that is
 * already wrong would produce anomalies that are artefacts of the defect rather than of the
 * business.
 */
export const EXCLUDED_METRICS = new Set(["netRevenue", "platformMarginPct", "totalLiabilities"]);

export type DayPoint = {
  /** `YYYY-MM-DD` in the platform timezone. */
  day: string;
  value: number;
  /**
   * Whether any payment row existed for this day.
   *
   * A day inside the observed span with no payments is zero activity — the platform was live and
   * nothing was sold. A day outside the span is not a zero, it is unknown, and is never included.
   */
  activity: "ZERO_ACTIVITY" | "ACTIVITY";
};

export type BaselineMeasurement = {
  n: number;
  median: number;
  mean: number;
  stddev: number;
  /** Median absolute deviation. Zero here is the finding, not a rounding artefact. */
  mad: number;
  zeroShare: number;
  coefficientOfVariation: number | null;
  /** Largest value divided by the median of non-zero values. Reported, never thresholded. */
  outlierRatio: number | null;
  stable: boolean;
  reasonCode?: string;
};

export type RevenueAnomalyResult = {
  metric: string;
  state: AnomalyState;
  observedValue: number | null;
  baselineValue: number | null;
  /** Only present when a baseline existed. Never a stand-in for absence. */
  deviation: number | null;
  anomalyScore: number | null;
  detectionMethod: typeof DETECTION_METHOD;
  baselineDefinition: string;
  baseline: BaselineMeasurement | null;
  evidence: Array<{ signal: string; value: number | string | null; source: string }>;
  confidence: number | null;
  /** No model exists, so this is null rather than a fabricated version string. */
  modelVersion: null;
  rulesVersion: string;
  reasonCode?: string;
  generatedAt: string;
  source: string;
};

const TZ = "Asia/Kolkata";

function dayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(d);
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export const revenueAnomalyService = {
  /**
   * The daily GMV series, with zero activity distinguished from unknown.
   *
   * Only days between the first and last observed payment are emitted. Outside that span the
   * platform's state is genuinely unknown, and emitting zeros there would manufacture history.
   */
  async dailySeries(): Promise<DayPoint[]> {
    const payments = await prisma.payment.findMany({
      // A baseline over the business population only: a fixture payment is not revenue, and one
      // synthetic spike would be exactly the kind of arithmetic noise this module refuses to alert on.
      where: { status: "SUCCESS", completedAt: { not: null }, ...analyticsWhereVia("payment") },
      select: { amountPaid: true, completedAt: true },
      orderBy: { completedAt: "asc" },
    });
    if (payments.length === 0) return [];

    const byDay = new Map<string, number>();
    for (const p of payments) {
      const k = dayKey(p.completedAt!);
      byDay.set(k, (byDay.get(k) ?? 0) + p.amountPaid);
    }

    const firstKey = dayKey(payments[0]!.completedAt!);
    const lastKey = dayKey(payments[payments.length - 1]!.completedAt!);
    const out: DayPoint[] = [];
    for (let t = Date.parse(firstKey + "T00:00:00+05:30"); t <= Date.parse(lastKey + "T00:00:00+05:30"); t += 86400000) {
      const k = dayKey(new Date(t));
      const v = byDay.get(k);
      out.push({
        day: k,
        value: v === undefined ? 0 : Math.round(v * 100) / 100,
        activity: v === undefined ? "ZERO_ACTIVITY" : "ACTIVITY",
      });
    }
    return out;
  },

  /**
   * Measure whether a baseline can be computed at all.
   *
   * Every instability test is a mathematical fact about the series, not a chosen limit: fewer than
   * two points has no variance, a zero MAD makes a modified z-score undefined, a zero median makes a
   * relative deviation a division by zero. `outlierRatio` is measured and reported but never used to
   * reject — how much concentration is too much is exactly the business judgement being withheld.
   */
  measureBaseline(series: DayPoint[]): BaselineMeasurement {
    const values = series.map((p) => p.value);
    const n = values.length;
    const empty: BaselineMeasurement = {
      n, median: 0, mean: 0, stddev: 0, mad: 0, zeroShare: 0,
      coefficientOfVariation: null, outlierRatio: null, stable: false,
      reasonCode: ANOMALY_REASON.TOO_FEW_POINTS,
    };
    if (n < 2) return empty;

    const sorted = [...values].sort((a, b) => a - b);
    const med = median(sorted);
    const mean = values.reduce((a, b) => a + b, 0) / n;
    const stddev = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
    const mad = median([...values.map((v) => Math.abs(v - med))].sort((a, b) => a - b));
    const zeroShare = values.filter((v) => v === 0).length / n;
    const nonZero = sorted.filter((v) => v > 0);
    const nonZeroMedian = nonZero.length > 0 ? median(nonZero) : 0;
    const outlierRatio = nonZeroMedian > 0 ? Math.round((sorted[n - 1]! / nonZeroMedian) * 100) / 100 : null;

    const base = {
      n,
      median: Math.round(med * 100) / 100,
      mean: Math.round(mean * 100) / 100,
      stddev: Math.round(stddev * 100) / 100,
      mad: Math.round(mad * 100) / 100,
      zeroShare: Math.round(zeroShare * 1000) / 1000,
      coefficientOfVariation: mean > 0 ? Math.round((stddev / mean) * 100) / 100 : null,
      outlierRatio,
    };

    if (mad === 0) return { ...base, stable: false, reasonCode: ANOMALY_REASON.MAD_ZERO };
    if (med === 0) return { ...base, stable: false, reasonCode: ANOMALY_REASON.MEDIAN_ZERO };
    return { ...base, stable: true };
  },

  /**
   * Evaluate one metric for the most recent complete day.
   *
   * Returns a refusal in every case the data cannot support: an excluded metric, no series, an
   * unstable baseline, or — once a baseline does become computable — the absence of an approved
   * threshold. It never returns an anomaly it cannot justify.
   */
  async evaluate(
    metric = "gmv",
    opts?: { policy?: RevenueAnomalyPolicy },
  ): Promise<RevenueAnomalyResult> {
    const generatedAt = new Date().toISOString();
    const policy = opts?.policy ?? revenueAnomalyPolicy;
    const shell = {
      metric,
      detectionMethod: DETECTION_METHOD,
      rulesVersion: REVENUE_ANOMALY_RULES_VERSION,
      modelVersion: null as null,
      generatedAt,
      source: "db:payments(status=SUCCESS)",
      observedValue: null,
      baselineValue: null,
      deviation: null,
      anomalyScore: null,
      confidence: null,
      baseline: null,
      evidence: [] as RevenueAnomalyResult["evidence"],
    };

    if (EXCLUDED_METRICS.has(metric)) {
      return {
        ...shell,
        state: "DATA_QUALITY_ISSUE",
        baselineDefinition: "excluded",
        reasonCode: ANOMALY_REASON.METRIC_EXCLUDED,
      };
    }

    let series: DayPoint[];
    try {
      series = await this.dailySeries();
    } catch (err) {
      logger.warn("revenue_anomaly_series_unavailable", { error: String(err).slice(0, 200) });
      return {
        ...shell,
        state: "INSUFFICIENT_DATA",
        baselineDefinition: "unavailable",
        reasonCode: ANOMALY_REASON.NO_SERIES,
      };
    }

    const baselineDefinition =
      "Daily " + metric + " in " + TZ + ", from the first to the last observed payment. " +
      "Days with no payment inside that span are zero activity; days outside it are not emitted.";

    if (series.length < 2) {
      return {
        ...shell,
        state: "INSUFFICIENT_DATA",
        baselineDefinition,
        baseline: this.measureBaseline(series),
        reasonCode: ANOMALY_REASON.TOO_FEW_POINTS,
      };
    }

    /** The most recent day is the point under test; everything before it is the baseline. */
    const point = series[series.length - 1]!;
    const history = series.slice(0, -1);
    const baseline = this.measureBaseline(history);

    const evidence: RevenueAnomalyResult["evidence"] = [
      { signal: "OBSERVED_DAY", value: point.day, source: "db:payments" },
      { signal: "OBSERVED_VALUE", value: point.value, source: "db:payments" },
      { signal: "DAY_ACTIVITY", value: point.activity, source: "db:payments" },
      { signal: "BASELINE_N", value: baseline.n, source: "computed" },
      { signal: "BASELINE_MEDIAN", value: baseline.median, source: "computed" },
      { signal: "BASELINE_MAD", value: baseline.mad, source: "computed" },
      { signal: "BASELINE_ZERO_SHARE", value: baseline.zeroShare, source: "computed" },
      { signal: "BASELINE_OUTLIER_RATIO", value: baseline.outlierRatio, source: "computed" },
    ];

    if (!baseline.stable) {
      return {
        ...shell,
        state: "UNSTABLE_BASELINE",
        observedValue: point.value,
        baselineDefinition,
        baseline,
        evidence,
        reasonCode: baseline.reasonCode ?? ANOMALY_REASON.MAD_ZERO,
      };
    }

    /**
     * A stable baseline still cannot produce an anomaly without an approved threshold.
     *
     * The deviation is computed and published so a human choosing a threshold can see what the
     * numbers look like; what is withheld is the verdict.
     */
    const deviation = Math.round(((point.value - baseline.median) / baseline.mad) * 100) / 100;
    const anomalyScore = Math.round(Math.abs(0.6745 * deviation) * 100) / 100;

    if (!isAnomalyPolicyApproved(policy)) {
      return {
        ...shell,
        state: "THRESHOLD_UNSET",
        observedValue: point.value,
        baselineValue: baseline.median,
        deviation,
        anomalyScore,
        baselineDefinition,
        baseline,
        evidence,
        reasonCode: ANOMALY_REASON.THRESHOLD_UNSET,
      };
    }

    return {
      ...shell,
      state: "EVALUATED",
      observedValue: point.value,
      baselineValue: baseline.median,
      deviation,
      anomalyScore,
      baselineDefinition,
      baseline,
      evidence,
    };
  },
};
