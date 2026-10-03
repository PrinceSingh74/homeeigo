/**
 * Dynamic Pricing API (Phase-4 Track 2) — the intelligence/recommendation layer.
 * Checkout pricing remains owned by booking-pricing.service; this exposes the live
 * multiplier stack, revenue-optimal price, surge forecast and A/B assignment.
 *
 * RBAC (2026-09-21): /quote and /experiment are ADMIN-only. `/quote` returns a *recommended* price that
 * checkout never charges; exposing it to customers created a second, contradictory "quote" beside the
 * authoritative POST /api/bookings/price-quote. No frontend consumed it. /surge-forecast (demand
 * pressure, no money) stays available to any authenticated user.
 * Every response carries confidence + freshness.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { dynamicPricingService as svc } from "../services/dynamic-pricing.service";

export const pricingRoutes = new Elysia({ prefix: "/api/pricing" })
  .use(authPlugin)

  .get("/quote", async ({ requireRole, query, set }) => {
    requireRole("ADMIN");
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

  .get("/experiment", async ({ requireRole }) => {
    const u = requireRole("ADMIN");
    return { success: true, data: await svc.assignExperiment(u.userId), generatedAt: new Date().toISOString() };
  });
