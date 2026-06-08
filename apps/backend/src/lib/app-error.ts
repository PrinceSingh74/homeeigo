/**
 * Opt-in, throw-based error hierarchy.
 *
 * Services/routes MAY `throw new ConflictError(...)` instead of manually
 * returning `errorResponse(...)` + `set.status`. The global error middleware
 * ([error.middleware.ts]) recognises any `AppError` (duck-typed via
 * `status` + `code`) and renders it through the existing `errorResponse`
 * envelope — so the frontend contract (`success`/`error`/`code`/`details`)
 * is preserved exactly.
 *
 * Default `code` values intentionally match the strings the existing
 * frontends already switch on (UNAUTHORIZED, FORBIDDEN, NOT_FOUND,
 * CONFLICT, RATE_LIMIT_EXCEEDED, VALIDATION_ERROR, INTERNAL_ERROR) so
 * nothing regresses. Callers can override the code when they need a more
 * specific one.
 */

export type AppErrorDetail = {
  field?: string;
  message: string;
  code?: string;
};

export type AppErrorOptions = {
  code?: string;
  details?: AppErrorDetail[];
  suggestion?: string;
  meta?: Record<string, unknown>;
};

export class AppError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly details?: AppErrorDetail[];
  public readonly suggestion?: string;
  public readonly meta?: Record<string, unknown>;

  constructor(message: string, status: number, code: string, options?: Omit<AppErrorOptions, "code">) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = options?.details;
    this.suggestion = options?.suggestion;
    this.meta = options?.meta;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Narrowing helper for the error middleware. */
export function isAppError(error: unknown): error is AppError {
  return (
    error instanceof AppError ||
    (typeof error === "object" &&
      error !== null &&
      typeof (error as { status?: unknown }).status === "number" &&
      typeof (error as { code?: unknown }).code === "string" &&
      typeof (error as { message?: unknown }).message === "string")
  );
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", options?: AppErrorOptions) {
    super(message, 400, options?.code ?? "VALIDATION_ERROR", options);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Invalid or expired token", options?: AppErrorOptions) {
    super(message, 401, options?.code ?? "UNAUTHORIZED", options);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "You don't have permission", options?: AppErrorOptions) {
    super(message, 403, options?.code ?? "FORBIDDEN", options);
  }
}

export class NotFoundError extends AppError {
  constructor(resource = "Resource", options?: AppErrorOptions) {
    super(`${resource} not found`, 404, options?.code ?? "NOT_FOUND", {
      suggestion: options?.suggestion ?? `Please check if the ${resource.toLowerCase()} exists.`,
      details: options?.details,
      meta: options?.meta,
    });
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", options?: AppErrorOptions) {
    super(message, 409, options?.code ?? "CONFLICT", options);
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Rate limit exceeded", retryAfter = 60, options?: AppErrorOptions) {
    super(message, 429, options?.code ?? "RATE_LIMIT_EXCEEDED", {
      suggestion: options?.suggestion ?? `Please wait ${retryAfter} seconds before trying again.`,
      details: options?.details,
      meta: { retryAfter, ...(options?.meta ?? {}) },
    });
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error", options?: AppErrorOptions) {
    super(message, 500, options?.code ?? "INTERNAL_ERROR", options);
  }
}

/**
 * Opt-in wrapper for DB failures. Hides the underlying driver/SQL message
 * from clients (only surfaced in development via `meta.originalMessage`).
 * Note: the global error middleware also auto-detects raw Prisma connection
 * errors and maps them to 503 — this class is for handlers that want to
 * explicitly wrap a caught DB error as a 500 with a friendly message.
 */
export class DatabaseError extends AppError {
  constructor(originalError?: Error, options?: AppErrorOptions) {
    super("Database operation failed", 500, options?.code ?? "DATABASE_ERROR", {
      suggestion:
        options?.suggestion ?? "Please try again. If the problem persists, contact support.",
      details: options?.details,
      meta: {
        ...(process.env.NODE_ENV === "development" && originalError
          ? { originalMessage: originalError.message }
          : {}),
        ...(options?.meta ?? {}),
      },
    });
  }
}
