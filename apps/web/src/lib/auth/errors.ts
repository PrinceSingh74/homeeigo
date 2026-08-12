import type { ApiResponse } from "@/types/auth";

export class AuthApiError extends Error {
  code?: string;
  status: number;
  details?: string[];
  retryAfter?: number;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: string[],
    retryAfter?: number,
  ) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfter = retryAfter;
  }
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof AuthApiError) {
    if (error.details?.length) return error.details.join(". ");
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function validationMessageFromBody(body: Record<string, unknown>): string | null {
  if (body.type === "validation") {
    const errors = body.errors;
    if (Array.isArray(errors)) {
      const parts = errors
        .map((entry) => {
          if (entry && typeof entry === "object" && "message" in entry) {
            return String((entry as { message: string }).message);
          }
          return null;
        })
        .filter((m): m is string => Boolean(m));
      if (parts.length > 0) return parts.slice(0, 2).join(". ");
    }
    if (typeof body.summary === "string" && body.summary) return body.summary;
    if (typeof body.message === "string" && body.message) return body.message;
    return "Please check the form and try again.";
  }
  return null;
}

export function parseApiError<T>(body: ApiResponse<T>, status: number): AuthApiError {
  const raw = body as ApiResponse<T> & Record<string, unknown>;
  const validationMsg = validationMessageFromBody(raw);

  const generic500 =
    status >= 500 && (!body.error || body.error === "Internal Server Error")
      ? "Server error. Make sure the API and database are running, then try again."
      : null;

  const message =
    generic500 ||
    validationMsg ||
    body.error ||
    (body.code === "SERVICE_UNAVAILABLE" && body.error
      ? body.error
      : body.code === "SERVICE_UNAVAILABLE"
      ? "Service temporarily unavailable. Please try again in a moment."
      : body.code === "RATE_LIMIT_EXCEEDED"
        ? "Too many attempts. Please wait and try again."
        : body.code === "POOL_BUSY"
          ? "System busy. Please retry in a few seconds."
          : body.code === "INVALID_CREDENTIALS"
          ? "Invalid email or password."
          : body.code === "EMAIL_EXISTS"
            ? "An account with this email or phone already exists."
            : body.code === "SMS_DELIVERY_FAILED"
              ? "Could not send SMS to this number. Check the number or try again."
              : "Request failed.");
  const retryAfter =
    typeof raw.retryAfter === "number"
      ? raw.retryAfter
      : typeof raw.retryAfter === "string"
        ? Number(raw.retryAfter)
        : undefined;

  return new AuthApiError(message, status, body.code, body.details, retryAfter);
}
