import type { UserRole } from "@prisma/client";
import { UnauthorizedError, ForbiddenError } from "../lib/app-error";
import { ErrorCode } from "../types/error";

/**
 * Typed 401/403 error factories (Part 7B, additive).
 *
 * Opt-in alternative to the existing sentinel-string pattern
 * (`throw new Error("UNAUTHORIZED" | "FORBIDDEN")` used by auth.plugin /
 * auth.middleware). These return `AppError` subclasses which the global error
 * middleware renders with richer envelopes (specific `code`, `suggestion`,
 * `requestId`, `timestamp`). Both patterns coexist — nothing is replaced.
 *
 * Role checks use the canonical Prisma `UserRole` enum casing
 * (CUSTOMER / VENDOR / ADMIN) — NOT lowercase — so they actually match
 * real user roles.
 */

/* ── 401 Unauthorized ─────────────────────────────────────────────── */

export const noTokenError = () =>
  new UnauthorizedError("No authentication token provided", {
    code: ErrorCode.NO_TOKEN,
    suggestion: "Include your token as: Authorization: Bearer <token>.",
  });

export const invalidTokenError = () =>
  new UnauthorizedError("Invalid or malformed token", {
    code: ErrorCode.INVALID_TOKEN,
    suggestion: "Send a valid token: Authorization: Bearer <token>.",
  });

export const tokenExpiredError = () =>
  new UnauthorizedError("Authentication token has expired", {
    code: ErrorCode.TOKEN_EXPIRED,
    suggestion: "Login again, or refresh via POST /api/auth/refresh.",
  });

export const invalidCredentialsError = () =>
  new UnauthorizedError("Invalid email or password", {
    code: ErrorCode.INVALID_CREDENTIALS,
    suggestion: "Check your email and password, then try again.",
  });

export const sessionExpiredError = () =>
  new UnauthorizedError("Your session has expired", {
    code: ErrorCode.SESSION_EXPIRED,
    suggestion: "Please login again to continue.",
  });

export const emailNotVerifiedError = () =>
  new UnauthorizedError("Your email has not been verified", {
    code: ErrorCode.EMAIL_NOT_VERIFIED,
    suggestion: "Check your inbox (and spam) for the verification link.",
  });

/* ── 403 Forbidden ────────────────────────────────────────────────── */

export const noPermissionError = (resource = "resource") =>
  new ForbiddenError(`You do not have permission to access this ${resource}`, {
    code: ErrorCode.NO_PERMISSION,
    suggestion: `Contact the ${resource} owner or an administrator if you need access.`,
  });

export const insufficientRoleError = (requiredRole: string) =>
  new ForbiddenError(`This action requires ${requiredRole} access`, {
    code: ErrorCode.INSUFFICIENT_ROLE,
    suggestion: `You need ${requiredRole} privileges to perform this action.`,
  });

export const accountBannedError = () =>
  new ForbiddenError("Your account has been banned", {
    code: ErrorCode.ACCOUNT_BANNED,
    suggestion: "Please contact support@homigo.com for more information.",
  });

export const accessDeniedError = (reason?: string) =>
  new ForbiddenError(reason ?? "Access denied", {
    code: ErrorCode.ACCESS_DENIED,
    suggestion: "Contact support with your request id if you believe this is a mistake.",
  });

/* ── Role / ownership predicates (canonical UPPERCASE roles) ──────── */

export const isAdmin = (role: UserRole) => role === "ADMIN";
export const isVendor = (role: UserRole) => role === "VENDOR";
export const isCustomer = (role: UserRole) => role === "CUSTOMER";

export const isResourceOwner = (userId: string, ownerId: string) => userId === ownerId;

/**
 * Throw 403 unless the caller owns the resource. Complements
 * `authPlugin.requireRole(...)` for per-record ownership checks.
 */
export function verifyOwnership(
  userId: string,
  ownerId: string,
  resourceName = "resource",
): void {
  if (!isResourceOwner(userId, ownerId)) {
    throw noPermissionError(resourceName);
  }
}
