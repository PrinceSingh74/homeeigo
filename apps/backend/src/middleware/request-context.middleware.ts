import { Elysia } from "elysia";
import crypto from "crypto";
import { formatTraceparent, resolveTraceContext } from "../lib/tracing";

/**
 * Request correlation support (Part 7, additive).
 *
 * - Derives a `requestId` for every request: reuses an inbound
 *   `X-Request-ID` / `X-Correlation-ID` header when the client (or an
 *   upstream gateway) supplies one, otherwise generates `req_<hex>`.
 * - Echoes it back on the `X-Request-ID` response header for ALL
 *   successful responses so clients/log aggregators can correlate.
 *
 * Error responses set the same header in `error.middleware.ts`, which now
 * also prefers the inbound header — so a single request always carries one
 * consistent correlation id end-to-end.
 *
 * Purely additive: adds a `requestId` field to the handler context and a
 * response header. No existing behaviour, contract, or response body changes.
 */
export function resolveRequestId(request: Request): string {
  const inbound =
    request.headers.get("x-request-id") || request.headers.get("x-correlation-id");
  if (inbound && inbound.trim()) {
    // Bound the length to keep logs/headers sane; strip control chars.
    return inbound.trim().replace(/[^\w.\-:]/g, "").slice(0, 128) || `req_${crypto.randomBytes(8).toString("hex")}`;
  }
  return `req_${crypto.randomBytes(8).toString("hex")}`;
}

export const requestContextPlugin = new Elysia({ name: "request-context" })
  .derive({ as: "global" }, ({ request }) => {
    const requestId = resolveRequestId(request);
    const trace = resolveTraceContext(request);
    return {
      requestId,
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
    };
  })
  .onAfterHandle({ as: "global" }, ({ requestId, traceId, spanId, set, path }) => {
    if (path.startsWith("/ws")) return;
    set.headers["X-Request-ID"] = requestId;
    set.headers["traceparent"] = formatTraceparent(traceId, spanId);
  });
