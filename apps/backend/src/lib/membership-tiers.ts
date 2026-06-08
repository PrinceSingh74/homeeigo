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

/** Platform visit fee waived for FREE_DELIVERY benefit. */
export const PLATFORM_VISIT_FEE_INR = 49;
