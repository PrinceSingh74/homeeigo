/**
 * Thin client mirror of partner-web / backend `getAvailableJobActions`.
 * Optimistic CTAs from list-cache timestamps — not a second FSM.
 *
 * Job stage is never a finance state. COMPLETED is job; EARNING_POSTED is money.
 */

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

export type JobLifecycleStage =
  | "OFFERED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED";

export type JobActionResult = {
  stage: JobLifecycleStage;
  availableActions: JobAction[];
  primaryAction: JobAction | null;
  requiredGates: string[];
  disabledReasons: Partial<Record<JobAction, string>>;
};

type JobActionInput = {
  status: string;
  enRouteAt?: string | null;
  arrivedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  paymentStatus?: string | null;
  startOtpVerifiedAt?: string | null;
};

const ACTIVE_CALL_STATUSES = new Set(["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"]);

function hasTs(v: string | null | undefined): boolean {
  return v != null && String(v).length > 0;
}

function resolveStage(job: JobActionInput): JobLifecycleStage {
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

export function getAvailableJobActions(job: JobActionInput): JobActionResult {
  const stage = resolveStage(job);
  const status = String(job.status).toUpperCase();
  const availableActions: JobAction[] = [];
  const disabledReasons: Partial<Record<JobAction, string>> = {};
  const requiredGates: string[] = [];

  const paymentOk =
    !job.paymentStatus || String(job.paymentStatus).toUpperCase() === "SUCCESS";
  if (!paymentOk && stage !== "CANCELLED" && stage !== "REJECTED" && stage !== "COMPLETED") {
    requiredGates.push("PAYMENT_SETTLED");
  }
  if (stage === "ARRIVED" && !hasTs(job.startOtpVerifiedAt)) {
    requiredGates.push("START_OTP_VERIFIED");
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
  }
  // START_OTP_VERIFIED is collected as a required gate for UI hints, but must NOT
  // disable START_SERVICE — that CTA opens the OTP sheet that satisfies the gate.

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

export function primaryActionLabel(primary: JobAction | null): string | null {
  switch (primary) {
    case "ACCEPT":
      return "Accept";
    case "START_NAVIGATION":
      return "On my way";
    case "MARK_ARRIVED":
      return "I've arrived";
    case "START_SERVICE":
      return "Start job";
    case "COMPLETE_SERVICE":
      return "Complete job";
    default:
      return null;
  }
}
