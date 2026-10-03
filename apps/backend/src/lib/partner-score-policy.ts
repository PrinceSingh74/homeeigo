/**
 * Section 06 unified partner score — policy version partner.score.v1
 *
 * Weights are a documented redistribution of the existing city/category ranking blend
 * in partner-os.service `compositeScore()`:
 *   rating×20×0.35 + completion×0.30 + acceptance×0.20 + volume×0.15
 *
 * Rating's 35% is split into Quality (20%) and Customer Satisfaction (15%).
 * Acceptance's 20% becomes Reliability (15%) so cancellation can share the slot.
 * Volume (15%) is replaced by On-Time (10%) plus room for Compliance/Safety (10% each).
 * On-Time is 10% rather than 15% so the seven weights sum to 1.00.
 *
 * Insufficient sample → component is null (not 0). Overall score renormalizes remaining weights.
 */

export const SCORE_POLICY_VERSION = "partner.score.v1";

export const SCORE_COMPONENT_KEYS = [
  "quality",
  "reliability",
  "completion",
  "onTime",
  "customerSatisfaction",
  "compliance",
  "safety",
] as const;

export type ScoreComponentKey = (typeof SCORE_COMPONENT_KEYS)[number];

export const SCORE_WEIGHTS: Record<ScoreComponentKey, number> = {
  quality: 0.2,
  customerSatisfaction: 0.15,
  completion: 0.2,
  reliability: 0.15,
  onTime: 0.1,
  compliance: 0.1,
  safety: 0.1,
};

/** Minimum samples before a component is scored. Matches matching.service rating floor (<5 reviews → default). */
export const SCORE_SAMPLE_FLOORS = {
  ratings: 5,
  completedJobs: 5,
  arrivals: 5,
  assignments: 5,
  documents: 1,
} as const;

/**
 * Bands justified against existing badge gates (rating.service):
 * super_star ≈ 4.8×20 = 96 + 98% completion; expert ≈ 4.5×20 = 90 + 95%; trusted ≈ 4.0×20 = 80 + 90%.
 */
export const SCORE_BANDS = {
  EXCELLENT: 90,
  GOOD: 80,
  HEALTHY: 70,
  NEEDS_ATTENTION: 55,
} as const;

export type ScoreBand =
  | "EXCELLENT"
  | "GOOD"
  | "HEALTHY"
  | "NEEDS_ATTENTION"
  | "AT_RISK"
  | "INSUFFICIENT_DATA";

export type ScoreFacts = {
  rating: number;
  ratingCount: number;
  highStarCount: number;
  completedJobs: number;
  totalBookings: number;
  partnerCancellations: number;
  acceptedAssignments: number;
  totalAssignments: number;
  onTimeArrivals: number;
  arrivalsWithTracking: number;
  documentsTotal: number;
  documentsVerified: number;
  kycVerified: boolean;
  complianceRestricted: boolean;
  /** Approved safety/risk *status* only — never raw PartnerRiskSignal rows. */
  reviewStatus: "MONITOR" | "REVIEW" | "RESTRICT" | "SUSPEND" | "CLEARED" | null;
};

export type ComponentResult = {
  key: ScoreComponentKey;
  value: number | null;
  weight: number;
  appliedWeight: number;
  source: string;
  normalization: string;
  sampleSize: number;
  sampleFloor: number;
  insufficient: boolean;
};

export type ScoreExplanationReason = {
  code: string;
  component: ScoreComponentKey | "overall";
  delta: number;
  detail: string;
  evidenceCount: number;
};

export type ComputedPartnerScore = {
  policyVersion: typeof SCORE_POLICY_VERSION;
  overallScore: number | null;
  band: ScoreBand;
  components: Record<ScoreComponentKey, number | null>;
  componentDetails: ComponentResult[];
  weights: Record<ScoreComponentKey, number>;
  sampleCompletedJobs: number;
  sampleRatings: number;
  sampleArrivals: number;
  sampleAssignments: number;
};

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function scoreBand(overall: number | null, scorableComponents: number): ScoreBand {
  if (overall == null || scorableComponents < 4) return "INSUFFICIENT_DATA";
  if (overall >= SCORE_BANDS.EXCELLENT) return "EXCELLENT";
  if (overall >= SCORE_BANDS.GOOD) return "GOOD";
  if (overall >= SCORE_BANDS.HEALTHY) return "HEALTHY";
  if (overall >= SCORE_BANDS.NEEDS_ATTENTION) return "NEEDS_ATTENTION";
  return "AT_RISK";
}

function clamp100(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export function computeQuality(facts: ScoreFacts): Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization"> {
  const insufficient = facts.ratingCount < SCORE_SAMPLE_FLOORS.ratings;
  return {
    value: insufficient ? null : round1(clamp100(facts.rating * 20)),
    sampleSize: facts.ratingCount,
    insufficient,
    source: "Rating.stars weighted average (rating.service.calculateProviderRating)",
    normalization: "rating 0–5 → ×20 → 0–100 (same as compositeScore rating term)",
  };
}

export function computeCsat(facts: ScoreFacts): Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization"> {
  const insufficient = facts.ratingCount < SCORE_SAMPLE_FLOORS.ratings;
  const pct = facts.ratingCount > 0 ? (facts.highStarCount / facts.ratingCount) * 100 : 0;
  return {
    value: insufficient ? null : round1(clamp100(pct)),
    sampleSize: facts.ratingCount,
    insufficient,
    source: "Rating.stars ≥ 4 share",
    normalization: "4–5 star count / total reviews × 100 — distinct from mean rating (Quality)",
  };
}

export function computeCompletion(facts: ScoreFacts): Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization"> {
  const insufficient = facts.totalBookings < SCORE_SAMPLE_FLOORS.completedJobs;
  const pct = facts.totalBookings > 0 ? (facts.completedJobs / facts.totalBookings) * 100 : 0;
  return {
    value: insufficient ? null : round1(clamp100(pct)),
    sampleSize: facts.totalBookings,
    insufficient,
    source: "Booking status COMPLETED / all assigned bookings",
    normalization: "already 0–100 percent",
  };
}

export function computeReliability(facts: ScoreFacts): Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization"> {
  const insufficient = facts.totalAssignments < SCORE_SAMPLE_FLOORS.assignments;
  const acceptance = facts.totalAssignments > 0 ? (facts.acceptedAssignments / facts.totalAssignments) * 100 : 0;
  const cancelDenom = Math.max(facts.completedJobs + facts.partnerCancellations, 1);
  const inverseCancel = 100 - (facts.partnerCancellations / cancelDenom) * 100;
  const blended = 0.6 * acceptance + 0.4 * inverseCancel;
  return {
    value: insufficient ? null : round1(clamp100(blended)),
    sampleSize: facts.totalAssignments,
    insufficient,
    source: "AssignmentAttempt ACCEPTED share (assignment-engine) + inverse CANCELLED_BY_PROVIDER",
    normalization: "0.6×acceptanceRate + 0.4×(100−partnerCancellationRate)",
  };
}

export function computeOnTime(facts: ScoreFacts): Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization"> {
  const insufficient = facts.arrivalsWithTracking < SCORE_SAMPLE_FLOORS.arrivals;
  const pct =
    facts.arrivalsWithTracking > 0 ? (facts.onTimeArrivals / facts.arrivalsWithTracking) * 100 : 0;
  return {
    value: insufficient ? null : round1(clamp100(pct)),
    sampleSize: facts.arrivalsWithTracking,
    insufficient,
    source: "Tracking.actualArrivalTime vs Booking.scheduledDate (rating.service ON_TIME_TOLERANCE_MIN=15)",
    normalization: "on-time count / arrivals-with-tracking × 100",
  };
}

export function computeCompliance(facts: ScoreFacts): Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization"> {
  if (facts.complianceRestricted) {
    return {
      value: 25,
      sampleSize: facts.documentsTotal,
      insufficient: false,
      source: "Provider.complianceRestricted (Section 05 approved restriction)",
      normalization: "restricted accounts contribute 25/100 — data exists, not a missing-sample zero",
    };
  }
  if (facts.documentsTotal < SCORE_SAMPLE_FLOORS.documents) {
    if (facts.kycVerified) {
      return {
        value: 50,
        sampleSize: 0,
        insufficient: false,
        source: "partner-os.getCompliance — KYC verified, no documents yet",
        normalization: "existing policy returns 50 when KYC is verified and document list is empty",
      };
    }
    return {
      value: null,
      sampleSize: 0,
      insufficient: true,
      source: "ProviderDocument + User.kycStatus",
      normalization: "no documents and KYC not verified → INSUFFICIENT_DATA, not 0",
    };
  }
  return {
    value: round1(clamp100((facts.documentsVerified / facts.documentsTotal) * 100)),
    sampleSize: facts.documentsTotal,
    insufficient: false,
    source: "verified ProviderDocument / total documents (partner-os.getCompliance)",
    normalization: "verified/total × 100",
  };
}

/**
 * Safety consumes PartnerRiskReviewStatus only. OPEN incidents and raw risk signals are ignored.
 */
export function computeSafety(facts: ScoreFacts): Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization"> {
  const status = facts.reviewStatus;
  if (status === "SUSPEND") {
    return {
      value: 20,
      sampleSize: 1,
      insufficient: false,
      source: "PartnerRiskProfile.reviewStatus (approved suspend)",
      normalization: "SUSPEND → 20; signals themselves are never scored",
    };
  }
  if (status === "RESTRICT") {
    return {
      value: 50,
      sampleSize: 1,
      insufficient: false,
      source: "PartnerRiskProfile.reviewStatus (approved restrict)",
      normalization: "RESTRICT → 50",
    };
  }
  return {
    value: 100,
    sampleSize: status ? 1 : 0,
    insufficient: false,
    source: "PartnerRiskProfile.reviewStatus MONITOR/REVIEW/CLEARED/absent",
    normalization: "REVIEW is not a finding — no penalty. No profile → 100 (no approved adverse status)",
  };
}

export function computePartnerScore(facts: ScoreFacts): ComputedPartnerScore {
  const builders: Record<ScoreComponentKey, (f: ScoreFacts) => Pick<ComponentResult, "value" | "sampleSize" | "insufficient" | "source" | "normalization">> = {
    quality: computeQuality,
    reliability: computeReliability,
    completion: computeCompletion,
    onTime: computeOnTime,
    customerSatisfaction: computeCsat,
    compliance: computeCompliance,
    safety: computeSafety,
  };

  const details: ComponentResult[] = SCORE_COMPONENT_KEYS.map((key) => {
    const part = builders[key](facts);
    return {
      key,
      weight: SCORE_WEIGHTS[key],
      appliedWeight: 0,
      sampleFloor:
        key === "quality" || key === "customerSatisfaction"
          ? SCORE_SAMPLE_FLOORS.ratings
          : key === "completion"
            ? SCORE_SAMPLE_FLOORS.completedJobs
            : key === "onTime"
              ? SCORE_SAMPLE_FLOORS.arrivals
              : key === "reliability"
                ? SCORE_SAMPLE_FLOORS.assignments
                : SCORE_SAMPLE_FLOORS.documents,
      ...part,
    };
  });

  const scorable = details.filter((d) => d.value != null && !d.insufficient);
  const weightSum = scorable.reduce((s, d) => s + d.weight, 0);
  for (const d of details) {
    d.appliedWeight = d.value != null && !d.insufficient && weightSum > 0 ? round1((d.weight / weightSum) * 100) / 100 : 0;
  }

  let overall: number | null = null;
  if (scorable.length >= 4 && weightSum > 0) {
    overall = round1(scorable.reduce((s, d) => s + (d.value as number) * (d.weight / weightSum), 0));
  }

  const components = Object.fromEntries(details.map((d) => [d.key, d.value])) as Record<ScoreComponentKey, number | null>;

  return {
    policyVersion: SCORE_POLICY_VERSION,
    overallScore: overall,
    band: scoreBand(overall, scorable.length),
    components,
    componentDetails: details,
    weights: { ...SCORE_WEIGHTS },
    sampleCompletedJobs: facts.completedJobs,
    sampleRatings: facts.ratingCount,
    sampleArrivals: facts.arrivalsWithTracking,
    sampleAssignments: facts.totalAssignments,
  };
}

export function explainScoreChange(
  previous: ComputedPartnerScore | null,
  next: ComputedPartnerScore,
  evidence: { lowRatings: number; lateArrivals: number; partnerCancellations: number },
): ScoreExplanationReason[] {
  if (!previous) {
    return [
      {
        code: "INITIAL_SCORE",
        component: "overall",
        delta: next.overallScore ?? 0,
        detail: "First calculated partner score",
        evidenceCount: 0,
      },
    ];
  }
  const reasons: ScoreExplanationReason[] = [];
  for (const key of SCORE_COMPONENT_KEYS) {
    const before = previous.components[key];
    const after = next.components[key];
    if (before == null && after == null) continue;
    if (before == null && after != null) {
      reasons.push({
        code: "COMPONENT_AVAILABLE",
        component: key,
        delta: after,
        detail: `${key} now has enough sample to score`,
        evidenceCount: 0,
      });
      continue;
    }
    if (before != null && after == null) {
      reasons.push({
        code: "COMPONENT_INSUFFICIENT",
        component: key,
        delta: -before,
        detail: `${key} dropped to insufficient data`,
        evidenceCount: 0,
      });
      continue;
    }
    const delta = round1((after as number) - (before as number));
    if (Math.abs(delta) < 0.5) continue;
    let detail = `${key} ${delta > 0 ? "improved" : "declined"} by ${Math.abs(delta).toFixed(1)}`;
    let evidenceCount = 0;
    if (key === "quality" || key === "customerSatisfaction") {
      evidenceCount = evidence.lowRatings;
      if (delta < 0 && evidence.lowRatings > 0) {
        detail = `${evidence.lowRatings} low rating${evidence.lowRatings === 1 ? "" : "s"}`;
      }
    }
    if (key === "onTime") {
      evidenceCount = evidence.lateArrivals;
      if (delta < 0 && evidence.lateArrivals > 0) {
        detail = `${evidence.lateArrivals} late arrival${evidence.lateArrivals === 1 ? "" : "s"}`;
      }
    }
    if (key === "reliability" || key === "completion") {
      evidenceCount = evidence.partnerCancellations;
      if (delta < 0 && evidence.partnerCancellations > 0) {
        detail = `completion / reliability declined (${evidence.partnerCancellations} partner cancellation${evidence.partnerCancellations === 1 ? "" : "s"})`;
      }
    }
    reasons.push({
      code: delta < 0 ? "COMPONENT_DOWN" : "COMPONENT_UP",
      component: key,
      delta,
      detail,
      evidenceCount,
    });
  }
  if (reasons.length === 0) {
    reasons.push({
      code: "NO_MATERIAL_CHANGE",
      component: "overall",
      delta: round1((next.overallScore ?? 0) - (previous.overallScore ?? 0)),
      detail: "No material component change",
      evidenceCount: 0,
    });
  }
  return reasons;
}

export function snapshotKey(providerId: string, score: ComputedPartnerScore): string {
  const parts = SCORE_COMPONENT_KEYS.map((k) => `${k}:${score.components[k] ?? "na"}`).join("|");
  return `${providerId}:${score.policyVersion}:${score.overallScore ?? "na"}:${score.band}:${parts}`;
}
