import type { OnboardingStep } from "./partner-lead-state-machine";
import { ONBOARDING_STEPS, onboardingStepLabel } from "./partner-lead-state-machine";

export type ActivationCheckKey =
  | "profileComplete"
  | "kycVerified"
  | "documentsVerified"
  | "backgroundCheckComplete"
  | "trainingComplete"
  | "assessmentPassed"
  | "bankVerified"
  | "emergencyContactPresent";

export type ActivationCheckItem = {
  key: ActivationCheckKey;
  label: string;
  description: string;
  category: "profile" | "kyc" | "documents" | "verification" | "training" | "assessment";
  complete: boolean;
};

export type ActivationChecklistResult = {
  checks: Record<ActivationCheckKey, boolean>;
  items: ActivationCheckItem[];
  ready: boolean;
  missing: string[];
  missingLabels: string[];
  completedCount: number;
  totalCount: number;
  progressPercent: number;
  completedModules: number;
  requiredModules: number;
  /** Earliest onboarding step the applicant must revisit (when not ready). */
  suggestedChangeStep?: string;
  suggestedChangeStepLabel?: string;
};

type ProviderCheckInput = {
  user: { firstName: string | null; lastName?: string | null };
  panNumberHash?: string | null;
  aadharNumberHash?: string | null;
  bankAccountNumberHash?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  backgroundCheckStatus?: string | null;
  partnerBackgroundCheck?: { status: string } | null;
  documents: Array<{ isVerified: boolean }>;
  partnerAssessments: Array<{ status: string }>;
  academyProgress: Array<{ completedAt: Date | null }>;
};

const ITEM_DEFS: Array<Omit<ActivationCheckItem, "complete">> = [
  {
    key: "profileComplete",
    label: "Profile complete",
    description: "Name and core profile fields captured",
    category: "profile",
  },
  {
    key: "emergencyContactPresent",
    label: "Emergency contact",
    description: "Emergency contact name and phone on file",
    category: "profile",
  },
  {
    key: "kycVerified",
    label: "KYC submitted",
    description: "PAN or Aadhaar identity captured and validated",
    category: "kyc",
  },
  {
    key: "bankVerified",
    label: "Bank verified",
    description: "Bank account details captured for payouts",
    category: "kyc",
  },
  {
    key: "documentsVerified",
    label: "Documents verified",
    description: "At least one onboarding document approved by HQ",
    category: "documents",
  },
  {
    key: "backgroundCheckComplete",
    label: "Background check",
    description: "Background verification cleared by compliance",
    category: "verification",
  },
  {
    key: "assessmentPassed",
    label: "Skill assessment",
    description: "Required skill assessment passed",
    category: "assessment",
  },
  {
    key: "trainingComplete",
    label: "Required training",
    description: "Mandatory Academy modules completed",
    category: "training",
  },
];

const CHECK_TO_ONBOARDING_STEP: Record<ActivationCheckKey, OnboardingStep> = {
  profileComplete: "profile",
  emergencyContactPresent: "profile",
  kycVerified: "kyc",
  bankVerified: "kyc",
  documentsVerified: "documents",
  backgroundCheckComplete: "background",
  assessmentPassed: "assessment",
  trainingComplete: "training",
};

export function resolveSuggestedChangeStep(
  checks: Record<ActivationCheckKey, boolean>,
): OnboardingStep | undefined {
  const missingSteps = new Set<OnboardingStep>();
  for (const def of ITEM_DEFS) {
    if (!checks[def.key]) missingSteps.add(CHECK_TO_ONBOARDING_STEP[def.key]);
  }
  for (const step of ONBOARDING_STEPS) {
    if (missingSteps.has(step)) return step;
  }
  return undefined;
}

export function buildActivationChecklist(
  provider: ProviderCheckInput,
  requiredModules: number,
): ActivationChecklistResult {
  const completedModules = provider.academyProgress.filter((p) => p.completedAt).length;

  const checks: Record<ActivationCheckKey, boolean> = {
    profileComplete: Boolean(provider.user.firstName?.trim()),
    emergencyContactPresent: Boolean(
      provider.emergencyContactName?.trim() && provider.emergencyContactPhone?.trim(),
    ),
    kycVerified: Boolean(provider.panNumberHash || provider.aadharNumberHash),
    bankVerified: Boolean(provider.bankAccountNumberHash),
    documentsVerified: provider.documents.some((d) => d.isVerified),
    backgroundCheckComplete:
      provider.backgroundCheckStatus === "CLEARED" ||
      provider.partnerBackgroundCheck?.status === "APPROVED",
    assessmentPassed: provider.partnerAssessments.some((a) => a.status === "PASSED"),
    trainingComplete: requiredModules === 0 || completedModules >= requiredModules,
  };

  const items: ActivationCheckItem[] = ITEM_DEFS.map((def) => ({
    ...def,
    complete: checks[def.key],
  }));

  const missingLabels = items.filter((i) => !i.complete).map((i) => i.label);
  const completedCount = items.filter((i) => i.complete).length;
  const totalCount = items.length;
  const suggestedChangeStep = resolveSuggestedChangeStep(checks);

  return {
    checks,
    items,
    ready: missingLabels.length === 0,
    missing: items.filter((i) => !i.complete).map((i) => i.key),
    missingLabels,
    completedCount,
    totalCount,
    progressPercent: Math.round((completedCount / totalCount) * 100),
    completedModules,
    requiredModules,
    suggestedChangeStep,
    suggestedChangeStepLabel: suggestedChangeStep
      ? onboardingStepLabel(suggestedChangeStep)
      : undefined,
  };
}

export function assertActivationReady(result: ActivationChecklistResult): void {
  if (result.ready) return;
  throw new Error(`ACTIVATION_BLOCKED:${result.missingLabels.join("; ")}`);
}
