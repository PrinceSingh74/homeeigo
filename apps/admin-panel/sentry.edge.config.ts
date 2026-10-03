/** Sentry — edge runtime (middleware). DSN-gated no-op without DSN. */
import * as Sentry from "@sentry/nextjs";
import { sentryReportingAllowed } from "./src/lib/sentry-gate";

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  // Production builds only, never under automation (navigator.webdriver) — dev/test sessions and
  // browser verification runs were reporting deliberate test errors to the production project.
  enabled: sentryReportingAllowed(DSN),
  environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES ?? 0.1),
});
