/**
 * Zone opportunity scoring — pure arithmetic, no I/O.
 *
 * This is the platform `zoneScoring().compositeScore` formula. It used to treat an idle
 * zone (`activeBookings === 0`) as perfect service health (100), which ranked empty zones
 * above starved high-demand zones. That is inverted for both partner guidance and admin
 * attention: the zone with unmet demand is the opportunity, the empty zone is not.
 *
 * `serviceHealth` remains an operations metric (can a zone currently cover active work?).
 * `opportunityScore` and `compositeScore` rank unmet demand first.
 *
 * Method: HEURISTIC. Not a trained model. Do not present these scores as ML.
 */

export type ZoneInterpretation =
  | "DEMAND_EXCEEDS_SUPPLY"
  | "BALANCED"
  | "OVERSUPPLIED"
  | "IDLE";

export type ZoneScoreInputs = {
  demand24h: number;
  supply: number;
  revenue24h: number;
  activeBookings: number;
  maxRev: number;
  maxDem: number;
};

export type SkillGap = {
  skill: string;
  demand: number;
  supply: number;
  gap: number;
};

export type ZoneScoreOutputs = {
  earningScore: number;
  demandScore: number;
  serviceHealth: number;
  riskScore: number;
  opportunityScore: number;
  gap: number;
  compositeScore: number;
  interpretation: ZoneInterpretation;
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Idle empty is neutral, not "perfect". Starved zones score low. */
export function serviceHealthScore(activeBookings: number, supply: number, demand24h: number): number {
  if (activeBookings === 0 && demand24h === 0) return 50;
  if (activeBookings === 0) {
    return Math.round(clamp((supply / Math.max(demand24h, 1)) * 100, 0, 100));
  }
  return Math.round(clamp((supply / activeBookings) * 100, 0, 100));
}

/**
 * Unmet-demand opportunity in 0–100.
 *
 * Case A (demand 18, supply 11) must score above Case B (demand 3, supply 15).
 */
export function opportunityScore(demand24h: number, supply: number): number {
  const gap = demand24h - supply;
  const denom = Math.max(demand24h, supply, 1);
  const unmetRatio = clamp(gap / denom, -1, 1);
  return Math.round(clamp(50 + unmetRatio * 50, 0, 100));
}

export function interpretSupplyDemand(demand24h: number, supply: number): ZoneInterpretation {
  const gap = demand24h - supply;
  if (demand24h === 0 && supply === 0) return "IDLE";
  if (gap > 2) return "DEMAND_EXCEEDS_SUPPLY";
  if (gap < -2) return "OVERSUPPLIED";
  return "BALANCED";
}

export function scoreZone(z: ZoneScoreInputs): ZoneScoreOutputs {
  const maxRev = Math.max(1, z.maxRev);
  const maxDem = Math.max(1, z.maxDem);
  const earning = (z.revenue24h / maxRev) * 100;
  const demandScore = (z.demand24h / maxDem) * 100;
  const serviceHealth = serviceHealthScore(z.activeBookings, z.supply, z.demand24h);
  const gap = z.demand24h - z.supply;
  const opportunity = opportunityScore(z.demand24h, z.supply);
  const risk = clamp(
    demandScore - serviceHealth + (z.supply === 0 && z.demand24h > 0 ? 40 : 0),
    0,
    100,
  );
  // Opportunity-first composite. serviceHealth is NOT added — that was the inversion.
  const composite = Math.round(opportunity * 0.45 + demandScore * 0.3 + earning * 0.25);

  return {
    earningScore: Math.round(earning),
    demandScore: Math.round(demandScore),
    serviceHealth,
    riskScore: Math.round(risk),
    opportunityScore: opportunity,
    gap,
    compositeScore: composite,
    interpretation: interpretSupplyDemand(z.demand24h, z.supply),
  };
}

/**
 * Skill-level recruitment copy. Returns null when category evidence is too thin to
 * recommend hiring a specific skill — volume gap still stands on its own.
 */
export function skillGapRecommendation(
  zoneName: string,
  volumeGap: number,
  skillGaps: SkillGap[],
): string | null {
  if (volumeGap <= 0) return null;
  const evidenced = skillGaps.filter((s) => s.demand >= 3 && s.gap > 0);
  if (evidenced.length === 0) {
    return `Demand exceeds supply by ${volumeGap} in ${zoneName}. Skill-level recruitment is not recommended until category data is sufficient.`;
  }
  const top = [...evidenced].sort((a, b) => b.gap - a.gap)[0];
  return `Acquire ${top.gap} ${top.skill} in ${zoneName}`;
}
