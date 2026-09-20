/**
 * Next.js instrumentation hook — loads the Sentry server/edge config per runtime and exposes
 * onRequestError so server-side route/API/render errors are captured (DSN-gated).
 *
 * This file is compiled for BOTH Node and Edge (middleware). Node-only work — route warming,
 * `child_process`, `process.cwd` — lives in `instrumentation-node.ts` and is imported only from
 * the `nodejs` branch. Putting those APIs here makes every request log an Edge Runtime error
 * and, under Turbopack, can wedge the dev server into 500s on every route.
 */
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    const { warmRoutesInBackground } = await import("./instrumentation-node");
    warmRoutesInBackground();
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

/**
 * Observability must never turn a recoverable render error into a 500. If Sentry itself throws
 * (misconfigured DSN, ingest timeout), the original request still completes.
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
