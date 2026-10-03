/**
 * X-84 — `GET /api/geo-intel/demand-forecast` answered an unhandled 500 when the data warehouse
 * could not be reached ("Could not load the default credentials" on the zero-egress stack; on live
 * the warehouse's billing is disabled).
 *
 * The contract now: a warehouse outage is a state, not a server error. The route answers 200 with
 * `available: false` and `reasonCode: "FORECAST_SOURCE_UNAVAILABLE"` (the code `forecast-explainer`
 * already uses for the same source) and carries NO forecast numbers — no points, no total, no
 * confidence. A healthy warehouse answers exactly as before, plus `available: true`.
 *
 * Outage shapes covered: refused connection, credentials refused by the egress barrier (the real
 * X-84 reproduction — no fake involved), a hang (bounded by a deadline), malformed rows, and the
 * client's own retries exhausted. The warehouse client is replaced through
 * `__setWarehouseClientForTests`, so nothing here leaves the machine.
 *
 * Horizons 101–120 are used only here: the live clients request 6 and 24, so no cached test result
 * can ever be read by a real consumer.
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

const RUN_ID = `x84-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let vendorToken = "";
let dbOk = false;
const usedHorizons = new Set<number>();

function hourUtc(offsetHours: number): string {
  const d = new Date(Date.now() + offsetHours * 3_600_000);
  return d.toISOString().slice(0, 13).replace("T", " ") + ":00";
}

const healthyRows = () => [
  { zone_id: "z-1", hour: hourUtc(1), predicted: 3.5, lo: 1.2, hi: 5.8 },
  { zone_id: "z-1", hour: hourUtc(2), predicted: 2.25, lo: 0.5, hi: 4 },
];

type FakeCall = { query: string; jobTimeoutMs?: number };
function fakeWarehouse(answer: () => Promise<unknown>) {
  const calls: FakeCall[] = [];
  __setWarehouseClientForTests({
    query: ((opts: { query: string; jobTimeoutMs?: number }) => {
      calls.push({ query: opts.query, jobTimeoutMs: opts.jobTimeoutMs });
      return answer();
    }) as never,
  });
  return calls;
}

function horizon(h: number): number {
  usedHorizons.add(h);
  return h;
}

async function getRoute(h: number) {
  const res = await app.handle(
    new Request(`http://localhost/api/geo-intel/demand-forecast?horizon=${h}`, {
      headers: { Authorization: `Bearer ${vendorToken}` },
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** An unavailable answer must not carry a single forecast number. */
function expectNoForecastNumbers(body: Record<string, any>) {
  expect(body.data).toBeNull();
  expect(body.confidence).toBeNull();
  expect(body.totalPredicted).toBeUndefined();
  expect(body.points).toBeUndefined();
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN_ID);
  const vendor = await prisma.user.findUniqueOrThrow({ where: { id: ctx.vendorUserId }, select: { id: true, email: true } });
  vendorToken = bearer(vendor);
}, 120_000);

afterEach(async () => {
  __setWarehouseClientForTests(null);
  delete process.env.BQ_QUERY_TIMEOUT_MS;
  for (const h of usedHorizons) await cacheService.invalidate(`geo-intel:demand-forecast:${h}`);
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

describe("X-84 route: warehouse unavailable is a 200 state, never a 500", () => {
  test("egress barrier refuses credentials (the reproduced X-84) → 200 available:false FORECAST_SOURCE_UNAVAILABLE", async () => {
    expect(dbOk, "homigo_test must be reachable — a skipped route test would hide X-84").toBe(true);
    // No fake: the real client path, refused by lib/bigquery-adc under NODE_ENV=test.
    const { status, body } = await getRoute(horizon(101));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.available).toBe(false);
    expect(body.reasonCode).toBe("FORECAST_SOURCE_UNAVAILABLE");
    expect(body.cause).toBe("CREDENTIALS");
    expectNoForecastNumbers(body);
  });

  test("refused connection → 200 available:false with cause CONNECTION", async () => {
    expect(dbOk, "homigo_test must be reachable — a skipped route test would hide X-84").toBe(true);
    fakeWarehouse(() => Promise.reject(Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:443"), { code: "ECONNREFUSED" })));
    const { status, body } = await getRoute(horizon(102));
    expect(status).toBe(200);
    expect(body.available).toBe(false);
    expect(body.reasonCode).toBe("FORECAST_SOURCE_UNAVAILABLE");
    expect(body.cause).toBe("CONNECTION");
    expectNoForecastNumbers(body);
  });

  test("a non-numeric horizon is a caller error (400), not reported as a warehouse outage", async () => {
    expect(dbOk, "homigo_test must be reachable — a skipped route test would hide X-84").toBe(true);
    const calls = fakeWarehouse(async () => [healthyRows()]);
    const res = await app.handle(
      new Request("http://localhost/api/geo-intel/demand-forecast?horizon=abc", {
        headers: { Authorization: `Bearer ${vendorToken}` },
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.success).toBe(false);
    expect(body.available).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("healthy warehouse → 200 available:true with the forecast exactly as computed before", async () => {
    expect(dbOk, "homigo_test must be reachable — a skipped route test would hide X-84").toBe(true);
    const rows = healthyRows();
    fakeWarehouse(async () => [rows]);
    const { status, body } = await getRoute(horizon(103));
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.available).toBe(true);
    expect(body.source).toBe("bigquery:arima_plus");
    expect(body.data.points).toEqual(rows);
    expect(body.data.totalPredicted).toBe(5.8);
    expect(body.data.stale).toBe(false);
    expect(body.data.horizonHours).toBe(103);
    expect(typeof body.confidence).toBe("number");
  });
});

describe("X-84 service: demandForecastSafe classifies every outage shape", () => {
  test("a hanging warehouse is cut off by the deadline (TIMEOUT); the fast jobs.query path stays eligible", async () => {
    process.env.BQ_QUERY_TIMEOUT_MS = "80";
    const calls = fakeWarehouse(() => new Promise(() => {}));
    const t0 = Date.now();
    const res = await geoIntelligenceService.demandForecastSafe(horizon(104));
    expect(Date.now() - t0).toBeLessThan(2_000);
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.reasonCode).toBe("FORECAST_SOURCE_UNAVAILABLE");
    expect(res.cause).toBe("TIMEOUT");
    expect(res.data).toBeNull();
    // jobTimeoutMs would disqualify the client's fast jobs.query path for every healthy call.
    expect(calls[0]?.jobTimeoutMs).toBeUndefined();
  });

  test("malformed rows (non-numeric prediction) → MALFORMED_RESPONSE, not a NaN forecast", async () => {
    fakeWarehouse(async () => [[{ zone_id: "z-1", hour: hourUtc(1), predicted: "lots", lo: 0, hi: 1 }]]);
    const res = await geoIntelligenceService.demandForecastSafe(horizon(105));
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.cause).toBe("MALFORMED_RESPONSE");
    expect(res.data).toBeNull();
  });

  test("malformed envelope (rows not an array) → MALFORMED_RESPONSE", async () => {
    fakeWarehouse(async () => [{ rows: "nope" }]);
    const res = await geoIntelligenceService.demandForecastSafe(horizon(106));
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.cause).toBe("MALFORMED_RESPONSE");
  });

  test("client retries exhausted (terminal 503 backendError) → UPSTREAM_ERROR; this layer adds no retries of its own", async () => {
    const calls = fakeWarehouse(() =>
      Promise.reject(Object.assign(new Error("Retry limit exceeded"), { code: 503, errors: [{ reason: "backendError" }] })),
    );
    const res = await geoIntelligenceService.demandForecastSafe(horizon(107));
    expect(res.available).toBe(false);
    if (res.available) return;
    expect(res.cause).toBe("UPSTREAM_ERROR");
    expect(calls).toHaveLength(1);
  });

  test("an unavailable answer is not cached: the next request after recovery gets the forecast", async () => {
    const h = horizon(108);
    fakeWarehouse(() => Promise.reject(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })));
    const down = await geoIntelligenceService.demandForecastSafe(h);
    expect(down.available).toBe(false);
    fakeWarehouse(async () => [healthyRows()]);
    const up = await geoIntelligenceService.demandForecastSafe(h);
    expect(up.available).toBe(true);
  });

  test("existing direct consumers still see a throw on outage (their own SOURCE_UNAVAILABLE handling is unchanged)", async () => {
    fakeWarehouse(() => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" })));
    let thrown: unknown = null;
    try {
      await geoIntelligenceService.demandForecast(horizon(109));
    } catch (err) {
      thrown = err;
    }
    expect(String(thrown)).toContain("ECONNREFUSED");
  });
});
