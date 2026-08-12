/**
 * Next.js instrumentation hook — loads the Sentry server/edge config per runtime and exposes
 * onRequestError so server-side route/API/render errors are captured (DSN-gated).
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

// Captures errors thrown in server components, route handlers, and middleware (Next 15).
export const onRequestError = Sentry.captureRequestError;
