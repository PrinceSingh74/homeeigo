import { AppError, InternalError, DatabaseError } from "../lib/app-error";
import { ErrorCode } from "../types/error";

/**
 * 5xx server-error factories (Part 7C, additive, opt-in).
 *
 * Return the existing `InternalError` / `DatabaseError` (app-error.ts) →
 * rendered by the global error middleware. Aligned to the real
 * `InternalError(message, { meta })` + `DatabaseError(originalError)` signatures.
 * The underlying error message is only surfaced in development (via `meta`).
 */

function devMeta(originalError?: Error) {
  return process.env.NODE_ENV === "development" && originalError
    ? { meta: { originalMessage: originalError.message } }
    : undefined;
}

export const internalServerError = (originalError?: Error) =>
  new InternalError("Internal server error", devMeta(originalError));

/** Wraps a caught DB error as a friendly 500 (driver message hidden in prod). */
export const databaseOperationError = (originalError: Error) =>
  new DatabaseError(originalError);

export const serviceUnavailableError = (serviceName = "Service") =>
  new InternalError(`${serviceName} is temporarily unavailable. Please try again later.`, {
    code: ErrorCode.SERVICE_UNAVAILABLE,
  });

export const timeoutError = () =>
  new InternalError("Request timed out. The server took too long to respond. Please try again.", {
    code: ErrorCode.SERVICE_UNAVAILABLE,
  });

export const paymentServiceError = (originalError?: Error) =>
  new InternalError("Payment service is temporarily unavailable. Please try again later.", {
    code: ErrorCode.SERVICE_UNAVAILABLE,
    ...devMeta(originalError),
  });

export const emailServiceError = (originalError?: Error) =>
  new InternalError("Email service is temporarily unavailable. Please try again later.", {
    code: ErrorCode.SERVICE_UNAVAILABLE,
    ...devMeta(originalError),
  });

export const fileUploadError = (originalError?: Error) =>
  new InternalError("File upload failed. Please try again with a different file.", devMeta(originalError));

export const externalApiError = (service: string, originalError?: Error) =>
  new InternalError(`Failed to reach ${service}. Please try again later.`, {
    code: ErrorCode.SERVICE_UNAVAILABLE,
    ...devMeta(originalError),
  });

/**
 * Run an async op and, on failure, rethrow as a friendly InternalError
 * (preserving an already-typed AppError if one was thrown).
 */
export async function safeAsync<T>(
  fn: () => Promise<T>,
  message = "Operation failed",
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    // Preserve ANY AppError subclass (it carries its own status/code) so a
    // NotFound/Conflict/etc. thrown inside fn isn't masked as a 500.
    if (error instanceof AppError) throw error;
    throw new InternalError(message, devMeta(error instanceof Error ? error : undefined));
  }
}
