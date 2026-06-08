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

import { logger } from "./logger";

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
  captureException: (e: unknown, ctx?: Record<string, unknown>) => void;
  captureMessage: (m: string, ctx?: Record<string, unknown>) => void;
  flush: (timeout?: number) => Promise<boolean>;
};

const DSN = process.env.SENTRY_DSN?.trim() ?? "";
const ENV = process.env.NODE_ENV || "development";
const RELEASE = process.env.APP_VERSION || "homigo-backend@1.0.0";
// Sample 10% of traces in prod, 100% elsewhere (only matters once DSN is set).
const TRACES_SAMPLE_RATE = ENV === "production" ? 0.1 : 1.0;

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
    try {
      // Non-literal specifier keeps the build self-contained when the optional
      // package isn't installed; resolution only happens at runtime when DSN set.
      const pkg = "@sentry/bun";
      const mod = (await import(pkg)) as unknown as SentryLike;
      mod.init({
        dsn: DSN,
        environment: ENV,
        release: RELEASE,
        tracesSampleRate: TRACES_SAMPLE_RATE,
        // Drop liveness probes from the noise.
        ignoreErrors: [],
        beforeSend: (event: { request?: { url?: string } }) => {
          if (event.request?.url?.includes("/health")) return null;
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

  /** Report a server-side exception. No-op (best-effort) when Sentry is off. */
  captureException(error: unknown, ctx: CaptureContext = {}): void {
    if (!enabled || !sentry) return;
    try {
      sentry.captureException(error, {
        level: ctx.level ?? "error",
        tags: {
          ...(ctx.category ? { category: ctx.category } : {}),
          ...(ctx.code !== undefined ? { code: String(ctx.code) } : {}),
          ...(ctx.path ? { path: ctx.path } : {}),
          ...(ctx.method ? { method: ctx.method } : {}),
        },
        extra: {
          ...(ctx.requestId ? { requestId: ctx.requestId } : {}),
          ...(ctx.extra ?? {}),
        },
        ...(ctx.userId ? { user: { id: ctx.userId } } : {}),
      });
    } catch {
      /* telemetry must never throw */
    }
  }

  /** Report a structured message (e.g. a security event). Best-effort. */
  captureMessage(message: string, ctx: CaptureContext = {}): void {
    if (!enabled || !sentry) return;
    try {
      sentry.captureMessage(message, {
        level: ctx.level ?? "warning",
        tags: { ...(ctx.category ? { category: ctx.category } : {}) },
        extra: ctx.extra ?? {},
      });
    } catch {
      /* telemetry must never throw */
    }
  }

  /** Flush buffered events on shutdown so nothing is lost on a clean exit. */
  async flush(timeoutMs = 2000): Promise<void> {
    if (!enabled || !sentry) return;
    try {
      await sentry.flush(timeoutMs);
    } catch {
      /* ignore */
    }
  }
}

export const observability = new Observability();
