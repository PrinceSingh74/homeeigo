/**
 * City Digital Twin API (Phase-4 Track 4) — ADMIN only.
 * Aggregation + simulation over verified services. Every response carries confidence + freshness.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { digitalTwinService as svc, SUPPORTED_CITIES } from "../services/digital-twin.service";

export const digitalTwinRoutes = new Elysia({ prefix: "/api/digital-twin" })
  .use(authPlugin)

  .get("/cities", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, supported: SUPPORTED_CITIES, ...(await svc.cities()) };
  })

  .get("/:city", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.cityTwin(params.city)) };
  })

  .get("/:city/insights", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.executiveInsights(params.city)) };
  })

  .post("/:city/simulate", async ({ requireRole, params, body }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.simulate(params.city, body)) };
  }, {
    body: t.Object({
      demandDeltaPct: t.Optional(t.Number()),
      providerDeltaPct: t.Optional(t.Number()),
      trafficDeltaPct: t.Optional(t.Number()),
      rainStart: t.Optional(t.Boolean()),
      festival: t.Optional(t.Boolean()),
    }),
  });
