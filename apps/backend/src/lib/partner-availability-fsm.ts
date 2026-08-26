/**
 * Partner operational FSM. Job lifecycle stays on BookingStatus —
 * this machine only governs partner-initiated availability actions
 * and derives the live operational state from stored flags + job phase.
 */

export const OPERATIONAL_STATES = [
  "offline",
  "available",
  "offered",
  "accepting_job",
  "en_route",
  "on_job",
  "paused",
  "suspended",
] as const;

export type OperationalState = (typeof OPERATIONAL_STATES)[number];

export type PartnerAvailabilityAction = "go_online" | "go_offline" | "pause" | "resume";

export const PAUSE_REASONS = ["break", "personal", "travel", "other"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export type DerivedStatusInput = {
  isBanned: boolean;
  isActive: boolean;
  isOnline: boolean;
  pausedAt: Date | null;
  hasInProgress: boolean;
  hasEnRoute: boolean;
  hasAccepted: boolean;
  hasOpenOffer: boolean;
};

const ALLOWED: Record<PartnerAvailabilityAction, ReadonlySet<OperationalState>> = {
  go_online: new Set(["offline"]),
  go_offline: new Set(["available", "offered", "accepting_job", "en_route", "on_job", "paused"]),
  pause: new Set(["available", "offered", "accepting_job", "en_route", "on_job"]),
  resume: new Set(["paused"]),
};

export function deriveOperationalStatus(input: DerivedStatusInput): OperationalState {
  if (input.isBanned || !input.isActive) return "suspended";
  if (input.pausedAt) return "paused";
  if (!input.isOnline) return "offline";
  if (input.hasInProgress) return "on_job";
  if (input.hasEnRoute) return "en_route";
  if (input.hasAccepted) return "accepting_job";
  if (input.hasOpenOffer) return "offered";
  return "available";
}

export function canPartnerAction(action: PartnerAvailabilityAction, from: OperationalState): boolean {
  if (from === "suspended") return false;
  return ALLOWED[action].has(from);
}

export function assertPartnerAction(action: PartnerAvailabilityAction, from: OperationalState): void {
  if (from === "suspended") {
    const err = new Error("ACCOUNT_RESTRICTED:Your account is currently unavailable for job assignments.");
    (err as Error & { code?: string }).code = "ACCOUNT_RESTRICTED";
    throw err;
  }
  if (!ALLOWED[action].has(from)) {
    const err = new Error(`INVALID_TRANSITION:Cannot ${action.replace("_", " ")} while ${from.replace("_", " ")}.`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
}

export function isDispatchEligibleStatus(status: OperationalState): boolean {
  return status === "available" || status === "offered" || status === "accepting_job" || status === "en_route" || status === "on_job";
}

export function normalizePauseReason(raw: string | undefined): PauseReason {
  const v = (raw ?? "other").trim().toLowerCase();
  return (PAUSE_REASONS as readonly string[]).includes(v) ? (v as PauseReason) : "other";
}
