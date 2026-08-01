/**
 * Dynamic Pricing API (Phase-4 Track 2) — the intelligence/recommendation layer.
 * Checkout pricing remains owned by booking-pricing.service; this exposes the live
 * multiplier stack, revenue-optimal price, surge forecast and A/B assignment.
 *
 * RBAC: any authenticated user (quotes/forecasts are customer + partner + admin facing).
 * Every response carries confidence + freshness.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { dynamicPricingService as svc } from "../services/dynamic-pricing.service";

export const pricingRoutes = new Elysia({ prefix: "/api/pricing" })
  .use(authPlugin)

  .get("/quote", async ({ requireAuth, query, set }) => {
    requireAuth();
    const baseFare = Number(query.baseFare);
    const fromLat = Number(query.fromLat), fromLng = Number(query.fromLng), toLat = Number(query.toLat), toLng = Number(query.toLng);
    if ([baseFare, fromLat, fromLng, toLat, toLng].some((n) => Number.isNaN(n))) {
      set.status = 400;
      return { success: false, error: "baseFare,fromLat,fromLng,toLat,toLng required" };
    }
    return { success: true, ...(await svc.quote({ baseFare, from: { lat: fromLat, lng: fromLng }, to: { lat: toLat, lng: toLng } })) };
  }, { query: t.Object({ baseFare: t.String(), fromLat: t.String(), fromLng: t.String(), toLat: t.String(), toLng: t.String() }) })

  .get("/surge-forecast", async ({ requireAuth, query, set }) => {
    requireAuth();
    const lat = Number(query.lat), lng = Number(query.lng);
    if ([lat, lng].some((n) => Number.isNaN(n))) {
      set.status = 400;
      return { success: false, error: "lat,lng required" };
    }
    return { success: true, ...(await svc.surgeForecast({ lat, lng })) };
  }, { query: t.Object({ lat: t.String(), lng: t.String() }) })

  .get("/experiment", async ({ requireAuth }) => {
    const u = requireAuth();
    return { success: true, data: svc.assignExperiment(u.userId), generatedAt: new Date().toISOString() };
  });
