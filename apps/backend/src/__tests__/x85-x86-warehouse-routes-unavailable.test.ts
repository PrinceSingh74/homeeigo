/**
 * X-85 / X-86 — the two other routes with the X-84 shape (found by the X-84 sibling sweep).
 *
 * X-85  GET /api/pricing/surge-forecast (any authenticated user): `surgeForecast` ran
 *       `demandForecast(6)` inside `Promise.all` with no catch, so a warehouse outage became a 500.
 *       Now the live part (`current`, from zone signals) is still answered, and the forecast-derived
 *       part says it cannot be derived: trend "unknown", predicted = current, confidence 0,
 *       trendBasis "FORECAST_SOURCE_UNAVAILABLE" — distinct from "UNAVAILABLE_STALE_FORECAST", which
 *       would misstate the cause.
 *
 * X-86  GET /api/geo-intel/fraud (admin): `detectFakeGps` threw straight through. Now 200
 *       `available: false`, reasonCode "FRAUD_SIGNALS_SOURCE_UNAVAILABLE", `data: null`,
 *       `confidence: null` — no anomaly count and no risk score nobody computed. Also: a non-numeric
 *       `limit` is a 400, and the cache is keyed by `limit` (it was one key for every limit).
 *
 * The warehouse client is replaced through `__setWarehouseClientForTests` except in the tests that
 * exercise the real egress barrier; nothing leaves the machine.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { cacheService } from "../services/cache.service";
import { geoIntelligenceService } from "../services/geo-intelligence.service";
import { __setWarehouseClientForTests } from "../services/vertex-ai.service";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN_ID = `x8586-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let customerToken = "";
let adminToken = "";
let dbOk = false;

const REQUIRE_DB = "homigo_test must be reachable — a skipped route test would hide the defect";

function hourUtc(offsetHours: number): string {
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  return d.toISOString().slice(0, 13).replace("T", " ") + ":00";
}

type FakeCall = { query: string };
function fakeWarehouse(answer: (sql: string) => Promise<unknown>) {
  const calls: FakeCall[] = [];
  __setWarehouseClientForTests({
    query: ((opts: { query: string }) => {
      calls.push({ query: opts.query });
      return answer(opts.query);
    }) as never,
  });
  return calls;
}

const refused = () => Promise.reject(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" }));

function gpsRow(i: number) {
  return { provider_hash: `ph-${i}`, booking_id: null, implied_kmh: 180 + i, jump_meters: 900.5, lat: 28.45, lng: 77.02, ts: "2026-09-30 05:00:00" };
}

async function get(path: string, token: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }));
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN_ID);
  customerToken = bearer(ctx.customerA);
  adminToken = bearer(ctx.superAdmin);
}, 120_000);

afterEach(async () => {
  __setWarehouseClientForTests(null);
  // The surge route also warms the zone snapshot caches (`surge-prediction`, `provider-density`).
  // Left behind, a later suite that seeds its own zones reads this file's snapshot for up to 120 s —
  // that failed zone-recommendation's travel/history tests in the full run.
  for (const key of ["demand-forecast:6", "surge-prediction", "provider-density", "fraud", "fraud:2", "fraud:3", "fraud:7", "fraud:11"]) {
    await cacheService.invalidate(`geo-intel:${key}`);
  }
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

describe("X-85 surge-forecast: a warehouse outage is 'cannot say', not a 500", () => {
  const path = "/api/pricing/surge-forecast?lat=28.4595&lng=77.0266";

  test("credentials refused (real egress barrier) → 200, trend unknown, trendBasis FORECAST_SOURCE_UNAVAILABLE", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const { status, body } = await get(path, customerToken);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.trendBasis).toBe("FORECAST_SOURCE_UNAVAILABLE");
    expect(body.data.trend).toBe("unknown");
    expect(body.data.predicted).toBe(body.data.current);
    expect(body.confidence).toBe(0);
    expect(body.source).toContain("unavailable");
  });

  test("refused connection → same 'cannot say' answer", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    fakeWarehouse(refused);
    const { status, body } = await get(path, customerToken);
    expect(status).toBe(200);
    expect(body.data.trendBasis).toBe("FORECAST_SOURCE_UNAVAILABLE");
    expect(body.data.trend).toBe("unknown");
  });

  test("healthy forecast → trend derived from the forecast exactly as before", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    fakeWarehouse(async () => [[
      { zone_id: "z-1", hour: hourUtc(1), predicted: 2, lo: 1, hi: 3 },
      { zone_id: "z-1", hour: hourUtc(2), predicted: 4, lo: 2, hi: 6 },
      { zone_id: "z-1", hour: hourUtc(3), predicted: 8, lo: 5, hi: 11 },
    ]]);
    const { status, body } = await get(path, customerToken);
    expect(status).toBe(200);
    expect(body.data.trendBasis).toBe("demand-forecast");
    expect(body.data.trend).toBe(body.data.predicted > body.data.current * 1.05 ? "rising" : body.data.predicted < body.data.current * 0.95 ? "falling" : "stable");
    expect(body.confidence).toBeGreaterThan(0);
    expect(body.source).toBe("geo-intel:surge+demand-forecast");
  });

  test("expired forecast window keeps its existing answer (UNAVAILABLE_STALE_FORECAST)", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    fakeWarehouse(async () => [[
      { zone_id: "z-1", hour: "2026-06-01 10:00", predicted: 2, lo: 1, hi: 3 },
      { zone_id: "z-1", hour: "2026-06-01 11:00", predicted: 4, lo: 2, hi: 6 },
    ]]);
    const { body } = await get(path, customerToken);
    expect(body.data.trendBasis).toBe("UNAVAILABLE_STALE_FORECAST");
    expect(body.data.trend).toBe("unknown");
    expect(body.confidence).toBe(0);
  });
});

describe("X-86 geo-intel fraud: a warehouse outage is a stated state, not a 500", () => {
  test("credentials refused (real egress barrier) → 200 available:false, no count and no score", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const { status, body } = await get("/api/geo-intel/fraud?limit=7", adminToken);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.available).toBe(false);
    expect(body.reasonCode).toBe("FRAUD_SIGNALS_SOURCE_UNAVAILABLE");
    expect(body.cause).toBe("CREDENTIALS");
    expect(body.data).toBeNull();
    expect(body.confidence).toBeNull();
  });

  test("refused connection → 200 available:false, cause CONNECTION", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    fakeWarehouse(refused);
    const { status, body } = await get("/api/geo-intel/fraud?limit=7", adminToken);
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.cause).toBe("CONNECTION");
    expect(body.data).toBeNull();
  });

  test("healthy warehouse → available:true with the same data as before", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const rows = [gpsRow(1), gpsRow(2)];
    fakeWarehouse(async () => [rows]);
    const { status, body } = await get("/api/geo-intel/fraud?limit=11", adminToken);
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.source).toBe("bigquery:vw_fake_gps_signals");
    expect(body.data.events).toEqual(rows);
    expect(body.data.suspiciousCount).toBe(2);
    expect(body.data.riskScore).toBe(18); // worst 182 km/h → round(182/1000*100)
    expect(body.confidence).toBe(0.95);
  });

  test("a non-numeric limit is a caller error (400) and never reaches the warehouse", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const calls = fakeWarehouse(async () => [[gpsRow(1)]]);
    const { status, body } = await get("/api/geo-intel/fraud?limit=abc", adminToken);
    expect(status).toBe(400);
    expect(body.success).toBe(false);
    expect(calls).toHaveLength(0);
  });

  test("each limit is answered for that limit (the cache used one key for every limit)", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    fakeWarehouse(async (sql) => {
      const n = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? 0);
      return [Array.from({ length: n }, (_, i) => gpsRow(i))];
    });
    const two = await get("/api/geo-intel/fraud?limit=2", adminToken);
    const three = await get("/api/geo-intel/fraud?limit=3", adminToken);
    expect(two.body.data.suspiciousCount).toBe(2);
    expect(three.body.data.suspiciousCount).toBe(3);
  });

  test("a vendor cannot read it (role gate unchanged)", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const vendor = await prisma.user.findUniqueOrThrow({ where: { id: ctx.vendorUserId }, select: { id: true, email: true } });
    const { status } = await get("/api/geo-intel/fraud?limit=7", bearer(vendor));
    expect(status).toBe(403);
  });
});

describe("X-86 service: fraudDetectionSafe classifies malformed rows; the throwing method is unchanged", () => {
  test("a row with a non-numeric implied speed → MALFORMED_RESPONSE, not a NaN risk score", async () => {
    fakeWarehouse(async () => [[{ ...gpsRow(1), implied_kmh: "fast" }]]);
    const res = await geoIntelligenceService.fraudDetectionSafe(7);
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.cause).toBe("MALFORMED_RESPONSE");
    expect(res.data).toBeNull();
  });

  test("fraudDetection still throws for its direct consumer (digital twin catches it)", async () => {
    fakeWarehouse(refused);
    let thrown: unknown = null;
    try {
      await geoIntelligenceService.fraudDetection(7);
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toContain("ECONNREFUSED");
  });
});
