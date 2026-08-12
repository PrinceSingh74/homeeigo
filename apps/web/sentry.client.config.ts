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
  // Session replay — default OFF for continuous recording (it processes DOM mutations on every
  // navigation, ~90ms CPU per nav per the flamegraph), but ALWAYS record sessions that hit an
  // error (the high-value case). Re-enable ambient sampling per-env via NEXT_PUBLIC_SENTRY_REPLAY.
  replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY ?? 0),
  replaysOnErrorSampleRate: 1.0,
  // Only browser-tracing is bundled eagerly. Session Replay (~40 kB) is loaded LAZILY from
  // Sentry's CDN after init (see below) so it stays out of the initial JS bundle — replay is
  // non-critical telemetry (10% sampled) and never needs to block first paint.
  integrations: [Sentry.browserTracingIntegration()],
  // Drop noisy benign errors (network blips, aborted navigations).
  ignoreErrors: ["AbortError", "Non-Error promise rejection captured", "ResizeObserver loop"],
});

// Session Replay is OPT-IN (default OFF). The replay recorder buffers DOM mutations continuously
// — even in error-only mode — which costs ~90ms CPU per navigation (proven via flamegraph) and
// adds steady background work that hurts 60fps smoothness. Error + performance tracking work
// fully without it. Enable per-env with NEXT_PUBLIC_SENTRY_REPLAY > 0 when actively investigating.
const REPLAY_ENABLED = Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY ?? 0) > 0;
if (DSN && REPLAY_ENABLED && typeof window !== "undefined") {
  const addReplay = () => {
    Sentry.lazyLoadIntegration("replayIntegration")
      .then((replayIntegration) => {
        Sentry.addIntegration(replayIntegration({ maskAllText: true, blockAllMedia: true }));
      })
      .catch(() => {
        /* CDN blocked / offline — error capture & tracing still work without replay */
      });
  };
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(addReplay);
  } else {
    setTimeout(addReplay, 2000);
  }
}
