/**
 * MLOps / AI-Operations API (Phase-4 Track 5) — ADMIN only.
 * Exposes the BigQuery model registry, governance metrics, data quality and platform health.
 */
import { Elysia } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { mlopsService as svc, readDataQuality, readRegistry } from "../services/mlops.service";

/**
 * A warehouse outage is a stated `available: false` with a reason code and no figures — not a 500
 * (X-88; the same contract as the X-84 demand forecast). The healthy answers are unchanged, plus
 * `available: true`.
 */
export const mlopsRoutes = new Elysia({ prefix: "/api/mlops" })
  .use(authPlugin)
  .get("/registry", async ({ requireRole }) => {
    requireRole("ADMIN");
    const r = await readRegistry(() => svc.registry());
    return r.available ? { success: true, available: true, ...r.value } : { success: true, ...r };
  })
  .get("/data-quality", async ({ requireRole }) => {
    requireRole("ADMIN");
    const r = await readDataQuality(() => svc.dataQuality());
    return r.available
      ? { success: true, available: true, data: r.value, generatedAt: new Date().toISOString() }
      : { success: true, ...r };
  })
  .get("/health", async ({ requireRole }) => {
    requireRole("ADMIN");
    const r = await readRegistry(() => svc.health());
    return r.available ? { success: true, available: true, data: r.value } : { success: true, ...r };
  })
  .get("/metrics", async ({ requireRole }) => {
    requireRole("ADMIN");
    const r = await readRegistry(() => svc.modelMetrics());
    return r.available ? { success: true, available: true, ...r.value } : { success: true, ...r };
  });
