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
import { notificationsRoutes } from "./routes/notifications";
import { adminApiRoutes } from "./routes/admin";
import { partnerRegisterRoutes } from "./routes/partner-register";
import { aiRoutes } from "./routes/ai";
import { trackingWs } from "./websocket/tracking.ws";
import { notificationsWs } from "./websocket/notifications.ws";
import { bookingWs } from "./websocket/booking.ws";
import { earningsWs } from "./websocket/earnings.ws";
import { roomManager } from "./lib/websocket";
import { redisClient } from "./lib/redis";
import { observability } from "./lib/observability";
import { startMaintenance, stopMaintenance } from "./lib/maintenance";
import prisma from "./lib/prisma";
import { errorMiddleware } from "./middleware/error.middleware";
import { requestContextPlugin } from "./middleware/request-context.middleware";
import { requestLoggerPlugin } from "./middleware/request-logger.middleware";
import { apiRateLimitPlugin } from "./middleware/api-rate-limit.middleware";
import { metricsPlugin } from "./middleware/metrics.middleware";
import { securityHeadersPlugin } from "./middleware/security.middleware";
import { observabilityRoutes } from "./routes/observability";
import { legalRoutes } from "./routes/legal";
import { assertProductionConfig } from "./lib/production-config";

type RootResponse = {
  status: "ok";
  message: "HOMIGO Backend Running 🚀";
  environment: string;
};

const port = Number(process.env.PORT || 3000);
const environment = process.env.NODE_ENV || "development";
const isDev = environment !== "production";

const allowedOrigins = new Set([
  "http://localhost:3001",
  "http://localhost:3002",
  "http://localhost:3003",
  "https://homigo.com",
  "https://partner.homigo.com",
  "https://admin.homigo.com",
]);

const fraudAllowedHeaders = [
  "X-Device-Id",
  "X-Device-Fingerprint",
  "X-Browser-Fingerprint",
  "X-Timezone",
  "X-Country",
];

const corsConfig = isDev
  ? {
      origin: true as const,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", ...fraudAllowedHeaders],
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
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With", ...fraudAllowedHeaders],
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
  .use(errorMiddleware)
  .use(requestContextPlugin)
  .use(requestLoggerPlugin)
  .use(securityHeadersPlugin)
  .use(apiRateLimitPlugin)
  .use(metricsPlugin)
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
  .use(notificationsRoutes)
  .use(aiRoutes)
  .use(adminApiRoutes)
  .use(subscriptionsRoutes)
  .use(supportRoutes)
  .use(referralsRoutes)
  .use(hcoinsRoutes)
  .use(giftCardsRoutes)
  .use(legalRoutes)
  .use(partnerRegisterRoutes)
  .use(trackingWs)
  .use(notificationsWs)
  .use(bookingWs)
  .use(earningsWs)
  .get("/", (): RootResponse => ({
    status: "ok",
    message: "HOMIGO Backend Running 🚀",
    environment,
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
      environment,
      services: { database, redis },
    };
  })
  .get("/api/v1/ws/stats", () => ({
    success: true,
    data: roomManager.getStats(),
    timestamp: new Date().toISOString(),
  }))
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
      websockets: 4,
    },
  }));

// Optional Redis: connect on boot (non-blocking) and close cleanly on shutdown.
// If REDIS_URL is unset this is a no-op and the app runs fully in-memory.
app.onStart(() => {
  void observability.init();
  void redisClient.connect().then(() => {
    redisClient.startHealthChecking();
    // Cross-instance WebSocket fan-out (no-op when Redis is disabled).
    void roomManager.initRedisFanout();
  });
  startMaintenance();
});
app.onStop(async () => {
  stopMaintenance();
  await roomManager.stopRedisFanout();
  await redisClient.disconnect();
  await observability.flush();
});

if (import.meta.main) {
  if (!isDev) {
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
