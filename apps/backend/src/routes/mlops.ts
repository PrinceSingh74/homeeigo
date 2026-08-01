/**
 * MLOps / AI-Operations API (Phase-4 Track 5) — ADMIN only.
 * Exposes the BigQuery model registry, governance metrics, data quality and platform health.
 */
import { Elysia } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { mlopsService as svc } from "../services/mlops.service";

export const mlopsRoutes = new Elysia({ prefix: "/api/mlops" })
  .use(authPlugin)
  .get("/registry", async ({ requireRole }) => { requireRole("ADMIN"); return { success: true, ...(await svc.registry()) }; })
  .get("/data-quality", async ({ requireRole }) => { requireRole("ADMIN"); return { success: true, data: await svc.dataQuality(), generatedAt: new Date().toISOString() }; })
  .get("/health", async ({ requireRole }) => { requireRole("ADMIN"); return { success: true, data: await svc.health() }; });
