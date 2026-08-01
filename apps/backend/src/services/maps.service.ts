import { distanceKm, etaMinutes } from "../lib/geo";
import { redisClient } from "../lib/redis";
import { logger } from "../lib/logger";
import { observeFeatureLatency, recordFeatureEvent, incCounter, observeHist } from "../lib/metrics";
import { mapsBreaker, CircuitOpenError } from "../lib/circuit-breaker";
import { weatherService } from "./weather.service";

/**
 * Phase 16 — Google Maps proxy. The API key stays SERVER-SIDE (never shipped to the
 * client). Every call degrades gracefully: geocoding/autocomplete return null/[] when
 * unconfigured (the UI shows manual entry, never fake data), while ETA falls back to a
 * legitimate haversine estimate. Results are cached in Redis to cap Google API cost.
 */
const KEY = (process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
const BASE = "https://maps.googleapis.com/maps/api";
const TIMEOUT_MS = 6000;
const CACHE_TTL = { geo: 86_400, place: 604_800, eta: 120 } as const;

// HOMIGO serves India only — reject coordinates outside the national bounding box.
const INDIA = { latMin: 6.5, latMax: 37.5, lngMin: 67.5, lngMax: 97.5 };

type LatLng = { lat: number; lng: number };
export type GeoAddress = {
  formattedAddress: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};

async function gfetch(path: string, params: Record<string, string>): Promise<Record<string, unknown> | null> {
  if (!KEY) return null;
  const endpoint = path.replace(/^\//, "").split("/")[0]; // geocode|place|distancematrix|directions
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", KEY);
  incCounter("google_api_calls_total", { endpoint });
  // Spec-named per-endpoint request counters (P6 FinOps): geocode_requests_total,
  // places_requests_total, directions_requests_total, distance_matrix_requests_total.
  const reqMetric: Record<string, string> = {
    geocode: "geocode_requests_total",
    place: "places_requests_total",
    directions: "directions_requests_total",
    distancematrix: "distance_matrix_requests_total",
  };
  if (reqMetric[endpoint]) incCounter(reqMetric[endpoint]);
  try {
    // Circuit breaker: after repeated upstream failures, OPEN → fast-fail without
    // even attempting the fetch (isolates a flaky/down Google Maps from the event loop).
    return await mapsBreaker.execute(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        logger.warn("maps.http_error", { path, status: res.status });
        incCounter("google_api_failures_total", { endpoint, reason: "http_error" });
        throw new Error(`maps_http_${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    });
  } catch (e) {
    if (e instanceof CircuitOpenError) {
      incCounter("google_api_failures_total", { endpoint, reason: "circuit_open" });
      return null; // fast-fail, isolated
    }
    logger.warn("maps.fetch_failed", { path, error: e instanceof Error ? e.message : String(e) });
    incCounter("google_api_failures_total", { endpoint, reason: "fetch_failed" });
    return null;
  }
}

function pickComponent(components: Array<{ long_name: string; types: string[] }>, type: string): string | null {
  return components.find((c) => c.types.includes(type))?.long_name ?? null;
}

function parseResult(r: {
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
  address_components: Array<{ long_name: string; types: string[] }>;
}): GeoAddress {
  const comps = r.address_components ?? [];
  return {
    formattedAddress: r.formatted_address,
    city: pickComponent(comps, "locality") ?? pickComponent(comps, "administrative_area_level_2"),
    state: pickComponent(comps, "administrative_area_level_1"),
    postalCode: pickComponent(comps, "postal_code"),
    country: pickComponent(comps, "country"),
    latitude: r.geometry.location.lat,
    longitude: r.geometry.location.lng,
  };
}

export const mapsService = {
  get isConfigured(): boolean {
    return Boolean(KEY);
  },

  isWithinIndia(lat: number, lng: number): boolean {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= INDIA.latMin &&
      lat <= INDIA.latMax &&
      lng >= INDIA.lngMin &&
      lng <= INDIA.lngMax
    );
  },

  async reverseGeocode(lat: number, lng: number): Promise<GeoAddress | null> {
    const cacheKey = `geo:rev:${lat.toFixed(5)},${lng.toFixed(5)}`;
    const cached = await redisClient.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as GeoAddress;

    const data = await gfetch("/geocode/json", { latlng: `${lat},${lng}` });
    const results = (data?.results ?? []) as Parameters<typeof parseResult>[0][];
    if (data?.status !== "OK" || results.length === 0) return null;
    const out = parseResult(results[0]!);
    await redisClient.set(cacheKey, JSON.stringify(out), CACHE_TTL.geo).catch(() => {});
    return out;
  },

  async geocode(address: string): Promise<GeoAddress | null> {
    const cacheKey = `geo:fwd:${address.toLowerCase().slice(0, 120)}`;
    const cached = await redisClient.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as GeoAddress;

    const data = await gfetch("/geocode/json", { address, region: "in" });
    const results = (data?.results ?? []) as Parameters<typeof parseResult>[0][];
    if (data?.status !== "OK" || results.length === 0) return null;
    const out = parseResult(results[0]!);
    await redisClient.set(cacheKey, JSON.stringify(out), CACHE_TTL.geo).catch(() => {});
    return out;
  },

  async autocomplete(
    input: string,
    opts?: { sessionToken?: string; lat?: number; lng?: number },
  ): Promise<Array<{ placeId: string; description: string; mainText: string; secondaryText: string }>> {
    if (!KEY || input.trim().length < 3) return [];
    const params: Record<string, string> = { input: input.trim(), components: "country:in" };
    if (opts?.sessionToken) params.sessiontoken = opts.sessionToken;
    if (Number.isFinite(opts?.lat) && Number.isFinite(opts?.lng)) {
      params.location = `${opts!.lat},${opts!.lng}`;
      params.radius = "50000";
    }
    const data = await gfetch("/place/autocomplete/json", params);
    const preds = (data?.predictions ?? []) as Array<{
      place_id: string;
      description: string;
      structured_formatting?: { main_text: string; secondary_text: string };
    }>;
    return preds.map((p) => ({
      placeId: p.place_id,
      description: p.description,
      mainText: p.structured_formatting?.main_text ?? p.description,
      secondaryText: p.structured_formatting?.secondary_text ?? "",
    }));
  },

  async placeDetails(placeId: string): Promise<GeoAddress | null> {
    const cacheKey = `geo:place:${placeId}`;
    const cached = await redisClient.get(cacheKey).catch(() => null);
    if (cached) return JSON.parse(cached) as GeoAddress;

    const data = await gfetch("/place/details/json", {
      place_id: placeId,
      fields: "formatted_address,geometry,address_component",
    });
    const result = data?.result as Parameters<typeof parseResult>[0] | undefined;
    if (data?.status !== "OK" || !result) return null;
    const out = parseResult(result);
    await redisClient.set(cacheKey, JSON.stringify(out), CACHE_TTL.place).catch(() => {});
    return out;
  },

  /** Traffic-aware ETA via Distance Matrix; haversine fallback (always returns a value). */
  async eta(from: LatLng, to: LatLng): Promise<{ etaMinutes: number; distanceKm: number; source: "google" | "haversine"; withTraffic: boolean }> {
    const __t0 = Date.now();
    const dKm = distanceKm(from.lat, from.lng, to.lat, to.lng);
    if (KEY) {
      const cacheKey = `geo:eta:${from.lat.toFixed(3)},${from.lng.toFixed(3)}:${to.lat.toFixed(3)},${to.lng.toFixed(3)}`;
      const cached = await redisClient.get(cacheKey).catch(() => null);
      if (cached) {
        const out = JSON.parse(cached) as { etaMinutes: number; distanceKm: number; source: "google" | "haversine"; withTraffic: boolean };
        observeHist("geo_eta_seconds", out.etaMinutes * 60, { source: out.source });
        return out;
      }
      const data = await gfetch("/distancematrix/json", {
        origins: `${from.lat},${from.lng}`,
        destinations: `${to.lat},${to.lng}`,
        mode: "driving",
        departure_time: "now",
      });
      const el = (data?.rows as Array<{ elements: Array<{ status: string; duration: { value: number }; duration_in_traffic?: { value: number }; distance: { value: number } }> }> | undefined)?.[0]?.elements?.[0];
      if (el?.status === "OK") {
        const secs = el.duration_in_traffic?.value ?? el.duration.value;
        const out = { etaMinutes: Math.ceil(secs / 60), distanceKm: Math.round((el.distance.value / 1000) * 10) / 10, source: "google" as const, withTraffic: Boolean(el.duration_in_traffic) };
        await redisClient.set(cacheKey, JSON.stringify(out), CACHE_TTL.eta).catch(() => {});
        observeHist("geo_eta_seconds", out.etaMinutes * 60, { source: "google" });
        return out;
      }
    }
    observeFeatureLatency("maps_eta", (Date.now() - __t0) / 1000);
    recordFeatureEvent("maps_eta", "haversine");
    const haversineEta = etaMinutes(dKm);
    observeHist("geo_eta_seconds", haversineEta * 60, { source: "haversine" });
    return { etaMinutes: haversineEta, distanceKm: Math.round(dKm * 10) / 10, source: "haversine", withTraffic: false };
  },

  /**
   * Weather-adjusted ETA — base ETA × weather factor (rain/storm/heat slow travel).
   * Fail-safe: no weather data → factor 1 (identical to plain eta()).
   */
  async etaWithWeather(
    from: LatLng,
    to: LatLng,
  ): Promise<{ etaMinutes: number; baseEtaMinutes: number; distanceKm: number; source: "google" | "haversine"; withTraffic: boolean; weatherFactor: number; weatherAdjusted: boolean }> {
    const base = await this.eta(from, to);
    const snap = await weatherService.getByCoords(to.lat, to.lng);
    const factor = weatherService.etaAdjustmentFactor(snap);
    return {
      ...base,
      baseEtaMinutes: base.etaMinutes,
      etaMinutes: Math.ceil(base.etaMinutes * factor),
      weatherFactor: factor,
      weatherAdjusted: factor > 1,
    };
  },

  /**
   * Traffic-aware multi-stop waypoint optimisation via Google Directions (`optimize:true`).
   * Returns the optimal visiting order of `waypoints` (indices into the input array) plus
   * totals, or `null` when the key is absent / the call fails — callers then fall back to a
   * haversine nearest-neighbour order. NOT a new routing engine: this is the maps proxy.
   */
  async optimizeWaypoints(
    origin: LatLng,
    waypoints: LatLng[],
    destination?: LatLng,
  ): Promise<{ order: number[]; distanceKm: number; durationMin: number; polyline: string | null } | null> {
    if (!KEY || waypoints.length === 0) return null;
    const dest = destination ?? waypoints[waypoints.length - 1]!;
    const data = await gfetch("/directions/json", {
      origin: `${origin.lat},${origin.lng}`,
      destination: `${dest.lat},${dest.lng}`,
      waypoints: `optimize:true|${waypoints.map((w) => `${w.lat},${w.lng}`).join("|")}`,
      mode: "driving",
      departure_time: "now",
    });
    const route = (data?.routes as Array<{ waypoint_order: number[]; overview_polyline?: { points: string }; legs: Array<{ distance: { value: number }; duration: { value: number }; duration_in_traffic?: { value: number } }> }> | undefined)?.[0];
    if (data?.status !== "OK" || !route) return null;
    const distanceKm = Math.round((route.legs.reduce((s, l) => s + l.distance.value, 0) / 1000) * 10) / 10;
    const durationMin = Math.ceil(route.legs.reduce((s, l) => s + (l.duration_in_traffic?.value ?? l.duration.value), 0) / 60);
    return { order: route.waypoint_order, distanceKm, durationMin, polyline: route.overview_polyline?.points ?? null };
  },

  /**
   * Point-to-point driving route via Google Directions — the encoded road
   * polyline + traffic-aware distance/duration for accurate on-map tracking
   * anywhere in India. Returns null (caller draws a straight line + haversine)
   * when the key is absent or the call fails.
   */
  async directions(
    from: LatLng,
    to: LatLng,
  ): Promise<{ polyline: string; distanceKm: number; durationMin: number } | null> {
    if (!KEY) return null;
    const data = await gfetch("/directions/json", {
      origin: `${from.lat},${from.lng}`,
      destination: `${to.lat},${to.lng}`,
      mode: "driving",
      departure_time: "now",
    });
    const route = (
      data?.routes as
        | Array<{
            overview_polyline?: { points: string };
            legs: Array<{
              distance: { value: number };
              duration: { value: number };
              duration_in_traffic?: { value: number };
            }>;
          }>
        | undefined
    )?.[0];
    if (data?.status !== "OK" || !route?.overview_polyline?.points) return null;
    const distanceKm = Math.round((route.legs.reduce((s, l) => s + l.distance.value, 0) / 1000) * 10) / 10;
    const durationMin = Math.ceil(
      route.legs.reduce((s, l) => s + (l.duration_in_traffic?.value ?? l.duration.value), 0) / 60,
    );
    return { polyline: route.overview_polyline.points, distanceKm, durationMin };
  },
};
