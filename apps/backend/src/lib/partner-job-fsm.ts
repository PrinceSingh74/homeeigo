/**
 * Partner OS job axis. BookingStatus / timestamps persist; this machine is the
 * partner-facing job state. Earnings live on the finance axis — job COMPLETED
 * is a gate that may post money, not a money state itself.
 */
import {
  JOB_STATES,
  PARTNER_AXIS,
  assertBelongsToAxis,
  type PartnerJobState,
} from "./partner-four-axis";

export { JOB_STATES };
export type { PartnerJobState };

/** Terminals that exist on the booking row but are not the happy-path job machine. */
export const JOB_TERMINAL_OUTCOMES = ["CANCELLED", "REJECTED"] as const;
export type JobTerminalOutcome = (typeof JOB_TERMINAL_OUTCOMES)[number];

export type JobAxisState = PartnerJobState | JobTerminalOutcome;

const TRANSITIONS: Record<PartnerJobState, PartnerJobState[]> = {
  OFFERED: ["ACCEPTED"],
  ACCEPTED: ["EN_ROUTE"],
  EN_ROUTE: ["ARRIVED"],
  ARRIVED: ["STARTED"],
  STARTED: ["IN_PROGRESS"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
};

export function canTransitionJob(from: PartnerJobState, to: PartnerJobState): boolean {
  if (from === to) return true;
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertJobTransition(from: PartnerJobState, to: PartnerJobState): void {
  assertBelongsToAxis(PARTNER_AXIS.JOB, from);
  assertBelongsToAxis(PARTNER_AXIS.JOB, to);
  if (!canTransitionJob(from, to)) {
    const err = new Error(`INVALID_TRANSITION:Cannot move job from ${from} to ${to}`);
    (err as Error & { code?: string }).code = "INVALID_TRANSITION";
    throw err;
  }
}

export function getAllowedJobTransitions(from: PartnerJobState): PartnerJobState[] {
  return TRANSITIONS[from] ?? [];
}

export type JobPhaseInput = {
  status: string;
  enRouteAt?: Date | string | null;
  arrivedAt?: Date | string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  startOtpVerifiedAt?: Date | string | null;
};

function hasTs(v: Date | string | null | undefined): boolean {
  return v != null && String(v).length > 0;
}

export function isJobTerminalOutcome(state: string): state is JobTerminalOutcome {
  return state === "CANCELLED" || state === "REJECTED";
}

/**
 * Project booking persistence onto the job axis. PENDING/ASSIGNED are booking
 * vocabulary and collapse here (PENDING → OFFERED, ASSIGNED → ACCEPTED).
 */
export function deriveJobState(job: JobPhaseInput): JobAxisState {
  const status = String(job.status).toUpperCase();
  if (status === "REJECTED") return "REJECTED";
  if (status === "CANCELLED_BY_USER" || status === "CANCELLED_BY_PROVIDER" || status === "CANCELLED") {
    return "CANCELLED";
  }
  if (status === "COMPLETED" || hasTs(job.completedAt)) return "COMPLETED";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  if (hasTs(job.startedAt) || (hasTs(job.startOtpVerifiedAt) && hasTs(job.arrivedAt))) return "STARTED";
  if (hasTs(job.arrivedAt)) return "ARRIVED";
  if (status === "EN_ROUTE" || hasTs(job.enRouteAt)) return "EN_ROUTE";
  if (status === "ACCEPTED" || status === "ASSIGNED") return "ACCEPTED";
  return "OFFERED";
}

export function isHappyPathJob(state: JobAxisState): state is PartnerJobState {
  return (JOB_STATES as readonly string[]).includes(state);
}
