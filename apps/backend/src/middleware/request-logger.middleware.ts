import { Elysia } from "elysia";
import { logger } from "../lib/logger";
import { resolveRequestId } from "./request-context.middleware";
import { resolveTraceContext } from "../lib/tracing";
import { getEventContext } from "../events/core/event-context";

/**
 * Structured per-request access log (Part 8C, additive).
 *
 * Logs every completed (non-thrown) HTTP response with method / path / status /
 * duration / requestId via the existing `logger` (which auto-redacts secrets).
 * Thrown/unhandled errors are already logged by `error.middleware.ts`, so this
 * does NOT add an onError hook → no double logging.
 *
 * - Start time captured in `onRequest` (pre-routing, fires for all requests),
 *   tracked per-Request via a WeakMap (no context-propagation assumptions).
 * - `onAfterHandle` is `{ as: "global" }` so it runs for routes in every
 *   sibling plugin (same scoping requirement as the rate-limit / error hooks).
 * - requestId is re-resolved from the request (honours inbound X-Request-ID),
 *   staying consistent with `request-context.middleware`.
 * - Noisy/irrelevant paths (/ws upgrades, /health, /swagger) are skipped.
 */

const startTimes = new WeakMap<Request, number>();

const SKIP_PREFIXES = ["/ws", "/health", "/ready", "/metrics", "/swagger"];

function shouldSkip(path: string): boolean {
  return SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export const requestLoggerPlugin = new Elysia({ name: "request-logger" })
  .onRequest(({ request }) => {
    startTimes.set(request, Date.now());
  })
  .onAfterHandle({ as: "global" }, ({ request, set }) => {
    const path = new URL(request.url).pathname;
    if (shouldSkip(path)) return;

    const start = startTimes.get(request);
    const durationMs = start !== undefined ? Date.now() - start : undefined;
    const status = typeof set.status === "number" ? set.status : 200;

    const trace = resolveTraceContext(request);
    const ctx = getEventContext();
    const meta = {
      requestId: resolveRequestId(request),
      traceId: trace.traceId,
      category: "APPLICATION" as const,
      method: request.method,
      path,
      status,
      ...(durationMs !== undefined ? { durationMs } : {}),
      ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
      ...(ctx.partnerId ? { partnerId: ctx.partnerId } : {}),
      ...(ctx.deviceId ? { deviceId: ctx.deviceId } : {}),
    };

    if (status >= 500) logger.error("request.completed", meta);
    else if (status >= 400) logger.warn("request.completed", meta);
    else logger.info("request.completed", meta);
  });
