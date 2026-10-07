/**
 * Why the partner is not being offered jobs, and the one thing that fixes it.
 *
 * Two server reads feed this, and they are worded differently on the server:
 *  - `GET /me/operations` → `readiness.blockers[]`: `{ code, message }` — the message is the
 *    server's own sentence and is shown unchanged;
 *  - `GET /me/dispatch-eligibility` → `reasons[]`: CODES ONLY. The server sends no sentence for
 *    them, so the wording below is this app's (the only place it words a server decision). A code
 *    this file does not know is shown as the code itself rather than guessed at.
 *
 * A reason the server already explained as a blocker is not repeated. Pure: no import.
 */
export type ReasonAction = { label: string; href: string };

export type DispatchReason = {
  code: string;
  /** The sentence to show. */
  message: string;
  /** True when `message` is the server's sentence, false when it is this app's wording of a code. */
  fromServer: boolean;
  /** Where the partner fixes it; null when nothing in the app can. */
  action: ReasonAction | null;
};

const AVAILABILITY: ReasonAction = { label: "Open availability", href: "/hq/account-availability" };
const DOCUMENTS: ReasonAction = { label: "Open documents", href: "/hq/trust-documents" };
const VERIFICATION: ReasonAction = { label: "See verification", href: "/hq/trust-verification" };
const SERVICES: ReasonAction = { label: "Open my services", href: "/hq/academy-services" };
const SUPPORT: ReasonAction = { label: "Contact support", href: "/hq/account-support" };

/** This app's wording for the eligibility CODES (the server sends no sentence for them). */
const CODE_COPY: Record<string, { message: string; action: ReasonAction | null }> = {
  NOT_FOUND: { message: "Your partner profile could not be found.", action: SUPPORT },
  NOT_ACTIVE: { message: "Your partner account is not active yet.", action: VERIFICATION },
  APPROVAL_PENDING: { message: "Your application is still being reviewed.", action: VERIFICATION },
  ACCOUNT_RESTRICTED: { message: "Your account is restricted from new jobs.", action: DOCUMENTS },
  NOT_AVAILABLE: { message: "You are offline or paused.", action: null },
  STALE_PRESENCE: { message: "The app has not checked in recently. Keep it open and connected.", action: null },
  STALE_LOCATION: { message: "Your location is out of date. Turn on location and keep the app open.", action: null },
  LOCATION_INVALID: { message: "Your phone sent a location that could not be used. Check your location settings.", action: null },
  NO_CAPACITY: { message: "You are at your job limit. Finish a job, or raise the limit in availability.", action: AVAILABILITY },
  SCHEDULE_BLOCKED: { message: "It is outside your working hours or days.", action: AVAILABILITY },
  OUTSIDE_SERVICE_AREA: { message: "You are outside your service area.", action: AVAILABILITY },
  SKILL_MISMATCH: { message: "You have no approved service to be offered jobs for.", action: SERVICES },
  RISK_BLOCKED: { message: "New jobs are on hold for your account.", action: SUPPORT },
  PAYMENT_NOT_READY: { message: "Your payout details are not ready.", action: SUPPORT },
  CONFLICT: { message: "You have another job at this time.", action: null },
};

/** Where a readiness blocker (which arrives with its own sentence) is fixed. */
const BLOCKER_ACTION: Record<string, ReasonAction | null> = {
  LIFECYCLE_NOT_ACTIVE: VERIFICATION,
  APPROVAL_PENDING: VERIFICATION,
  ACCOUNT_RESTRICTED: DOCUMENTS,
  SKILL_REQUIRED: SERVICES,
  SERVICE_AREA_REQUIRED: AVAILABILITY,
};

/** Eligibility codes that say the same thing as a readiness blocker. */
const SAME_AS_BLOCKER: Record<string, string> = {
  NOT_ACTIVE: "LIFECYCLE_NOT_ACTIVE",
  APPROVAL_PENDING: "APPROVAL_PENDING",
  ACCOUNT_RESTRICTED: "ACCOUNT_RESTRICTED",
  SKILL_MISMATCH: "SKILL_REQUIRED",
  OUTSIDE_SERVICE_AREA: "SERVICE_AREA_REQUIRED",
};

/**
 * Where a refusal of "go online" is fixed. `PUT /me/online` answers 403 ACCOUNT_RESTRICTED or 409
 * with the first readiness blocker's code; its sentence is shown as sent, and this only adds the way
 * out. Null for a code with nothing to open.
 */
export function actionForRefusal(code: string | null | undefined): ReasonAction | null {
  if (!code) return null;
  return BLOCKER_ACTION[code] ?? CODE_COPY[code]?.action ?? null;
}

export function dispatchReasons(input: {
  /** `PartnerOperations.readiness.blockers`. */
  blockers?: ReadonlyArray<{ code: string; message: string }> | null;
  /** `DispatchEligibility.reasons`; pass null / undefined when that read has not answered. */
  reasons?: ReadonlyArray<string> | null;
  /**
   * The partner chose to be offline or paused. `NOT_AVAILABLE` and the two freshness codes are then
   * just the consequence of that choice (an offline phone sends no presence), not something to fix.
   */
  offlineByChoice?: boolean;
}): DispatchReason[] {
  const out: DispatchReason[] = [];
  const seen = new Set<string>();
  for (const b of input.blockers ?? []) {
    if (!b?.code || seen.has(b.code)) continue;
    seen.add(b.code);
    out.push({ code: b.code, message: b.message || b.code, fromServer: Boolean(b.message), action: BLOCKER_ACTION[b.code] ?? null });
  }
  for (const code of input.reasons ?? []) {
    if (!code || seen.has(code)) continue;
    if (SAME_AS_BLOCKER[code] && seen.has(SAME_AS_BLOCKER[code])) continue;
    if (input.offlineByChoice && (code === "NOT_AVAILABLE" || code === "STALE_PRESENCE" || code === "STALE_LOCATION")) continue;
    seen.add(code);
    const copy = CODE_COPY[code];
    out.push({ code, message: copy?.message ?? code.replace(/_/g, " ").toLowerCase(), fromServer: false, action: copy?.action ?? null });
  }
  return out;
}
