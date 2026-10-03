/** Membership tier priority scores for booking queue (server-side only). */
export const TIER_PRIORITY_SCORE: Record<string, number> = {
  platinum: 100,
  gold: 80,
  silver: 60,
  free: 10,
};

export function resolveTierPriorityScore(tier: string | null | undefined): number {
  if (!tier) return TIER_PRIORITY_SCORE.free;
  const key = tier.toLowerCase();
  return TIER_PRIORITY_SCORE[key] ?? TIER_PRIORITY_SCORE.free;
}

// PLATFORM_VISIT_FEE_INR (₹49) was removed 2026-09-21: no visit fee was ever charged, so "waiving" it
// was a discount against a fee that did not exist. Fees live in booking-pricing PLATFORM_FEES.
