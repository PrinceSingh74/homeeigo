import type { BookingStatus, PaymentStatus } from "@prisma/client";
import { deriveJobState, type JobAxisState } from "./partner-job-fsm";
import { NO_SHOW_POLICY } from "./no-show-policy";

export type JobAction =
  | "ACCEPT"
  | "DECLINE"
  | "START_NAVIGATION"
  | "MARK_ARRIVED"
  | "START_SERVICE"
  | "COMPLETE_SERVICE"
  | "CALL_CUSTOMER"
  | "OPEN_CHAT"
  | "UPLOAD_EVIDENCE"
  | "REPORT_NO_SHOW";

/** UI stage = job axis + booking terminals. Earnings are finance, never a job stage. */
export type JobLifecycleStage = JobAxisState;

export type JobActionInput = {
  status: BookingStatus | string;
  enRouteAt?: Date | string | null;
  arrivedAt?: Date | string | null;
  startedAt?: Date | string | null;
  completedAt?: Date | string | null;
  paymentStatus?: PaymentStatus | string | null;
  startOtpVerifiedAt?: Date | string | null;
  /**
   * Phase 10 §6 — the server's START requirement gate. Only the backend can supply it (it comes from
   * booking_requirement_states); a client evaluating this policy locally has no value here and must
   * treat the server's `/actions` answer as the authority.
   */
  requirementGate?: { ok: boolean; blocking: number; message: string } | null;
  /**
   * Phase 10 §9 — the server's safety gate (ACTIVE holds + open incidents). Like the requirement gate
   * only the backend can supply it; START, steps and COMPLETE are all refused while it is closed.
   */
  safetyGate?: { ok: boolean; blocking: number; message: string } | null;
  /**
   * The server's own payment exemption — an audited admin override or a §11 fee-waived follow-up
   * (see booking-payment-gate.ts). Server-computed only; never true for money that went back.
   * Without it a rework visit the server lets the partner work showed "Payment confirmation pending".
   */
  paymentExempt?: boolean;
  /** Injectable only so tests need no real clock; production passes nothing. */
  now?: Date;
};

export type JobActionResult = {
  stage: JobLifecycleStage;
  availableActions: JobAction[];
  primaryAction: JobAction | null;
  requiredGates: string[];
  disabledReasons: Partial<Record<JobAction, string>>;
};

const ACTIVE_CALL_STATUSES = new Set(["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"]);
/** Mirrors RETURNED_PAYMENT_STATUSES: no exemption survives money going back. */
const RETURNED = new Set(["REFUNDED", "REFUNDING", "EXPIRED"]);

function hasTs(v: Date | string | null | undefined): boolean {
  return v != null && String(v).length > 0;
}

/** Whole minutes since arrival, or null when arrival is unknown or recorded in the future. */
function waitedMinutesSinceArrival(job: JobActionInput): number | null {
  if (!hasTs(job.arrivedAt)) return null;
  const arrived = new Date(job.arrivedAt as Date | string).getTime();
  if (!Number.isFinite(arrived)) return null;
  const ms = (job.now ?? new Date()).getTime() - arrived;
  if (ms < 0) return null;
  return Math.floor(ms / 60_000);
}
/**
 * Pure partner/customer job-action policy from the job axis.
 * Does not own FSM transitions — only describes what UI may offer.
 * Money posting is finance-axis, triggered after COMPLETED.
 */
export function getAvailableJobActions(job: JobActionInput): JobActionResult {
  const stage = deriveJobState(job);
  const status = String(job.status).toUpperCase();
  const availableActions: JobAction[] = [];
  const disabledReasons: Partial<Record<JobAction, string>> = {};
  const requiredGates: string[] = [];

  const paymentOk =
    !job.paymentStatus ||
    String(job.paymentStatus).toUpperCase() === "SUCCESS" ||
    (job.paymentExempt === true && !RETURNED.has(String(job.paymentStatus).toUpperCase()));
  if (!paymentOk && stage !== "CANCELLED" && stage !== "REJECTED" && stage !== "COMPLETED") {
    requiredGates.push("PAYMENT_SETTLED");
  }

  if (stage === "ARRIVED" || stage === "STARTED") {
    if (!hasTs(job.startOtpVerifiedAt) && stage === "ARRIVED") {
      requiredGates.push("START_OTP_VERIFIED");
    }
  }

  switch (stage) {
    case "OFFERED":
      availableActions.push("ACCEPT", "DECLINE");
      break;
    case "ACCEPTED":
      availableActions.push("START_NAVIGATION", "CALL_CUSTOMER", "OPEN_CHAT");
      break;
    case "EN_ROUTE":
      availableActions.push("MARK_ARRIVED", "CALL_CUSTOMER", "OPEN_CHAT", "UPLOAD_EVIDENCE");
      break;
    case "ARRIVED":
      availableActions.push("START_SERVICE", "CALL_CUSTOMER", "OPEN_CHAT", "UPLOAD_EVIDENCE");
      // §52: the partner is at the door. Reporting a no-show is offered here and nowhere else,
      // because this is the only stage where the evidence the service demands actually exists.
      availableActions.push("REPORT_NO_SHOW");
      break;
    case "STARTED":
    case "IN_PROGRESS":
      availableActions.push("COMPLETE_SERVICE", "CALL_CUSTOMER", "OPEN_CHAT", "UPLOAD_EVIDENCE");
      break;
    case "COMPLETED":
      availableActions.push("OPEN_CHAT", "UPLOAD_EVIDENCE");
      break;
    default:
      break;
  }

  if (ACTIVE_CALL_STATUSES.has(status) && !availableActions.includes("CALL_CUSTOMER")) {
    availableActions.push("CALL_CUSTOMER");
  }
  if (
    ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS", "COMPLETED"].includes(status) &&
    !availableActions.includes("OPEN_CHAT")
  ) {
    availableActions.push("OPEN_CHAT");
  }

  // The button is shown from arrival but stays disabled until the wait has actually been served —
  // the server refuses early reports anyway, and a partner deserves to know how long is left
  // rather than tapping into a 400.
  if (availableActions.includes("REPORT_NO_SHOW")) {
    const waited = waitedMinutesSinceArrival(job);
    if (waited === null || waited < NO_SHOW_POLICY.graceMinutes) {
      const remaining = waited === null ? NO_SHOW_POLICY.graceMinutes : NO_SHOW_POLICY.graceMinutes - waited;
      disabledReasons.REPORT_NO_SHOW = `Available in ${remaining} min`;
    }
  }

  if (!paymentOk) {
    for (const a of ["ACCEPT", "START_NAVIGATION", "START_SERVICE"] as JobAction[]) {
      if (availableActions.includes(a)) {
        disabledReasons[a] = "Payment confirmation pending";
      }
    }
  } else if (requiredGates.includes("START_OTP_VERIFIED")) {
    disabledReasons.START_SERVICE = "Customer OTP required";
  }
  // §6: a blocked requirement gate wins over everything but payment — the OTP is pointless until the
  // preconditions are in place, and the server refuses the start regardless of what the button says.
  if (job.requirementGate && !job.requirementGate.ok && availableActions.includes("START_SERVICE")) {
    requiredGates.push("REQUIREMENTS_RESOLVED");
    if (paymentOk) disabledReasons.START_SERVICE = job.requirementGate.message;
  }
  // §9: a safety hold wins over everything — the server refuses START and COMPLETE while it stands, and
  // offering Start sent the customer a PIN for a job that could not begin.
  if (job.safetyGate && !job.safetyGate.ok) {
    for (const a of ["START_SERVICE", "COMPLETE_SERVICE"] as JobAction[]) {
      if (availableActions.includes(a)) {
        if (!requiredGates.includes("SAFETY_CLEARED")) requiredGates.push("SAFETY_CLEARED");
        disabledReasons[a] = job.safetyGate.message;
      }
    }
  }

  const primaryOrder: JobAction[] = [
    "ACCEPT",
    "START_NAVIGATION",
    "MARK_ARRIVED",
    "START_SERVICE",
    "COMPLETE_SERVICE",
  ];
  const primaryAction = primaryOrder.find((a) => availableActions.includes(a)) ?? null;

  return { stage, availableActions, primaryAction, requiredGates, disabledReasons };
}
