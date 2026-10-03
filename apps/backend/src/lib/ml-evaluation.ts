/**
 * Phase 15 — the evaluation arithmetic shared by every candidate model on this platform.
 *
 * ── Why this is one module and not copied per model ──────────────────────────────
 *
 * `cancellation-risk` needed logistic regression, AUC, Brier and a standard error. Provider
 * acceptance needs exactly the same four. Copying them would mean two implementations of the same
 * statistic that can silently disagree — and the one that matters most, the AUC standard error, is
 * the piece that decides whether a model gets promoted. Two versions of *that* drifting apart is a
 * governance failure wearing a maths costume.
 *
 * ── The materiality rule, and why it lives here ──────────────────────────────────
 *
 * `beatsBaseline` asks whether one number exceeds another. It is trivially satisfiable on small
 * holdouts and it is not a promotion signal. The first cancellation-risk run returned
 * `beatsBaseline: true` on a margin of 0.014 AUC against a standard error of 0.057 — arithmetically
 * correct, practically meaningless. Putting `materiallyBetter` in the shared module means no future
 * model can quietly report the first without the second.
 */

/** Numerically stable logistic. The naive form overflows for large negative z. */
export function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export type TrainingExample = { features: number[]; label: number };

/**
 * Logistic regression by batch gradient descent.
 *
 * No dependency: the datasets here are hundreds of rows, and pulling in a solver would add a supply
 * chain for arithmetic that fits in twenty lines. The bias term is deliberately not regularised —
 * penalising it would shrink the intercept toward zero and bias the base rate itself.
 */
export function trainLogistic(
  examples: TrainingExample[],
  dimensions: number,
  opts: { iterations?: number; learningRate?: number; l2?: number } = {},
): number[] {
  const { iterations = 4000, learningRate = 0.1, l2 = 0.01 } = opts;
  const w = new Array<number>(dimensions).fill(0);
  if (examples.length === 0) return w;

  for (let it = 0; it < iterations; it++) {
    const grad = new Array<number>(dimensions).fill(0);
    for (const ex of examples) {
      let z = 0;
      for (let j = 0; j < dimensions; j++) z += w[j]! * ex.features[j]!;
      const err = sigmoid(z) - ex.label;
      for (let j = 0; j < dimensions; j++) grad[j]! += err * ex.features[j]!;
    }
    for (let j = 0; j < dimensions; j++) {
      const penalty = j === 0 ? 0 : l2 * w[j]!;
      w[j]! -= learningRate * (grad[j]! / examples.length + penalty);
    }
  }
  return w;
}

export function predictLogistic(weights: number[], features: number[]): number {
  let z = 0;
  for (let j = 0; j < weights.length; j++) z += weights[j]! * features[j]!;
  return sigmoid(z);
}

/**
 * Area under the ROC curve, computed exactly by rank comparison.
 *
 * Exact rather than sampled because these holdouts are small enough for it, and an approximation
 * would add its own error to a margin already being compared against a standard error.
 * Null when one class is absent — an AUC over a single class is undefined, not 0.5.
 */
export function auc(scores: number[], labels: number[]): number | null {
  const pos: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < scores.length; i++) (labels[i] === 1 ? pos : neg).push(scores[i]!);
  if (pos.length === 0 || neg.length === 0) return null;
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p > n ? 1 : p === n ? 0.5 : 0;
  return wins / (pos.length * neg.length);
}

/** Mean squared error of the probabilities. The calibration bar, where AUC is the ranking bar. */
export function brier(scores: number[], labels: number[]): number {
  if (scores.length === 0) return 0;
  return scores.reduce((s, p, i) => s + (p - labels[i]!) ** 2, 0) / scores.length;
}

/**
 * Hanley–McNeil standard error of an AUC estimate.
 *
 * The piece that turns "beats the baseline" into a decision. On a holdout with 32 positives the
 * standard error is around 0.06, so a margin of one or two points is noise — and a promotion made
 * on that basis is a coin flip with a report attached.
 */
export function aucStandardError(a: number, nPos: number, nNeg: number): number {
  if (nPos <= 0 || nNeg <= 0) return Number.POSITIVE_INFINITY;
  const q1 = a / (2 - a);
  const q2 = (2 * a * a) / (1 + a);
  const variance =
    (a * (1 - a) + (nPos - 1) * (q1 - a * a) + (nNeg - 1) * (q2 - a * a)) / (nPos * nNeg);
  return Math.sqrt(Math.max(variance, 0));
}

export type Materiality = {
  materiallyBetter: boolean;
  aucMargin: number;
  aucStandardError: number | null;
  marginInStandardErrors: number | null;
  verdict: string;
};

/**
 * Whether a candidate's ranking advantage survives its own uncertainty.
 *
 * Two standard errors, not one — a one-sigma "improvement" happens by chance roughly a third of the
 * time, and a model promoted on that basis will regress the moment it meets new data.
 */
export function assessMateriality(
  candidateAuc: number | null,
  baselineAuc: number,
  nPos: number,
  nNeg: number,
): Materiality {
  if (candidateAuc === null) {
    return {
      materiallyBetter: false,
      aucMargin: 0,
      aucStandardError: null,
      marginInStandardErrors: null,
      verdict: "AUC is undefined on this holdout — one class is absent, so no comparison is possible.",
    };
  }
  const se = aucStandardError(candidateAuc, nPos, nNeg);
  const margin = candidateAuc - baselineAuc;
  const materiallyBetter = Number.isFinite(se) && margin > 1.96 * se;
  return {
    materiallyBetter,
    aucMargin: Number(margin.toFixed(4)),
    aucStandardError: Number.isFinite(se) ? Number(se.toFixed(4)) : null,
    marginInStandardErrors: Number.isFinite(se) && se > 0 ? Number((margin / se).toFixed(2)) : null,
    verdict: materiallyBetter
      ? "The candidate's ranking advantage exceeds twice its own standard error on this holdout."
      : "The candidate's ranking advantage is within the noise of this holdout. It is NOT distinguishable from the baseline, and promoting it would be promoting a coin flip.",
  };
}
