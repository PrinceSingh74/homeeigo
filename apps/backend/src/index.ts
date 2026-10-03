import "./load-env";
import { describeDatabaseTarget, isIsolatedDatabase } from "./lib/chaos-isolation";
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
import { adminMlRoutes } from "./routes/admin-ml";
import { adminGovernanceRoutes } from "./routes/admin-governance";
import { adminCapabilitiesRoutes } from "./routes/admin-capabilities";
import { bookingCasesRoutes } from "./routes/booking-cases";
import { providerCapabilitiesRoutes } from "./routes/provider-capabilities";
import { analyticsRoutes } from "./routes/analytics";
import { partnerNavRoutes } from "./routes/partner-nav";
import { knowledgeRoutes } from "./routes/knowledge";
import { vitalsRoutes } from "./routes/vitals";
import { uxSignalsRoutes } from "./routes/ux-signals";
import { weatherRoutes } from "./routes/weather";
import { notificationsRoutes } from "./routes/notifications";
import { adminApiRoutes } from "./routes/admin";
import { partnerRegisterRoutes } from "./routes/partner-register";
import { webhooksRoutes } from "./routes/webhooks";
import { aiRoutes } from "./routes/ai";
import { aiGatewayRoutes } from "./routes/ai-gateway.routes";
import { aiBrainRoutes } from "./routes/ai-brain.routes";
import { aiToolsRoutes } from "./routes/ai-tools.routes";
import { agentsRoutes } from "./routes/agents.routes";
import { visionRoutes } from "./routes/vision.routes";
import { trackingWs } from "./websocket/tracking.ws";
import { notificationsWs } from "./websocket/notifications.ws";
import { bookingWs } from "./websocket/booking.ws";
import { earningsWs } from "./websocket/earnings.ws";
import { adminOpsWs } from "./websocket/admin-ops.ws";
import { roomManager } from "./lib/websocket";
import { redisClient } from "./lib/redis";
import {
  startFeatureFlagInvalidationListener,
  stopFeatureFlagInvalidationListener,
} from "./services/feature-flag.service";
import { observability } from "./lib/observability";
import { startMaintenance, stopMaintenance, runStartupFinancialIntegrity } from "./lib/maintenance";
import prisma from "./lib/prisma";
import { disconnectLeaderAnchors } from "./lib/distributed-scheduler";
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
import { assertProductionConfig, productionConfigWarnings } from "./lib/production-config";
import { isDeployedEnvironment } from "./lib/deployed-environment";
import { createDependencyProbe, isDraining, markDraining, shutdownDrainMs } from "./lib/probe-health";
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
/**
 * Whether this process may use developer-machine behaviour: permissive LAN CORS, localhost console
 * origins, Swagger, skipping the Redis connect, and skipping `assertProductionConfig`.
 *
 * This was `environment !== "production"`. `.env.staging` ships NODE_ENV=development, so on staging
 * all five were on: any private-LAN origin was reflected with credentials, Swagger was served, and
 * the production configuration guard never ran. Keyed on deployment now — see lib/deployed-environment.
 */
const isDev = !isDeployedEnvironment();

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

/**
 * `http://localhost:3001|3002|3003` used to be members of this set unconditionally, and this set is
 * the allowlist for the NON-dev branch of `corsConfig` — the one that runs with `credentials: true`
 * on a deployed host. A production API therefore honoured credentialed cross-origin requests from
 * anything served on those local ports, which is a browser-reachable origin on every machine.
 *
 * Dev does not need them here: the dev branch below reflects localhost and private-LAN origins by
 * regex. A deployer who genuinely wants a local origin against a deployed API can still add one
 * through `ALLOWED_ORIGINS`, which is an explicit act rather than a default.
 */
const LOCAL_CONSOLE_ORIGINS = ["http://localhost:3001", "http://localhost:3002", "http://localhost:3003"];

const allowedOrigins = new Set([
  ...(isDev ? LOCAL_CONSOLE_ORIGINS : []),
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
  "X-Registration-Token",
  /**
   * The web apps declare which audience they are so the API can pick their HttpOnly refresh cookie
   * (lib/auth-cookies.ts). It must be allowlisted here or the browser's preflight fails and login
   * never leaves the page — which is also exactly why the header works as a CSRF control: another
   * origin cannot send it without a preflight this allowlist refuses.
   */
  "X-Homigo-Audience",
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

/**
 * Built in two segments rather than as one 54-link chain.
 *
 * Elysia carries the accumulated route, decorator and store types forward through every `.use()`,
 * so the type of the chain grows with each link. At this size the instantiation exceeded
 * TypeScript's depth limit and the whole expression collapsed to `any`-ish with TS2589 — meaning
 * the file was, in practice, the least type-checked part of the server.
 *
 * Splitting is safe because `.use()` MUTATES and returns the same instance (verified against
 * elysia 1.4.29): the second segment registers onto the very same `app`, in the same order, with
 * the same plugin scoping. Only the amount of type TypeScript carries forward changes. Nothing
 * consumes `typeof app` — there is no Eden treaty client — so the type each segment builds is
 * simply discarded. No annotation, no cast and no `any` is involved.
 */
const dependencyProbe = createDependencyProbe(async () => {
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
  return { database, redis };
});

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
  .use(observabilityRoutes);

// Segment 2 — same instance, same order; see the note above.
app
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
  .use(adminMlRoutes)
  .use(adminGovernanceRoutes)
  .use(adminCapabilitiesRoutes)
  .use(bookingCasesRoutes)
  .use(providerCapabilitiesRoutes)
  .use(analyticsRoutes)
  .use(partnerNavRoutes)
  .use(knowledgeRoutes);

app
  .use(vitalsRoutes)
  .use(uxSignalsRoutes)
  .use(weatherRoutes)
  .use(notificationsRoutes)
  .use(aiRoutes)
  .use(aiGatewayRoutes)
  .use(aiBrainRoutes)
  .use(aiToolsRoutes)
  .use(agentsRoutes)
  .use(visionRoutes)
  .use(adminApiRoutes);

app
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
  .use(adminOpsWs);

app
  .get("/", (): RootResponse => ({
    status: "ok",
    message: "HOMIGO Backend Running 🚀",
    environment: appEnvironment,
  }))
  .get("/livez", () => ({ status: "alive" }))
  .get("/readyz", async ({ set }) => {
    const { database } = await dependencyProbe();
    const ready = database === "ok" && !isDraining();
    if (!ready) set.status = 503;
    return { status: ready ? "ready" : isDraining() ? "draining" : "unavailable" };
  })
  .get("/health", async () => {
    // Cached single-flight check (lib/probe-health): /health is public and unauthenticated, and used
    // to spend a pooled connection on every hit.
    const { database, redis } = await dependencyProbe();
    return {
      status: database === "ok" ? "ok" : "degraded",
      message: "HOMIGO Backend is running!",
      timestamp: new Date().toISOString(),
      environment: appEnvironment,
      services: { database, redis },
      /**
       * Whether this process is attached to a disposable database.
       *
       * Section 7 drives load, saturation, duplicate execution and crash recovery through HTTP, and
       * a harness pointed at a base URL has no other way to learn which database it is about to
       * write to — the target is a property of the SERVER, not of the harness's own environment.
       * `lib/chaos-isolation.assertServerTargetIsolated` reads this and refuses to run when it is
       * false or absent, so a destructive scenario aimed at the wrong box stops before the first
       * write instead of after it.
       *
       * A boolean rather than the database name on purpose: `/health` is public (it is mounted
       * before `authPlugin`), and the harness needs the verdict, not the identifier. This discloses
       * no more than `environment` already does.
       */
      isolatedDatabase: isIsolatedDatabase(describeDatabaseTarget()?.databaseName ?? ""),
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
  // Phase-12 platform health (ETL freshness, warehouse age, forecast horizon, registry reconciliation).
  // Written in Phase 12 and never registered, so `ml_platform_serviceable` and `ml_platform_check_state`
  // existed in code and never reached Prometheus — a producer with no collection is not a metric.
  void import("./services/ml-platform-health.service").then((m) => m.registerMlPlatformHealthSamplers()).catch(() => undefined);
  void import("./lib/etl-metrics").then((m) => { m.initEtlMetricsAtZero(); m.registerEtlMetricSamplers(); }).catch(() => undefined);
  /**
   * Standing refund backlog. `refund_indeterminate_total` is a counter and answers how many BECAME
   * indeterminate, never how many still are — so 53 rows aged 16–35 days had no series any alert
   * could key on.
   */
  void import("./lib/refund-backlog-metrics").then((m) => { m.initRefundBacklogMetricsAtZero(); m.registerRefundBacklogSamplers(); }).catch(() => undefined);
  void import("./lib/eta-metrics").then((m) => { m.initEtaMetricsAtZero(); m.registerEtaMetricSamplers(); }).catch(() => undefined);
  void import("./lib/ai-metrics").then((m) => { m.initAiMetricsAtZero(); m.registerAiMetricSamplers(); }).catch(() => undefined);
  void import("./lib/ai-brain-metrics").then((m) => { m.initAiBrainMetricsAtZero(); m.registerAiBrainMetricSamplers(); }).catch(() => undefined);
  void import("./lib/ai-tools-metrics").then((m) => { m.initAiToolsMetricsAtZero(); m.registerAiToolsMetricSamplers(); }).catch(() => undefined);
  // Phase-13 automation inventory. The engine counters were already wired but never seeded, so an
  // Automation dashboard could not tell "no workflow ran" from "nothing is instrumented".
  void import("./lib/automation-metrics").then((m) => { m.initAutomationMetricsAtZero(); m.registerAutomationMetricSamplers(); }).catch(() => undefined);
  /**
   * Phase-14 governance gauges. Registered like every other sampler so the controls are observable
   * on the same boards as the systems they govern, rather than only through an admin API call.
   *
   * With no budget policy configured these publish `homigo_ai_budget_policies_active = 0` and no
   * per-policy series at all — an absent cap shows as an absent series, not as a limit of zero.
   */
  void import("./services/ai-budget.service").then((m) => m.registerAiBudgetSamplers()).catch(() => undefined);
  void import("./services/workflow-recovery.service").then((m) => m.registerWorkflowRecoverySamplers()).catch(() => undefined);
  void import("./ai/templates/prompt-templates").then((m) => m.seedPromptTemplates()).catch(() => undefined);
  void import("./ai-brain/prompts/prompt-registry").then((m) => m.seedPromptRegistry()).catch(() => undefined);
  void import("./ai-tools/registry/tool-registry").then((m) => { m.initToolRegistry(); return m.seedToolRegistry(); }).catch(() => undefined);
  /**
   * Phase-16 agent layer.
   *
   * Awaited-and-logged rather than `.catch(() => undefined)` like its neighbours, because the
   * failure it can raise is different in kind. The registry throws when an agent definition
   * disagrees with the tool catalog — a read-only assistant that declares a write, a capability
   * naming a tool that has been disabled. Swallowing that would boot a backend whose agents'
   * real reach differs from their declared reach, which is precisely the state this validation
   * exists to prevent. The error is logged at SECURITY so it cannot be mistaken for a warm-up
   * hiccup.
   */
  void import("./agents")
    .then((m) => {
      m.initAgents();
      // Queued through scheduled_jobs, not a timer, so exactly one instance sweeps and a missed
      // sweep shows up as a stale job row rather than as silence.
      return m.ensureRecoverySweepScheduled();
    })
    .catch(async (err) => {
      const { logger } = await import("./lib/logger");
      logger.error("agents_init_failed", {
        category: "SECURITY",
        error: err instanceof Error ? err.message : "unknown",
      });
    });
  void redisClient.connect().then(() => {
    redisClient.startHealthChecking();
    // Cross-instance WebSocket fan-out (no-op when Redis is disabled).
    void roomManager.initRedisFanout();
    /**
     * Cross-instance feature-flag invalidation, started here for the same reason the fan-out is:
     * a subscription attempted before the connection exists silently returns nothing, and a
     * kill switch that quietly failed to subscribe is worse than one that never claimed to.
     */
    void startFeatureFlagInvalidationListener();
  });
  // A socket must not outlive the access token it was opened with (independent of Redis).
  roomManager.startTokenExpirySweep();
  void runStartupFinancialIntegrity().catch((err) => {
    console.error("Startup financial integrity failed:", err);
    if (process.env.BLOCK_BOOT_ON_INTEGRITY_FAIL === "true") process.exit(1);
  });
  void import("./events/consumers").then((m) => m.bootstrapEventConsumers()).catch((err) => {
    console.error("Event consumer bootstrap failed:", err);
    // Without consumers the outbox still marks every row PUBLISHED — events would be "delivered"
    // to nobody while every health signal stayed green. Make /ready say so.
    void import("./lib/boot-health").then((m) =>
      m.markBootDegraded("event_consumers", err, "no event consumers registered: outbox rows publish to nobody"),
    );
  });
  /**
   * §8 — state which Razorpay world this process is talking to, once, at boot.
   *
   * A credential mismatch is not a startup failure (a developer holding live keys locally must be
   * told, not blocked), but it must never be silent: a live key on a laptop and a test key on a
   * deployed host are the two ways a payment environment surprises someone. No secret is logged —
   * only the key's prefix.
   */
  void (async () => {
    const { razorpayService: rzp } = await import("./services/razorpay.service");
    const { describePaymentEnvironment } = await import("./lib/payment-environment");
    const { logger } = await import("./lib/logger");
    const verdict = rzp.paymentEnvironment;
    const line = describePaymentEnvironment(verdict);
    if (verdict.mismatch) {
      logger.error("payment_environment_mismatch", {
        category: "PAYMENT",
        environment: verdict.environment,
        mismatch: verdict.mismatch,
        keyPrefix: verdict.keyPrefix,
      });
      const { opsAlertService } = await import("./services/ops-alert.service");
      await opsAlertService
        .raise("payment_environment_mismatch", "CRITICAL", line, {
          environment: verdict.environment,
          mismatch: verdict.mismatch,
          keyPrefix: verdict.keyPrefix,
        })
        .catch(() => undefined);
    } else {
      logger.info("payment_environment", { category: "PAYMENT", environment: verdict.environment, keyPrefix: verdict.keyPrefix });
    }
  })().catch(() => undefined);

  startMaintenance();
});
// Idempotent graceful shutdown — releases the Prisma pool, Redis, and timers exactly once.
// Wired to BOTH Elysia's onStop AND raw process signals, because onStop does not fire on
// SIGTERM/SIGINT or `bun --watch` reloads — without this, killed processes leak their
// connection pool until Postgres reaps them (the "idle connections pile up" symptom).
let shuttingDown = false;
async function gracefulShutdown(reason: string, opts: { drainHttp?: boolean } = {}): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    /**
     * Drain before releasing anything (2026-10-01). The pools used to close while requests were still
     * in flight, so every request the orchestrator had already routed here failed on a closed client.
     * Now: /readyz goes 503 → wait for routing to converge → stop accepting and let in-flight requests
     * finish → then release timers, Redis and the pools.
     */
    if (opts.drainHttp) {
      markDraining();
      const drainMs = shutdownDrainMs(isDeployedEnvironment());
      if (drainMs > 0) await new Promise((r) => setTimeout(r, drainMs));
      await app.server?.stop(false);
    }
    stopMaintenance();
    await stopFeatureFlagInvalidationListener();
    roomManager.stopTokenExpirySweep();
    await roomManager.stopRedisFanout();
    await redisClient.disconnect();
    await observability.flush();
    await disconnectLeaderAnchors();
    await prisma.$disconnect();
    console.log(`[shutdown] clean (${reason}) — Prisma pools released`);
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
    void gracefulShutdown(sig, { drainHttp: true }).finally(() => process.exit(0));
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
    const configWarnings = productionConfigWarnings();
    if (configWarnings.length > 0) {
      const { logger } = await import("./lib/logger");
      for (const w of configWarnings) {
        logger.warn("production_config_warning", { category: "SECURITY", key: w.key, message: w.message });
      }
    }
  }

  /**
   * Request body cap (2026-10-01). Bun's default is 128 MB, and JSON bodies are parsed before any auth
   * check, so one unauthenticated client could make the process buffer and parse 128 MB per request.
   * The largest legitimate body is chargeback evidence (10 MB → ~13.4 MB as base64 in JSON); 25 MB
   * leaves headroom. Override with MAX_REQUEST_BODY_BYTES.
   */
  const configuredBodyCap = Number(process.env.MAX_REQUEST_BODY_BYTES);
  const maxRequestBodySize = Number.isFinite(configuredBodyCap) && configuredBodyCap > 0 ? configuredBodyCap : 25 * 1024 * 1024;
  app.listen({ port, maxRequestBodySize }, () => {
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
