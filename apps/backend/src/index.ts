import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { partnerRoutes } from "./modules/partner/routes";
import { adminRoutes } from "./modules/admin/routes";
import { authRoutes } from "./routes/auth";
import { userRoutes } from "./routes/user";
import { errorMiddleware } from "./middleware/error.middleware";
import { apiRateLimitPlugin } from "./middleware/api-rate-limit.middleware";
import { securityHeadersPlugin } from "./middleware/security.middleware";

type RootResponse = {
  status: "ok";
  message: "HOMIGO Backend Running 🚀";
  environment: string;
};

const port = Number(process.env.PORT || 3000);
const environment = process.env.NODE_ENV || "development";

const app = new Elysia()
  .use(errorMiddleware)
  .use(securityHeadersPlugin)
  .use(apiRateLimitPlugin)
  .use(
    cors({
      origin: [
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:3003",
        "https://homigo.com",
        "https://partner.homigo.com",
        "https://admin.homigo.com",
      ],
    })
  )
  .use(swagger())
  .use(authRoutes)
  .use(userRoutes)
  .use(partnerRoutes)
  .use(adminRoutes)
  .get("/", (): RootResponse => ({
    status: "ok",
    message: "HOMIGO Backend Running 🚀",
    environment,
  }))
  .get("/health", () => ({
    status: "ok",
    message: "HOMIGO Backend is running!",
    timestamp: new Date().toISOString(),
    environment,
  }))
  .get("/api/v1/status", () => ({
    app: "HOMIGO",
    version: "1.0.0",
    tagline: "The Future of Home Services",
    status: "running",
    uptime: process.uptime(),
  }))
  .post("/api/v1/test", ({ body }) => ({
    received: body,
    message: "Backend is working!",
    timestamp: new Date().toISOString(),
  }))
  .listen(port, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║        🚀 HOMIGO BACKEND RUNNING       ║
    ║     The Future of Home Services        ║
    ╠════════════════════════════════════════╣
    ║ 📍 Server: http://localhost:${port}       ║
    ║ 📚 Swagger: http://localhost:${port}/swagger
    ║ 💚 Health: http://localhost:${port}/health
    ║ 🔧 Environment: ${environment}
    ╚════════════════════════════════════════╝
    `);
  });

export default app;
