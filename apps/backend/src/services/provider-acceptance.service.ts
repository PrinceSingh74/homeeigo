/**
 * Phase 15 — will this provider accept this job?
 *
 * ── Why this model exists at all ─────────────────────────────────────────────────
 *
 * The first Phase-15 data audit looked at customer→service repeat bookings, found 117 of 147
 * customers had booked exactly once, and concluded recommendation was blocked by data. That
 * conclusion was right about *that* dataset and wrong as a verdict on the platform: it never asked
 * whether a ranking problem with real labels existed elsewhere.
 *
 * It does. `assignment_attempts` holds **3,164 dispatch offers across 54 providers over 88 days**,
 * each with a genuine observed outcome:
 *
 *   ACCEPTED  236     the provider took the job
 *   TIMEOUT  2904     the offer expired unanswered
 *   REJECTED    7     the provider declined
 *   SENT       17     still in flight — excluded, no label yet
 *
 * That is a real label, recorded by the assignment engine as a consequence of provider behaviour —
 * not a rule's own output relabelled as truth, which is the trap `fraud_signals` and
 * `provider_match_scores` both represent.
 *
 * Ordering offers by predicted acceptance is a recommendation problem, and it is the one this
 * platform's data actually supports.
 *
 * ── What is deliberately not used ────────────────────────────────────────────────
 *
 * `provider_match_scores` has 2,386 rows and looks like the obvious training set. It is unusable:
 * its `booking_id` column is **entirely NULL**, so no score can be joined to whether that provider
 * was actually chosen. Scores without outcomes are the assignment engine's own opinion, and
 * training on them would teach a model to imitate the scorer it was meant to improve.
 */
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, setGauge } from "../lib/metrics";
import {
  trainLogistic,
  predictLogistic,
  auc,
  brier,
  assessMateriality,
  type TrainingExample,
} from "../lib/ml-evaluation";

export const PROVIDER_ACCEPTANCE_MODEL_VERSION = "provider-acceptance.v1";

/** Offers that reached a terminal outcome. `SENT` is still in flight and carries no label yet. */
const TERMINAL = ["ACCEPTED", "TIMEOUT", "REJECTED"];

/**
 * Fields excluded, with the reason. Returned with the evaluation so the leakage argument can be
 * checked rather than trusted.
 */
export const EXCLUDED_FEATURES = [
  { field: "status", reason: "IS_THE_LABEL." },
  { field: "responded_at", reason: "OUTCOME — only set when the provider actually answered, which is most of the label." },
  { field: "response_ms", reason: "OUTCOME — a response time exists only for offers that got a response." },
  { field: "assignment_jobs.accepted_at", reason: "OUTCOME — the job-level record of the acceptance being predicted." },
  { field: "assignment_jobs.status", reason: "OUTCOME — reflects whether the dispatch eventually succeeded." },
  { field: "provider_match_scores.*", reason: "NO_OUTCOME_JOIN — booking_id is entirely NULL, so a score cannot be tied to what happened. Training on it would imitate the existing scorer." },
] as const;

export const FEATURE_NAMES = [
  "bias",
  "prior_offers_log",
  "prior_accept_rate",
  "is_first_offer",
  "prior_median_response_log",
  "dispatch_hour_sin",
  "dispatch_hour_cos",
  "is_weekend",
  "job_attempt_index_log",
] as const;

type Example = TrainingExample & { dispatchedAt: Date };

export class ProviderAcceptanceService {
  /**
   * Build examples in dispatch order.
   *
   * Per-provider history advances **after** each example is emitted, so an offer never sees the
   * provider's own later behaviour. Computing acceptance rate with an aggregate query instead would
   * put the answer inside the features — the failure that makes a model look excellent offline and
   * useless the moment it predicts something that has not happened yet.
   */
  private async buildExamples(): Promise<{ examples: Example[]; skipped: number }> {
    const rows = await prisma.assignmentAttempt.findMany({
      where: { status: { in: TERMINAL as never } },
      select: { providerId: true, jobId: true, status: true, dispatchedAt: true, responseMs: true },
      orderBy: { dispatchedAt: "asc" },
    });

    const offers = new Map<string, number>();
    const accepts = new Map<string, number>();
    const responseTotals = new Map<string, number>();
    const responseCounts = new Map<string, number>();
    const jobOfferIndex = new Map<string, number>();

    const examples: Example[] = [];
    let skipped = 0;

    for (const a of rows) {
      if (!a.dispatchedAt || !a.providerId) {
        skipped++;
        continue;
      }
      const seen = offers.get(a.providerId) ?? 0;
      const took = accepts.get(a.providerId) ?? 0;
      const respTotal = responseTotals.get(a.providerId) ?? 0;
      const respCount = responseCounts.get(a.providerId) ?? 0;
      const attemptIdx = jobOfferIndex.get(a.jobId) ?? 0;

      const hour = a.dispatchedAt.getHours();
      const dow = a.dispatchedAt.getDay();

      examples.push({
        dispatchedAt: a.dispatchedAt,
        label: a.status === "ACCEPTED" ? 1 : 0,
        features: [
          1,
          Math.log1p(seen),
          seen > 0 ? took / seen : 0,
          seen === 0 ? 1 : 0,
          // Mean of prior responses only. A provider with no prior response contributes 0 rather
          // than an imputed average, which would invent behaviour they have not shown.
          respCount > 0 ? Math.log1p(respTotal / respCount / 1000) : 0,
          Math.sin((2 * Math.PI * hour) / 24),
          Math.cos((2 * Math.PI * hour) / 24),
          dow === 0 || dow === 6 ? 1 : 0,
          // How far down the dispatch chain this offer is. Later offers on a job are systematically
          // different — the earlier providers already passed.
          Math.log1p(attemptIdx),
        ],
      });

      // History advances AFTER emission. This ordering is the leakage guard.
      offers.set(a.providerId, seen + 1);
      if (a.status === "ACCEPTED") accepts.set(a.providerId, took + 1);
      if (a.responseMs !== null && a.responseMs !== undefined) {
        responseTotals.set(a.providerId, respTotal + a.responseMs);
        responseCounts.set(a.providerId, respCount + 1);
      }
      jobOfferIndex.set(a.jobId, attemptIdx + 1);
    }

    return { examples, skipped };
  }

  /**
   * Train and evaluate on a temporal split against two baselines.
   *
   * The split is by dispatch time. A random split would let the model see offers made after the
   * ones it is graded on, and provider behaviour drifts as they join, leave and change capacity.
   */
  async evaluate(holdoutFraction = 0.3) {
    const { examples, skipped } = await this.buildExamples();

    const MIN_TRAIN = 200;
    const MIN_TEST_POSITIVES = 15;

    if (examples.length < MIN_TRAIN + 50) {
      return {
        status: "DATA_INSUFFICIENT" as const,
        modelVersion: PROVIDER_ACCEPTANCE_MODEL_VERSION,
        examples: examples.length,
        skipped,
        detail: `${examples.length} usable offers is below the ${MIN_TRAIN + 50} needed to train and hold out meaningfully.`,
        excludedFeatures: EXCLUDED_FEATURES,
      };
    }

    const cut = Math.floor(examples.length * (1 - holdoutFraction));
    const train = examples.slice(0, cut);
    const test = examples.slice(cut);
    const testPositives = test.filter((e) => e.label === 1).length;
    const testNegatives = test.length - testPositives;

    if (testPositives < MIN_TEST_POSITIVES) {
      return {
        status: "DATA_INSUFFICIENT" as const,
        modelVersion: PROVIDER_ACCEPTANCE_MODEL_VERSION,
        examples: examples.length,
        skipped,
        detail: `The holdout contains ${testPositives} acceptances; below ${MIN_TEST_POSITIVES} the metrics are noise.`,
        excludedFeatures: EXCLUDED_FEATURES,
      };
    }

    const w = trainLogistic(train, FEATURE_NAMES.length);
    const labels = test.map((e) => e.label);
    const candidate = test.map((e) => predictLogistic(w, e.features));

    /**
     * Two baselines, because beating only the weaker one proves nothing.
     *
     * BASE_RATE predicts the training period's acceptance rate for every offer — no discrimination
     * at all (AUC 0.5 by construction) but well calibrated, so it is the bar for Brier.
     * PRIOR_ACCEPT_RATE predicts the provider's own historical acceptance rate, which is what the
     * assignment engine could do without a model, so it is the bar for AUC.
     */
    const trainRate = train.reduce((s, e) => s + e.label, 0) / train.length;
    const baseRate = test.map(() => trainRate);
    const rateIdx = FEATURE_NAMES.indexOf("prior_accept_rate");
    const firstIdx = FEATURE_NAMES.indexOf("is_first_offer");
    const priorRule = test.map((e) => (e.features[firstIdx] === 1 ? trainRate : e.features[rateIdx]!));

    const metrics = {
      candidate: { auc: auc(candidate, labels), brier: brier(candidate, labels) },
      baselineBaseRate: { auc: auc(baseRate, labels), brier: brier(baseRate, labels) },
      baselinePriorRate: { auc: auc(priorRule, labels), brier: brier(priorRule, labels) },
    };

    const aucBar = Math.max(metrics.baselinePriorRate.auc ?? 0.5, 0.5);
    const beatsAuc = (metrics.candidate.auc ?? 0) > aucBar;
    const beatsBrier = metrics.candidate.brier < metrics.baselineBaseRate.brier;
    const materiality = assessMateriality(metrics.candidate.auc, aucBar, testPositives, testNegatives);

    const result = {
      status: "EVALUATED" as const,
      modelVersion: PROVIDER_ACCEPTANCE_MODEL_VERSION,
      labelSource: "assignment_attempts.status — a real observed provider response, not a rule's output",
      split: {
        kind: "TEMPORAL" as const,
        trainCount: train.length,
        testCount: test.length,
        testPositives,
        trainStart: train[0]!.dispatchedAt.toISOString(),
        trainEnd: train[train.length - 1]!.dispatchedAt.toISOString(),
        testStart: test[0]!.dispatchedAt.toISOString(),
        testEnd: test[test.length - 1]!.dispatchedAt.toISOString(),
      },
      classBalance: {
        overallPositiveRate: Number((examples.reduce((s, e) => s + e.label, 0) / examples.length).toFixed(4)),
        trainPositiveRate: Number(trainRate.toFixed(4)),
        testPositiveRate: Number((testPositives / test.length).toFixed(4)),
      },
      metrics,
      beatsBaseline: beatsAuc && beatsBrier,
      beatsBaselineDetail: {
        aucBeatsPriorRateRule: beatsAuc,
        brierBeatsBaseRate: beatsBrier,
        note: "Both must hold. Beating only calibration means the model ranks no better than a provider's own history; beating only ranking means its probabilities are not usable as probabilities.",
      },
      /** The verdict that should drive a promotion decision. */
      materiality,
      coefficients: FEATURE_NAMES.map((name, i) => ({ name, weight: Number(w[i]!.toFixed(4)) })),
      excludedFeatures: EXCLUDED_FEATURES,
      skipped,
      limitations: [
        `CLASS_IMBALANCE: acceptances are a minority of offers. Ranking metrics tolerate that; a naive accuracy figure would not, which is why none is reported.`,
        `SMALL_PROVIDER_POOL: 54 providers over 88 days. A model this size largely learns individual providers rather than transferable behaviour, and will not generalise to a new provider.`,
        "SINGLE_SPLIT: one temporal cut, not walk-forward validation.",
        "NO_SEGMENT_ANALYSIS: no breakdown by service, city or provider tenure.",
        "NOT_SERVING: this is an offline evaluation. The assignment engine does not consume it and no version is registered in the ML registry.",
      ],
      evaluatedAt: new Date().toISOString(),
    };

    setGauge("homigo_provider_acceptance_model_auc", metrics.candidate.auc ?? 0, {
      model: PROVIDER_ACCEPTANCE_MODEL_VERSION,
    });
    // The gauge publishes materiality, not the bare comparison — a dashboard reading
    // "beats baseline = 1" for a margin inside the noise is the same claim in a different medium.
    setGauge("homigo_provider_acceptance_model_materially_better", materiality.materiallyBetter ? 1 : 0, {
      model: PROVIDER_ACCEPTANCE_MODEL_VERSION,
    });
    incCounter("homigo_provider_acceptance_evaluations_total", {
      beats: String(result.beatsBaseline),
      material: String(materiality.materiallyBetter),
    });

    logger.info("provider_acceptance_model_evaluated", {
      category: "APPLICATION",
      auc: metrics.candidate.auc,
      materiallyBetter: materiality.materiallyBetter,
      train: train.length,
      test: test.length,
    });

    return result;
  }
}

export const providerAcceptanceService = new ProviderAcceptanceService();
