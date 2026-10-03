/**
 * Whether this runtime may report to Sentry.
 *
 * The dev `.env`/`.env.local` carry the production DSN, so without a gate every
 * dev server, local build and browser-automation run reported into the production
 * project (Playwright runs were rate-limited by Sentry ingest). Now:
 *   - production builds report (NODE_ENV=production), unless running under
 *     browser automation (navigator.webdriver) or NEXT_PUBLIC_SENTRY_DISABLED=1;
 *   - dev/test never report unless NEXT_PUBLIC_SENTRY_ENABLE_NONPROD=1 (ideally
 *     together with a separate, non-production DSN).
 */
export function sentryReportingAllowed(dsn: string | undefined): boolean {
  if (!dsn) return false;
  if (process.env.NEXT_PUBLIC_SENTRY_DISABLED === "1") return false;
  if (typeof navigator !== "undefined" && navigator.webdriver === true) return false;
  if (process.env.NEXT_PUBLIC_SENTRY_ENABLE_NONPROD === "1") return true;
  return process.env.NODE_ENV === "production";
}
