import type { ApiResponse } from "@/types/partner";

export class PartnerApiError extends Error {
  code?: string;
  status: number;
  details?: string[];
  retryAfter?: number;
  /** The refusal's `data` block, when the server sent one (e.g. `{ verdictId }` on a §10 refusal). */
  data?: unknown;

  constructor(message: string, status: number, code?: string, details?: string[], retryAfter?: number, data?: unknown) {
    super(message);
    this.name = "PartnerApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
    this.data = data;
  }
}

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof PartnerApiError) {
    if (error.details?.length) {
      const useful = error.details.filter((d) => !/^(Expected |Invalid type)/i.test(d));
      if (useful.length) return useful.join(". ");
    }
    return error.message === "Validation error"
      ? "Could not save that action. Please try again."
      : error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export function parseApiError<T>(body: ApiResponse<T>, status: number): PartnerApiError {
  const generic500 =
    status >= 500 && (!body.error || body.error === "Internal Server Error")
      ? "Server error. Please retry in a moment."
      : null;

  const message =
    generic500 ||
    body.error ||
    (body.code === "FORBIDDEN"
      ? "You don't have permission to do this."
      : body.code === "UNAUTHORIZED"
        ? "Session expired. Please sign in again."
        : body.code === "RATE_LIMIT_EXCEEDED"
          ? "Too many attempts. Please wait and try again."
          : body.code === "INVALID_CREDENTIALS"
            ? "Invalid email or password."
            : body.code === "INVALID_STATUS"
              ? "This booking can't change state right now."
              : body.code === "NOT_FOUND"
                ? "This request expired or was reassigned — refresh for new jobs."
                : body.code === "OUTSIDE_SERVICE_AREA"
                  ? "You're outside the job area — move closer to the service location and try again."
                  : body.code === "STALE_LOCATION"
                  ? "Your GPS is outdated. Enable location and try Accept again."
                : body.code === "STALE_PRESENCE"
                  ? "Go online, wait a few seconds, then try Accept again."
                : body.code === "LOCATION_INVALID" || body.code === "LOCATION_REQUIRED"
                    ? "Valid GPS is required — enable location, move outdoors, and retry."
                : body.error === "LEDGER_UNBALANCED"
                  ? "Could not finalize earnings for this job. Please try again or contact support."
                  : body.code === "SMS_DELIVERY_FAILED"
                  ? "Could not send SMS to this number. Check the number or try again."
                  : body.code === "INSUFFICIENT_BALANCE"
                ? "Wallet balance is too low for this withdrawal."
                // Phase 10 §10 — complete-flow refusals. The server normally sends its own human
                // message in body.error; these are the fallback so the code never surfaces raw.
                : body.code === "QUALITY_PROOF_REQUIRED"
                  ? "Required job proof is missing — add the photos before completing."
                : body.code === "QUALITY_CHECKLIST_REQUIRED"
                  ? "Complete the service checklist before finishing this job."
                : body.code === "SAFETY_HOLD_ACTIVE"
                  ? "Work is on safety hold — it cannot be completed until the safety team clears it."
                : body.code === "EXECUTION_GATE_BLOCKED"
                  ? "Finish the required work steps before completing this job."
                : body.code === "QUALITY_VERDICT_BLOCKED"
                  ? "The quality check refused completion — see the Quality panel for what to fix."
                : "Request failed.");

  // Backend sends field-level details as objects ({ field, message }); flatten
  // them to message strings so they render as text (not "[object Object]").
  const details = Array.isArray(body.details)
    ? body.details
        .map((d) => (typeof d === "string" ? d : d?.message ?? ""))
        .filter((m): m is string => m.length > 0)
    : undefined;

  const retryAfter =
    typeof body.retryAfter === "number" && Number.isFinite(body.retryAfter) && body.retryAfter > 0
      ? body.retryAfter
      : undefined;

  return new PartnerApiError(message, status, body.code, details, retryAfter, body.data);
}
