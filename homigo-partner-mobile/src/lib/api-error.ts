/**
 * The one error every API call throws. Pure (no React Native import) so screens' logic and the unit
 * tests can use it; `services/partner-api.ts` re-exports it.
 *
 * The backend's refusal envelope is `{ success: false, error: <sentence>, code, data?, details?,
 * retryAfter? }` — the human sentence is `error` (there is no `message` key on a refusal), and the
 * extras a screen needs sit under `data`:
 *   - `attemptsLeft`     POST /bookings/:id/start, code OTP_INVALID (null on the other OTP_* codes)
 *   - `retryAfterSec`    POST /bookings/:id/start-otp, codes RESEND_COOLDOWN / RATE_LIMITED (429)
 *   - `blocking`         REQUIREMENT_GATE_BLOCKED (BlockingRequirement[]), SAFETY_HOLD_ACTIVE
 *                        (SafetyBlocking[]), EXECUTION_GATE_BLOCKED (step rows), QUALITY_VERDICT_BLOCKED
 *   - `waitedMinutes`, `graceMinutes`   POST /bookings/:id/no-show refusals
 *   - `verdict`, `verdictId`, `reasonCodes`   POST /bookings/:id/complete quality refusals
 *   - `detail`           EVIDENCE_REQUIRED on a step action (["NOTE"|"PHOTO"|"BEFORE"|"AFTER"])
 *   - `alternative`      CALL_RELAY_UNAVAILABLE ("CHAT")
 * `retryAfter` (seconds) is top-level, on rate limits.
 *
 * A request that never got an HTTP answer (offline, DNS, TLS, timeout) is `status: 0`,
 * `code: "NETWORK_ERROR"` — nothing the server said, so nothing to show as its sentence.
 */
export const NETWORK_ERROR_CODE = "NETWORK_ERROR";
/** The one offline sentence of the app (the same words as `OFFLINE_SENTENCE` in job-screen / error-sentence). */
export const NETWORK_ERROR_MESSAGE = "You're offline. Check your connection and try again.";

/** The refusal's `data` block. Known keys are typed loosely on purpose: their shape depends on `code`. */
export type PartnerApiErrorData = {
  attemptsLeft?: number | null;
  retryAfterSec?: number | null;
  blocking?: unknown;
  waitedMinutes?: number | null;
  graceMinutes?: number;
  verdict?: string | null;
  verdictId?: number | null;
  reasonCodes?: string[];
  detail?: string[];
  alternative?: string;
  [key: string]: unknown;
};

export class PartnerApiError extends Error {
  /** HTTP status; 0 when there was no HTTP answer at all. */
  readonly status: number;
  /** The server's machine code (`NOT_FOUND`, `OTP_INVALID`, …), `NETWORK_ERROR`, or null. */
  readonly code: string | null;
  /** Seconds to wait before retrying, when the server said (body `retryAfter` or `Retry-After`). */
  readonly retryAfter: number | null;
  /** The refusal's `data` block; null when the server sent none. */
  readonly data: PartnerApiErrorData | null;
  /** Field-level validation messages (400 VALIDATION_ERROR); empty otherwise. */
  readonly details: string[];

  constructor(
    message: string,
    opts: { status: number; code?: string | null; retryAfter?: number | null; data?: PartnerApiErrorData | null; details?: string[] },
  ) {
    super(message);
    this.name = "PartnerApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.retryAfter = opts.retryAfter ?? null;
    this.data = opts.data ?? null;
    this.details = opts.details ?? [];
  }
}

export function networkError(cause?: unknown): PartnerApiError {
  const e = new PartnerApiError(NETWORK_ERROR_MESSAGE, { status: 0, code: NETWORK_ERROR_CODE });
  if (cause !== undefined) (e as { cause?: unknown }).cause = cause;
  return e;
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof PartnerApiError && error.status === 0 && error.code === NETWORK_ERROR_CODE;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function positive(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Builds the error for an HTTP answer that is not a success. `body` is the parsed JSON, or null when
 * the body was not JSON; `retryAfterHeader` is the raw `Retry-After` header.
 */
export function apiErrorFromResponse(status: number, statusText: string, body: unknown, retryAfterHeader: string | null): PartnerApiError {
  const json = isRecord(body) ? body : {};
  const message = (typeof json.error === "string" && json.error) || statusText || "Request failed";
  const headerSeconds = retryAfterHeader && /^\d+$/.test(retryAfterHeader) ? positive(Number(retryAfterHeader)) : null;
  const details = Array.isArray(json.details)
    ? json.details
        .map((d) => (typeof d === "string" ? d : isRecord(d) && typeof d.message === "string" ? d.message : ""))
        .filter((m) => m.length > 0)
    : [];
  return new PartnerApiError(message, {
    status,
    code: typeof json.code === "string" ? json.code : null,
    retryAfter: positive(json.retryAfter) ?? headerSeconds,
    data: isRecord(json.data) ? (json.data as PartnerApiErrorData) : null,
    details,
  });
}

/** A finite number from the refusal's `data`, or null — a missing value is never 0. */
export function errorDataNumber(error: unknown, key: string): number | null {
  if (!(error instanceof PartnerApiError) || !error.data) return null;
  const v = error.data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** The sentence to show: the server's own, the validation details when it sent them, else `fallback`. */
export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again."): string {
  if (error instanceof PartnerApiError) {
    if (error.details.length) return error.details.join(". ");
    return error.message || fallback;
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
