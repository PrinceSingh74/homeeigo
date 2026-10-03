/**
 * Phase 15 — cancellation risk, and the honest evaluation of whether it is worth having.
 *
 * ── Why this model and not the others ────────────────────────────────────────────
 *
 * Phase 15 asked for advanced recommendation ML, sophisticated fraud ML and advanced predictive
 * operations. A data-readiness audit was run before any of them was written, and only one survived
 * it:
 *
 *   Recommendation — 147 customers have booked; **117 of them exactly once**. Personalised ranking
 *                    needs repeat behaviour to learn from, and 80% of the population has none.
 *   Fraud          — nine chargebacks and one confirmed case in the entire history. A supervised
 *                    fraud model needs positives; there are nine.
 *   Cancellation   — 387 terminal bookings, 161 of them cancelled. A 41.6% positive rate over 87
 *                    days. Small, but a real label with real balance.
 *
 * So this is the one built. The other two are classified DATA_INSUFFICIENT with their counts, not
 * built and hidden behind a confidence score.
 *
 * ── Why the evaluation matters more than the model ───────────────────────────────
 *
 * 387 examples is not much. It is entirely possible that a model learns nothing a base rate does
 * not already give you, and the outcome that would embarrass this platform is shipping one that
 * does not and calling it intelligence. So the candidate is scored against two baselines it has to
 * beat, on a **temporal** split, and `beatsBaseline` is computed rather than asserted. A negative
 * result here is a successful phase, not a failed one.
 *
 * ── Leakage ──────────────────────────────────────────────────────────────────────
 *
 * Every feature is knowable at the instant the booking row is created. That rules out most of the
 * table: `provider_id` and `assigned_at` are populated by the assignment engine afterwards,
 * `payment_status` evolves, `accepted_at` / `started_at` / `completed_at` / `cancelled_at` are the
 * outcome itself, and `cancellation_reason` and `cancelled_by` *are the label wearing a disguise*.
 * Customer history is computed with a strict `created_at <` cutoff against the booking being
 * scored, so a customer's later cancellations cannot inform their earlier prediction.
 */
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, setGauge } from "../lib/metrics";

export const CANCELLATION_MODEL_VERSION = "cancellation-risk.v1";

/** Statuses that have finished. A booking still in flight has no label yet and is excluded. */
const TERMINAL = ["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"] as const;
const CANCELLED = ["CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER"];

/**
 * Fields deliberately excluded, and why. Returned with the evaluation so a reviewer can check the
 * leakage reasoning rather than trust it.
 */
export const EXCLUDED_FEATURES = [
  { field: "provider_id", reason: "POST_CREATION — set by the assignment engine after the booking exists." },
  { field: "assigned_at", reason: "POST_CREATION — written when the assignment engine matches a provider." },
  { field: "accepted_at", reason: "OUTCOME — a booking that was accepted is far less likely to be cancelled by definition." },
  { field: "started_at", reason: "OUTCOME — work only starts on a booking that was not cancelled." },
  { field: "completed_at", reason: "TARGET_RECONSTRUCTION — non-null iff the label is COMPLETED." },
  { field: "cancelled_at", reason: "TARGET_RECONSTRUCTION — non-null iff the label is cancelled." },
  { field: "cancellation_reason", reason: "LABEL_DEFINING — the label wearing a disguise." },
  { field: "cancelled_by", reason: "LABEL_DEFINING — non-null only when the booking was cancelled." },
  { field: "refund_status", reason: "LABEL_DEFINING — refunds follow cancellations." },
  { field: "actual_duration", reason: "OUTCOME — only exists for work that happened." },
  { field: "payment_status", reason: "EVOLVES — its value at prediction time differs from its value at read time." },
  { field: "queue_position", reason: "POST_CREATION — assigned by the dispatch queue after the booking exists." },
  { field: "premium_matched", reason: "POST_CREATION — a matching outcome." },
] as const;

type Example = { features: number[]; label: number; createdAt: Date };

/** Named so a coefficient can be read back against the thing it weights. */
export const FEATURE_NAMES = [
  "bias",
  "lead_time_hours_log",
  "scheduled_hour_sin",
  "scheduled_hour_cos",
  "is_weekend",
  "base_amount_log",
  "has_discount",
  "prior_bookings_log",
  "prior_cancel_rate",
  "is_first_booking",
] as const;

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export class CancellationRiskService {
  /**
   * Build the example set.
   *
   * Customer history is computed in one pass over bookings ordered by creation, so each example
   * sees only what existed before it. Computing it with an aggregate query instead would leak the
   * future into every row — the single most common way a model like this ends up looking
   * excellent and being useless.
   */
  private async buildExamples(): Promise<{ examples: Example[]; skipped: number }> {
    const rows = await prisma.booking.findMany({
      where: { status: { in: TERMINAL as unknown as string[] } as never },
      select: {
        id: true, userId: true, status: true, createdAt: true,
        scheduledDate: true, baseAmount: true, discount: true,
      },
      orderBy: { createdAt: "asc" },
    });

    const priorCount = new Map<string, number>();
    const priorCancels = new Map<string, number>();
    const examples: Example[] = [];
    let skipped = 0;

    for (const b of rows) {
      if (!b.scheduledDate || b.baseAmount === null || b.baseAmount === undefined) {
        skipped++;
        continue;
      }
      const seen = priorCount.get(b.userId) ?? 0;
      const cancels = priorCancels.get(b.userId) ?? 0;

      const leadHours = Math.max(0, (b.scheduledDate.getTime() - b.createdAt.getTime()) / 3_600_000);
      const hour = b.scheduledDate.getHours();
      const dow = b.scheduledDate.getDay();

      examples.push({
        createdAt: b.createdAt,
        label: CANCELLED.includes(b.status as string) ? 1 : 0,
        features: [
          1,
          Math.log1p(leadHours),
          Math.sin((2 * Math.PI * hour) / 24),
          Math.cos((2 * Math.PI * hour) / 24),
          dow === 0 || dow === 6 ? 1 : 0,
          Math.log1p(Math.max(0, b.baseAmount)),
          (b.discount ?? 0) > 0 ? 1 : 0,
          Math.log1p(seen),
          seen > 0 ? cancels / seen : 0,
          seen === 0 ? 1 : 0,
        ],
      });

      // Advance history AFTER the example is emitted — this ordering is the leakage guard.
      priorCount.set(b.userId, seen + 1);
      if (CANCELLED.includes(b.status as string)) priorCancels.set(b.userId, cancels + 1);
    }

    return { examples, skipped };
  }

  /** Logistic regression by batch gradient descent. Small data, so no dependency is justified. */
  private train(examples: Example[], iterations = 4000, lr = 0.1, l2 = 0.01): number[] {
    const d = FEATURE_NAMES.length;
    const w = new Array(d).fill(0);
    if (examples.length === 0) return w;

    for (let it = 0; it < iterations; it++) {
      const grad = new Array(d).fill(0);
      for (const ex of examples) {
        let z = 0;
        for (let j = 0; j < d; j++) z += w[j]! * ex.features[j]!;
        const err = sigmoid(z) - ex.label;
        for (let j = 0; j < d; j++) grad[j]! += err * ex.features[j]!;
      }
      for (let j = 0; j < d; j++) {
        // Bias is not regularised — penalising it would bias the base rate itself.
        const penalty = j === 0 ? 0 : l2 * w[j]!;
        w[j]! -= (lr * (grad[j]! / examples.length + penalty));
      }
    }
    return w;
  }

  private predict(w: number[], features: number[]): number {
    let z = 0;
    for (let j = 0; j < w.length; j++) z += w[j]! * features[j]!;
    return sigmoid(z);
  }

  /** Area under ROC by rank comparison. Exact for this data size; no sampling. */
  private auc(scores: number[], labels: number[]): number | null {
    const pos = scores.filter((_, i) => labels[i] === 1);
    const neg = scores.filter((_, i) => labels[i] === 0);
    if (pos.length === 0 || neg.length === 0) return null;
    let wins = 0;
    for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
    return wins / (pos.length * neg.length);
  }

  /**
   * Hanley–McNeil standard error of an AUC estimate.
   *
   * Added after the first evaluation returned `beatsBaseline: true` on a margin of 0.014 AUC with
   * 32 positives in the holdout. That verdict was arithmetically correct and practically
   * meaningless: at this sample size the standard error is several times the margin, so "beats the
   * baseline" and "is indistinguishable from the baseline" were the same measurement. Reporting the
   * first without the second is precisely the fake intelligence this phase exists to prevent.
   */
  private aucStandardError(auc: number, nPos: number, nNeg: number): number {
    if (nPos <= 0 || nNeg <= 0) return Number.POSITIVE_INFINITY;
    const q1 = auc / (2 - auc);
    const q2 = (2 * auc * auc) / (1 + auc);
    const variance =
      (auc * (1 - auc) + (nPos - 1) * (q1 - auc * auc) + (nNeg - 1) * (q2 - auc * auc)) /
      (nPos * nNeg);
    return Math.sqrt(Math.max(variance, 0));
  }


  private brier(scores: number[], labels: number[]): number {
    return scores.reduce((s, p, i) => s + (p - labels[i]!) ** 2, 0) / Math.max(scores.length, 1);
  }

  /**
   * Train and evaluate on a temporal split, against baselines the candidate must beat.
   *
   * The split is by time, not at random. A random split lets the model see bookings made *after*
   * the ones it is tested on, which for a behaviour that drifts week to week is a way of grading
   * your own homework.
   */
  async evaluate(holdoutFraction = 0.3) {
    const { examples, skipped } = await this.buildExamples();

    const MIN_TRAIN = 100;
    const MIN_TEST_POSITIVES = 15;

    if (examples.length < MIN_TRAIN + 30) {
      return {
        status: "DATA_INSUFFICIENT" as const,
        modelVersion: CANCELLATION_MODEL_VERSION,
        examples: examples.length,
        skipped,
        detail: `${examples.length} usable examples is below the ${MIN_TRAIN + 30} needed to train and hold out meaningfully.`,
        excludedFeatures: EXCLUDED_FEATURES,
      };
    }

    const cut = Math.floor(examples.length * (1 - holdoutFraction));
    const train = examples.slice(0, cut);
    const test = examples.slice(cut);
    const testPositives = test.filter((e) => e.label === 1).length;

    if (testPositives < MIN_TEST_POSITIVES) {
      return {
        status: "DATA_INSUFFICIENT" as const,
        modelVersion: CANCELLATION_MODEL_VERSION,
        examples: examples.length,
        skipped,
        detail: `The holdout contains ${testPositives} cancellations; below ${MIN_TEST_POSITIVES} the metrics are noise.`,
        excludedFeatures: EXCLUDED_FEATURES,
      };
    }

    const w = this.train(train);
    const labels = test.map((e) => e.label);
    const candidate = test.map((e) => this.predict(w, e.features));

    /**
     * Two baselines, because beating only the weaker one proves nothing.
     *
     * BASE_RATE predicts the training period's cancellation rate for everyone — it has no
     * discrimination at all (AUC 0.5 by construction) but is well calibrated, so it is the bar for
     * Brier score. PRIOR_CANCEL_RATE predicts the customer's own historical cancellation rate,
     * which is the obvious thing to do without a model and is the bar for AUC.
     */
    const trainRate = train.reduce((s, e) => s + e.label, 0) / train.length;
    const baseRate = test.map(() => trainRate);
    const priorRateIdx = FEATURE_NAMES.indexOf("prior_cancel_rate");
    const firstIdx = FEATURE_NAMES.indexOf("is_first_booking");
    const priorRule = test.map((e) => (e.features[firstIdx] === 1 ? trainRate : e.features[priorRateIdx]!));

    const metrics = {
      candidate: { auc: this.auc(candidate, labels), brier: this.brier(candidate, labels) },
      baselineBaseRate: { auc: this.auc(baseRate, labels), brier: this.brier(baseRate, labels) },
      baselinePriorRate: { auc: this.auc(priorRule, labels), brier: this.brier(priorRule, labels) },
    };

    const aucBar = Math.max(metrics.baselinePriorRate.auc ?? 0.5, 0.5);
    const beatsAuc = (metrics.candidate.auc ?? 0) > aucBar;
    const beatsBrier = metrics.candidate.brier < metrics.baselineBaseRate.brier;

    /**
     * Whether the margin survives its own uncertainty.
     *
     * `beatsAuc` only asks whether one number exceeds another. With 32 positives in the holdout the
     * standard error on the AUC estimate dwarfs a margin of a couple of points, so a bare
     * comparison reports a coin flip as an improvement — which is exactly what the first run of
     * this evaluation did.
     */
    const testNegatives = test.length - testPositives;
    const aucSe =
      metrics.candidate.auc === null
        ? null
        : this.aucStandardError(metrics.candidate.auc, testPositives, testNegatives);
    const aucMargin = (metrics.candidate.auc ?? 0) - aucBar;
    const materiallyBetter = aucSe !== null && aucMargin > 1.96 * aucSe;

    const coefficients = FEATURE_NAMES.map((name, i) => ({ name, weight: Number(w[i]!.toFixed(4)) }));

    const result = {
      status: "EVALUATED" as const,
      modelVersion: CANCELLATION_MODEL_VERSION,
      split: {
        kind: "TEMPORAL" as const,
        trainCount: train.length,
        testCount: test.length,
        testPositives,
        trainStart: train[0]!.createdAt.toISOString(),
        trainEnd: train[train.length - 1]!.createdAt.toISOString(),
        testStart: test[0]!.createdAt.toISOString(),
        testEnd: test[test.length - 1]!.createdAt.toISOString(),
      },
      metrics,
      /** Computed, never asserted. A false here is a real and useful result. */
      beatsBaseline: beatsAuc && beatsBrier,
      beatsBaselineDetail: {
        aucBeatsPriorRateRule: beatsAuc,
        brierBeatsBaseRate: beatsBrier,
        note: "Both must hold. Beating only calibration means the model ranks no better than a customer's own history; beating only ranking means its probabilities are not usable as probabilities.",
      },
      /**
       * The verdict that should drive a promotion decision. `beatsBaseline` can be true while this
       * is false, and when it is, the correct reading is "no measurable improvement".
       */
      materiality: {
        materiallyBetter,
        aucMargin: Number(aucMargin.toFixed(4)),
        aucStandardError: aucSe === null ? null : Number(aucSe.toFixed(4)),
        marginInStandardErrors: aucSe && aucSe > 0 ? Number((aucMargin / aucSe).toFixed(2)) : null,
        verdict: materiallyBetter
          ? "The candidate's ranking advantage exceeds twice its own standard error on this holdout."
          : "The candidate's ranking advantage is within the noise of this holdout. It is NOT distinguishable from the baseline rule, and promoting it would be promoting a coin flip.",
      },
      coefficients,
      excludedFeatures: EXCLUDED_FEATURES,
      skipped,
      limitations: [
        `SMALL_SAMPLE: ${examples.length} terminal bookings over 87 days. Metrics on a holdout this size carry wide error bars that this evaluation does not compute.`,
        "NO_SEGMENT_ANALYSIS: performance is not broken down by service, city or customer tenure, so a model that works only for one segment would look uniformly adequate.",
        "SINGLE_SPLIT: one temporal cut, not walk-forward validation. A different cut could give a materially different answer.",
        "NOT_SERVING: this is an offline evaluation. Nothing consumes the score, and no version is registered in the ML registry.",
      ],
      evaluatedAt: new Date().toISOString(),
    };

    setGauge("homigo_cancellation_model_auc", metrics.candidate.auc ?? 0, { model: CANCELLATION_MODEL_VERSION });
    // Publishes MATERIALITY, not the bare comparison — a dashboard reading "beats baseline = 1"
    // for a margin inside the noise would be the same lie in a different medium.
    setGauge("homigo_cancellation_model_materially_better", result.materiality.materiallyBetter ? 1 : 0, { model: CANCELLATION_MODEL_VERSION });
    incCounter("homigo_cancellation_model_evaluations_total", { beats: String(result.beatsBaseline) });

    logger.info("cancellation_model_evaluated", {
      category: "APPLICATION",
      auc: metrics.candidate.auc,
      beatsBaseline: result.beatsBaseline,
      train: train.length,
      test: test.length,
    });

    return result;
  }
}

export const cancellationRiskService = new CancellationRiskService();
