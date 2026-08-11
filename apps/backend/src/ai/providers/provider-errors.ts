import type { AiProviderType } from "@prisma/client";

/**
 * Normalized provider failure taxonomy.
 *
 * Adapters translate their native errors into these codes so the router can decide
 * retry/cooldown/failover without knowing which provider it is talking to. Adding a
 * provider must never require new branching in the router.
 */
export type ProviderErrorCode =
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_QUOTA_EXCEEDED"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_5XX"
  | "PROVIDER_NETWORK_ERROR"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_UNKNOWN_ERROR";

/**
 * Retry eligibility per code.
 *
 * A caller mistake (auth, malformed request) will fail identically on a second attempt,
 * so retrying only doubles latency. Rate limits and quota exhaustion are retryable in
 * principle but not *immediately* — they take the cooldown path to another provider
 * instead, which is why they are false here.
 */
const RETRYABLE: Record<ProviderErrorCode, boolean> = {
  PROVIDER_TIMEOUT: true,
  PROVIDER_5XX: true,
  PROVIDER_UNAVAILABLE: true,
  PROVIDER_NETWORK_ERROR: true,
  PROVIDER_INVALID_RESPONSE: true,
  PROVIDER_RATE_LIMITED: false,
  PROVIDER_QUOTA_EXCEEDED: false,
  PROVIDER_AUTH_FAILED: false,
  PROVIDER_BAD_REQUEST: false,
  PROVIDER_UNKNOWN_ERROR: false,
};

/** Codes that should park the provider rather than merely count as a failure. */
const COOLDOWN_CODES = new Set<ProviderErrorCode>([
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_QUOTA_EXCEEDED",
]);

export class ProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly provider: AiProviderType;
  readonly httpStatus?: number;
  /** How long the provider asked us to wait, when it told us. */
  readonly retryAfterMs?: number;
  readonly retryable: boolean;

  constructor(params: {
    code: ProviderErrorCode;
    provider: AiProviderType;
    message: string;
    httpStatus?: number;
    retryAfterMs?: number;
    cause?: unknown;
  }) {
    // The message is built by the caller from already-sanitised parts. Upstream payloads
    // are summarised, never embedded whole, so nothing here can carry a credential.
    super(params.message, { cause: params.cause });
    this.name = "ProviderError";
    this.code = params.code;
    this.provider = params.provider;
    this.httpStatus = params.httpStatus;
    this.retryAfterMs = params.retryAfterMs;
    this.retryable = RETRYABLE[params.code];
  }

  get shouldCooldown(): boolean {
    return COOLDOWN_CODES.has(this.code);
  }
}

/**
 * `Retry-After` is either delta-seconds or an HTTP date. Some providers omit the header
 * and put the delay in the body instead ("Please retry in 34.5s"), so both are read.
 * Returns undefined when the provider gave no usable hint — the caller then applies its
 * own default rather than inventing a number here.
 */
export function parseRetryAfterMs(headers: Headers, body?: string): number | undefined {
  const header = headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  }

  // Vendor-specific reset hints, in preference order.
  const resetTokens = headers.get("x-ratelimit-reset-tokens");
  const resetRequests = headers.get("x-ratelimit-reset-requests");
  for (const hint of [resetTokens, resetRequests]) {
    const parsed = hint ? parseDurationString(hint) : undefined;
    if (parsed !== undefined) return parsed;
  }

  if (body) {
    const match = body.match(/retry in ([\d.]+)\s*s/i);
    if (match) return Math.round(Number(match[1]) * 1000);
  }
  return undefined;
}

/** Parses "27.8s", "1h6m14.4s", "500ms" into milliseconds. */
function parseDurationString(raw: string): number | undefined {
  const compound = raw.match(/(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?/);
  if (compound && (compound[1] || compound[2] || compound[3])) {
    const h = Number(compound[1] ?? 0);
    const m = Number(compound[2] ?? 0);
    const s = Number(compound[3] ?? 0);
    return Math.round(((h * 60 + m) * 60 + s) * 1000);
  }
  const ms = raw.match(/^([\d.]+)ms$/);
  if (ms) return Math.round(Number(ms[1]));
  return undefined;
}

/**
 * Maps an HTTP response to a taxonomy code.
 *
 * 429 splits two ways: a per-minute rate limit recovers on its own and is worth coming
 * back to, while an exhausted daily quota does not. Providers signal the difference only
 * in prose, so the body is inspected for quota wording.
 */
export function classifyHttpStatus(status: number, body: string): ProviderErrorCode {
  if (status === 401 || status === 403) return "PROVIDER_AUTH_FAILED";
  if (status === 400 || status === 404 || status === 422) return "PROVIDER_BAD_REQUEST";
  if (status === 429) {
    return /quota|exceeded your current quota|per day|daily|RESOURCE_EXHAUSTED/i.test(body)
      ? "PROVIDER_QUOTA_EXCEEDED"
      : "PROVIDER_RATE_LIMITED";
  }
  if (status === 503 || status === 502 || status === 504) return "PROVIDER_UNAVAILABLE";
  if (status >= 500) return "PROVIDER_5XX";
  return "PROVIDER_UNKNOWN_ERROR";
}

/** Maps a thrown (non-HTTP) error — aborts, DNS failures, connection resets. */
export function classifyThrown(err: unknown): ProviderErrorCode {
  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : String(err);
  if (name === "AbortError" || /abort|timeout|timed out/i.test(message)) return "PROVIDER_TIMEOUT";
  // Runtimes name connection faults differently — Node uses errno strings, Bun uses
  // PascalCase error names — so both spellings are matched.
  const signal = `${name} ${message}`;
  if (/ECONNREFUSED|ENOTFOUND|ECONNRESET|EHOSTUNREACH|ConnectionRefused|ConnectionClosed|fetch failed|Unable to connect|socket|network/i.test(signal)) {
    return "PROVIDER_NETWORK_ERROR";
  }
  return "PROVIDER_UNKNOWN_ERROR";
}

/**
 * Summarises an upstream error body for logs without forwarding it verbatim.
 *
 * Raw provider payloads can echo request content back and are not ours to redistribute,
 * so only the vendor's short message field is kept, truncated.
 */
export function summariseUpstreamBody(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string; type?: string } | string };
    const message =
      typeof parsed.error === "string" ? parsed.error : parsed.error?.message ?? "";
    if (message) return message.replace(/\s+/g, " ").slice(0, 160);
  } catch {
    // Not JSON — fall through to the truncated raw form.
  }
  return body.replace(/\s+/g, " ").slice(0, 160);
}

/** Wraps any thrown value into a ProviderError, preserving an existing classification. */
export function toProviderError(err: unknown, provider: AiProviderType): ProviderError {
  if (err instanceof ProviderError) return err;
  const code = classifyThrown(err);
  return new ProviderError({
    code,
    provider,
    message: `${provider} ${code}`,
    cause: err,
  });
}
