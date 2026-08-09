import type { ApiResponse } from "@/types/partner";

export class PartnerApiError extends Error {
  code?: string;
  status: number;
  details?: string[];

  constructor(message: string, status: number, code?: string, details?: string[]) {
    super(message);
    this.name = "PartnerApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof PartnerApiError) {
    if (error.details?.length) return error.details.join(". ");
    return error.message;
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
                : body.error === "LEDGER_UNBALANCED"
                  ? "Could not finalize earnings for this job. Please try again or contact support."
                  : body.code === "SMS_DELIVERY_FAILED"
                  ? "Could not send SMS to this number. Check the number or try again."
                  : body.code === "INSUFFICIENT_BALANCE"
                ? "Wallet balance is too low for this withdrawal."
                : "Request failed.");

  // Backend sends field-level details as objects ({ field, message }); flatten
  // them to message strings so they render as text (not "[object Object]").
  const details = Array.isArray(body.details)
    ? body.details
        .map((d) => (typeof d === "string" ? d : d?.message ?? ""))
        .filter((m): m is string => m.length > 0)
    : undefined;

  return new PartnerApiError(message, status, body.code, details);
}
