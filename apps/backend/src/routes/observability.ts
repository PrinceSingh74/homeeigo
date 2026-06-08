import { Elysia } from "elysia";
import { assertOpsAuthorized } from "../lib/ops-auth";
import prisma from "../lib/prisma";
import { redisClient } from "../lib/redis";
import { renderMetrics } from "../lib/metrics";
import { renderFinancialMetrics } from "../lib/financial-metrics";
import { renderOpsMetrics } from "../lib/ops-metrics";

/**
 * Operational endpoints for Kubernetes / load balancers / Prometheus.
 *
 *   GET /ready    — deep readiness: only reports "ready" when the hard
 *                   dependencies (database, memory headroom) are healthy. Redis
 *                   and third-party integrations are reported but DON'T gate
 *                   readiness, because the app serves correctly without them
 *                   (in-memory fallback / dev console) — gating on them would
 *                   wrongly pull a healthy pod out of rotation.
 *   GET /metrics  — Prometheus text exposition (see lib/metrics).
 *
 * /health (liveness) stays in index.ts unchanged.
 */

// Optional RSS ceiling (MB). Under Bun (JavaScriptCore) heapUsed can exceed
// heapTotal, so a heap-ratio check is unreliable and would falsely flag a pod
// as not-ready. We instead gate on resident memory only when an explicit
// MAX_RSS_MB is configured; otherwise memory is reported but never gates.
const MAX_RSS_MB = Number(process.env.MAX_RSS_MB || 0);

async function checkDatabase() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "healthy" as const, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "unhealthy" as const,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "query failed",
    };
  }
}

async function checkRedis() {
  if (!redisClient.isEnabled) return { status: "disabled" as const };
  const start = Date.now();
  const ok = await redisClient.healthCheck();
  return {
    status: ok ? ("healthy" as const) : ("degraded" as const),
    latencyMs: Date.now() - start,
    topology: redisClient.topology,
  };
}

function checkMemory() {
  const m = process.memoryUsage();
  const rssMb = Math.round(m.rss / 1048576);
  const overCeiling = MAX_RSS_MB > 0 && rssMb > MAX_RSS_MB;
  return {
    status: overCeiling ? ("unhealthy" as const) : ("healthy" as const),
    rssMb,
    heapUsedMb: Math.round(m.heapUsed / 1048576),
    ...(MAX_RSS_MB > 0 ? { maxRssMb: MAX_RSS_MB } : {}),
  };
}

/** Config presence only — we do NOT make live third-party calls on a probe. */
function checkIntegrations() {
  return {
    razorpay: { configured: !!process.env.RAZORPAY_KEY_ID && !!process.env.RAZORPAY_KEY_SECRET },
    razorpayWebhook: { configured: !!process.env.RAZORPAY_WEBHOOK_SECRET },
    email: { configured: !!process.env.RESEND_API_KEY },
    sms: { configured: !!process.env.TWILIO_ACCOUNT_SID && !!process.env.TWILIO_AUTH_TOKEN },
  };
}

export const observabilityRoutes = new Elysia({ name: "observability-routes" })
  .get("/ready", async ({ request, set }) => {
    if (!assertOpsAuthorized(request)) {
      set.status = 401;
      return { success: false, error: "Unauthorized", code: "UNAUTHORIZED" };
    }
    const [database, redis] = await Promise.all([checkDatabase(), checkRedis()]);
    const memory = checkMemory();
    const integrations = checkIntegrations();

    // Only hard dependencies gate readiness.
    const ready = database.status === "healthy" && memory.status === "healthy";
    if (!ready) set.status = 503;

    return {
      status: ready ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      checks: { database, redis, memory, integrations },
    };
  })
  .get("/metrics", async ({ request, set }) => {
    if (!assertOpsAuthorized(request)) {
      set.status = 401;
      return "unauthorized\n";
    }
    set.headers["Content-Type"] = "text/plain; version=0.0.4; charset=utf-8";
    const base = await renderMetrics();
    return `${base}\n${renderFinancialMetrics()}\n${renderOpsMetrics()}\n`;
  });
