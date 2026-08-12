/** Sentry — edge runtime (middleware). DSN-gated no-op without DSN. */
import * as Sentry from "@sentry/nextjs";

const DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: DSN,
  enabled: Boolean(DSN),
  environment: process.env.NEXT_PUBLIC_ENV ?? process.env.NODE_ENV,
  tracesSampleRate: Number(process.env.SENTRY_TRACES ?? 0.1),
});
