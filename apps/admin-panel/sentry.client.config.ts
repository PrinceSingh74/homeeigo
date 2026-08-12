/**
 * Sentry — browser/client (customer web). Captures React errors, unhandled rejections,
 * hydration errors, route errors, plus session replay + browser performance/tracing.
 * DSN-gated: a no-op when NEXT_PUBLIC_SENTRY_DSN is unset (zero overhead in dev), mirroring
 * the backend's lib/observability.ts pattern.
 */
import * as Sentry from "@sentry/nextjs";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  enabled: Boolean(DSN),
  environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE, // set in CI to the build SHA
  // Distributed tracing (links frontend → backend spans via the trace header).
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES ?? 0.1),
  tracePropagationTargets: [/^\//, /api\.homigo\./, process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"],
  // Session replay — record 10% of sessions, 100% of sessions with an error.
  replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY ?? 0.1),
  replaysOnErrorSampleRate: 1.0,
  integrations: [
    Sentry.replayIntegration({ maskAllText: true, blockAllMedia: true }),
    Sentry.browserTracingIntegration(),
  ],
  // Drop noisy benign errors (network blips, aborted navigations).
  ignoreErrors: ["AbortError", "Non-Error promise rejection captured", "ResizeObserver loop"],
});
