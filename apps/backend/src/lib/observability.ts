/**
 * Observability — error & performance reporting via Sentry.
 *
 * Mirrors the Redis philosophy: entirely OPTIONAL and fail-safe.
 *   - SENTRY_DSN unset  → every call here is a no-op (dev/local behaves exactly
 *                         as before; the @sentry/bun package need not even load).
 *   - SENTRY_DSN set    → @sentry/bun is loaded lazily and events are reported.
 *
 * Nothing in this module ever throws — a broken telemetry pipeline must never
 * take down a request. We capture only server-side faults (5xx / DB outages),
 * never expected 4xx validation/auth noise, so the signal stays clean.
 *
 * Runtime note: HOMIGO runs on Bun, so we use @sentry/bun (NOT @sentry/node,
 * whose profiling integration relies on Node-only native addons).
 */

import { logger, redactForTelemetry, scrubTextForTelemetry } from "./logger";

export type CaptureContext = {
  requestId?: string;
  path?: string;
  method?: string;
  code?: string | number;
  userId?: string;
  category?: "auth" | "payment" | "database" | "websocket" | "integration" | "security";
  level?: "fatal" | "error" | "warning" | "info";
  extra?: Record<string, unknown>;
};

type SentryLike = {
  init: (opts: Record<string, unknown>) => void;
  captureException: (e: unknown, ctx?: Record<string, unknown>) => string;
  captureMessage: (m: string, ctx?: Record<string, unknown>) => string;
  flush: (timeout?: number) => Promise<boolean>;
};

/** Runtime shape check for the optionally-installed Sentry package. */
function isSentryLike(mod: unknown): mod is SentryLike {
  if (typeof mod !== "object" || mod === null) return false;
  const m = mod as Record<string, unknown>;
  return typeof m.init === "function" && typeof m.captureException === "function";
}

/**
 * A test runtime never reports to Sentry unless it opts in with HOMIGO_REQUIRE_SENTRY=1.
 * `.env.test` layers on top of `.env`, so suites and test-mode harnesses inherited the PRODUCTION
 * DSN and polluted the real project with fixture errors (memory: `sentry-chaos-pollution`), and a
 * test environment must never be able to raise an alert that reaches production monitoring.
 */
const DSN =
  process.env.NODE_ENV === "test" && process.env.HOMIGO_REQUIRE_SENTRY !== "1"
    ? ""
    : process.env.SENTRY_DSN?.trim() ?? "";
const ENV = process.env.SENTRY_ENVIRONMENT || process.env.APP_ENV || process.env.NODE_ENV || "development";
const RELEASE = process.env.APP_VERSION || "homigo-backend@1.0.0";
// Sample 10% of traces in prod, 100% elsewhere (only matters once DSN is set).
const TRACES_SAMPLE_RATE = ENV === "production" ? 0.1 : 1.0;

/**
 * Only production-like environments report. Dev servers, test runs, chaos/soak
 * harnesses and browser automation all load the same .env DSN, and used to send
 * everything to the production project at 100% tracing. Opt in explicitly with
 * SENTRY_ENABLE_NONPROD=1 when debugging Sentry itself (ideally with a separate DSN).
 */
const REPORTING_ENVS = new Set(["production", "staging"]);
export function sentryReportingAllowed(env: string = ENV, optIn = process.env.SENTRY_ENABLE_NONPROD): boolean {
  return REPORTING_ENVS.has(env) || optIn === "1";
}

let sentry: SentryLike | null = null;
let enabled = false;

class Observability {
  /** True once Sentry is live (DSN present and SDK loaded). */
  get isEnabled(): boolean {
    return enabled;
  }

  /**
   * Initialise Sentry if SENTRY_DSN is configured. Safe to call once on boot.
   * Loads @sentry/bun lazily so the dependency is only touched when actually
   * used; any failure (missing package, bad DSN) degrades to a no-op + a log.
   */
  async init(): Promise<void> {
    if (enabled || !DSN) {
      if (!DSN) logger.info("observability: Sentry disabled (no SENTRY_DSN)");
      return;
    }
    if (!sentryReportingAllowed()) {
      logger.info("observability: Sentry disabled outside production/staging", { environment: ENV });
      return;
    }
    try {
      // Non-literal specifier keeps the build self-contained when the optional
      // package isn't installed; resolution only happens at runtime when DSN set.
      const pkg = "@sentry/bun";
      const mod = await import(pkg);
      // The specifier is non-literal and the package is optional, so what comes back is genuinely
      // unknown at build time — this is a real dynamic boundary, not a stale type. It is therefore
      // CHECKED rather than asserted: without this, a package that resolved to something else
      // would fail on the `.init(...)` call below with a TypeError instead of a clear message.
      if (!isSentryLike(mod)) {
        logger.warn("observability: optional Sentry package did not expose the expected API");
        return;
      }
      mod.init({
        dsn: DSN,
        environment: ENV,
        release: RELEASE,
        tracesSampleRate: TRACES_SAMPLE_RATE,
        // Drop liveness probes from the noise.
        ignoreErrors: [],
        /**
         * Last line of defence before anything leaves the machine. Sentry captures the error
         * message verbatim, and a message can carry PII (a Prisma validation error echoes the
         * arguments of the failed call). Scrub the same way the logs are scrubbed.
         */
        beforeSend: (event: Record<string, unknown>) => {
          const req = event.request as { url?: string } | undefined;
          if (req?.url?.includes("/health")) return null;
          try {
            if (typeof event.message === "string") event.message = scrubTextForTelemetry(event.message);
            const ex = event.exception as { values?: Array<{ value?: string }> } | undefined;
            for (const v of ex?.values ?? []) {
              if (typeof v.value === "string") v.value = scrubTextForTelemetry(v.value);
            }
            /**
             * Everything else the SDK attaches by itself. `extra` alone was not enough: breadcrumbs
             * carry console lines and outgoing request URLs, `request` carries the URL and its query
             * string (`?phone=…`), and tags/contexts carry the route (independent review, 2026-09-20).
             */
            for (const key of ["extra", "contexts", "tags", "request", "user"] as const) {
              const value = event[key];
              if (value && typeof value === "object") {
                event[key] = redactForTelemetry(value as Record<string, unknown>);
              }
            }
            const crumbs = event.breadcrumbs as Array<Record<string, unknown>> | { values?: Array<Record<string, unknown>> } | undefined;
            const list = Array.isArray(crumbs) ? crumbs : crumbs?.values;
            for (const [i, crumb] of (list ?? []).entries()) {
              if (crumb && typeof crumb === "object") (list as Array<Record<string, unknown>>)[i] = redactForTelemetry(crumb);
            }
          } catch {
            /* telemetry must never throw */
          }
          return event;
        },
      });
      sentry = mod;
      enabled = true;
      logger.info("observability: Sentry initialised", { environment: ENV, release: RELEASE });
    } catch (err) {
      enabled = false;
      sentry = null;
      logger.warn("observability: Sentry init failed — continuing without it", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /** Report a server-side exception. Returns the Sentry event id (or undefined
   *  when Sentry is off / on error). No-op + best-effort. */
  captureException(error: unknown, ctx: CaptureContext = {}): string | undefined {
    if (!enabled || !sentry) return undefined;
    try {
      return sentry.captureException(error, {
        level: ctx.level ?? "error",
        tags: {
          ...(ctx.category ? { category: ctx.category } : {}),
          ...(ctx.code !== undefined ? { code: String(ctx.code) } : {}),
          ...(ctx.path ? { path: ctx.path } : {}),
          ...(ctx.method ? { method: ctx.method } : {}),
        },
        extra: redactForTelemetry({
          ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
          ...(ctx.extra ?? {}),
        }),
        ...(ctx.userId ? { user: { id: ctx.userId } } : {}),
      });
    } catch {
      /* telemetry must never throw */
      return undefined;
    }
  }

  /** Report a structured message (e.g. a security event). Returns the event id. */
  captureMessage(message: string, ctx: CaptureContext = {}): string | undefined {
    if (!enabled || !sentry) return undefined;
    try {
      return sentry.captureMessage(message, {
        level: ctx.level ?? "warning",
        tags: { ...(ctx.category ? { category: ctx.category } : {}) },
        extra: redactForTelemetry(ctx.extra ?? {}),
      });
    } catch {
      /* telemetry must never throw */
      return undefined;
    }
  }

  /** Flush buffered events. Returns true if everything was sent within timeout. */
  async flush(timeoutMs = 2000): Promise<boolean> {
    if (!enabled || !sentry) return false;
    try {
      return await sentry.flush(timeoutMs);
    } catch {
      return false;
    }
  }
}

export const observability = new Observability();
