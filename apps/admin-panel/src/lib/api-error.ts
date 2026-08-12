import type { ApiResponse } from "@/types/admin";

export class AdminApiError extends Error {
  code?: string;
  status: number;
  details?: string[];

  constructor(message: string, status: number, code?: string, details?: string[]) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getErrorMessage(
  error: unknown,
  fallback = "Something went wrong. Please try again.",
): string {
  if (error instanceof AdminApiError) {
    if (error.details?.length) return error.details.join(". ");
    return error.message;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/** Contextual recovery hint for admin console load failures. */
export function getApiLoadHint(error: unknown): string | null {
  const message = getErrorMessage(error, "").toLowerCase();
  if (!message) return null;

  if (error instanceof AdminApiError && error.status === 0) {
    return "Backend API unreachable. Ensure apps/backend is running on port 3000 and set NEXT_PUBLIC_API_URL in admin-panel .env.local if needed.";
  }
  if (message.includes("database") || message.includes("docker") || message.includes("db:migrate")) {
    return "Database is down or migrations are pending. Run docker compose up -d and bun run db:migrate in apps/backend, then restart the backend once (avoid duplicate servers on port 3000).";
  }
  if (message.includes("unauthorized") || message.includes("sign in")) {
    return "Session expired. Sign out and log in again.";
  }
  if (message.includes("forbidden") || message.includes("permission")) {
    return "Your admin role may not have finance access. Ask a super-admin to grant permissions.";
  }
  return null;
}

export function parseApiError<T>(body: ApiResponse<T>, status: number): AdminApiError {
  const generic500 =
    status >= 500 && (!body.error || body.error === "Internal Server Error")
      ? "Server error. Please retry in a moment."
      : null;

  const message =
    generic500 ||
    body.error ||
    (body.code === "FORBIDDEN"
      ? "You don't have admin permissions."
      : body.code === "UNAUTHORIZED"
        ? "Session expired. Please sign in again."
        : body.code === "RATE_LIMIT_EXCEEDED"
          ? "Too many attempts. Please wait and try again."
          : body.code === "INVALID_CREDENTIALS"
            ? "Invalid email or password."
            : "Request failed.");

  return new AdminApiError(message, status, body.code, body.details);
}
