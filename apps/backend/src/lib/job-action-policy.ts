import type { BookingStatus, PaymentStatus } from "@prisma/client";
import { deriveJobState, type JobAxisState } from "./partner-job-fsm";

export type JobAction =
  | "ACCEPT"
  | "DECLINE"
  | "START_NAVIGATION"
  | "MARK_ARRIVED"
  | "START_SERVICE"
  | "COMPLETE_SERVICE"
  | "CALL_CUSTOMER"
  | "OPEN_CHAT"
  | "UPLOAD_EVIDENCE";

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
};

export type JobActionResult = {
  stage: JobLifecycleStage;
  availableActions: JobAction[];
  primaryAction: JobAction | null;
  requiredGates: string[];
  disabledReasons: Partial<Record<JobAction, string>>;
};

const ACTIVE_CALL_STATUSES = new Set(["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"]);

function hasTs(v: Date | string | null | undefined): boolean {
  return v != null && String(v).length > 0;
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
    String(job.paymentStatus).toUpperCase() === "SUCCESS";
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

  if (!paymentOk) {
    for (const a of ["ACCEPT", "START_NAVIGATION", "START_SERVICE"] as JobAction[]) {
      if (availableActions.includes(a)) {
        disabledReasons[a] = "Payment confirmation pending";
      }
    }
  } else if (requiredGates.includes("START_OTP_VERIFIED")) {
    disabledReasons.START_SERVICE = "Customer OTP required";
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
