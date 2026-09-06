/**
 * Section 06 partner program lifecycle FSM.
 *
 * Distinct from:
 *   - availability FSM (offline / available / paused / on_job)
 *   - job FSM (BookingStatus + timestamps)
 *   - finance FSM
 *   - PartnerLeadStatus (acquisition CRM — Section 01 remains source for lead context)
 *   - PartnerRiskReviewStatus / complianceRestricted
 *
 * ACTIVE does not mean ONLINE. SUSPENDED partners must not receive new jobs;
 * an in-progress job is not cancelled by a lifecycle transition.
 */
import {
  LIFECYCLE_STATES,
  PARTNER_AXIS,
  assertBelongsToAxis,
  type PartnerLifecycleState,
} from "./partner-four-axis";

export { LIFECYCLE_STATES };
export type { PartnerLifecycleState };

/** Persistence leftovers from the pre-lock enum. Mapped on read; never written by the FSM. */
export const LIFECYCLE_PERSISTENCE_ALIASES = {
  KYC_PENDING: "APPLIED",
  VERIFICATION: "VERIFIED",
  APPROVED: "ACTIVE",
} as const;

export type PersistedLifecycleState =
  | PartnerLifecycleState
  | keyof typeof LIFECYCLE_PERSISTENCE_ALIASES;

const TRANSITIONS: Record<PartnerLifecycleState, PartnerLifecycleState[]> = {
  APPLIED: ["VERIFIED"],
  VERIFIED: ["TRAINING", "APPLIED"],
  TRAINING: ["ACTIVE", "VERIFIED"],
  ACTIVE: ["PAUSED", "UNDER_REVIEW"],
  PAUSED: ["ACTIVE", "UNDER_REVIEW"],
  UNDER_REVIEW: ["ACTIVE", "SUSPENDED", "PAUSED"],
  SUSPENDED: ["REACTIVATED"],
  REACTIVATED: ["ACTIVE"],
};

export type LifecycleAction = "approve" | "pause" | "review" | "suspend" | "reactivate" | "advance";

/** Admin console actions map onto explicit to-states. */
export const ADMIN_LIFECYCLE_ACTIONS: Record<Exclude<LifecycleAction, "advance">, PartnerLifecycleState> = {
  approve: "ACTIVE",
  pause: "PAUSED",
  review: "UNDER_REVIEW",
  suspend: "SUSPENDED",
  reactivate: "REACTIVATED",
};

export function isLifecyclePersistenceAlias(state: string): boolean {
  return Object.prototype.hasOwnProperty.call(LIFECYCLE_PERSISTENCE_ALIASES, state);
}

export function tryCanonicalizeLifecycle(state: string): PartnerLifecycleState | null {
  const aliased = LIFECYCLE_PERSISTENCE_ALIASES[state as keyof typeof LIFECYCLE_PERSISTENCE_ALIASES];
  if (aliased) return aliased;
  if ((LIFECYCLE_STATES as readonly string[]).includes(state)) return state as PartnerLifecycleState;
  return null;
}

export function canonicalizeLifecycle(state: string): PartnerLifecycleState {
  return tryCanonicalizeLifecycle(state) ?? "APPLIED";
}

export function canTransitionLifecycle(from: string, to: string): boolean {
  if (isLifecyclePersistenceAlias(to)) return false;
  const b = tryCanonicalizeLifecycle(to);
  if (!b) return false;
  const a = canonicalizeLifecycle(from);
  if (a === b) return true;
  return TRANSITIONS[a]?.includes(b) ?? false;
}

export function assertLifecycleTransition(from: string, to: string): void {
  if (isLifecyclePersistenceAlias(to) || !tryCanonicalizeLifecycle(to)) {
    const err = new Error(`INVALID_TRANSITION:Cannot move partner lifecycle from ${from} to ${to}`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
  const a = canonicalizeLifecycle(from);
  const b = tryCanonicalizeLifecycle(to)!;
  assertBelongsToAxis(PARTNER_AXIS.LIFECYCLE, a);
  assertBelongsToAxis(PARTNER_AXIS.LIFECYCLE, b);
  if (!canTransitionLifecycle(from, to)) {
    const err = new Error(`INVALID_TRANSITION:Cannot move partner lifecycle from ${from} to ${to}`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
}

export function getAllowedLifecycleTransitions(from: string): PartnerLifecycleState[] {
  return TRANSITIONS[canonicalizeLifecycle(from)] ?? [];
}

/** New job offers — only ACTIVE. REACTIVATED must be completed to ACTIVE first. */
export function isDispatchEligibleLifecycle(state: string): boolean {
  return canonicalizeLifecycle(state) === "ACTIVE";
}

/** Going online is an availability action, gated by lifecycle — not an availability state. */
export function isLifecycleBlockingOnline(state: string): boolean {
  return !isDispatchEligibleLifecycle(state);
}

export function adminActionTarget(
  action: Exclude<LifecycleAction, "advance">,
  from: string,
): PartnerLifecycleState {
  const current = canonicalizeLifecycle(from);
  if (action === "approve") {
    if (current === "APPLIED") return "VERIFIED";
    if (current === "VERIFIED") return "TRAINING";
    if (current === "TRAINING") return "ACTIVE";
    return "ACTIVE";
  }
  if (action === "reactivate") {
    if (current === "REACTIVATED") return "ACTIVE";
    return "REACTIVATED";
  }
  return ADMIN_LIFECYCLE_ACTIONS[action];
}

export const LIFECYCLE_ONBOARDING_PATH: PartnerLifecycleState[] = [
  "APPLIED",
  "VERIFIED",
  "TRAINING",
  "ACTIVE",
];

/**
 * Derive a lifecycle from existing Provider flags when the column was just backfilled
 * or a caller has not yet gone through the FSM. Used as a read-model fallback only —
 * writes always go through assertLifecycleTransition.
 */
export function deriveLifecycleFromFlags(input: {
  isApproved: boolean;
  isActive: boolean;
  isBanned: boolean;
  registrationStatus: string;
  leadStatus?: string | null;
  riskReviewStatus?: string | null;
}): PartnerLifecycleState {
  if (input.isBanned || (input.isApproved && !input.isActive)) return "SUSPENDED";
  if (input.riskReviewStatus === "REVIEW") return "UNDER_REVIEW";
  if (input.isApproved && input.isActive) return "ACTIVE";
  if (input.leadStatus === "TRAINING") return "TRAINING";
  if (input.leadStatus === "VERIFICATION" || input.leadStatus === "VERIFIED") return "VERIFIED";
  if (input.leadStatus === "KYC_PENDING") return "APPLIED";
  if (input.leadStatus === "ACTIVATED" || input.leadStatus === "APPROVED" || input.registrationStatus === "APPROVED") {
    return "ACTIVE";
  }
  return "APPLIED";
}
