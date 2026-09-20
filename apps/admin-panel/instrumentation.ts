/**
 * Next.js instrumentation hook — loads the Sentry server/edge config per runtime and exposes
 * onRequestError so server-side route/API/render errors are captured (DSN-gated).
 *
 * Keep Node-only APIs (`child_process`, `process.cwd`, …) out of this file. Next compiles it
 * for Edge (middleware) as well as Node. `scripts/check-instrumentation-edge.mjs` enforces that.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Observability must never turn a recoverable render error into a 500. If Sentry itself throws,
 * the original request still completes.
 */
export function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
): ReturnType<typeof Sentry.captureRequestError> | void {
  try {
    return Sentry.captureRequestError(...args);
  } catch {
    // Intentionally empty — a telemetry failure is not a product failure.
  }
}
