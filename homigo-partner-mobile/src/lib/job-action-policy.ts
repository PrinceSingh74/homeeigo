/**
 * Client mirror of the backend's `getAvailableJobActions`
 * (apps/backend/src/lib/job-action-policy.ts + partner-job-fsm.ts `deriveJobState`).
 *
 * Use `GET /api/bookings/:id/actions` when the job is open — it is the authority, and only it knows
 * the requirement gate, the safety gate, the payment exemption, whether the start PIN is verified
 * and the no-show preview. This mirror renders CTAs from a cached row until that answer arrives; it
 * is not a second state machine. Pure: no imports, so it runs under `node --test`, and
 * apps/backend/src/__tests__/job-action-mirror-parity.test.ts reads this file's TEXT to keep the
 * three copies (backend, partner web, this) agreeing on terminal statuses and actions.
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
  | "UPLOAD_EVIDENCE"
  | "REPORT_NO_SHOW";

export type JobLifecycleStage =
  | "OFFERED"
  | "ACCEPTED"
  | "EN_ROUTE"
  | "ARRIVED"
  | "STARTED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED"
  | "REJECTED"
  | "EXPIRED"
  | "CUSTOMER_NO_SHOW"
  | "PROVIDER_NO_SHOW";

/** The server-computed gate summaries carried by `/actions`. */
export type JobGateSummary = { ok: boolean; blocking: number; message: string };

/** What the policy answers — the same five fields as the backend's `JobActionResult`. */
export type JobActionPolicy = {
  stage: JobLifecycleStage;
  availableActions: JobAction[];
  primaryAction: JobAction | null;
  /** "PAYMENT_SETTLED" | "START_OTP_VERIFIED" | "REQUIREMENTS_RESOLVED" | "SAFETY_CLEARED" */
  requiredGates: string[];
  disabledReasons: Partial<Record<JobAction, string>>;
};

export type JobActionInput = {
  /** Wire (`"en_route"`) or enum (`"EN_ROUTE"`) form. */
  status: string;
  enRouteAt?: string | null;
  arrivedAt?: string | null;
  /** The booked time: the no-show wait runs from the later of this and the arrival. */
  scheduledDate?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  paymentStatus?: string | null;
  /**
   * Whether the customer's start PIN has been verified. The booking payload never carries this
   * (`startOtpVerifiedAt` is not serialised to a partner); the only source is the server's
   * `/actions` answer — pass `!requiredGates.includes("START_OTP_VERIFIED")` from it. Left out, the
   * PIN counts as not verified, which is what a cached row can honestly say.
   */
  startOtpVerified?: boolean;
  /** §6: the server's START requirement gate (from /actions). A client mirror has no value for it. */
  requirementGate?: JobGateSummary | null;
  /** §9: the server's safety gate (from /actions) — an ACTIVE hold or open incident refuses START and COMPLETE. */
  safetyGate?: JobGateSummary | null;
  /**
   * The server's payment exemption (list row, detail or /actions): a fee-waived rework / revisit or an
   * audited admin override. Without it a rework job the server lets the partner work read "Payment
   * confirmation pending".
   */
  paymentExempt?: boolean;
  /** Injectable so tests need no real clock; screens pass nothing. */
  now?: Date;
};

/** Mirror of the backend's NO_SHOW_POLICY.graceMinutes (lib/no-show-policy.ts); the unit test reads it from there. */
export const NO_SHOW_GRACE_MINUTES = 15;

/** The server's wording for the start-PIN gate. */
export const START_OTP_REASON = "Customer OTP required";

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

/**
 * Whole minutes the customer has been waited for: since the arrival, or since the booked time when
 * the partner came early (a customer is not late for an appointment that has not begun). Null when
 * arrival is unknown or in the future; "BEFORE_APPOINTMENT" while the booked time is still ahead.
 */
function waitedMinutesSinceArrival(job: JobActionInput): number | null | "BEFORE_APPOINTMENT" {
  if (!hasTs(job.arrivedAt)) return null;
  const arrived = new Date(job.arrivedAt as string).getTime();
  if (!Number.isFinite(arrived)) return null;
  const now = (job.now ?? new Date()).getTime();
  if (now < arrived) return null;
  const booked = hasTs(job.scheduledDate) ? new Date(job.scheduledDate as string).getTime() : Number.NaN;
  if (Number.isFinite(booked) && booked > now) return "BEFORE_APPOINTMENT";
  const from = Number.isFinite(booked) ? Math.max(arrived, booked) : arrived;
  return Math.floor((now - from) / 60_000);
}

export function getAvailableJobActions(job: JobActionInput): JobActionPolicy {
  const stage = resolveStage(job);
  const status = String(job.status).toUpperCase();
  const paymentStatus = job.paymentStatus ? String(job.paymentStatus).toUpperCase() : "";
  const availableActions: JobAction[] = [];
  const disabledReasons: Partial<Record<JobAction, string>> = {};
  const requiredGates: string[] = [];

  const paymentOk = !paymentStatus || paymentStatus === "SUCCESS" || (job.paymentExempt === true && !RETURNED_PAYMENT.has(paymentStatus));
  if (!paymentOk && stage !== "CANCELLED" && stage !== "REJECTED" && stage !== "COMPLETED") {
    requiredGates.push("PAYMENT_SETTLED");
  }
  if (stage === "ARRIVED" && job.startOtpVerified !== true) {
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
      // §52: the partner is at the door. Reporting a no-show is offered here and nowhere else.
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

  // Shown from arrival but disabled until the wait has been served — the server refuses early
  // reports anyway, and the partner deserves to know how long is left.
  if (availableActions.includes("REPORT_NO_SHOW")) {
    const waited = waitedMinutesSinceArrival(job);
    if (waited === "BEFORE_APPOINTMENT") {
      disabledReasons.REPORT_NO_SHOW = "Available after the booked time";
    } else if (waited === null || waited < NO_SHOW_GRACE_MINUTES) {
      const remaining = waited === null ? NO_SHOW_GRACE_MINUTES : NO_SHOW_GRACE_MINUTES - waited;
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
    // Same words as the server. This reason does NOT disable the button — see `primaryControlState`.
    disabledReasons.START_SERVICE = START_OTP_REASON;
  }

  // §6 (mirror of backend job-action-policy): a blocked requirement gate disables START with the
  // server's sentence; payment still wins. The server refuses the start regardless of the button.
  if (job.requirementGate && !job.requirementGate.ok && availableActions.includes("START_SERVICE")) {
    requiredGates.push("REQUIREMENTS_RESOLVED");
    if (paymentOk) disabledReasons.START_SERVICE = job.requirementGate.message;
  }
  // §9 (mirror): a safety hold wins over everything. Offering Start here sent the customer a PIN for
  // a job the server would refuse to start.
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

/**
 * Whether an action is disabled, and the sentence to show. Works on this mirror's answer and on the
 * server's `/actions` answer alike. The start-PIN reason never disables START_SERVICE: that button
 * opens the PIN sheet that satisfies the gate (same rule as partner web's `primaryControlState`).
 */
export function actionControlState(
  policy: { disabledReasons: Partial<Record<JobAction, string>> },
  action: JobAction,
): { disabled: boolean; reason: string | null } {
  const raw = policy.disabledReasons[action] ?? null;
  const reason = action === "START_SERVICE" && raw === START_OTP_REASON ? null : raw;
  return { disabled: reason !== null, reason };
}

/** The primary button: which action, whether it is disabled and why. A reason always disables. */
export function primaryControlState(policy: {
  primaryAction: JobAction | null;
  disabledReasons: Partial<Record<JobAction, string>>;
}): { action: JobAction | null; disabled: boolean; reason: string | null } {
  const action = policy.primaryAction;
  if (!action) return { action: null, disabled: false, reason: null };
  return { action, ...actionControlState(policy, action) };
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
