import type { ApiResponse } from "@/types/auth";

export class AuthApiError extends Error {
  code?: string;
  status: number;
  details?: string[];

  constructor(message: string, status: number, code?: string, details?: string[]) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof AuthApiError) {
    if (error.status === 0) {
      return error.message;
    }
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

/** Backend sends details as strings OR {field,message} objects — normalize to readable strings. */
function normalizeDetails(details: unknown): string[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const parts = details
    .map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object" && "message" in entry) {
        return String((entry as { message: unknown }).message);
      }
      return null;
    })
    .filter((m): m is string => Boolean(m));
  return parts.length > 0 ? parts : undefined;
}

export function parseApiError<T>(body: ApiResponse<T>, status: number): AuthApiError {
  const raw = body as ApiResponse<T> & Record<string, unknown>;
  const validationMsg = validationMessageFromBody(raw);
  const details = normalizeDetails(raw.details);

  const generic500 =
    status >= 500 && (!body.error || body.error === "Internal Server Error")
      ? "Server error. Make sure the API and database are running, then try again."
      : null;

  const message =
    generic500 ||
    validationMsg ||
    // "Validation error" alone tells the user nothing — prefer the field messages.
    (body.error === "Validation error" && details ? details.slice(0, 2).join(". ") : null) ||
    body.error ||
    (body.code === "SERVICE_UNAVAILABLE"
      ? "Service temporarily unavailable. Please try again in a moment."
      : body.code === "RATE_LIMIT_EXCEEDED"
        ? "Too many attempts. Please wait and try again."
        : body.code === "INVALID_CREDENTIALS"
          ? "Invalid email or password."
          : body.code === "EMAIL_EXISTS"
            ? "An account with this email or phone already exists."
            : "Request failed.");
  return new AuthApiError(message, status, body.code, details);
}
