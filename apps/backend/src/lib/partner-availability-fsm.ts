/**
 * Partner operational FSM. Job lifecycle stays on the job axis —
 * this machine only governs partner-initiated availability actions
 * and derives the live operational state from stored flags + job phase.
 *
 * SUSPENDED is a lifecycle state. It is never an availability value.
 */
import {
  AVAILABILITY_STATES,
  type PartnerAvailabilityState,
} from "./partner-four-axis";

export type OperationalState =
  | "offline"
  | "available"
  | "offered"
  | "accepting"
  | "en_route"
  | "on_job"
  | "paused";

export const OPERATIONAL_STATES: readonly OperationalState[] = [
  "offline",
  "available",
  "offered",
  "accepting",
  "en_route",
  "on_job",
  "paused",
];

const CANONICAL_TO_STORED: Record<PartnerAvailabilityState, OperationalState> = {
  OFFLINE: "offline",
  AVAILABLE: "available",
  OFFERED: "offered",
  ACCEPTING: "accepting",
  EN_ROUTE: "en_route",
  ON_JOB: "on_job",
  PAUSED: "paused",
};

const STORED_TO_CANONICAL: Record<string, PartnerAvailabilityState> = {
  offline: "OFFLINE",
  available: "AVAILABLE",
  offered: "OFFERED",
  accepting: "ACCEPTING",
  accepting_job: "ACCEPTING",
  en_route: "EN_ROUTE",
  on_job: "ON_JOB",
  paused: "PAUSED",
  // Persistence leftover — account restriction belongs on lifecycle.
  suspended: "OFFLINE",
};

export type PartnerAvailabilityAction = "go_online" | "go_offline" | "pause" | "resume";

export const PAUSE_REASONS = ["break", "personal", "travel", "other"] as const;
export type PauseReason = (typeof PAUSE_REASONS)[number];

export type DerivedStatusInput = {
  isOnline: boolean;
  pausedAt: Date | null;
  hasInProgress: boolean;
  hasEnRoute: boolean;
  hasAccepted: boolean;
  hasOpenOffer: boolean;
  /** @deprecated Lifecycle axis. Ignored by availability derivation. */
  isBanned?: boolean;
  /** @deprecated Lifecycle axis. Ignored by availability derivation. */
  isActive?: boolean;
  /** @deprecated Lifecycle / compliance axis. Ignored by availability derivation. */
  complianceRestricted?: boolean;
};

const ALLOWED: Record<PartnerAvailabilityAction, ReadonlySet<OperationalState>> = {
  go_online: new Set(["offline"]),
  go_offline: new Set(["available", "offered", "accepting", "en_route", "on_job", "paused"]),
  pause: new Set(["available", "offered", "accepting", "en_route", "on_job"]),
  resume: new Set(["paused"]),
};

export function toCanonicalAvailability(state: string): PartnerAvailabilityState {
  return STORED_TO_CANONICAL[state] ?? (AVAILABILITY_STATES.includes(state as PartnerAvailabilityState)
    ? (state as PartnerAvailabilityState)
    : "OFFLINE");
}

export function toStoredAvailability(state: PartnerAvailabilityState): OperationalState {
  return CANONICAL_TO_STORED[state];
}

export function normalizeOperationalStatus(state: string): OperationalState {
  return toStoredAvailability(toCanonicalAvailability(state));
}

export function deriveOperationalStatus(input: DerivedStatusInput): OperationalState {
  if (input.pausedAt) return "paused";
  if (!input.isOnline) return "offline";
  if (input.hasInProgress) return "on_job";
  if (input.hasEnRoute) return "en_route";
  if (input.hasAccepted) return "accepting";
  if (input.hasOpenOffer) return "offered";
  return "available";
}

export function deriveCanonicalAvailability(input: DerivedStatusInput): PartnerAvailabilityState {
  return toCanonicalAvailability(deriveOperationalStatus(input));
}

export function canPartnerAction(action: PartnerAvailabilityAction, from: OperationalState | string): boolean {
  const stored = normalizeOperationalStatus(from);
  return ALLOWED[action].has(stored);
}

export function assertPartnerAction(action: PartnerAvailabilityAction, from: OperationalState | string): void {
  const stored = normalizeOperationalStatus(from);
  if (!ALLOWED[action].has(stored)) {
    const err = new Error(`INVALID_TRANSITION:Cannot ${action.replace("_", " ")} while ${stored.replace("_", " ")}.`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
}

export function isDispatchEligibleStatus(status: OperationalState | string): boolean {
  const stored = normalizeOperationalStatus(status);
  return stored === "available" || stored === "offered" || stored === "accepting" || stored === "en_route" || stored === "on_job";
}

export function normalizePauseReason(raw: string | undefined): PauseReason {
  const v = (raw ?? "other").trim().toLowerCase();
  return (PAUSE_REASONS as readonly string[]).includes(v) ? (v as PauseReason) : "other";
}
