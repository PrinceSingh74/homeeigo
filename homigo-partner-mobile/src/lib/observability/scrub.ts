/**
 * PII/secret scrubbing for outbound error reports.
 *
 * Deliberately free of any React Native / Expo import so it is pure, unit-testable in plain Node,
 * and impossible to accidentally couple to app state. The partner app handles auth tokens, job
 * OTPs, Aadhaar/PAN numbers, bank details and Razorpay identifiers — none of which may ever reach
 * an error tracker. Scrubbing centrally here is safer than trusting every future call site to
 * remember.
 */

const SENSITIVE_KEY =
  /(token|password|otp|secret|authorization|signature|razorpay|apikey|api_key|dsn|refresh|access_token|aadhaar|pan|account_number|ifsc|cvv|card)/i;

const MAX_DEPTH = 6;

export function scrubObject(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH || value == null) return value;
  if (Array.isArray(value)) return value.map((v) => scrubObject(v, depth + 1));
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubObject(v, depth + 1);
  }
  return out;
}

export type ScrubbableEvent = {
  extra?: unknown;
  contexts?: unknown;
  request?: { headers?: unknown; data?: unknown; url?: unknown } | unknown;
};

/** Strip sensitive fields from an event in place, then return it. */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  if (event.extra) event.extra = scrubObject(event.extra);
  if (event.contexts) event.contexts = scrubObject(event.contexts);
  if (event.request && typeof event.request === "object") {
    const req = event.request as Record<string, unknown>;
    if (req.headers) req.headers = scrubObject(req.headers);
    if (req.data) req.data = scrubObject(req.data);
    // A URL can carry a token in its query string.
    if (typeof req.url === "string") {
      req.url = req.url.replace(/([?&](?:token|access_token|refresh_token)=)[^&]+/gi, "$1[redacted]");
    }
  }
  return event;
}
