import "./load-env";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { authRoutes } from "./routes/auth";
import { subscriptionsRoutes } from "./routes/subscriptions";
import { supportRoutes } from "./routes/support";
import { referralsRoutes } from "./routes/referrals";
import { hcoinsRoutes } from "./routes/hcoins";
import { giftCardsRoutes } from "./routes/gift-cards";
import { userRoutes } from "./routes/users";
import { servicesRoutes } from "./routes/services";
import { statsRoutes } from "./routes/stats";
import { providersRoutes } from "./routes/providers";
import { bookingsRoutes } from "./routes/bookings";
import { paymentsRoutes } from "./routes/payments";
import { ratingsRoutes } from "./routes/ratings";
import { uploadsRoutes } from "./routes/uploads";
import { walletRoutes } from "./routes/wallet";
import { trackingRoutes } from "./routes/tracking";
import { geoRoutes } from "./routes/geo";
import { geoIntelligenceRoutes } from "./routes/geo-intelligence";
import { pricingRoutes } from "./routes/pricing";
import { customerIntelligenceRoutes } from "./routes/customer-intelligence";
import { digitalTwinRoutes } from "./routes/digital-twin";
import { mlopsRoutes } from "./routes/mlops";
import { analyticsRoutes } from "./routes/analytics";
import { partnerNavRoutes } from "./routes/partner-nav";
import { vitalsRoutes } from "./routes/vitals";
import { uxSignalsRoutes } from "./routes/ux-signals";
import { weatherRoutes } from "./routes/weather";
import { notificationsRoutes } from "./routes/notifications";
import { adminApiRoutes } from "./routes/admin";
import { partnerRegisterRoutes } from "./routes/partner-register";
import { webhooksRoutes } from "./routes/webhooks";
import { aiRoutes } from "./routes/ai";
import { aiGatewayRoutes } from "./routes/ai-gateway.routes";
import { trackingWs } from "./websocket/tracking.ws";
import { notificationsWs } from "./websocket/notifications.ws";
import { bookingWs } from "./websocket/booking.ws";
import { earningsWs } from "./websocket/earnings.ws";
import { adminOpsWs } from "./websocket/admin-ops.ws";
import { roomManager } from "./lib/websocket";
import { redisClient } from "./lib/redis";
import { observability } from "./lib/observability";
import { startMaintenance, stopMaintenance, runStartupFinancialIntegrity } from "./lib/maintenance";
import prisma from "./lib/prisma";
import { errorMiddleware } from "./middleware/error.middleware";
import { requestContextPlugin } from "./middleware/request-context.middleware";
import { requestLoggerPlugin } from "./middleware/request-logger.middleware";
import { apiRateLimitPlugin } from "./middleware/api-rate-limit.middleware";
import { metricsPlugin } from "./middleware/metrics.middleware";
import { idempotencyPlugin } from "./middleware/idempotency.middleware";
import { applySecurityHeaders } from "./middleware/security.middleware";
import { observabilityRoutes } from "./routes/observability";
import { legalRoutes } from "./routes/legal";
import { complianceRoutes } from "./routes/compliance";
import { assertProductionConfig } from "./lib/production-config";
import { assertLogGovernance } from "./lib/log-governance";
import { rbacService } from "./services/rbac.service";
import { keyManagementService } from "./services/key-management.service";
import { authPlugin } from "./plugins/auth.plugin";
import { adminRbacPlugin } from "./middleware/admin-rbac";

type RootResponse = {
  status: "ok";
  message: "HOMIGO Backend Running 🚀";
  environment: string;
};

const port = Number(process.env.PORT || 3000);
const environment = process.env.NODE_ENV || "development";
const appEnvironment = process.env.APP_ENV || environment;
const isDev = environment !== "production";

// Production CORS allowlist. Built-in defaults are merged with env-configured
// origins so a deployer can point the frontends at their own domains WITHOUT
// editing source: set FRONTEND_URL / PARTNER_WEB_URL / ADMIN_WEB_URL and/or a
// comma-separated ALLOWED_ORIGINS. (In dev, LAN reflection below takes over.)
const envOrigins = [
  process.env.FRONTEND_URL,
  process.env.PARTNER_WEB_URL,
  process.env.ADMIN_WEB_URL,
  ...(process.env.ALLOWED_ORIGINS?.split(",") ?? []),
]
  .map((o) => o?.trim().replace(/\/$/, ""))
  .filter((o): o is string => typeof o === "string" && /^https?:\/\//.test(o));

const allowedOrigins = new Set([
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "https://homigo.com",
  "https://partner.homigo.com",
  "https://admin.homigo.com",
  ...envOrigins,
]);

const fraudAllowedHeaders = [
  "X-Device-Id",
  "X-Device-Fingerprint",
  "X-Browser-Fingerprint",
  "X-Timezone",
  "X-Country",
];

/** OpenTelemetry + Sentry distributed tracing headers (admin/customer panels send these). */
const tracingAllowedHeaders = [
  "baggage",
  "traceparent",
  "tracestate",
  "sentry-trace",
  "b3",
  "x-b3-traceid",
  "x-b3-spanid",
  "x-b3-sampled",
];

const standardAllowedHeaders = [
  "Content-Type",
  "Authorization",
  "X-Requested-With",
  ...fraudAllowedHeaders,
  ...tracingAllowedHeaders,
];

const corsConfig = isDev
  ? {
      // Dev: reflect localhost AND private-LAN origins (any port) so phone/Expo and
      // other-device browsers on the same network can reach the API. Public origins
      // (e.g. evil.com) are still NOT reflected — that keeps the CORS-reflection fix
      // while not breaking real LAN/mobile dev. Production stays a strict allowlist.
      origin: [
        /^http:\/\/localhost:\d+$/,
        /^http:\/\/127\.0\.0\.1:\d+$/,
        /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/,
        /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}:\d+$/,
        /^http:\/\/172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}:\d+$/,
      ],
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: standardAllowedHeaders,
      exposeHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
      ],
      maxAge: 86400,
    }
  : {
      origin: Array.from(allowedOrigins),
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: standardAllowedHeaders,
      exposeHeaders: [
        "Content-Type",
        "Authorization",
        "X-Request-ID",
        "Retry-After",
        "X-RateLimit-Limit",
        "X-RateLimit-Remaining",
        "X-RateLimit-Reset",
      ],
      maxAge: 86400,
    };

const app = new Elysia()
  // Root-level onRequest → security headers on EVERY response (incl. errors/404s).
  .onRequest(applySecurityHeaders)
  .use(errorMiddleware)
  .use(requestContextPlugin)
  .use(requestLoggerPlugin)
  .use(apiRateLimitPlugin)
  .use(metricsPlugin)
  .use(idempotencyPlugin)
  .use(cors(corsConfig))
  .use(isDev ? swagger() : new Elysia())
  .use(observabilityRoutes)
  .use(authRoutes)
  .use(userRoutes)
  .use(servicesRoutes)
  .use(statsRoutes)
  .use(providersRoutes)
  .use(bookingsRoutes)
  .use(paymentsRoutes)
  .use(ratingsRoutes)
  .use(uploadsRoutes)
  .use(walletRoutes)
  .use(trackingRoutes)
  .use(geoRoutes)
  .use(geoIntelligenceRoutes)
  .use(pricingRoutes)
  .use(customerIntelligenceRoutes)
  .use(digitalTwinRoutes)
  .use(mlopsRoutes)
  .use(analyticsRoutes)
  .use(partnerNavRoutes)
  .use(vitalsRoutes)
  .use(uxSignalsRoutes)
  .use(weatherRoutes)
  .use(notificationsRoutes)
  .use(aiRoutes)
  .use(aiGatewayRoutes)
  .use(adminApiRoutes)
  .use(subscriptionsRoutes)
  .use(supportRoutes)
  .use(referralsRoutes)
  .use(hcoinsRoutes)
  .use(giftCardsRoutes)
  .use(legalRoutes)
  .use(complianceRoutes)
  .use(partnerRegisterRoutes)
  .use(webhooksRoutes)
  .use(trackingWs)
  .use(notificationsWs)
  .use(bookingWs)
  .use(earningsWs)
  .use(adminOpsWs)
  .get("/", (): RootResponse => ({
    status: "ok",
    message: "HOMIGO Backend Running 🚀",
    environment: appEnvironment,
  }))
  .get("/health", async () => {
    const database = await prisma
      .$queryRaw`SELECT 1`
      .then(() => "ok" as const)
      .catch(() => "down" as const);
    // Redis is optional: "disabled" when no REDIS_URL, "degraded" when configured
    // but unreachable (the app keeps working via in-memory fallback).
    const redis = !redisClient.isEnabled
      ? ("disabled" as const)
      : (await redisClient.healthCheck())
        ? ("ok" as const)
        : ("degraded" as const);
    return {
      status: database === "ok" ? "ok" : "degraded",
      message: "HOMIGO Backend is running!",
      timestamp: new Date().toISOString(),
      environment: appEnvironment,
      services: { database, redis },
    };
  })
  .use(authPlugin)
  .use(adminRbacPlugin)
  .get("/api/v1/ws/stats", ({ requireAdminContext }) => {
    requireAdminContext();
    return {
      success: true,
      data: roomManager.getStats(),
      timestamp: new Date().toISOString(),
    };
  })
  .get("/api/v1/status", () => ({
    app: "HOMIGO",
    version: "1.0.0",
    tagline: "The Future of Home Services",
    status: "running",
    uptime: process.uptime(),
    endpoints: {
      auth: 9,
      users: 11,
      services: 5,
      providers: 6,
      bookings: 9,
      payments: 5,
      ratings: 4,
      wallet: 5,
      tracking: 3,
      notifications: 4,
      admin: 7,
      websockets: 5,
    },
  }));

// Optional Redis: connect on boot (non-blocking) and close cleanly on shutdown.
// If REDIS_URL is unset this is a no-op and the app runs fully in-memory.
app.onStart(() => {
  void rbacService.bootstrap().catch((err) => {
    console.error("RBAC bootstrap failed:", err);
  });
  void keyManagementService.bootstrap().catch((err) => {
    console.error("Encryption key bootstrap failed:", err);
  });
  void observability.init();
  // Register live Prometheus gauge samplers (DB pool, integrity, dispatch acceptance).
  void import("./lib/metrics-init").then((m) => m.initMetricsAtZero()).catch(() => undefined);
  void import("./lib/metrics-samplers").then((m) => m.registerMetricSamplers()).catch(() => undefined);
  void import("./lib/backup-metrics-sampler").then((m) => m.registerBackupMetricSamplers()).catch(() => undefined);
  void import("./lib/websocket-metrics-sampler").then((m) => m.registerWebSocketMetricSamplers()).catch(() => undefined);
  void import("./lib/geo-metrics").then((m) => m.registerGeoMetricSamplers()).catch(() => undefined);
  void import("./lib/finops-metrics").then((m) => m.registerFinOpsSamplers()).catch(() => undefined);
  void import("./lib/log-health.service").then((m) => m.registerLogHealthSamplers()).catch(() => undefined);
  void import("./lib/partner-exec-metrics").then((m) => m.registerPartnerExecSamplers()).catch(() => undefined);
  void import("./lib/finance-intelligence-metrics").then((m) => m.registerFinanceIntelligenceSamplers()).catch(() => undefined);
  void import("./lib/enterprise-intelligence-metrics").then((m) => m.registerEnterpriseIntelligenceSamplers()).catch(() => undefined);
  void import("./services/mlops.service").then((m) => m.registerMlopsSamplers()).catch(() => undefined);
  void import("./lib/etl-metrics").then((m) => { m.initEtlMetricsAtZero(); m.registerEtlMetricSamplers(); }).catch(() => undefined);
  void import("./lib/eta-metrics").then((m) => { m.initEtaMetricsAtZero(); m.registerEtaMetricSamplers(); }).catch(() => undefined);
  void import("./lib/ai-metrics").then((m) => { m.initAiMetricsAtZero(); m.registerAiMetricSamplers(); }).catch(() => undefined);
  void import("./ai/templates/prompt-templates").then((m) => m.seedPromptTemplates()).catch(() => undefined);
  void redisClient.connect().then(() => {
    redisClient.startHealthChecking();
    // Cross-instance WebSocket fan-out (no-op when Redis is disabled).
    void roomManager.initRedisFanout();
  });
  void runStartupFinancialIntegrity().catch((err) => {
    console.error("Startup financial integrity failed:", err);
    if (process.env.BLOCK_BOOT_ON_INTEGRITY_FAIL === "true") process.exit(1);
  });
  void import("./events/consumers").then((m) => m.bootstrapEventConsumers()).catch((err) => {
    console.error("Event consumer bootstrap failed:", err);
  });
  startMaintenance();
});
// Idempotent graceful shutdown — releases the Prisma pool, Redis, and timers exactly once.
// Wired to BOTH Elysia's onStop AND raw process signals, because onStop does not fire on
// SIGTERM/SIGINT or `bun --watch` reloads — without this, killed processes leak their
// connection pool until Postgres reaps them (the "idle connections pile up" symptom).
let shuttingDown = false;
async function gracefulShutdown(reason: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    stopMaintenance();
    await roomManager.stopRedisFanout();
    await redisClient.disconnect();
    await observability.flush();
    await prisma.$disconnect();
    console.log(`[shutdown] clean (${reason}) — Prisma pool released`);
  } catch (err) {
    console.error(`[shutdown] error during ${reason}:`, err);
  }
}

app.onStop(async () => {
  await gracefulShutdown("elysia:onStop");
});

// SIGTERM (orchestrator stop) + SIGINT (Ctrl-C) — the portable graceful-shutdown signals.
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    void gracefulShutdown(sig).finally(() => process.exit(0));
  });
}

// Last-resort process guards. Sentry only installs these when a DSN is set, so a
// deployment without Sentry would otherwise crash silently (no log, no report) on
// a stray throw/rejection. Report + log always; on a fatal uncaughtException, shut
// down cleanly and exit non-zero so the orchestrator restarts a healthy process.
process.on("unhandledRejection", (reason) => {
  observability.captureException(reason, { level: "error", extra: { kind: "unhandledRejection" } });
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  observability.captureException(err, { level: "fatal", extra: { kind: "uncaughtException" } });
  console.error("[uncaughtException]", err);
  void gracefulShutdown("uncaughtException").finally(() => process.exit(1));
});

if (import.meta.main) {
  // Log governance guardrail — HARD-FAIL boot if anyone configured INFO/WARN/DEBUG → DB.
  // Runs in every environment so the 699 MB log explosion can never be re-enabled by a config slip.
  assertLogGovernance();
  if (!isDev) {
    await redisClient.connect();
    assertProductionConfig();
  }
  app.listen(port, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║        🚀 HOMIGO BACKEND RUNNING       ║
    ║     The Future of Home Services        ║
    ╠════════════════════════════════════════╣
    ║ 📍 Server: http://localhost:${port}       ║
    ║ 📚 Swagger: http://localhost:${port}/swagger
    ║ 💚 Health: http://localhost:${port}/health
    ║ 🔧 Environment: ${environment}
    ║ 📡 REST API: 63+ endpoints (Part 3)     ║
    ╚════════════════════════════════════════╝
    `);
  });
}

export default app;
