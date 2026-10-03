/**
 * Connection-level failure codes — the peer could not be reached or dropped the socket.
 *
 * Read from the error itself or from its `cause` (undici's `fetch failed` wraps the socket error).
 * This says nothing about WHICH dependency failed; callers decide that from where they called.
 * The error middleware uses it so a warehouse, Redis or HTTP upstream refusing a connection is no
 * longer reported as the database being down (X-87).
 */
const CONNECTION_FAILURE_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ECONNABORTED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

export function connectionFailureCode(err: unknown): string | null {
  const e = err as { code?: unknown; cause?: { code?: unknown } } | null | undefined;
  for (const code of [e?.code, e?.cause?.code]) {
    if (typeof code === "string" && CONNECTION_FAILURE_CODES.has(code)) return code;
  }
  return null;
}
