/**
 * The sentence a screen shows when a request fails. Pure (no import): the error is read by shape so
 * this can be unit-tested without the API client.
 *
 * Two different things happen and the partner is told which:
 *  - no HTTP answer at all (`PartnerApiError` with `status: 0`, `code: "NETWORK_ERROR"`): the app is
 *    offline or the server could not be reached — nothing the server said, so one fixed sentence;
 *  - a refusal: the server's own sentence, unchanged (its validation details when it sent them).
 */
export const OFFLINE_SENTENCE = "You're offline. Check your connection and try again.";

type ApiErrorLike = { name?: unknown; status?: unknown; code?: unknown; message?: unknown; details?: unknown };

function asApiError(error: unknown): ApiErrorLike | null {
  if (!(error instanceof Error) || error.name !== "PartnerApiError") return null;
  return error as ApiErrorLike;
}

/** True only when the request got no HTTP answer. A 4xx / 5xx is an answer. */
export function isOfflineError(error: unknown): boolean {
  const e = asApiError(error);
  return e != null && e.status === 0 && e.code === "NETWORK_ERROR";
}

/** The server's machine code, or null. */
export function errorCode(error: unknown): string | null {
  const e = asApiError(error);
  return e && typeof e.code === "string" ? e.code : null;
}

export function errorSentence(error: unknown, fallback = "Something went wrong. Try again."): string {
  if (isOfflineError(error)) return OFFLINE_SENTENCE;
  const e = asApiError(error);
  if (e) {
    const details = Array.isArray(e.details) ? e.details.filter((d): d is string => typeof d === "string" && d.length > 0) : [];
    if (details.length) return details.join(". ");
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}
