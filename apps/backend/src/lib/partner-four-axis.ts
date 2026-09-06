/**
 * Partner OS four-axis lock.
 *
 * Never mix these machines. Same English words may appear on more than one axis
 * (PAUSED, OFFERED, EN_ROUTE, AVAILABLE) — they are homonyms, not shared state.
 *
 *   PARTNER lifecycle
 *        │
 *        ├───────────────┐
 *        │               │
 *   AVAILABILITY        JOB
 *        │               │
 *        └───────┬───────┘
 *                │
 *             FINANCE
 *
 * Allowed coupling is gates and projections, never storage:
 *   - lifecycle ACTIVE gates new dispatch; it does not write job or money
 *   - availability OFFERED/EN_ROUTE/ON_JOB may be *derived* from job phase
 *   - job COMPLETED is the only job hop that may post finance
 *   - finance never writes lifecycle, availability, or job
 */

export const PARTNER_AXIS = {
  LIFECYCLE: "LIFECYCLE",
  AVAILABILITY: "AVAILABILITY",
  JOB: "JOB",
  FINANCE: "FINANCE",
} as const;

export type PartnerAxis = (typeof PARTNER_AXIS)[keyof typeof PARTNER_AXIS];

/** Partner program lifecycle. Not online/offline, not the live job, not money. */
export const LIFECYCLE_STATES = [
  "APPLIED",
  "VERIFIED",
  "TRAINING",
  "ACTIVE",
  "PAUSED",
  "UNDER_REVIEW",
  "SUSPENDED",
  "REACTIVATED",
] as const;
export type PartnerLifecycleState = (typeof LIFECYCLE_STATES)[number];

/**
 * Partner-initiated availability. Not account suspension (lifecycle) and not
 * the booking row (job). Persistence still uses lowercase snake_case.
 */
export const AVAILABILITY_STATES = [
  "OFFLINE",
  "AVAILABLE",
  "OFFERED",
  "ACCEPTING",
  "EN_ROUTE",
  "ON_JOB",
  "PAUSED",
] as const;
export type PartnerAvailabilityState = (typeof AVAILABILITY_STATES)[number];

/** Live job on a booking. Not partner online, not earnings. */
export const JOB_STATES = [
  "OFFERED",
  "ACCEPTED",
  "EN_ROUTE",
  "ARRIVED",
  "STARTED",
  "IN_PROGRESS",
  "COMPLETED",
] as const;
export type PartnerJobState = (typeof JOB_STATES)[number];

/** Partner money movement. Not job COMPLETED, not availability AVAILABLE. */
export const FINANCE_STATES = [
  "EARNING_POSTED",
  "PENDING",
  "AVAILABLE",
  "WITHDRAWAL_REQUESTED",
  "PROCESSING",
  "PAID",
] as const;
export type PartnerFinanceState = (typeof FINANCE_STATES)[number];

const LIFECYCLE_SET = new Set<string>(LIFECYCLE_STATES);
const AVAILABILITY_SET = new Set<string>(AVAILABILITY_STATES);
const JOB_SET = new Set<string>(JOB_STATES);
const FINANCE_SET = new Set<string>(FINANCE_STATES);

export const FOUR_AXIS_STATES = {
  LIFECYCLE: LIFECYCLE_STATES,
  AVAILABILITY: AVAILABILITY_STATES,
  JOB: JOB_STATES,
  FINANCE: FINANCE_STATES,
} as const;

/** Tokens that exist on more than one axis. Never compare them as if they were one enum. */
export const FOUR_AXIS_HOMONYMS = {
  PAUSED: [PARTNER_AXIS.LIFECYCLE, PARTNER_AXIS.AVAILABILITY],
  OFFERED: [PARTNER_AXIS.AVAILABILITY, PARTNER_AXIS.JOB],
  EN_ROUTE: [PARTNER_AXIS.AVAILABILITY, PARTNER_AXIS.JOB],
  AVAILABLE: [PARTNER_AXIS.AVAILABILITY, PARTNER_AXIS.FINANCE],
} as const;

export type FourAxisSnapshot = {
  lifecycle: PartnerLifecycleState;
  availability: PartnerAvailabilityState;
  job: PartnerJobState | null;
  finance: PartnerFinanceState | null;
};

export const FOUR_AXIS_TOPOLOGY = [
  "PARTNER.lifecycle",
  "PARTNER.lifecycle -> AVAILABILITY",
  "PARTNER.lifecycle -> JOB",
  "AVAILABILITY + JOB -> FINANCE",
] as const;

/** Dispatch / matching may only load lifecycle ACTIVE. Not APPLIED+isApproved. */
export const DISPATCH_LIFECYCLE_WHERE = { lifecycleState: "ACTIVE" as const };

export function axisOfLifecycle(state: string): PartnerAxis | null {
  return LIFECYCLE_SET.has(state) ? PARTNER_AXIS.LIFECYCLE : null;
}

export function axisOfAvailability(state: string): PartnerAxis | null {
  return AVAILABILITY_SET.has(state) ? PARTNER_AXIS.AVAILABILITY : null;
}

export function axisOfJob(state: string): PartnerAxis | null {
  return JOB_SET.has(state) ? PARTNER_AXIS.JOB : null;
}

export function axisOfFinance(state: string): PartnerAxis | null {
  return FINANCE_SET.has(state) ? PARTNER_AXIS.FINANCE : null;
}

export function homonymAxes(token: string): PartnerAxis[] {
  const hit = FOUR_AXIS_HOMONYMS[token as keyof typeof FOUR_AXIS_HOMONYMS];
  return hit ? [...hit] : [];
}

export function isHomonym(token: string): boolean {
  return homonymAxes(token).length > 1;
}

/**
 * A token may legally exist on multiple axes. It must never be copied from one
 * axis field onto another. Callers pass the *destination* axis.
 */
export function assertBelongsToAxis(axis: PartnerAxis, state: string): void {
  const ok =
    (axis === PARTNER_AXIS.LIFECYCLE && LIFECYCLE_SET.has(state)) ||
    (axis === PARTNER_AXIS.AVAILABILITY && AVAILABILITY_SET.has(state)) ||
    (axis === PARTNER_AXIS.JOB && JOB_SET.has(state)) ||
    (axis === PARTNER_AXIS.FINANCE && FINANCE_SET.has(state));
  if (!ok) {
    const err = new Error(`AXIS_MIX: ${state} is not a ${axis} state`);
    (err as Error & { code?: string }).code = "AXIS_MIX";
    throw err;
  }
}

export function assertNotCrossAxisWrite(fromAxis: PartnerAxis, toAxis: PartnerAxis): void {
  if (fromAxis === toAxis) return;
  const err = new Error(`AXIS_MIX: cannot write ${toAxis} from a ${fromAxis} mutation`);
  (err as Error & { code?: string }).code = "AXIS_MIX";
  throw err;
}
