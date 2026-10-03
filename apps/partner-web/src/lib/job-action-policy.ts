/**
 * Thin client mirror of backend `getAvailableJobActions`.
 * Prefer GET /api/bookings/:id/actions when the job is open; use this for
 * optimistic local CTAs from list-cache timestamps until that fetch returns.
 *
 * Job stage is never a finance state. COMPLETED is job; EARNING_POSTED is money.
 */
import type { JobAction, JobActionResult, JobLifecycleStage, PartnerBooking } from "@/types/partner";

export type { JobAction, JobActionResult, JobLifecycleStage };

/** The server's (apps/backend/src/lib/job-action-policy.ts) wording for the start-PIN gate. */
export const START_OTP_REASON = "Customer OTP required";

type JobActionInput = {
  status: string;
  enRouteAt?: string | null;
  arrivedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  paymentStatus?: string | null;
  startOtpVerifiedAt?: string | null;
  /** §6: the server's START requirement gate (from /actions). A client mirror has no value for it. */
  requirementGate?: { ok: boolean; blocking: number; message: string } | null;
  /** §9: the server's safety gate (from /actions) — an ACTIVE hold or open incident refuses START and COMPLETE. */
  safetyGate?: { ok: boolean; blocking: number; message: string } | null;
  /** The server's payment exemption (list row or /actions): fee-waived rework / revisit or audited override. */
  paymentExempt?: boolean;
};

const RETURNED_PAYMENT = new Set(["REFUNDED", "REFUNDING", "EXPIRED"]);

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
  // Read BEFORE any timestamp. A CUSTOMER_NO_SHOW row still carries the `arrivedAt` that produced
  // it, so without this it derived as ARRIVED and this mirror offered "Start service" on a booking
  // that was already closed and settled; EXPIRED fell through to OFFERED and offered Accept on a
  // released slot. Mirrors the backend list of the same name.
  if (status === "EXPIRED" || status === "CUSTOMER_NO_SHOW" || status === "PROVIDER_NO_SHOW") {
    return status as JobLifecycleStage;
  }
  if (status === "COMPLETED" || hasTs(job.completedAt)) return "COMPLETED";
  if (status === "IN_PROGRESS") return "IN_PROGRESS";
  // Mirror of backend partner-job-fsm (§6): a verified PIN is not a started job.
  if (hasTs(job.startedAt)) return "STARTED";
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
    !job.paymentStatus ||
    String(job.paymentStatus).toUpperCase() === "SUCCESS" ||
    (job.paymentExempt === true && !RETURNED_PAYMENT.has(String(job.paymentStatus).toUpperCase()));
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
  } else if (requiredGates.includes("START_OTP_VERIFIED")) {
    disabledReasons.START_SERVICE = START_OTP_REASON;
  }

  // §6 (mirror of backend job-action-policy): a blocked requirement gate disables START with the
  // server's sentence; payment still wins. The server refuses the start regardless of the button.
  if (job.requirementGate && !job.requirementGate.ok && availableActions.includes("START_SERVICE")) {
    requiredGates.push("REQUIREMENTS_RESOLVED");
    if (paymentOk) disabledReasons.START_SERVICE = job.requirementGate.message;
  }
  // §9 (mirror): a safety hold wins over everything; the server refuses START and COMPLETE while it stands.
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

/** Map primary action → existing timestamp-gated CTA key used by cards/dashboard. */
export function primaryActionToLocalCta(
  primary: JobAction | null,
): "en_route" | "arrived" | "start" | "complete" | "accept" | null {
  switch (primary) {
    case "ACCEPT":
      return "accept";
    case "START_NAVIGATION":
      return "en_route";
    case "MARK_ARRIVED":
      return "arrived";
    case "START_SERVICE":
      return "start";
    case "COMPLETE_SERVICE":
      return "complete";
    default:
      return null;
  }
}

export function localActionsFromBooking(booking: PartnerBooking): JobActionResult {
  return getAvailableJobActions(booking);
}

/**
 * The card's primary button: which action, whether it is disabled and why. X-60 (browser, 2026-09-29):
 * the card chose the button from the policy but never applied its disabled reason, so a job on safety
 * hold still offered an enabled "Start job" (the server refused it). A reason always disables.
 */
export function primaryControlState(policy: JobActionResult): { action: JobAction | null; disabled: boolean; reason: string | null } {
  const action = policy.primaryAction;
  const raw = action ? (policy.disabledReasons[action] ?? null) : null;
  // The OTP gate is satisfied BY this button (it opens the PIN dialog) — it never disables it. Same rule
  // as the partner app (homigo-partner-mobile/src/lib/job-action-policy.ts).
  const reason = action === "START_SERVICE" && raw === START_OTP_REASON ? null : raw;
  return { action, disabled: reason !== null, reason };
}
