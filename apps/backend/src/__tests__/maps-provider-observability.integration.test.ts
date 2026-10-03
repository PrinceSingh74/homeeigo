/**
 * Coding-phase certification 2026-09-28: with Cloud billing disabled on the Maps project, every
 * Google web-service call answers HTTP 200 with `status: "REQUEST_DENIED"`. The service fell back
 * correctly (null address, empty predictions, haversine ETA) but said nothing: no log line, no
 * metric, and `google_api_failures_total` stayed at zero because the HTTP status was 200. A fully
 * denied provider was indistinguishable from a healthy one with no traffic.
 *
 * The provider here is a TEST DOUBLE that answers with the response bodies Google documents for
 * each outcome (billing-disabled denial, quota exhaustion, a success). Nothing in this file proves
 * the real provider's success path or that caching works against real Google — billing is off, so
 * that cannot be observed. What it proves is how the service classifies, reports and degrades on
 * each documented answer, and that its own cache logic stops a second provider call.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import app from "../index";
import { mapsService } from "../services/maps.service";
import { redisClient } from "../lib/redis";
import { sumCounterWhere } from "../lib/metrics";
import { logger } from "../lib/logger";
import { mapsBreaker } from "../lib/circuit-breaker";
import { runWithEventContext } from "../events/core/event-context";
import { JWTService } from "../services/jwt.service";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";

// ── The provider double ────────────────────────────────────────────────────────────────────────
type Scenario = "denied" | "over_limit" | "timeout" | "ok";
let scenario: Scenario = "denied";
const providerCalls: string[] = [];

/** Google's documented answer for a project without billing (same body on every web service). */
const DENIED = {
  status: "REQUEST_DENIED",
  error_message:
    "You must enable Billing on the Google Cloud Project at https://console.cloud.google.com/project/_/billing/enable Learn more at https://developers.google.com/maps/gmp-get-started",
};
const OVER_LIMIT = {
  status: "OVER_QUERY_LIMIT",
  error_message: "You have exceeded your daily request quota for this API.",
};
const EMPTY: Record<string, Record<string, unknown>> = {
  "/maps/api/geocode/json": { results: [] },
  "/maps/api/place/autocomplete/json": { predictions: [] },
  "/maps/api/place/details/json": { html_attributions: [] },
  "/maps/api/distancematrix/json": { destination_addresses: [], origin_addresses: [], rows: [] },
  "/maps/api/directions/json": { geocoded_waypoints: [], routes: [] },
};
const OK: Record<string, Record<string, unknown>> = {
  "/maps/api/geocode/json": {
    status: "OK",
    results: [
      {
        formatted_address: "MG Road, Bengaluru, Karnataka 560001, India",
        geometry: { location: { lat: 12.9756, lng: 77.6066 }, location_type: "GEOMETRIC_CENTER" },
        place_id: "ChIJ-double-mg-road",
        types: ["route"],
        address_components: [
          { long_name: "Bengaluru", short_name: "Bengaluru", types: ["locality", "political"] },
          { long_name: "Karnataka", short_name: "KA", types: ["administrative_area_level_1", "political"] },
          { long_name: "560001", short_name: "560001", types: ["postal_code"] },
          { long_name: "India", short_name: "IN", types: ["country", "political"] },
        ],
      },
    ],
  },
  "/maps/api/distancematrix/json": {
    status: "OK",
    origin_addresses: ["Indiranagar, Bengaluru"],
    destination_addresses: ["MG Road, Bengaluru"],
    rows: [
      {
        elements: [
          {
            status: "OK",
            distance: { text: "5.2 km", value: 5213 },
            duration: { text: "14 mins", value: 840 },
            duration_in_traffic: { text: "18 mins", value: 1080 },
          },
        ],
      },
    ],
  },
};

const realFetch = globalThis.fetch;
const providerDouble = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.hostname === "maps.googleapis.com") {
    providerCalls.push(url.pathname);
    if (!url.searchParams.get("key")) throw new Error("provider double: request sent without a key");
    // What fetch rejects with when AbortSignal.timeout(...) fires.
    if (scenario === "timeout") throw new DOMException("The operation timed out.", "TimeoutError");
    const empty = EMPTY[url.pathname] ?? {};
    const body = scenario === "denied" ? { ...empty, ...DENIED } : scenario === "over_limit" ? { ...empty, ...OVER_LIMIT } : OK[url.pathname] ?? { ...empty, status: "ZERO_RESULTS" };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json; charset=UTF-8" } });
  }
  if (url.hostname === "router.project-osrm.org") {
    providerCalls.push("osrm");
    return new Response("upstream unavailable", { status: 503 });
  }
  return realFetch(input, init);
}) as typeof fetch;

// ── Log capture ────────────────────────────────────────────────────────────────────────────────
type Line = { msg: string; meta: Record<string, unknown> };
let lines: Line[] = [];
const origWarn = logger.warn.bind(logger);

const saved = { flag: process.env.HOMIGO_REQUIRE_MAPS, key: process.env.GOOGLE_MAPS_API_KEY };
const RUN = `mp-${Date.now().toString(36)}`;
let ctx: AdvCtx | null = null;
const jwt = new JWTService();

beforeAll(async () => {
  process.env.HOMIGO_REQUIRE_MAPS = "1";
  process.env.GOOGLE_MAPS_API_KEY = "test-double-key-not-a-google-key";
  globalThis.fetch = providerDouble;
  (logger as { warn: typeof logger.warn }).warn = ((msg: string, meta?: Record<string, unknown>) => {
    lines.push({ msg, meta: meta ?? {} });
    return (origWarn as (...a: unknown[]) => unknown)(msg, meta);
  }) as typeof logger.warn;
  if (await dbReachable()) ctx = await seedAdversarialFixtures(RUN);
}, 60_000);

afterAll(async () => {
  globalThis.fetch = realFetch;
  (logger as { warn: typeof logger.warn }).warn = origWarn;
  if (saved.flag === undefined) delete process.env.HOMIGO_REQUIRE_MAPS;
  else process.env.HOMIGO_REQUIRE_MAPS = saved.flag;
  if (saved.key === undefined) delete process.env.GOOGLE_MAPS_API_KEY;
  else process.env.GOOGLE_MAPS_API_KEY = saved.key;
  mapsBreaker.reset();
  if (ctx) await cleanupAdversarialFixtures(RUN);
}, 60_000);

afterEach(() => {
  scenario = "denied";
  providerCalls.length = 0;
  lines = [];
  mapsBreaker.reset();
});

const counter = (name: string, endpoint: string) => sumCounterWhere(name, `endpoint=${endpoint}`);
const fallbackCount = (endpoint: string, fallback: string) => sumCounterWhere("maps_fallback_used_total", `endpoint=${endpoint},fallback=${fallback}`);
const reported = (errorClass: string) => lines.filter((l) => l.meta.errorClass === errorClass);

describe("provider denial (billing disabled) is reported, not silent", () => {
  it("reverse geocode: null result, a denial log naming endpoint/class/correlation/fallback, and the denial counters", async () => {
    const denied0 = counter("maps_provider_denied_total", "geocode");
    const fb0 = fallbackCount("geocode", "manual_entry");
    const failures0 = sumCounterWhere("google_api_failures_total", "reason=request_denied");
    const out = await runWithEventContext({ requestId: "req_maps_denied_1", correlationId: "req_maps_denied_1" }, () =>
      mapsService.reverseGeocode(12.9716, 77.5946),
    );
    expect(out).toBeNull();
    expect(providerCalls).toEqual(["/maps/api/geocode/json"]);
    const line = lines.find((l) => l.msg === "maps.provider_denied");
    expect(line?.meta).toMatchObject({ endpoint: "geocode", errorClass: "REQUEST_DENIED", fallback: "manual_entry", correlationId: "req_maps_denied_1" });
    expect(String(line?.meta.providerMessage)).toContain("enable Billing");
    expect(counter("maps_provider_denied_total", "geocode")).toBe(denied0 + 1);
    expect(fallbackCount("geocode", "manual_entry")).toBe(fb0 + 1);
    expect(sumCounterWhere("google_api_failures_total", "reason=request_denied")).toBe(failures0 + 1);
  });

  it("ETA: haversine answer, and the fallback is counted as haversine", async () => {
    const denied0 = counter("maps_provider_denied_total", "distancematrix");
    const fb0 = fallbackCount("distancematrix", "haversine");
    const out = await mapsService.eta({ lat: 12.9784, lng: 77.6408 }, { lat: 12.9756, lng: 77.6066 });
    expect(out.source).toBe("haversine");
    expect(out.etaMinutes).toBeGreaterThan(0);
    expect(counter("maps_provider_denied_total", "distancematrix")).toBe(denied0 + 1);
    expect(fallbackCount("distancematrix", "haversine")).toBe(fb0 + 1);
    expect(reported("REQUEST_DENIED")[0]?.meta).toMatchObject({ endpoint: "distancematrix", fallback: "haversine" });
  });

  it("directions: denial falls through to the OSRM fallback, which is what the log and counter name", async () => {
    const fb0 = fallbackCount("directions", "osrm");
    const out = await mapsService.directions({ lat: 12.9784, lng: 77.6408 }, { lat: 12.9756, lng: 77.6066 });
    expect(out).toBeNull(); // the OSRM double is down too → caller draws a straight line
    expect(providerCalls).toEqual(["/maps/api/directions/json", "osrm"]);
    expect(fallbackCount("directions", "osrm")).toBe(fb0 + 1);
    expect(reported("REQUEST_DENIED")[0]?.meta).toMatchObject({ endpoint: "directions", fallback: "osrm" });
  });
});

describe("quota exhaustion and timeouts are classified separately", () => {
  it("OVER_QUERY_LIMIT: empty predictions, the over-query-limit counter, not the denial counter", async () => {
    scenario = "over_limit";
    const over0 = counter("maps_over_query_limit_total", "place");
    const denied0 = counter("maps_provider_denied_total", "place");
    const out = await mapsService.autocomplete("MG Road Bengaluru");
    expect(out).toEqual([]);
    expect(counter("maps_over_query_limit_total", "place")).toBe(over0 + 1);
    expect(counter("maps_provider_denied_total", "place")).toBe(denied0);
    expect(reported("OVER_QUERY_LIMIT")[0]?.meta).toMatchObject({ endpoint: "place", fallback: "manual_entry" });
  });

  it("timeout: haversine answer, the timeout counter, and a TIMEOUT log line", async () => {
    scenario = "timeout";
    const t0 = counter("maps_timeout_total", "distancematrix");
    const out = await mapsService.eta({ lat: 12.9784, lng: 77.6408 }, { lat: 12.9756, lng: 77.6066 });
    expect(out.source).toBe("haversine");
    expect(counter("maps_timeout_total", "distancematrix")).toBe(t0 + 1);
    expect(reported("TIMEOUT")[0]?.meta).toMatchObject({ endpoint: "distancematrix", fallback: "haversine" });
  });
});

describe("denial over the wire never becomes a 5xx", () => {
  const call = async (path: string, requestId: string) => {
    if (!ctx) throw new Error("fixtures not seeded");
    const auth = `Bearer ${jwt.generateAccessToken({ userId: ctx.customerA.id, email: `${ctx.customerA.id}@adv.test` })}`;
    const res = await app.handle(new Request(`http://localhost${path}`, { headers: { authorization: auth, "x-request-id": requestId } }));
    return { status: res.status, body: (await res.json()) as { success: boolean; data: Record<string, unknown> | null } };
  };

  it("reverse, autocomplete, place, ETA and route all answer 200 with their fallback while Google denies", async () => {
    if (!ctx) return;
    const rid = `${RUN}-wire`;
    const reverse = await call("/api/geo/reverse?lat=12.9716&lng=77.5946", `${rid}-rev`);
    expect(reverse.status).toBe(200);
    expect(reverse.body.data).toMatchObject({ available: true, address: null });

    const ac = await call("/api/geo/autocomplete?q=MG%20Road", `${rid}-ac`);
    expect(ac.status).toBe(200);
    expect(ac.body.data).toMatchObject({ available: true, predictions: [] });

    const place = await call("/api/geo/place/ChIJdoubleDeniedPlace", `${rid}-place`);
    expect(place.status).toBe(200);
    expect(place.body).toMatchObject({ success: false, data: null });

    const eta = await call("/api/geo/eta?fromLat=12.9784&fromLng=77.6408&toLat=12.9756&toLng=77.6066", `${rid}-eta`);
    expect(eta.status).toBe(200);
    expect(eta.body.data).toMatchObject({ source: "haversine" });

    const route = await call("/api/geo/route?fromLat=12.9784&fromLng=77.6408&toLat=12.9756&toLng=77.6066", `${rid}-route`);
    expect(route.status).toBe(200);
    expect(route.body.data).toMatchObject({ polyline: null, source: "haversine" });

    // Every denial line carries the caller's request id as its correlation id.
    const denials = lines.filter((l) => l.msg === "maps.provider_denied");
    expect(denials.length).toBeGreaterThanOrEqual(5);
    for (const l of denials) expect(String(l.meta.correlationId)).toStartWith(rid);
  });

  it("a timing-out provider also degrades to 200", async () => {
    if (!ctx) return;
    scenario = "timeout";
    const eta = await call("/api/geo/eta?fromLat=12.9784&fromLng=77.6408&toLat=12.9756&toLng=77.6066", `${RUN}-timeout`);
    expect(eta.status).toBe(200);
    expect(eta.body.data).toMatchObject({ source: "haversine" });
  });
});

describe("success path and cache (provider double + in-memory cache double)", () => {
  const store = new Map<string, { value: string; ttl?: number }>();
  beforeAll(() => {
    const r = redisClient as unknown as Record<string, unknown>;
    r.get = async (k: string) => store.get(k)?.value ?? null;
    r.set = async (k: string, value: string, ttl?: number) => {
      store.set(k, { value, ttl });
      return true;
    };
  });
  afterAll(() => {
    const r = redisClient as unknown as Record<string, unknown>;
    delete r.get;
    delete r.set;
  });

  it("reverse geocode: parsed from the documented OK body, cached for a day, and the repeat makes no provider call", async () => {
    scenario = "ok";
    const lat = 12.9716 + Math.random() / 1000;
    const first = await mapsService.reverseGeocode(lat, 77.5946);
    expect(first).toEqual({
      formattedAddress: "MG Road, Bengaluru, Karnataka 560001, India",
      city: "Bengaluru",
      state: "Karnataka",
      postalCode: "560001",
      country: "India",
      latitude: 12.9756,
      longitude: 77.6066,
    });
    expect(providerCalls).toHaveLength(1);
    const key = `geo:rev:${lat.toFixed(5)},77.59460`;
    expect(store.get(key)?.ttl).toBe(86_400);
    const second = await mapsService.reverseGeocode(lat, 77.5946);
    expect(second).toEqual(first);
    expect(providerCalls).toHaveLength(1);
    expect(lines.filter((l) => l.msg.startsWith("maps."))).toEqual([]);
  });

  it("ETA: Google's traffic-aware duration is used and the repeat is served from cache", async () => {
    scenario = "ok";
    const from = { lat: 12.9784 + Math.random() / 100, lng: 77.6408 };
    const to = { lat: 12.9756, lng: 77.6066 };
    const first = await mapsService.eta(from, to);
    expect(first).toEqual({ etaMinutes: 18, distanceKm: 5.2, source: "google", withTraffic: true });
    const second = await mapsService.eta(from, to);
    expect(second).toEqual(first);
    expect(providerCalls).toEqual(["/maps/api/distancematrix/json"]);
  });
});
