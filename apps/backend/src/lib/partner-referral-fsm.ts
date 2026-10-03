/**
 * Section 07 partner-referral lifecycle FSM.
 *
 * Distinct from:
 *   - PartnerLifecycleState (Section 06)
 *   - PartnerLeadStatus (Section 01)
 *   - availability FSM
 *   - BookingStatus (Section 03)
 *   - wallet / reward transaction status (Section 04)
 *
 * Frontend cannot set QUALIFIED or REWARD_RELEASED. Those hops are server-only
 * after qualification and canonical finance succeed.
 */

export type PartnerReferralStatus =
  | "INVITED"
  | "REGISTERED"
  | "VERIFIED"
  | "TRAINING"
  | "ACTIVE"
  | "FIRST_JOB"
  | "QUALIFIED"
  | "REWARD_RELEASED";

export const REFERRAL_STATUSES: PartnerReferralStatus[] = [
  "INVITED",
  "REGISTERED",
  "VERIFIED",
  "TRAINING",
  "ACTIVE",
  "FIRST_JOB",
  "QUALIFIED",
  "REWARD_RELEASED",
];

const TRANSITIONS: Record<PartnerReferralStatus, PartnerReferralStatus[]> = {
  INVITED: ["REGISTERED"],
  REGISTERED: ["VERIFIED"],
  VERIFIED: ["TRAINING"],
  TRAINING: ["ACTIVE"],
  ACTIVE: ["FIRST_JOB"],
  FIRST_JOB: ["QUALIFIED"],
  QUALIFIED: ["REWARD_RELEASED"],
  REWARD_RELEASED: [],
};

export function canTransitionReferral(from: PartnerReferralStatus, to: PartnerReferralStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertReferralTransition(from: PartnerReferralStatus, to: PartnerReferralStatus): void {
  if (!canTransitionReferral(from, to)) {
    const err = new Error(`INVALID_TRANSITION:Cannot move partner referral from ${from} to ${to}`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
}

export function getAllowedReferralTransitions(from: PartnerReferralStatus): PartnerReferralStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function nextReferralHop(from: PartnerReferralStatus): PartnerReferralStatus | null {
  return TRANSITIONS[from]?.[0] ?? null;
}

/** Terminal financial state — only after ledger + wallet succeed. */
export function isRewardReleased(status: PartnerReferralStatus): boolean {
  return status === "REWARD_RELEASED";
}

export function isQualificationLocked(status: PartnerReferralStatus): boolean {
  return status === "QUALIFIED" || status === "REWARD_RELEASED";
}
