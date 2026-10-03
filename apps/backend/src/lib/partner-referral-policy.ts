/**
 * Section 07 explicit policy. Qualification and reward amounts live here so
 * evaluators, APIs, and tests share one definition.
 */

/** Flat partner-network reward credited to the referrer via Section 04 finance. */
export const PARTNER_REFERRAL_REWARD_RUPEES = 500;

/** Successful completed jobs required after ACTIVE before QUALIFIED. */
export const QUALIFYING_JOB_TARGET = 3;

/** Shareable partner referral codes do not expire; invite JWT reuses Section 01 (14 days). */
export const PARTNER_REFERRAL_INVITE_TTL_DAYS = 14;

/** Burst of INVITED rows from one referrer in 24h that is a PATTERN_ABUSE signal, not auto-block. */
export const REFERRAL_BURST_SIGNAL_THRESHOLD = 8;

export const MAJOR_COMPLAINT_CATEGORIES = ["complaint", "safety", "fraud", "COMPLAINT", "SAFETY", "FRAUD"] as const;
export const MAJOR_COMPLAINT_PRIORITIES = ["high", "urgent", "critical", "HIGH", "URGENT", "CRITICAL"] as const;

export type QualificationGate = {
  key: "active" | "jobs" | "complaint" | "fraud" | "review" | "self";
  ok: boolean;
  detail: string;
};

export type QualificationEvaluation = {
  eligible: boolean;
  blocked: boolean;
  jobs: number;
  jobTarget: number;
  gates: QualificationGate[];
  blockReasons: string[];
};

export function evaluateQualificationGates(input: {
  referredLifecycleActive: boolean;
  successfulJobs: number;
  hasMajorComplaint: boolean;
  hasAuthoritativeFraudFlag: boolean;
  reviewBlocked: boolean;
  selfReferral: boolean;
}): QualificationEvaluation {
  const gates: QualificationGate[] = [
    {
      key: "active",
      ok: input.referredLifecycleActive,
      detail: input.referredLifecycleActive
        ? "Referred partner lifecycle is ACTIVE"
        : "Referred partner is not ACTIVE",
    },
    {
      key: "jobs",
      ok: input.successfulJobs >= QUALIFYING_JOB_TARGET,
      detail: `${input.successfulJobs} / ${QUALIFYING_JOB_TARGET} successful jobs`,
    },
    {
      key: "complaint",
      ok: !input.hasMajorComplaint,
      detail: input.hasMajorComplaint ? "Major complaint on file" : "No major complaint",
    },
    {
      key: "fraud",
      ok: !input.hasAuthoritativeFraudFlag,
      detail: input.hasAuthoritativeFraudFlag
        ? "Authoritative fraud/restrict flag"
        : "No authoritative fraud flag",
    },
    {
      key: "review",
      ok: !input.reviewBlocked,
      detail: input.reviewBlocked ? "Admin review blocked or held" : "Review clear",
    },
    {
      key: "self",
      ok: !input.selfReferral,
      detail: input.selfReferral ? "Self-referral" : "Not self-referral",
    },
  ];
  const blockReasons = gates.filter((g) => !g.ok).map((g) => g.detail);
  const blocked =
    input.hasMajorComplaint ||
    input.hasAuthoritativeFraudFlag ||
    input.reviewBlocked ||
    input.selfReferral;
  const eligible = gates.every((g) => g.ok);
  return {
    eligible,
    blocked,
    jobs: input.successfulJobs,
    jobTarget: QUALIFYING_JOB_TARGET,
    gates,
    blockReasons,
  };
}

export function partnerFacingQualLabel(input: {
  qualificationStatus: string;
  reviewStatus: string;
  status: string;
}): "Pending" | "Eligible" | "Blocked" | "Qualified" | "Rewarded" {
  if (input.status === "REWARD_RELEASED" || input.qualificationStatus === "REWARDED") return "Rewarded";
  if (input.status === "QUALIFIED" || input.qualificationStatus === "QUALIFIED") return "Qualified";
  if (input.reviewStatus === "BLOCKED" || input.qualificationStatus === "BLOCKED") return "Blocked";
  if (input.qualificationStatus === "ELIGIBLE") return "Eligible";
  return "Pending";
}
