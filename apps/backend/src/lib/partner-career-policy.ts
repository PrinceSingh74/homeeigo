/**
 * Section 06 career ladder. Thresholds are the existing badge gates in rating.service.awardBadges():
 *   trusted     → PROFESSIONAL  (10 jobs, 4.0 rating, 90% completion)
 *   expert      → EXPERT        (30 jobs, 4.5 rating, 95% completion)
 *   super_star  → ELITE         (50 jobs, 4.8 rating, 98% completion)
 * plus certification / academy for EXPERT+ and punctual (onTime≥95, 20 jobs) for ELITE.
 *
 * Levels never automatically fall. Benefits may be restricted while lifecycle is not ACTIVE
 * or compliance is restricted — that is a temporary entitlement pause, not a demotion.
 */
import { canonicalizeLifecycle } from "./partner-lifecycle-fsm";

export type PartnerCareerLevel = "STARTER" | "PROFESSIONAL" | "EXPERT" | "ELITE";

export const CAREER_POLICY_VERSION = "partner.career.v1";

export const CAREER_ORDER: PartnerCareerLevel[] = ["STARTER", "PROFESSIONAL", "EXPERT", "ELITE"];

export type CareerRequirement = {
  id: string;
  label: string;
  current: number;
  target: number;
  met: boolean;
  unit: "jobs" | "rating" | "percent" | "count";
};

export type CareerFacts = {
  completedJobs: number;
  rating: number;
  completionRate: number;
  onTimeRate: number;
  certifications: number;
  academyCompleted: number;
  complianceRestricted: boolean;
  lifecycleState: string;
};

export type CareerProgress = {
  currentLevel: PartnerCareerLevel;
  eligibleLevel: PartnerCareerLevel;
  nextLevel: PartnerCareerLevel | null;
  progressPct: number;
  remainingRequirements: CareerRequirement[];
  requirements: CareerRequirement[];
  qualificationState: "QUALIFIED" | "IN_PROGRESS" | "BENEFITS_RESTRICTED" | "GRACE_MAINTAINED";
  benefitsActive: boolean;
  careerPriorityBoost: number;
  policyVersion: typeof CAREER_POLICY_VERSION;
};

/** Matching premiumBoost already uses +4 / +8 / +12 for rating 4.0 / 4.5 / 4.8. Career reuses those steps. */
export const CAREER_PRIORITY_BOOST: Record<PartnerCareerLevel, number> = {
  STARTER: 0,
  PROFESSIONAL: 4,
  EXPERT: 8,
  ELITE: 12,
};

export function levelIndex(level: PartnerCareerLevel): number {
  return CAREER_ORDER.indexOf(level);
}

export function nextCareerLevel(level: PartnerCareerLevel): PartnerCareerLevel | null {
  const i = levelIndex(level);
  return i >= 0 && i < CAREER_ORDER.length - 1 ? CAREER_ORDER[i + 1]! : null;
}

function req(
  id: string,
  label: string,
  current: number,
  target: number,
  unit: CareerRequirement["unit"],
): CareerRequirement {
  return { id, label, current, target, met: current >= target, unit };
}

export function requirementsFor(level: PartnerCareerLevel, facts: CareerFacts): CareerRequirement[] {
  if (level === "STARTER") return [];
  if (level === "PROFESSIONAL") {
    return [
      req("jobs", "Completed jobs", facts.completedJobs, 10, "jobs"),
      req("rating", "Rating", facts.rating, 4.0, "rating"),
      req("completion", "Completion rate", facts.completionRate, 90, "percent"),
    ];
  }
  if (level === "EXPERT") {
    return [
      req("jobs", "Completed jobs", facts.completedJobs, 30, "jobs"),
      req("rating", "Rating", facts.rating, 4.5, "rating"),
      req("completion", "Completion rate", facts.completionRate, 95, "percent"),
      req("cert", "Certification or academy module", facts.certifications + facts.academyCompleted, 1, "count"),
    ];
  }
  return [
    req("jobs", "Completed jobs", facts.completedJobs, 50, "jobs"),
    req("rating", "Rating", facts.rating, 4.8, "rating"),
    req("completion", "Completion rate", facts.completionRate, 98, "percent"),
    req("ontime", "On-time rate", facts.onTimeRate, 95, "percent"),
    req("cert", "Certification or academy module", facts.certifications + facts.academyCompleted, 1, "count"),
  ];
}

export function meetsLevel(level: PartnerCareerLevel, facts: CareerFacts): boolean {
  return requirementsFor(level, facts).every((r) => r.met);
}

export function eligibleCareerLevel(facts: CareerFacts): PartnerCareerLevel {
  if (meetsLevel("ELITE", facts)) return "ELITE";
  if (meetsLevel("EXPERT", facts)) return "EXPERT";
  if (meetsLevel("PROFESSIONAL", facts)) return "PROFESSIONAL";
  return "STARTER";
}

/**
 * No automatic demotion. If eligible < current, keep current (GRACE_MAINTAINED).
 * Promotion only when eligible > current.
 */
export function resolveCareerLevel(
  current: PartnerCareerLevel,
  facts: CareerFacts,
): { nextStored: PartnerCareerLevel; promoted: boolean; demoted: boolean } {
  const eligible = eligibleCareerLevel(facts);
  if (levelIndex(eligible) > levelIndex(current)) {
    return { nextStored: eligible, promoted: true, demoted: false };
  }
  return { nextStored: current, promoted: false, demoted: false };
}

export function benefitsRestricted(facts: Pick<CareerFacts, "lifecycleState" | "complianceRestricted">): boolean {
  if (facts.complianceRestricted) return true;
  return canonicalizeLifecycle(facts.lifecycleState) !== "ACTIVE";
}

export function careerPriorityBoost(
  level: PartnerCareerLevel,
  facts: Pick<CareerFacts, "lifecycleState" | "complianceRestricted">,
): number {
  if (benefitsRestricted(facts)) return 0;
  return CAREER_PRIORITY_BOOST[level];
}

export function computeCareerProgress(current: PartnerCareerLevel, facts: CareerFacts): CareerProgress {
  const eligible = eligibleCareerLevel(facts);
  const stored = resolveCareerLevel(current, facts).nextStored;
  const next = nextCareerLevel(stored);
  const targetReqs = next ? requirementsFor(next, facts) : requirementsFor(stored, facts);
  const met = targetReqs.filter((r) => r.met).length;
  const progressPct = targetReqs.length === 0 ? 100 : Math.round((met / targetReqs.length) * 100);
  const remaining = targetReqs.filter((r) => !r.met);
  const restricted = benefitsRestricted(facts);
  const maintainsWithoutEligible = levelIndex(stored) > levelIndex(eligible);

  let qualificationState: CareerProgress["qualificationState"] = "IN_PROGRESS";
  if (restricted) qualificationState = "BENEFITS_RESTRICTED";
  else if (maintainsWithoutEligible) qualificationState = "GRACE_MAINTAINED";
  else if (!next || remaining.length === 0) qualificationState = "QUALIFIED";

  return {
    currentLevel: stored,
    eligibleLevel: eligible,
    nextLevel: next,
    progressPct,
    remainingRequirements: remaining,
    requirements: targetReqs,
    qualificationState,
    benefitsActive: !restricted,
    careerPriorityBoost: careerPriorityBoost(stored, facts),
    policyVersion: CAREER_POLICY_VERSION,
  };
}

export function promotionReason(level: PartnerCareerLevel, facts: CareerFacts): string {
  const reqs = requirementsFor(level, facts);
  return reqs.map((r) => `${r.current}${r.unit === "rating" ? "" : r.unit === "percent" ? "%" : ""} ${r.label.toLowerCase()}`).join(", ");
}

export const CAREER_BADGE_LABELS: Record<string, string> = {
  super_star: "Top Rated",
  expert: "Certified Expert",
  trusted: "Reliable Partner",
  quick_responder: "Fast Responder",
  punctual: "Punctual",
  safety_champion: "Safety Champion",
};
