import { Prisma } from "@prisma/client";
import { Elysia } from "elysia";
import { errorResponse } from "../lib/api-response";
import { ValidationFailedError, type FieldError } from "./validation.middleware";
import { AuditLogService, requestMeta } from "../services/audit-log.service";
import { logger } from "../lib/logger";
import { observability } from "../lib/observability";
import { AppError } from "../lib/app-error";
import { resolveRequestId } from "./request-context.middleware";

/** Best-effort extraction of field-level details from an Elysia validation error. */
function extractElysiaValidationDetails(error: unknown): FieldError[] {
  const all = (error as { all?: unknown })?.all;
  if (!Array.isArray(all)) return [];
  return all
    .filter((item): item is { path?: string; message?: string } => typeof item === "object" && item !== null)
    .map((item) => ({
      field: (item.path ?? "").replace(/^\//, "").replace(/\//g, ".") || "(root)",
      message: item.message ?? "Invalid value",
    }));
}

function isDatabaseError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return ["P1000", "P1001", "P1002", "P1017"].includes(error.code);
  }
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("database") ||
      msg.includes("postgres") ||
      msg.includes("prisma") ||
      msg.includes("connect econnrefused")
    );
  }
  return false;
}

export const errorMiddleware = new Elysia({ name: "error-middleware" }).onError(
  { as: "global" },
  ({ code, error, set, request, path }) => {
  // Reuse the request's correlation id (inbound X-Request-ID / X-Correlation-ID
  // when present) so the error response matches success-path logs & headers.
  const requestId = resolveRequestId(request);
  // Surface the request id on every error response for client-side tracing.
  set.headers["X-Request-ID"] = requestId;

  // Opt-in thrown AppError → standard envelope. Strict instanceof only, so
  // framework errors (Elysia ValidationError / NotFoundError) fall through to
  // their dedicated branches below instead of being caught here.
  if (error instanceof AppError) {
    set.status = error.status;
    return errorResponse(error.message, error.code, {
      requestId,
      ...(error.details ? { details: error.details } : {}),
      ...(error.suggestion ? { suggestion: error.suggestion } : {}),
      ...(error.meta ?? {}),
    });
  }

  const maybeValidationError = error as {
    name?: string;
    message?: string;
    details?: unknown;
  };
  const hasFieldDetails =
    Array.isArray(maybeValidationError.details) &&
    maybeValidationError.details.every(
      (d) =>
        typeof d === "object" &&
        d !== null &&
        "field" in (d as Record<string, unknown>) &&
        "message" in (d as Record<string, unknown>),
    );

  if (error instanceof ValidationFailedError || maybeValidationError.name === "ValidationFailedError" || hasFieldDetails) {
    set.status = 400;
    return errorResponse("Validation error", "VALIDATION_ERROR", {
      requestId,
      details: (maybeValidationError.details as FieldError[] | undefined) ?? [],
    });
  }

  if (error instanceof Error) {
    if (error.message === "UNAUTHORIZED") {
      set.status = 401;
      void AuditLogService.failure("UNAUTHORIZED_ACCESS", { reason: path, ...requestMeta(request) });
      return errorResponse("Invalid or expired token", "UNAUTHORIZED", { requestId });
    }
    if (error.message === "FORBIDDEN") {
      set.status = 403;
      void AuditLogService.failure("FORBIDDEN_ACCESS", { reason: path, ...requestMeta(request) });
      return errorResponse("You don't have permission", "FORBIDDEN", { requestId });
    }
    if (error.message === "ACCOUNT_SUSPENDED") {
      set.status = 403;
      void AuditLogService.failure("FORBIDDEN_ACCESS", { reason: "account_suspended", ...requestMeta(request) });
      return errorResponse("Account suspended or scheduled for deletion", "ACCOUNT_SUSPENDED", { requestId });
    }
    if (error.message === "EMAIL_NOT_VERIFIED") {
      set.status = 403;
      return errorResponse("Verify your email to continue", "EMAIL_NOT_VERIFIED", { requestId });
    }
  }
  if (code === "VALIDATION") {
    set.status = 400;
    return errorResponse("Validation error", "VALIDATION_ERROR", {
      requestId,
      details: extractElysiaValidationDetails(error),
    });
  }

  // Unmatched route → standardized 404 (Elysia raises NOT_FOUND for these).
  if (code === "NOT_FOUND") {
    set.status = 404;
    return errorResponse("Endpoint not found", "NOT_FOUND", {
      requestId,
      meta: { path, method: request.method },
    });
  }

  if (isDatabaseError(error)) {
    set.status = 503;
    observability.captureException(error, {
      requestId,
      path,
      method: request.method,
      code: "SERVICE_UNAVAILABLE",
      category: "database",
      level: "fatal",
    });
    return errorResponse(
      "Database is not reachable. Start Docker, run `docker compose up -d` and `bun run db:migrate` in apps/backend.",
      "SERVICE_UNAVAILABLE",
      { requestId },
    );
  }

  set.status = 500;
  const raw = error instanceof Error ? error.message : "An error occurred. Please try again later.";
  logger.error("unhandled error", {
    requestId,
    path,
    code,
    error: raw,
    stack: error instanceof Error ? error.stack : undefined,
  });
  // Ship only genuine server faults (5xx) to Sentry — 4xx/validation/auth are
  // handled above and never reach here, so the error stream stays signal-rich.
  observability.captureException(error, {
    requestId,
    path,
    method: request.method,
    code: String(code),
    level: "error",
  });
  return errorResponse(
    process.env.NODE_ENV === "production" ? "Internal server error" : raw,
    "INTERNAL_ERROR",
    { requestId },
  );
  },
);
