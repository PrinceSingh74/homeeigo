export type WebOnboardingStep =
  | "account"
  | "services"
  | "profile"
  | "location"
  | "availability"
  | "kyc"
  | "documents"
  | "assessment"
  | "training"
  | "review"
  | "submit";

export const WEB_ONBOARDING_FLOW: Array<{ id: WebOnboardingStep; label: string }> = [
  { id: "account", label: "Account" },
  { id: "services", label: "Services" },
  { id: "profile", label: "Profile" },
  { id: "location", label: "Location" },
  { id: "availability", label: "Availability" },
  { id: "kyc", label: "KYC" },
  { id: "documents", label: "Documents" },
  { id: "assessment", label: "Assessment" },
  { id: "training", label: "Training" },
  { id: "review", label: "Review" },
  { id: "submit", label: "Submitted" },
];

export type OnboardingProgressPayload = {
  currentStep: string;
  completedSteps: string[];
  percentComplete: number;
  providerId?: string | null;
  draftData?: Record<string, unknown>;
  lastSavedAt?: string | null;
  resumeLabel?: string;
  nextAction?: string;
  canResume?: boolean;
  submitted?: boolean;
  changesRequested?: boolean;
  changesRequestedStep?: string | null;
  changesRequestedNotes?: string | null;
};

function hasStep(completedSteps: string[], step: string): boolean {
  return completedSteps.includes(step);
}

export function mapCompletedToWebSteps(completedSteps: string[]): WebOnboardingStep[] {
  const done = new Set<WebOnboardingStep>();
  if (hasStep(completedSteps, "otp") || hasStep(completedSteps, "account")) done.add("account");
  if (hasStep(completedSteps, "services") || hasStep(completedSteps, "skills")) done.add("services");
  if (hasStep(completedSteps, "profile")) done.add("profile");
  if (hasStep(completedSteps, "location")) done.add("location");
  if (hasStep(completedSteps, "availability")) done.add("availability");
  if (hasStep(completedSteps, "kyc")) done.add("kyc");
  if (hasStep(completedSteps, "documents")) done.add("documents");
  if (hasStep(completedSteps, "assessment")) done.add("assessment");
  if (hasStep(completedSteps, "training")) done.add("training");
  if (hasStep(completedSteps, "review")) done.add("review");
  if (hasStep(completedSteps, "submit")) done.add("submit");
  return [...done];
}

export function mapBackendStepToWebStep(step: string): WebOnboardingStep {
  if (step === "otp" || step === "account") return "account";
  if (step === "skills" || step === "services") return "services";
  if (step === "profile") return "profile";
  if (step === "location") return "location";
  if (step === "availability") return "availability";
  if (step === "kyc") return "kyc";
  if (step === "documents") return "documents";
  if (step === "assessment" || step === "background") return "assessment";
  if (step === "training") return "training";
  if (step === "review") return "review";
  return "submit";
}

export function resolveWebOnboardingStep(
  completedSteps: string[],
  submitted?: boolean,
  changesRequestedStep?: string | null,
): WebOnboardingStep {
  if (changesRequestedStep) return mapBackendStepToWebStep(changesRequestedStep);
  if (submitted) return "submit";
  if (!hasStep(completedSteps, "otp")) return "account";
  if (!hasStep(completedSteps, "services")) return "services";
  if (!hasStep(completedSteps, "profile")) return "profile";
  if (!hasStep(completedSteps, "location")) return "location";
  if (!hasStep(completedSteps, "availability")) return "availability";
  if (!hasStep(completedSteps, "kyc")) return "kyc";
  if (!hasStep(completedSteps, "documents")) return "documents";
  if (!hasStep(completedSteps, "assessment")) return "assessment";
  if (!hasStep(completedSteps, "training")) return "training";
  if (!hasStep(completedSteps, "review")) return "review";
  return "submit";
}

export function formatLastSaved(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  if (diff < 60_000) return "Saved just now";
  if (diff < 3_600_000) return `Saved ${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `Saved ${Math.floor(diff / 3_600_000)}h ago`;
  return `Saved ${d.toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
}

export function draftSection<T extends Record<string, unknown>>(
  draftData: Record<string, unknown> | undefined,
  step: string,
): Partial<T> {
  const section = draftData?.[step];
  if (section && typeof section === "object") return section as Partial<T>;
  return {};
}

export type MobileOnboardingStep =
  | "welcome"
  | "account"
  | "otp"
  | "services"
  | "profile"
  | "location"
  | "availability"
  | "kyc"
  | "documents"
  | "assessment"
  | "training"
  | "review"
  | "done";

export function resolveMobileOnboardingStep(
  completedSteps: string[],
  submitted?: boolean,
  changesRequestedStep?: string | null,
): MobileOnboardingStep {
  if (submitted && !changesRequestedStep) return "done";
  if (changesRequestedStep) {
    const mapped = mapBackendStepToWebStep(changesRequestedStep);
    if (mapped === "submit") return "review";
    if (mapped === "account") return "account";
    return mapped;
  }
  if (!hasStep(completedSteps, "otp")) return "otp";
  if (!hasStep(completedSteps, "services")) return "services";
  if (!hasStep(completedSteps, "profile")) return "profile";
  if (!hasStep(completedSteps, "location")) return "location";
  if (!hasStep(completedSteps, "availability")) return "availability";
  if (!hasStep(completedSteps, "kyc")) return "kyc";
  if (!hasStep(completedSteps, "documents")) return "documents";
  if (!hasStep(completedSteps, "assessment")) return "assessment";
  if (!hasStep(completedSteps, "training")) return "training";
  if (!hasStep(completedSteps, "review")) return "review";
  return "done";
}
