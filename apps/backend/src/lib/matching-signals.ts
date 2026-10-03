/**
 * W2-D3 — ranking signals that say UNKNOWN when they do not know.
 *
 * The old scorer invented a value for every signal it had no evidence for:
 *
 *   rating      fewer than 5 reviews           -> a flat 15/30 — ranked a provider with NO reviews
 *                                                  above every provider measured below 3.0
 *   completion  completionRate defaulted to 0  -> 1/10, indistinguishable from a real 0%
 *   response    no recent bookings             -> rating.service wrote responseRate = 100
 *   distance    no coordinates                 -> an invented 15 km, which became a real distance
 *                                                  score AND an ETA shown to the customer
 *
 * The rule here is the owner's: UNKNOWN stays UNKNOWN. A signal with no evidence is `null` — not
 * average, not good, not 100%, not 15 km — and it is EXCLUDED from the score rather than scored.
 *
 * Excluded, not zeroed. Zero would punish a new provider for having no history, which is the other
 * half of the same rule. `normalisedMatchScore` therefore divides by the weight of the signals that
 * ARE known, so an unknown signal neither helps nor hurts.
 *
 * With every signal known and the default weights this produces exactly the old additive total —
 * `DEFAULT_WEIGHTS` are proportional to `MAX_POINTS` — so providers with real history rank as they
 * always did. Only fabricated values change.
 *
 * Pure: no database, no clock.
 */

/** Minimum evidence before a signal is trusted. Below it the signal is UNKNOWN, not a guess. */
export const MIN_RATING_SAMPLE = 5;
export const MIN_COMPLETION_SAMPLE = 3;
export const MIN_RESPONSE_SAMPLE = 3;

export const SIGNAL_MAX_POINTS = {
  rating: 30,
  distance: 25,
  availability: 20,
  response: 15,
  completion: 10,
} as const;

export type SignalName = keyof typeof SIGNAL_MAX_POINTS;

export type SignalWeights = Record<SignalName, number>;

/** Proportional to `SIGNAL_MAX_POINTS`, so the all-known case equals the old additive sum. */
export const DEFAULT_SIGNAL_WEIGHTS: SignalWeights = {
  rating: 0.3,
  distance: 0.25,
  availability: 0.2,
  response: 0.15,
  completion: 0.1,
};

/** Each component in points, or `null` when there is no evidence for it. */
export type SignalScores = Record<SignalName, number | null>;

/** The evidence behind a provider's stored rates, counted from real bookings at match time. */
export type ProviderEvidence = {
  /** Bookings that reached a terminal outcome — the denominator completionRate is meaningful over. */
  terminalJobs: number;
  /** Bookings created in the response window — the denominator responseRate is meaningful over. */
  recentJobs: number;
};

export function ratingPoints(rating: number, totalReviews: number): number | null {
  if (!(totalReviews >= MIN_RATING_SAMPLE)) return null;
  if (rating >= 4.8) return 30;
  if (rating >= 4.5) return 27;
  if (rating >= 4.0) return 24;
  if (rating >= 3.5) return 20;
  if (rating >= 3.0) return 15;
  return 10;
}

export function completionPoints(completionRate: number, evidence: ProviderEvidence): number | null {
  if (!(evidence.terminalJobs >= MIN_COMPLETION_SAMPLE)) return null;
  if (completionRate >= 98) return 10;
  if (completionRate >= 95) return 9;
  if (completionRate >= 90) return 8;
  if (completionRate >= 85) return 6;
  if (completionRate >= 80) return 4;
  // A measured low rate over real jobs is real, and is scored as such.
  return 1;
}

export function responsePoints(
  responseRate: number,
  avgResponseTime: number,
  evidence: ProviderEvidence,
): number | null {
  if (!(evidence.recentJobs >= MIN_RESPONSE_SAMPLE)) return null;
  let base: number;
  if (responseRate >= 95) base = 15;
  else if (responseRate >= 90) base = 13;
  else if (responseRate >= 85) base = 11;
  else if (responseRate >= 80) base = 9;
  else if (responseRate >= 70) base = 6;
  else base = 3;

  let multiplier = 1;
  if (avgResponseTime > 30) multiplier = 0.4;
  else if (avgResponseTime > 15) multiplier = 0.6;
  else if (avgResponseTime > 5) multiplier = 0.8;
  return base * multiplier;
}

export function distancePoints(distanceKm: number | null, maxKm: number): number | null {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return null;
  const score = (1 - distanceKm / maxKm) * 25;
  if (score < 0) return 0;
  if (score > 25) return 25;
  return score;
}

/**
 * 0–100 over the signals that are KNOWN.
 *
 * `null` components are removed from both the numerator and the weight total. If nothing is known
 * the result is 0 rather than NaN — but in practice availability is always known, because a
 * provider without it never reaches ranking.
 */
export function normalisedMatchScore(scores: SignalScores, weights: SignalWeights = DEFAULT_SIGNAL_WEIGHTS): number {
  let weighted = 0;
  let weightTotal = 0;
  for (const name of Object.keys(SIGNAL_MAX_POINTS) as SignalName[]) {
    const points = scores[name];
    const w = weights[name];
    if (points == null || !(w > 0)) continue;
    weighted += (points / SIGNAL_MAX_POINTS[name]) * w;
    weightTotal += w;
  }
  if (!(weightTotal > 0)) return 0;
  return (100 * weighted) / weightTotal;
}

/** Which signals were unknown — for the decision record, so "why did this rank here" has an answer. */
export function unknownSignals(scores: SignalScores): SignalName[] {
  return (Object.keys(SIGNAL_MAX_POINTS) as SignalName[]).filter((n) => scores[n] == null);
}

/**
 * Deterministic ordering for ranked providers.
 *
 * `Array.sort` on score alone leaves ties in input order, and the input order is the candidate
 * query's `ORDER BY rating DESC, completion_rate DESC` — stored columns that included the very
 * fabricated values W2-D3 removes. So ties are broken explicitly:
 *
 *   1. higher score first;
 *   2. more signals KNOWN first — a tie between an observed record and an unobserved one goes to the
 *      observed one. This prefers evidence without inventing any: it applies only on an exact tie;
 *   3. provider id, ascending — so the same inputs always produce the same order.
 */
export function compareRankedProviders(
  a: { totalScore: number; unknownSignals?: readonly string[]; providerId: string },
  b: { totalScore: number; unknownSignals?: readonly string[]; providerId: string },
): number {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  const aUnknown = a.unknownSignals?.length ?? 0;
  const bUnknown = b.unknownSignals?.length ?? 0;
  if (aUnknown !== bUnknown) return aUnknown - bUnknown;
  return a.providerId < b.providerId ? -1 : a.providerId > b.providerId ? 1 : 0;
}
