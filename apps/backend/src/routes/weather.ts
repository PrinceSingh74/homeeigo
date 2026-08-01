import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { weatherService } from "../services/weather.service";
import prisma from "../lib/prisma";

/** NCR Tier-0 region — always tracked first (Delhi, Gurugram, Noida). */
const NCR_CITIES = ["Delhi,IN", "Gurugram,IN", "Noida,IN"];
/** Major HOMIGO metros used to round out the overview. */
const DEFAULT_CITIES = ["Mumbai,IN", "Bengaluru,IN", "Hyderabad,IN", "Chennai,IN", "Kolkata,IN", "Pune,IN", "Ahmedabad,IN"];

const coords = t.Object({
  lat: t.Optional(t.String()),
  lng: t.Optional(t.String()),
  city: t.Optional(t.String()),
});

function parseLoc(q: { lat?: string; lng?: string; city?: string }) {
  const lat = q.lat != null ? Number(q.lat) : NaN;
  const lng = q.lng != null ? Number(q.lng) : NaN;
  return { lat, lng, city: q.city, hasCoords: Number.isFinite(lat) && Number.isFinite(lng) };
}

/**
 * Weather intelligence API — current conditions, forecast, and customer/partner
 * weather warnings. Authenticated (customers + partners). Returns
 * `{ available:false }` (never fake data) when WEATHER_API_KEY is unconfigured or
 * the upstream is unavailable.
 */
export const weatherRoutes = new Elysia({ prefix: "/api/weather" })
  .use(authPlugin)
  .get("/config", () => ({ success: true, data: { configured: weatherService.isConfigured } }))
  .get(
    "/current",
    async ({ requireAuth, query, set }) => {
      requireAuth();
      const { lat, lng, city, hasCoords } = parseLoc(query);
      const snap = city ? await weatherService.getByCity(city) : hasCoords ? await weatherService.getByCoords(lat, lng) : null;
      if (!snap) {
        return { success: true, data: { available: false, reason: weatherService.isConfigured ? "upstream_unavailable" : "not_configured" } };
      }
      return { success: true, data: { available: true, weather: snap, alerts: weatherService.alertsFor(snap) } };
    },
    { query: coords },
  )
  .get(
    "/forecast",
    async ({ requireAuth, query }) => {
      requireAuth();
      const { lat, lng, hasCoords } = parseLoc(query);
      if (!hasCoords) return { success: false, error: "lat/lng required" };
      const fc = await weatherService.getForecast(lat, lng);
      if (!fc) return { success: true, data: { available: false } };
      return { success: true, data: { available: true, forecast: fc } };
    },
    { query: coords },
  )
  .get(
    "/alerts",
    async ({ requireAuth, query }) => {
      requireAuth();
      const { lat, lng, city, hasCoords } = parseLoc(query);
      const snap = city ? await weatherService.getByCity(city) : hasCoords ? await weatherService.getByCoords(lat, lng) : null;
      if (!snap) return { success: true, data: { available: false, alerts: [] } };
      return {
        success: true,
        data: {
          available: true,
          severity: snap.severity,
          alerts: weatherService.alertsFor(snap),
          vendorImpact: weatherService.vendorAvailabilityImpact(snap),
          etaFactor: weatherService.etaAdjustmentFactor(snap),
        },
      };
    },
    { query: coords },
  )
  /** Admin weather command-center — weather + surge + vendor impact across active service areas. */
  .get("/admin/overview", async ({ requireRole }) => {
    requireRole("ADMIN");
    if (!weatherService.isConfigured) {
      return { success: true, data: { available: false, reason: "not_configured", cities: [] } };
    }
    // NCR (Tier-0) is always tracked, then distinct cities from active geofence zones, then metros.
    const zones = await prisma.geofence
      .findMany({ where: { isActive: true, city: { not: null } }, select: { city: true }, distinct: ["city"] })
      .catch(() => [] as Array<{ city: string | null }>);
    const zoneCities = zones.map((z) => z.city).filter((c): c is string => !!c).map((c) => `${c},IN`);
    const list = [...new Set([...NCR_CITIES, ...zoneCities, ...DEFAULT_CITIES])];

    const results = await Promise.all(
      list.map(async (city) => {
        const snap = await weatherService.getByCity(city);
        if (!snap) return { city, available: false };
        return {
          city,
          available: true,
          tempC: snap.tempC,
          humidity: snap.humidity,
          windSpeedKmh: snap.windSpeedKmh,
          rain1hMm: snap.rain1hMm,
          condition: snap.condition,
          description: snap.description,
          severity: snap.severity,
          surgeMultiplier: weatherService.surgeMultiplier(snap),
          etaFactor: weatherService.etaAdjustmentFactor(snap),
          vendorImpact: weatherService.vendorAvailabilityImpact(snap),
          alerts: weatherService.alertsFor(snap),
        };
      }),
    );
    const active = results.filter((r) => r.available);
    return {
      success: true,
      data: {
        available: active.length > 0,
        generatedAt: new Date().toISOString(),
        citiesTracked: list.length,
        citiesWithData: active.length,
        severeAreas: active.filter((r) => "severity" in r && (r.severity === "severe" || r.severity === "extreme")).length,
        cities: results,
      },
    };
  });
