/**
 * Canonical, machine-readable error codes.
 *
 * Values intentionally match the strings the backend already emits and the
 * frontends already switch on (see each app's lib/api-error.ts), so adopting
 * the enum is type-safety only — it changes no wire values and breaks nothing.
 *
 * `code` fields stay typed as `string` in the envelope/AppError so existing
 * string-literal callers keep compiling; this enum is an opt-in convenience.
 */
export enum ErrorCode {
  // 400 — Bad request / validation
  VALIDATION_ERROR = "VALIDATION_ERROR",
  INVALID_INPUT = "INVALID_INPUT",
  MISSING_FIELD = "MISSING_FIELD",
  INVALID_FORMAT = "INVALID_FORMAT",
  INVALID_JSON = "INVALID_JSON",
  INVALID_EMAIL = "INVALID_EMAIL",
  INVALID_PHONE = "INVALID_PHONE",
  INVALID_PASSWORD = "INVALID_PASSWORD",

  // 401 — Unauthorized
  UNAUTHORIZED = "UNAUTHORIZED",
  INVALID_CREDENTIALS = "INVALID_CREDENTIALS",
  NO_TOKEN = "NO_TOKEN",
  INVALID_TOKEN = "INVALID_TOKEN",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  SESSION_EXPIRED = "SESSION_EXPIRED",

  // 403 — Forbidden
  FORBIDDEN = "FORBIDDEN",
  NO_PERMISSION = "NO_PERMISSION",
  ACCESS_DENIED = "ACCESS_DENIED",
  INSUFFICIENT_ROLE = "INSUFFICIENT_ROLE",
  ACCOUNT_BANNED = "ACCOUNT_BANNED",
  EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED",

  // 404 — Not found
  NOT_FOUND = "NOT_FOUND",
  USER_NOT_FOUND = "USER_NOT_FOUND",
  BOOKING_NOT_FOUND = "BOOKING_NOT_FOUND",

  // 409 — Conflict
  CONFLICT = "CONFLICT",
  DUPLICATE_EMAIL = "DUPLICATE_EMAIL",
  DUPLICATE_PHONE = "DUPLICATE_PHONE",
  INVALID_STATUS = "INVALID_STATUS",
  INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE",

  // 429 — Rate limit
  RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED",

  // 5xx — Server
  INTERNAL_ERROR = "INTERNAL_ERROR",
  DATABASE_ERROR = "DATABASE_ERROR",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
}

export type ErrorDetail = {
  field?: string;
  message: string;
  code?: string;
};

/**
 * Standard error envelope. `status`/`requestId`/`timestamp`/`details`/
 * `suggestion`/`meta` are optional because the existing `errorResponse`
 * helper populates them situationally — this interface describes the union
 * of what callers may receive, without forcing churn on existing responses.
 */
export interface ErrorResponse {
  success: false;
  error: string;
  code: string;
  status?: number;
  requestId?: string;
  timestamp?: string;
  details?: ErrorDetail[];
  suggestion?: string;
  meta?: {
    retryAfter?: number;
    path?: string;
    method?: string;
    [key: string]: unknown;
  };
}

export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  timestamp?: string;
  requestId?: string;
}
