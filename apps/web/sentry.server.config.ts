/** Sentry — server runtime (customer web SSR/route handlers). DSN-gated no-op without DSN. */
import * as Sentry from "@sentry/nextjs";
import { sentryReportingAllowed } from "./src/lib/sentry-gate";

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  // Production only; never dev, tests or browser automation (see src/lib/sentry-gate.ts).
  enabled: sentryReportingAllowed(DSN),
  environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV,
  release: process.env.NEXT_PUBLIC_SENTRY_RELEASE,
  tracesSampleRate: Number(process.env.SENTRY_TRACES ?? 0.1),
});
