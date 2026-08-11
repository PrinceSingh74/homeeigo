/**
 * Caller identity extracted from an inbound request, for AI Gateway telemetry.
 *
 * Shared so every gateway entry point attributes rate limits and audit rows the same
 * way — two routes computing "the client IP" differently would let one path be limited
 * per-proxy while another is limited per-user.
 */

/** Left-most `x-forwarded-for` hop, falling back to `x-real-ip`. */
export function clientIp(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}

/** W3C `traceparent` trace-id, falling back to `x-request-id`, so AI spans join the existing trace. */
export function traceId(request: Request): string | undefined {
  return (
    request.headers.get("traceparent")?.split("-")[1] ??
    request.headers.get("x-request-id") ??
    undefined
  );
}
