/**
 * Sentry — browser/client (partner web). Captures React errors, unhandled rejections,
 * hydration errors, route errors, plus session replay + browser performance/tracing.
 * DSN-gated: a no-op when NEXT_PUBLIC_SENTRY_DSN is unset (zero overhead in dev), mirroring
 * the backend's lib/observability.ts pattern.
 */
import * as Sentry from "@sentry/nextjs";
import { sentryReportingAllowed } from "./src/lib/sentry-gate";

const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  // Production builds only, never under automation (navigator.webdriver) — dev/test sessions and
  // browser verification runs were reporting deliberate test errors to the production project.
  enabled: sentryReportingAllowed(DSN),
  environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE, // set in CI to the build SHA
  // Distributed tracing (links frontend → backend spans via the trace header).
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES ?? 0.1),
  tracePropagationTargets: [/^\//, /api\.homigo\./, process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000"],
  /**
   * Session replay — continuous recording OFF by default, error sessions always kept.
   *
   * This app recorded 10% of sessions ambiently. The replay recorder buffers DOM mutations the
   * whole time it is running, which the customer app measured at ~90ms of CPU per navigation on a
   * flamegraph — steady background work on the main thread, on every route change, for one partner
   * in ten. That is the difference between a transition that feels smooth and one that stutters.
   *
   * Error sessions are the high-value case and are still captured at 100%. Ambient sampling can be
   * turned back on per environment with NEXT_PUBLIC_SENTRY_REPLAY when someone is investigating.
   */
  replaysSessionSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_REPLAY ?? 0),
  replaysOnErrorSampleRate: 1.0,
  /**
   * Only browser-tracing is bundled eagerly. Session Replay (~40 kB) was in the initial bundle on
   * all 53 routes; it is non-critical telemetry and never needs to block first paint, so it is
   * loaded lazily below instead.
   */
  integrations: [Sentry.browserTracingIntegration()],
  // Drop noisy benign errors (network blips, aborted navigations).
  ignoreErrors: ["AbortError", "Non-Error promise rejection captured", "ResizeObserver loop"],
});

/**
 * Replay, when it is wanted, arrives late and from the CDN — never in the first-load bundle.
 *
 * Loaded on an idle callback so it cannot compete with hydration or the first navigation. If the
 * CDN is blocked or the browser is offline, error capture and tracing carry on without it.
 */
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
