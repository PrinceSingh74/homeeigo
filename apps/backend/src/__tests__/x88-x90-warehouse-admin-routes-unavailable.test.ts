/**
 * X-88 / X-89 / X-90 — the rest of the X-84 class: warehouse-backed admin routes with no availability
 * boundary between the warehouse read and the HTTP answer.
 *
 * Every test here uses the REAL egress barrier (lib/bigquery-adc refuses under NODE_ENV=test), which
 * is exactly how the warehouse is unreachable on the zero-egress stack — no fake client involved.
 *
 * X-88  13 admin routes answered an unhandled 500. Contract now (the X-84 class contract):
 *       200 `{ success: true, available: false, reasonCode, cause, reason, data: null }` — no figures.
 *       `/api/analytics/health` is composite: its Postgres parts (freshness) still answer; only the
 *       warehouse parts say unavailable. POST `/api/analytics/features/export` is an action that did
 *       not happen: 503 `success: false`, and — the integrity half — it no longer writes a new ACTIVE
 *       training version (demoting the previous one) before discovering the warehouse is down.
 * X-89  `forecastSafe` threw for zone/daily (its fallback reads the same warehouse, unguarded), so
 *       `/api/analytics/forecast/zone/daily` answered 500. Now `available: false` → the route's
 *       existing 503 contract; the admin-ml deterministic forecast answers `unavailable: true`.
 * X-90  The data-quality engine scored an outage as every rule FAILED: overall score 0%, every rule a
 *       critical failure, and one `data_quality_results` row per rule (quality_score 101) written on a
 *       GET. Now a rule the warehouse could not evaluate is not evaluated: not scored, not persisted,
 *       overall score null.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { demandForecastService } from "../../analytics/forecast/demand-forecast.service";
import { runDataQualityChecks } from "../../analytics/data-quality/engine";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN_ID = `x8890-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let adminToken = "";
let dbOk = false;
const REQUIRE_DB = "homigo_test must be reachable — a skipped route test would hide the defect";

async function call(method: "GET" | "POST", path: string, body?: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { Authorization: `Bearer ${adminToken}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

function expectUnavailable(r: { status: number; body: Record<string, any> }, reasonCode: string) {
  expect(r.status).toBe(200);
  expect(r.body.success).toBe(true);
  expect(r.body.available).toBe(false);
  expect(r.body.reasonCode).toBe(reasonCode);
  expect(r.body.cause).toBe("CREDENTIALS");
  expect(r.body.data).toBeNull();
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN_ID);
  adminToken = bearer(ctx.superAdmin);
}, 120_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

describe("X-88 mlops routes: a warehouse outage is a stated state, not a 500", () => {
  for (const path of ["/api/mlops/health", "/api/mlops/registry", "/api/mlops/metrics", "/api/analytics/mlops/registry", "/api/analytics/mlops/metrics"]) {
    test(`${path} → 200 available:false ML_REGISTRY_SOURCE_UNAVAILABLE`, async () => {
      expect(dbOk, REQUIRE_DB).toBe(true);
      const r = await call("GET", path);
      expectUnavailable(r, "ML_REGISTRY_SOURCE_UNAVAILABLE");
      expect(r.body.models).toBeUndefined();
      expect(r.body.summary).toBeUndefined();
    });
  }

  test("/api/mlops/data-quality → 200 available:false DATA_QUALITY_SOURCE_UNAVAILABLE", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    expectUnavailable(await call("GET", "/api/mlops/data-quality"), "DATA_QUALITY_SOURCE_UNAVAILABLE");
  });
});

describe("X-88 analytics forecast planning routes", () => {
  for (const path of ["/api/analytics/forecast/surge-planning", "/api/analytics/forecast/capacity"]) {
    test(`${path} → 200 available:false FORECAST_SOURCE_UNAVAILABLE`, async () => {
      expect(dbOk, REQUIRE_DB).toBe(true);
      expectUnavailable(await call("GET", path), "FORECAST_SOURCE_UNAVAILABLE");
    });
  }
});

describe("X-88 feature store", () => {
  test("GET /api/analytics/features/customer → 200 available:false FEATURE_STORE_SOURCE_UNAVAILABLE", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    expectUnavailable(await call("GET", "/api/analytics/features/customer?limit=5"), "FEATURE_STORE_SOURCE_UNAVAILABLE");
  });

  test("an unknown group or a non-numeric limit is a caller error (400), not an outage", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    expect((await call("GET", "/api/analytics/features/galaxy")).status).toBe(400);
    expect((await call("GET", "/api/analytics/features/customer?limit=abc")).status).toBe(400);
  });

  test("POST /features/export during an outage → 503, and no training version is written or demoted", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const t0 = new Date();
    const activeBefore = await prisma.dataVersion.findMany({ where: { versionType: "training", isActive: true }, select: { id: true } });
    const r = await call("POST", "/api/analytics/features/export", { group: "customer", split: "training" });
    const created = await prisma.dataVersion.findMany({ where: { versionType: "training", createdAt: { gte: t0 } }, select: { id: true } });
    const activeAfter = await prisma.dataVersion.findMany({ where: { versionType: "training", isActive: true }, select: { id: true } });
    // Undo what the pre-fix code wrote, so a red run does not leave the test DB changed.
    if (created.length) {
      await prisma.dataVersion.deleteMany({ where: { id: { in: created.map((c) => c.id) } } });
      if (activeBefore.length) await prisma.dataVersion.updateMany({ where: { id: { in: activeBefore.map((a) => a.id) } }, data: { isActive: true } });
    }
    expect(r.status).toBe(503);
    expect(r.body.success).toBe(false);
    expect(r.body.available).toBe(false);
    expect(r.body.reasonCode).toBe("FEATURE_STORE_SOURCE_UNAVAILABLE");
    expect(created).toHaveLength(0);
    expect(activeAfter.map((a) => a.id).sort()).toEqual(activeBefore.map((a) => a.id).sort());
  });
});

describe("X-88 + X-90 composite pipeline health and data quality", () => {
  test("/api/analytics/health → 200: Postgres freshness answers, warehouse parts say unavailable, no fabricated score", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const rowsBefore = await prisma.dataQualityResult.count();
    const r = await call("GET", "/api/analytics/health");
    const rowsAfter = await prisma.dataQualityResult.count();
    expect(r.status).toBe(200);
    expect(r.body.success).toBe(true);
    const p = r.body.pipeline;
    expect(typeof p.totalDatasets).toBe("number");
    expect(p.qualityScore).toBeNull();
    expect(p.mlops.available).toBe(false);
    expect(p.mlops.reasonCode).toBe("ML_REGISTRY_SOURCE_UNAVAILABLE");
    expect(rowsAfter).toBe(rowsBefore);
  });

  test("runDataQualityChecks during an outage: nothing scored, nothing persisted, no critical failures claimed", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const rowsBefore = await prisma.dataQualityResult.count();
    const report = await runDataQualityChecks();
    const rowsAfter = await prisma.dataQualityResult.count();
    expect(report.overallScore).toBeNull();
    expect(report.criticalFailures).toBe(0);
    expect(report.sourceUnavailable).toBe(true);
    expect(report.rules.every((r) => r.evaluated === false)).toBe(true);
    expect(rowsAfter).toBe(rowsBefore);
  });

  test("/api/analytics/quality → 200 with overallScore null (not 0%)", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const r = await call("GET", "/api/analytics/quality");
    expect(r.status).toBe(200);
    expect(r.body.overallScore).toBeNull();
    expect(r.body.sourceUnavailable).toBe(true);
  });
});

describe("X-89 forecastSafe zone/daily and the deterministic forecaster", () => {
  test("forecastSafe(zone, daily) resolves available:false instead of rejecting", async () => {
    let rejected: unknown = null;
    let result: Awaited<ReturnType<typeof demandForecastService.forecastSafe>> | null = null;
    try {
      result = await demandForecastService.forecastSafe("zone", "daily");
    } catch (err) {
      rejected = err;
    }
    expect(rejected).toBeNull();
    expect(result?.available).toBe(false);
  });

  test("GET /api/analytics/forecast/zone/daily → the route's existing 503 contract, not a 500", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const r = await call("GET", "/api/analytics/forecast/zone/daily");
    expect(r.status).toBe(503);
    expect(r.body.success).toBe(false);
    expect(String(r.body.error)).toContain("fallback");
  });

  test("GET /api/admin/ml/demand/forecast → 200 unavailable (the deterministic forecaster reads the same warehouse)", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const r = await call("GET", "/api/admin/ml/demand/forecast");
    expect(r.status).toBe(200);
    expect(r.body.data.unavailable).toBe(true);
    expect(r.body.data.points).toBeUndefined();
  });

  test("GET /api/admin/ml/demand/evaluation → 200 with a SOURCE_UNAVAILABLE verdict and no comparison", async () => {
    expect(dbOk, REQUIRE_DB).toBe(true);
    const r = await call("GET", "/api/admin/ml/demand/evaluation");
    expect(r.status).toBe(200);
    expect(String(r.body.data.verdict)).toMatch(/^SOURCE_UNAVAILABLE/);
    expect(r.body.data.results).toEqual([]);
    expect(r.body.data.best).toBeNull();
  });
});
