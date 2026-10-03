import { devAffordancesAllowed } from "../lib/deployed-environment";
import { Prisma } from "@prisma/client";
import { Elysia } from "elysia";
import { errorResponse } from "../lib/api-response";
import { ValidationFailedError, type FieldError } from "./validation.middleware";
import { AuditLogService, requestMeta } from "../services/audit-log.service";
import { logger } from "../lib/logger";
import { observability } from "../lib/observability";
import { AppError, RateLimitError } from "../lib/app-error";
import { isPrismaPoolTimeout, isPrismaConcurrencyError, mapPrismaKnownError, mapDomainError } from "../lib/prisma-errors";
import { resolveRequestId } from "./request-context.middleware";
import { connectionFailureCode } from "../lib/connection-errors";

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
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  // Connection / reachability only — do NOT treat every Prisma query error as
  // "database unreachable" (that masked real accept/capacity/constraint failures).
  // Prisma's own wording identifies the database even when the error was re-thrown as a plain Error.
  if (
    msg.includes("can't reach database") ||
    msg.includes("cannot reach database") ||
    msg.includes("database server") ||
    msg.includes("server has closed the connection") ||
    (msg.includes("postgres") && msg.includes("connect"))
  ) {
    return true;
  }
  // A bare refused / timed-out connection names no dependency. It counts as the database only when
  // Prisma raised it; from anything else (warehouse, Redis, an HTTP upstream) it used to be answered
  // "Database is not reachable. Start Docker…" and paged as a fatal database event (X-87).
  const prismaRaised =
    error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Prisma.PrismaClientRustPanicError;
  return (
    prismaRaised &&
    (msg.includes("connect econnrefused") || msg.includes("connection refused") || msg.includes("connection timed out"))
  );
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

  // Malformed JSON / body parse failures (Elysia code PARSE) — client fault, not 500.
  if (
    code === "PARSE" ||
    (error instanceof Error && error.message === "Bad Request" && String(code) !== "VALIDATION")
  ) {
    set.status = 400;
    return errorResponse("Malformed request body", "INVALID_JSON", {
      requestId,
      suggestion: "Send valid JSON with Content-Type: application/json",
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = mapPrismaKnownError(error);
    if (mapped) {
      if (mapped.sentry) {
        observability.captureException(error, {
          requestId,
          path,
          method: request.method,
          code: mapped.code,
          category: mapped.category ?? "database",
          level: mapped.level ?? "error",
        });
      }
      set.status = mapped.status;
      return errorResponse(mapped.message, mapped.code, {
        requestId,
        ...(mapped.suggestion ? { suggestion: mapped.suggestion } : {}),
      });
    }
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError && isPrismaConcurrencyError(error)) {
    set.status = 409;
    return errorResponse("Transaction conflict — please retry", "CONFLICT", {
      requestId,
      suggestion: "Retry the request; another operation updated the same record.",
    });
  }

  if (error instanceof Error) {
    const domain = mapDomainError(error.message);
    if (domain) {
      if (domain.sentry) {
        observability.captureException(error, {
          requestId,
          path,
          method: request.method,
          code: domain.code,
          category: domain.category,
          level: domain.level ?? "error",
        });
      }
      set.status = domain.status;
      return errorResponse(domain.message, domain.code, {
        requestId,
        ...(domain.suggestion ? { suggestion: domain.suggestion } : {}),
      });
    }
  }

  if (isPrismaPoolTimeout(error)) {
    set.status = 429;
    return errorResponse(
      "Database pool busy — please retry shortly",
      "RATE_LIMIT_EXCEEDED",
      { requestId, suggestion: "Wait a moment and try again." },
    );
  }

  if (error instanceof RateLimitError) {
    set.status = 429;
    return errorResponse(error.message, error.code, {
      requestId,
      ...(error.suggestion ? { suggestion: error.suggestion } : {}),
      ...(error.meta ?? {}),
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

  // Some other dependency could not be reached (X-87). Still a 503 — the request did not fail
  // because of anything the caller sent — but it names no dependency and is not a database event.
  const connectionCode = connectionFailureCode(error);
  if (connectionCode) {
    set.status = 503;
    logger.warn("dependency_unreachable", {
      requestId,
      path,
      connectionCode,
      error: error instanceof Error ? error.message.slice(0, 200) : String(error).slice(0, 200),
    });
    observability.captureException(error, {
      requestId,
      path,
      method: request.method,
      code: "SERVICE_UNAVAILABLE",
      category: "integration",
      level: "error",
    });
    return errorResponse("A required service is temporarily unavailable.", "SERVICE_UNAVAILABLE", { requestId });
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
  // The raw message goes back only on a developer machine. It used to be gated on
  // `NODE_ENV === "production"`, and `.env.staging` ships NODE_ENV=development — so on staging every
  // unhandled 500 returned the underlying error to the caller. Measured on 2026-09-21: an
  // unauthenticated POST /api/auth/login answered with the Prisma invocation text, the absolute
  // source path of user-pii.service.ts and an excerpt of its code. The full detail is still logged
  // and sent to Sentry above; only the response is reduced.
  return errorResponse(
    devAffordancesAllowed() ? raw : "Internal server error",
    "INTERNAL_ERROR",
    { requestId },
  );
  },
);
