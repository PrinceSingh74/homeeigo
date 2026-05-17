import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

const app = new Elysia()
  .use(cors())
  .use(swagger())

  // Health check endpoint
  .get("/health", () => ({
    status: "ok",
    message: "HOMIGO Backend is running!",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
  }))

  // API version endpoint
  .get("/api/v1/status", () => ({
    app: "HOMIGO",
    version: "1.0.0",
    tagline: "The Future of Home Services",
    status: "running",
    uptime: process.uptime(),
  }))

  // Basic test endpoint
  .post("/api/v1/test", ({ body }) => {
    return {
      received: body,
      message: "Backend is working!",
      timestamp: new Date().toISOString(),
    };
  })

  .listen(process.env.PORT || 3000, () => {
    console.log(`
    ╔════════════════════════════════════════╗
    ║        🚀 HOMIGO BACKEND RUNNING       ║
    ║     The Future of Home Services        ║
    ╠════════════════════════════════════════╣
    ║ 📍 Server: http://localhost:3000       ║
    ║ 📚 Swagger: http://localhost:3000/swagger
    ║ 💚 Health: http://localhost:3000/health
    ║ 🔧 Environment: ${process.env.NODE_ENV}
    ╚════════════════════════════════════════╝
    `);
  });

export default app;
