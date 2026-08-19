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
  | "done";

function hasStep(completedSteps: string[], step: string): boolean {
  return completedSteps.includes(step);
}

export function resolveMobileOnboardingStep(
  completedSteps: string[],
  submitted?: boolean,
  changesRequestedStep?: string | null,
): MobileOnboardingStep {
  if (submitted && !changesRequestedStep) return "done";
  if (changesRequestedStep) {
    if (changesRequestedStep === "otp" || changesRequestedStep === "account") return "account";
    if (changesRequestedStep === "services" || changesRequestedStep === "skills") return "services";
    if (changesRequestedStep === "profile") return "profile";
    if (changesRequestedStep === "location") return "location";
    if (changesRequestedStep === "availability") return "availability";
    if (changesRequestedStep === "kyc") return "kyc";
    if (changesRequestedStep === "documents") return "documents";
    if (changesRequestedStep === "assessment" || changesRequestedStep === "background" || changesRequestedStep === "training") {
      return "assessment";
    }
    return "documents";
  }
  if (!hasStep(completedSteps, "otp")) return "otp";
  if (!hasStep(completedSteps, "services")) return "services";
  if (!hasStep(completedSteps, "profile")) return "profile";
  if (!hasStep(completedSteps, "location")) return "location";
  if (!hasStep(completedSteps, "availability")) return "availability";
  if (!hasStep(completedSteps, "kyc")) return "kyc";
  if (!hasStep(completedSteps, "documents")) return "documents";
  if (!hasStep(completedSteps, "assessment")) return "assessment";
  return "done";
}

export function draftSection<T extends Record<string, unknown>>(
  draftData: Record<string, unknown> | undefined,
  step: string,
): Partial<T> {
  const section = draftData?.[step];
  if (section && typeof section === "object") return section as Partial<T>;
  return {};
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

export const MOBILE_STEP_LABELS: Record<MobileOnboardingStep, string> = {
  welcome: "Welcome",
  account: "Account",
  otp: "Verification",
  services: "Services",
  profile: "Profile",
  location: "Location",
  availability: "Availability",
  kyc: "KYC",
  documents: "Documents",
  assessment: "Assessment",
  done: "Submitted",
};
