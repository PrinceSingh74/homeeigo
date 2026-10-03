import type { PartnerLeadStatus } from "@prisma/client";

/** Valid lead lifecycle transitions — server-side only. */
const TRANSITIONS: Record<PartnerLeadStatus, PartnerLeadStatus[]> = {
  NEW: ["CONTACTED", "INTERESTED", "APPLICATION_STARTED", "DUPLICATE", "INVALID", "DORMANT"],
  CONTACTED: ["INTERESTED", "APPLICATION_STARTED", "DORMANT", "INVALID", "WITHDRAWN", "DUPLICATE"],
  INTERESTED: ["APPLICATION_STARTED", "CONTACTED", "DORMANT", "WITHDRAWN", "DUPLICATE"],
  APPLICATION_STARTED: ["APPLICATION_SUBMITTED", "KYC_PENDING", "WITHDRAWN", "DORMANT"],
  APPLICATION_SUBMITTED: ["KYC_PENDING", "VERIFICATION", "REJECTED", "WITHDRAWN"],
  KYC_PENDING: ["VERIFICATION", "APPLICATION_SUBMITTED", "REJECTED", "WITHDRAWN"],
  VERIFICATION: ["TRAINING", "APPROVED", "REJECTED", "KYC_PENDING"],
  TRAINING: ["APPROVED", "VERIFICATION", "REJECTED"],
  APPROVED: ["ACTIVATED", "REJECTED", "DORMANT"],
  ACTIVATED: ["DORMANT"],
  DORMANT: ["CONTACTED", "INTERESTED", "APPLICATION_STARTED", "DUPLICATE"],
  REJECTED: [],
  DUPLICATE: [],
  INVALID: [],
  WITHDRAWN: [],
};

const TERMINAL: PartnerLeadStatus[] = ["REJECTED", "DUPLICATE", "INVALID", "WITHDRAWN"];

export function canTransitionLead(from: PartnerLeadStatus, to: PartnerLeadStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertLeadTransition(from: PartnerLeadStatus, to: PartnerLeadStatus): void {
  if (!canTransitionLead(from, to)) {
    throw new Error(`INVALID_TRANSITION:Cannot move lead from ${from} to ${to}`);
  }
}

export function isTerminalLeadStatus(status: PartnerLeadStatus): boolean {
  return TERMINAL.includes(status);
}

export function getAllowedLeadTransitions(from: PartnerLeadStatus): PartnerLeadStatus[] {
  return TRANSITIONS[from] ?? [];
}

/** Map provider registration milestones to lead status. */
export function leadStatusForRegistrationStep(step: string): PartnerLeadStatus | null {
  switch (step) {
    case "application_started":
      return "APPLICATION_STARTED";
    case "application_submitted":
      return "APPLICATION_SUBMITTED";
    case "kyc_pending":
      return "KYC_PENDING";
    case "verification":
      return "VERIFICATION";
    case "training":
      return "TRAINING";
    case "approved":
      return "APPROVED";
    case "activated":
      return "ACTIVATED";
    default:
      return null;
  }
}

export const ONBOARDING_STEPS = [
  "account",
  "otp",
  "services",
  "profile",
  "skills",
  "location",
  "availability",
  "kyc",
  "documents",
  "background",
  "assessment",
  "training",
  "review",
  "submit",
] as const;

export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

export const ONBOARDING_STEP_LABELS: Record<OnboardingStep, string> = {
  account: "Account",
  otp: "Phone verification",
  services: "Services",
  profile: "Profile",
  skills: "Skills",
  location: "Location",
  availability: "Availability",
  kyc: "KYC",
  documents: "Documents",
  background: "Background verification",
  assessment: "Skill assessment",
  training: "Training",
  review: "Review",
  submit: "Submit",
};

export function onboardingStepLabel(step: string): string {
  return ONBOARDING_STEP_LABELS[step as OnboardingStep] ?? step.replace(/_/g, " ");
}

/** Remove target step and all later steps from completed list (admin request-changes rewind). */
export function rewindCompletedSteps(completedSteps: string[], targetStep: OnboardingStep): string[] {
  const targetIdx = ONBOARDING_STEPS.indexOf(targetStep);
  if (targetIdx <= 0) return completedSteps.filter((s) => s === "account" || s === "otp");
  const keep = new Set(ONBOARDING_STEPS.slice(0, targetIdx));
  return completedSteps.filter((s) => keep.has(s as OnboardingStep));
}

/** Map onboarding step to lead CRM status when applicant is sent back. */
/**
 * Maps an onboarding step to the lead status that step implies.
 *
 * Takes `string`, not `OnboardingStep`, because the function is deliberately TOTAL: anything it
 * does not recognise falls through to APPLICATION_SUBMITTED, and its only real caller
 * (`syncFromProviderDecision`) receives `metadata.targetStep` as a free-form string off a request.
 * That caller previously bridged the gap with `as never`, which claimed the value had been checked
 * when nothing had checked it. Declaring the real input type states the contract that already
 * holds, and the documented fallback stays the documented fallback.
 */
export function leadStatusForOnboardingStep(step: string): PartnerLeadStatus {
  if (["account", "otp", "services", "profile", "skills", "location", "availability"].includes(step)) {
    return "APPLICATION_STARTED";
  }
  if (step === "kyc" || step === "documents") return "KYC_PENDING";
  if (step === "background" || step === "assessment") return "VERIFICATION";
  if (step === "training") return "TRAINING";
  return "APPLICATION_SUBMITTED";
}

export function onboardingProgress(completedSteps: string[]): {
  currentStep: OnboardingStep;
  percentComplete: number;
  completed: OnboardingStep[];
  remaining: OnboardingStep[];
} {
  const completed = ONBOARDING_STEPS.filter((s) => completedSteps.includes(s));
  const remaining = ONBOARDING_STEPS.filter((s) => !completedSteps.includes(s));
  const currentStep = remaining[0] ?? "submit";
  const percentComplete = Math.round((completed.length / ONBOARDING_STEPS.length) * 100);
  return { currentStep, percentComplete, completed, remaining };
}
