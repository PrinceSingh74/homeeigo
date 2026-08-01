/**
 * Geo-Intelligence API — unified endpoints over the GeoIntelligenceService.
 * Consumed by Customer/Partner apps, the Admin command center, and Grafana.
 *
 * RBAC:
 *   ADMIN-only      : revenue-forecast, fraud, exec-kpis  (business/security sensitive)
 *   ADMIN + VENDOR  : demand-forecast, surge, zone-scoring, provider-density
 *                     (partners use these for earnings positioning — aggregate zone intel only)
 *   any authed user : eta
 * Every response carries { confidence, freshness, source, cached, generatedAt }.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { geoIntelligenceService as svc } from "../services/geo-intelligence.service";

export const geoIntelligenceRoutes = new Elysia({ prefix: "/api/geo-intel" })
  .use(authPlugin)

  // Partner + Admin --------------------------------------------------------
  .get("/demand-forecast", async ({ requireRole, query }) => {
    requireRole("ADMIN", "VENDOR");
    const horizon = Number(query.horizon ?? 24);
    return { success: true, ...(await svc.demandForecast(horizon)) };
  }, { query: t.Object({ horizon: t.Optional(t.String()) }) })

  .get("/surge", async ({ requireRole }) => {
    requireRole("ADMIN", "VENDOR");
    return { success: true, ...(await svc.surgePrediction()) };
  })

  // Any authenticated user -------------------------------------------------
  .get("/eta", async ({ requireAuth, query, set }) => {
    requireAuth();
    const fromLat = Number(query.fromLat), fromLng = Number(query.fromLng), toLat = Number(query.toLat), toLng = Number(query.toLng);
    if ([fromLat, fromLng, toLat, toLng].some((n) => Number.isNaN(n))) {
      set.status = 400;
      return { success: false, error: "fromLat,fromLng,toLat,toLng required" };
    }
    return { success: true, ...(await svc.etaPrediction({ lat: fromLat, lng: fromLng }, { lat: toLat, lng: toLng })) };
  }, { query: t.Object({ fromLat: t.String(), fromLng: t.String(), toLat: t.String(), toLng: t.String() }) })

  // Partner + Admin (aggregate zone intelligence) -------------------------
  .get("/zone-scoring", async ({ requireRole }) => {
    requireRole("ADMIN", "VENDOR");
    return { success: true, ...(await svc.zoneScoring()) };
  })

  .get("/provider-density", async ({ requireRole }) => {
    requireRole("ADMIN", "VENDOR");
    return { success: true, ...(await svc.providerDensity()) };
  })

  // Admin only -------------------------------------------------------------
  .get("/revenue-forecast", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.revenueForecast()) };
  })

  .get("/fraud", async ({ requireRole, query }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.fraudDetection(Number(query.limit ?? 50))) };
  }, { query: t.Object({ limit: t.Optional(t.String()) }) })

  .get("/exec-kpis", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.executiveKpis()) };
  });
