import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { mapsService } from "../services/maps.service";
import { matchingService } from "../services/matching.service";
import { geofenceService } from "../services/geofence.service";
import { consumeRateLimitSmart } from "../middleware/rate-limit.middleware";
import { coverageRoutes } from "./coverage";

/**
 * Phase 16 — customer-facing geolocation API. Google calls are proxied server-side and
 * per-user rate-limited to cap cost. Provider matching reuses the existing
 * `matchingService` (no duplicate matching logic).
 */
const geoCoreRoutes = new Elysia({ prefix: "/api/geo" })
  .use(authPlugin)
  // Lets the client know whether live geocoding/autocomplete is available (else manual entry).
  .get("/config", () => ({ success: true, data: { mapsConfigured: mapsService.isConfigured } }))

  .get("/reverse", async ({ requireAuth, query, set }) => {
    const { userId } = requireAuth();
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (!mapsService.isWithinIndia(lat, lng)) {
      set.status = 400;
      return { success: false, error: "Coordinates outside the service area", code: "OUT_OF_AREA" };
    }
    const gate = await consumeRateLimitSmart(`geo:rev:${userId}`, 60, 60_000);
    if (!gate.allowed) {
      set.status = 429;
      return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
    }
    const address = await mapsService.reverseGeocode(lat, lng);
    return { success: true, data: { available: mapsService.isConfigured, address } };
  })

  .get("/autocomplete", async ({ requireAuth, query, set }) => {
    const { userId } = requireAuth();
    const q = String(query.q ?? "").trim();
    if (q.length < 3) return { success: true, data: { predictions: [] } };
    const gate = await consumeRateLimitSmart(`geo:ac:${userId}`, 120, 60_000);
    if (!gate.allowed) {
      set.status = 429;
      return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
    }
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    const predictions = await mapsService.autocomplete(q, {
      sessionToken: typeof query.session === "string" ? query.session : undefined,
      lat: Number.isFinite(lat) ? lat : undefined,
      lng: Number.isFinite(lng) ? lng : undefined,
    });
    return { success: true, data: { available: mapsService.isConfigured, predictions } };
  })

  .get("/place/:placeId", async ({ requireAuth, params }) => {
    requireAuth();
    const place = await mapsService.placeDetails(params.placeId);
    return { success: Boolean(place), data: place };
  })

  .get("/eta", async ({ requireAuth, query, set }) => {
    requireAuth();
    const from = { lat: Number(query.fromLat), lng: Number(query.fromLng) };
    const to = { lat: Number(query.toLat), lng: Number(query.toLng) };
    if ([from.lat, from.lng, to.lat, to.lng].some((n) => !Number.isFinite(n))) {
      set.status = 400;
      return { success: false, error: "Invalid coordinates", code: "INVALID_COORDS" };
    }
    // Weather-adjusted ETA — bad weather at the destination slows partner travel.
    return { success: true, data: await mapsService.etaWithWeather(from, to) };
  })

  // Driving route — encoded road polyline + traffic-aware distance/duration for
  // accurate on-map tracking anywhere in India. Falls back gracefully (null).
  .get("/route", async ({ requireAuth, query, set }) => {
    requireAuth();
    const from = { lat: Number(query.fromLat), lng: Number(query.fromLng) };
    const to = { lat: Number(query.toLat), lng: Number(query.toLng) };
    if ([from.lat, from.lng, to.lat, to.lng].some((n) => !Number.isFinite(n))) {
      set.status = 400;
      return { success: false, error: "Invalid coordinates", code: "INVALID_COORDS" };
    }
    const [route, eta] = await Promise.all([
      mapsService.directions(from, to),
      mapsService.etaWithWeather(from, to),
    ]);
    return {
      success: true,
      data: {
        polyline: route?.polyline ?? null,
        distanceKm: route?.distanceKm ?? eta.distanceKm,
        durationMin: route?.durationMin ?? eta.etaMinutes,
        etaMinutes: eta.etaMinutes,
        source: route ? "google" : eta.source,
      },
    };
  })

  // Is this location inside a serviceable zone? (Geofencing; opt-in — serviceable by
  // default when no SERVICE_ZONE geofences are configured.)
  .get("/serviceable", async ({ requireAuth, query, set }) => {
    requireAuth();
    const lat = Number(query.lat);
    const lng = Number(query.lng);
    if (!mapsService.isWithinIndia(lat, lng)) {
      set.status = 400;
      return { success: false, error: "Coordinates outside the service area", code: "OUT_OF_AREA" };
    }
    const result = await geofenceService.isServiceable(lat, lng, typeof query.category === "string" ? query.category : undefined);
    return { success: true, data: result };
  })

  // Report the user's current position → diff geofence membership, log ENTER/EXIT events.
  .post(
    "/checkin",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const b = body as { latitude: number; longitude: number };
      if (!mapsService.isWithinIndia(b.latitude, b.longitude)) {
        set.status = 400;
        return { success: false, error: "Coordinates outside the service area", code: "OUT_OF_AREA" };
      }
      const gate = await consumeRateLimitSmart(`geo:checkin:${userId}`, 120, 60_000);
      if (!gate.allowed) {
        set.status = 429;
        return { success: false, error: "Too many requests", code: "RATE_LIMITED" };
      }
      const transitions = await geofenceService.evaluate({ userId }, b.latitude, b.longitude);
      return { success: true, data: transitions };
    },
    { body: t.Object({ latitude: t.Number(), longitude: t.Number() }) },
  )

  // Customer "providers near me" — reuses the certified matching engine.
  .post(
    "/nearby-providers",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const b = body as { serviceId: string; latitude: number; longitude: number; scheduledDate?: string; maxDistanceKm?: number };
      if (!mapsService.isWithinIndia(b.latitude, b.longitude)) {
        set.status = 400;
        return { success: false, error: "Service not available in this area", code: "OUT_OF_AREA" };
      }
      const matches = await matchingService.findBestProviders({
        serviceId: b.serviceId,
        customerId: userId,
        latitude: b.latitude,
        longitude: b.longitude,
        scheduledDate: b.scheduledDate ? new Date(b.scheduledDate) : new Date(Date.now() + 3_600_000),
        maxDistanceKm: b.maxDistanceKm,
      });
      return { success: true, data: { providers: matches, count: matches.length } };
    },
    {
      body: t.Object({
        serviceId: t.String(),
        latitude: t.Number(),
        longitude: t.Number(),
        scheduledDate: t.Optional(t.String()),
        maxDistanceKm: t.Optional(t.Number()),
      }),
    },
  )

  // --- Geofence administration (ADMIN only — enforced via requireRole) ---
  .get("/geofences", async ({ requireRole, query }) => {
    requireRole("ADMIN");
    const geofences = await geofenceService.list({
      city: typeof query.city === "string" ? query.city : undefined,
      activeOnly: query.activeOnly === "true",
    });
    return { success: true, data: { geofences } };
  })
  // Per-zone analytics: supply / demand / revenue / utilization (24h), circle + polygon.
  .get("/geofences/analytics", async ({ requireRole }) => {
    requireRole("ADMIN");
    const zones = await geofenceService.zoneAnalytics();
    return {
      success: true,
      data: {
        zones,
        totals: {
          zones: zones.length,
          supply: zones.reduce((s, z) => s + z.supply, 0),
          demand: zones.reduce((s, z) => s + z.demand, 0),
          revenue: zones.reduce((s, z) => s + z.revenue, 0),
        },
      },
    };
  })
  .post(
    "/geofences",
    async ({ requireRole, body, set }) => {
      requireRole("ADMIN");
      const b = body as { name: string; centerLat: number; centerLng: number; radiusMeters: number; city?: string; state?: string; serviceCategories?: string[]; zoneType?: string; shape?: string; polygon?: Array<{ lat: number; lng: number }>; surgeMultiplier?: number };
      const isPolygon = b.shape === "POLYGON" && Array.isArray(b.polygon) && b.polygon.length >= 3;
      if (!isPolygon && (b.radiusMeters <= 0 || b.radiusMeters > 100_000)) {
        set.status = 400;
        return { success: false, error: "radiusMeters must be 1..100000", code: "INVALID_RADIUS" };
      }
      if (!mapsService.isWithinIndia(b.centerLat, b.centerLng)) {
        set.status = 400;
        return { success: false, error: "Centre outside the service area", code: "OUT_OF_AREA" };
      }
      const geofence = await geofenceService.create(b);
      set.status = 201;
      return { success: true, data: { geofence } };
    },
    { body: t.Object({ name: t.String(), centerLat: t.Number(), centerLng: t.Number(), radiusMeters: t.Number(), city: t.Optional(t.String()), state: t.Optional(t.String()), serviceCategories: t.Optional(t.Array(t.String())), zoneType: t.Optional(t.String()), shape: t.Optional(t.String()), polygon: t.Optional(t.Array(t.Object({ lat: t.Number(), lng: t.Number() }))), surgeMultiplier: t.Optional(t.Number()) }) },
  )
  .patch(
    "/geofences/:id",
    async ({ requireRole, params, body }) => {
      requireRole("ADMIN");
      const geofence = await geofenceService.update(params.id, body as Record<string, never>);
      return { success: true, data: { geofence } };
    },
    { body: t.Object({ name: t.Optional(t.String()), radiusMeters: t.Optional(t.Number()), centerLat: t.Optional(t.Number()), centerLng: t.Optional(t.Number()), serviceCategories: t.Optional(t.Array(t.String())), isActive: t.Optional(t.Boolean()), city: t.Optional(t.String()), state: t.Optional(t.String()) }) },
  )
  .delete("/geofences/:id", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    await geofenceService.remove(params.id);
    return { success: true, data: { ok: true } };
  })
  .get("/geofence-events", async ({ requireRole, query }) => {
    requireRole("ADMIN");
    const events = await geofenceService.listEvents({
      geofenceId: typeof query.geofenceId === "string" ? query.geofenceId : undefined,
      userId: typeof query.userId === "string" ? query.userId : undefined,
      eventType: typeof query.eventType === "string" ? query.eventType : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { success: true, data: { events } };
  });

// Hyperlocal Coverage Engine V1 rides on the geo module (composed here instead
// of index.ts so the root plugin chain doesn't grow past TS's type-depth limit).
// coverageRoutes carries its own absolute prefix (/api/coverage).
export const geoRoutes = new Elysia().use(geoCoreRoutes).use(coverageRoutes);
