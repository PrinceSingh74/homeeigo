import { liveProviderAllowed } from "../lib/test-egress";
import { distanceKm, etaMinutes } from "../lib/geo";
import { redisClient } from "../lib/redis";
import { logger } from "../lib/logger";
import { observeFeatureLatency, recordFeatureEvent, incCounter, observeHist } from "../lib/metrics";
import { mapsBreaker, CircuitOpenError } from "../lib/circuit-breaker";
import { getEventContext } from "../events/core/event-context";
import { weatherService } from "./weather.service";

/**
 * Phase 16 — Google Maps proxy. The API key stays SERVER-SIDE (never shipped to the
 * client). Every call degrades gracefully: geocoding/autocomplete return null/[] when
 * unconfigured (the UI shows manual entry, never fake data), while ETA falls back to a
 * legitimate haversine estimate. Results are cached in Redis to cap Google API cost.
 */
// Test runtimes never spend Google Maps quota (lib/test-egress.ts); callers degrade to haversine/null.
// Read per call, not once at import: a deployed process's env never changes, and a test can then
// exercise the configured path against a provider double.
function mapsKey(): string {
  return liveProviderAllowed("HOMIGO_REQUIRE_MAPS") ? (process.env.GOOGLE_MAPS_API_KEY ?? "").trim() : "";
}
const BASE = "https://maps.googleapis.com/maps/api";
const TIMEOUT_MS = 6000;
const CACHE_TTL = { geo: 86_400, place: 604_800, eta: 120 } as const;

/**
 * Testing-phase routing fallback — OSRM public demo server (free, keyless).
 *
 * Google stays the PRIMARY provider: the moment Cloud billing is enabled its
 * branch wins again and OSRM is never consulted. Enabled by default outside
 * production; production requires an explicit OSRM_FALLBACK_ENABLED=true
 * (the public demo server has no SLA — self-host OSRM if ever needed live).
 */
const OSRM_FALLBACK =
  process.env.OSRM_FALLBACK_ENABLED === "true" ||
  (process.env.OSRM_FALLBACK_ENABLED !== "false" && process.env.NODE_ENV !== "production");
const OSRM_BASE = (process.env.OSRM_BASE_URL || "https://router.project-osrm.org").replace(/\/$/, "");

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

/** What the caller serves instead when Google gives no usable answer. */
type MapsFallback = "manual_entry" | "haversine" | "osrm" | "straight_line" | "nearest_neighbour";

/**
 * Google answers a denied, over-quota or malformed request with HTTP 200 and the verdict in the
 * body's `status`. The HTTP-level failure counter therefore never saw a project whose billing was
 * switched off: every call was denied, every caller fell back, and nothing said so (coding-phase
 * certification 2026-09-28). Each failure class is now logged with the endpoint, the caller's
 * correlation id and the fallback served, and counted.
 */
type MapsFailureClass = "REQUEST_DENIED" | "OVER_QUERY_LIMIT" | "PROVIDER_ERROR" | "TIMEOUT" | "HTTP_ERROR" | "NETWORK_ERROR" | "CIRCUIT_OPEN";

const FAILURE_COUNTER: Partial<Record<MapsFailureClass, string>> = {
  REQUEST_DENIED: "maps_provider_denied_total",
  OVER_QUERY_LIMIT: "maps_over_query_limit_total",
  TIMEOUT: "maps_timeout_total",
};

/** Statuses that are an answer, not a failure: the place or route simply does not exist. */
const ANSWER_STATUSES = new Set(["OK", "ZERO_RESULTS", "NOT_FOUND"]);

function failureContext(endpoint: string, errorClass: MapsFailureClass, fallback: MapsFallback) {
  const ctx = getEventContext();
  return { endpoint, errorClass, fallback, correlationId: ctx.correlationId ?? ctx.requestId ?? null };
}

function countFailure(endpoint: string, errorClass: MapsFailureClass, fallback: MapsFallback): void {
  const counter = FAILURE_COUNTER[errorClass];
  if (counter) incCounter(counter, { endpoint });
  incCounter("maps_fallback_used_total", { endpoint, fallback });
}

async function gfetch(path: string, params: Record<string, string>, fallback: MapsFallback): Promise<Record<string, unknown> | null> {
  const key = mapsKey();
  if (!key) return null;
  const endpoint = path.replace(/^\//, "").split("/")[0]; // geocode|place|distancematrix|directions
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("key", key);
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
    const data = await mapsBreaker.execute(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!res.ok) {
        logger.warn("maps.http_error", { path, status: res.status, ...failureContext(endpoint, "HTTP_ERROR", fallback) });
        incCounter("google_api_failures_total", { endpoint, reason: "http_error" });
        throw new Error(`maps_http_${res.status}`);
      }
      return (await res.json()) as Record<string, unknown>;
    });
    const status = typeof data?.status === "string" ? data.status : "";
    if (!ANSWER_STATUSES.has(status)) {
      const errorClass: MapsFailureClass = status === "REQUEST_DENIED" || status === "OVER_QUERY_LIMIT" ? status : "PROVIDER_ERROR";
      logger.warn(errorClass === "PROVIDER_ERROR" ? "maps.provider_error" : "maps.provider_denied", {
        path,
        providerStatus: status || null,
        providerMessage: typeof data?.error_message === "string" ? data.error_message.slice(0, 300) : null,
        ...failureContext(endpoint, errorClass, fallback),
      });
      incCounter("google_api_failures_total", { endpoint, reason: errorClass.toLowerCase() });
      countFailure(endpoint, errorClass, fallback);
    }
    return data;
  } catch (e) {
    if (e instanceof CircuitOpenError) {
      incCounter("google_api_failures_total", { endpoint, reason: "circuit_open" });
      countFailure(endpoint, "CIRCUIT_OPEN", fallback); // counted, not logged: one outage, not one line per call
      return null; // fast-fail, isolated
    }
    const message = e instanceof Error ? e.message : String(e);
    // AbortSignal.timeout rejects fetch with a DOMException named "TimeoutError".
    const errorClass: MapsFailureClass =
      (e as { name?: unknown } | null)?.name === "TimeoutError" ? "TIMEOUT" : message.startsWith("maps_http_") ? "HTTP_ERROR" : "NETWORK_ERROR";
    logger.warn("maps.fetch_failed", { path, error: message, ...failureContext(endpoint, errorClass, fallback) });
    incCounter("google_api_failures_total", { endpoint, reason: "fetch_failed" });
    countFailure(endpoint, errorClass, fallback);
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
    return Boolean(mapsKey());
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

    const data = await gfetch("/geocode/json", { latlng: `${lat},${lng}` }, "manual_entry");
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

    const data = await gfetch("/geocode/json", { address, region: "in" }, "manual_entry");
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
    if (!mapsKey() || input.trim().length < 3) return [];
    const params: Record<string, string> = { input: input.trim(), components: "country:in" };
    if (opts?.sessionToken) params.sessiontoken = opts.sessionToken;
    if (Number.isFinite(opts?.lat) && Number.isFinite(opts?.lng)) {
      params.location = `${opts!.lat},${opts!.lng}`;
      params.radius = "50000";
    }
    const data = await gfetch("/place/autocomplete/json", params, "manual_entry");
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

    const data = await gfetch(
      "/place/details/json",
      { place_id: placeId, fields: "formatted_address,geometry,address_component" },
      "manual_entry",
    );
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
    if (mapsKey()) {
      const cacheKey = `geo:eta:${from.lat.toFixed(3)},${from.lng.toFixed(3)}:${to.lat.toFixed(3)},${to.lng.toFixed(3)}`;
      const cached = await redisClient.get(cacheKey).catch(() => null);
      if (cached) {
        const out = JSON.parse(cached) as { etaMinutes: number; distanceKm: number; source: "google" | "haversine"; withTraffic: boolean };
        observeHist("geo_eta_seconds", out.etaMinutes * 60, { source: out.source });
        return out;
      }
      const data = await gfetch(
        "/distancematrix/json",
        { origins: `${from.lat},${from.lng}`, destinations: `${to.lat},${to.lng}`, mode: "driving", departure_time: "now" },
        "haversine",
      );
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
    if (!mapsKey() || waypoints.length === 0) return null;
    const dest = destination ?? waypoints[waypoints.length - 1]!;
    const data = await gfetch(
      "/directions/json",
      {
        origin: `${origin.lat},${origin.lng}`,
        destination: `${dest.lat},${dest.lng}`,
        waypoints: `optimize:true|${waypoints.map((w) => `${w.lat},${w.lng}`).join("|")}`,
        mode: "driving",
        departure_time: "now",
      },
      "nearest_neighbour",
    );
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
  ): Promise<{ polyline: string; distanceKm: number; durationMin: number; source: "google" | "osrm" } | null> {
    if (mapsKey()) {
      const data = await gfetch(
        "/directions/json",
        { origin: `${from.lat},${from.lng}`, destination: `${to.lat},${to.lng}`, mode: "driving", departure_time: "now" },
        OSRM_FALLBACK ? "osrm" : "straight_line",
      );
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
      if (data?.status === "OK" && route?.overview_polyline?.points) {
        const distanceKm = Math.round((route.legs.reduce((s, l) => s + l.distance.value, 0) / 1000) * 10) / 10;
        const durationMin = Math.ceil(
          route.legs.reduce((s, l) => s + (l.duration_in_traffic?.value ?? l.duration.value), 0) / 60,
        );
        return { polyline: route.overview_polyline.points, distanceKm, durationMin, source: "google" };
      }
    }
    // Google absent or denied (e.g. billing disabled during testing) → OSRM.
    return osrmDirections(from, to);
  },
};

/**
 * Real road route from the OSRM public demo server — same encoded-polyline
 * format Google returns, so every consumer works unchanged. No traffic model
 * (durations are free-flow), which is fine for the testing phase.
 */
async function osrmDirections(
  from: LatLng,
  to: LatLng,
): Promise<{ polyline: string; distanceKm: number; durationMin: number; source: "osrm" } | null> {
  if (!OSRM_FALLBACK) return null;
  const cacheKey = `geo:osrm:${from.lat.toFixed(3)},${from.lng.toFixed(3)}:${to.lat.toFixed(3)},${to.lng.toFixed(3)}`;
  const cached = await redisClient.get(cacheKey).catch(() => null);
  if (cached) {
    return JSON.parse(cached) as { polyline: string; distanceKm: number; durationMin: number; source: "osrm" };
  }
  try {
    const url =
      `${OSRM_BASE}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      `?overview=full&geometries=polyline`;
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`osrm_http_${res.status}`);
    const data = (await res.json()) as {
      code?: string;
      routes?: Array<{ geometry?: string; distance?: number; duration?: number }>;
    };
    const r = data.routes?.[0];
    if (data.code !== "Ok" || !r?.geometry) return null;
    const out = {
      polyline: r.geometry,
      distanceKm: Math.round(((r.distance ?? 0) / 1000) * 10) / 10,
      durationMin: Math.max(1, Math.ceil((r.duration ?? 60) / 60)),
      source: "osrm" as const,
    };
    await redisClient.set(cacheKey, JSON.stringify(out), CACHE_TTL.eta).catch(() => {});
    recordFeatureEvent("maps_directions", "osrm_fallback");
    return out;
  } catch (e) {
    logger.warn("maps.osrm_fallback_failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
