/**
 * Phase 1 Analytics Platform API — ADMIN only, RBAC-protected, DPDP-ready (no raw PII).
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { mlopsService as svc, readRegistry } from "../services/mlops.service";
import { readWarehouse, warehouseQueryTimeoutMs, DEMAND_FORECAST_UNAVAILABLE } from "../lib/warehouse-read";
import { getExecutionHistory } from "../../analytics/etl/engine";
import { triggerManualEtl } from "../../analytics/scheduler/etl-scheduler";
import { runDataQualityChecks, getQualityHistory } from "../../analytics/data-quality/engine";
import { getFreshnessDashboard, getSlaViolations } from "../../analytics/freshness/service";
import { featureStoreService, FEATURE_STORE_UNAVAILABLE, type FeatureGroup } from "../../analytics/feature-store/service";
import { listVersions, getActiveVersion, rollbackVersion, type VersionType } from "../../analytics/versioning/service";
import {
  demandForecastService,
  type ForecastGranularity,
  type ForecastScope,
} from "../../analytics/forecast/demand-forecast.service";
import { ETL_JOB_DEFINITIONS } from "../../analytics/config";
import prisma from "../lib/prisma";

/** Warehouse planning reads for HTTP (X-88): the rows, or a stated outage with no figures. */
function readForecast<T>(run: () => Promise<T>) {
  return readWarehouse(run, {
    reasonCode: DEMAND_FORECAST_UNAVAILABLE,
    logEvent: "forecast_planning_unavailable",
    reason: "The demand-forecast warehouse views did not answer.",
  });
}

/**
 * Request-boundary schemas for the two analytics unions. These endpoints previously accepted a
 * bare `t.String()` and handed it straight to functions typed `FeatureGroup` / `VersionType`, so an
 * arbitrary value flowed into the feature store and the version registry. `split` on
 * /features/export was already validated this way — these bring the sibling fields in line.
 *
 * `satisfies` ties each literal list to its source union, so adding a member to `FeatureGroup` or
 * `VersionType` without updating the route schema becomes a compile error rather than a silent
 * rejection at runtime.
 */
const FEATURE_GROUPS = [
  "customer", "partner", "payment", "finance", "fraud", "geo", "demand", "eta",
] as const satisfies readonly FeatureGroup[];

const VERSION_TYPES = [
  "dataset", "feature", "training", "schema", "pipeline",
] as const satisfies readonly VersionType[];

const FEATURE_GROUP_SCHEMA = t.Union(FEATURE_GROUPS.map((g) => t.Literal(g)));
const VERSION_TYPE_SCHEMA = t.Union(VERSION_TYPES.map((v) => t.Literal(v)));

export const analyticsRoutes = new Elysia({ prefix: "/api/analytics" })
  .use(authPlugin)

  // ETL Platform
  .get("/etl/jobs", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, jobs: ETL_JOB_DEFINITIONS };
  })
  .post("/etl/run", async ({ requireRole, body }) => {
    requireRole("ADMIN");
    const result = await triggerManualEtl(body.jobIds, body.runMode);
    return { success: result.success, counts: result.counts };
  }, {
    body: t.Object({
      jobIds: t.Optional(t.Array(t.String())),
      /**
       * Constrained to the real `EtlRunMode` enum. It was `t.String()`, so any arbitrary value
       * reached `triggerManualEtl` — which types it as `EtlRunMode` — and would have been written
       * to an enum column. Validating at the boundary rejects it with a 422 instead, matching how
       * `split` is already validated on /features/export.
       */
      runMode: t.Optional(
        t.Union([
          t.Literal("INCREMENTAL"),
          t.Literal("FULL"),
          t.Literal("RECOVERY"),
          t.Literal("BACKFILL"),
          t.Literal("REPLAY"),
        ]),
      ),
    }),
  })
  .get("/etl/executions/:jobId", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, executions: await getExecutionHistory(params.jobId) };
  })
  .get("/etl/watermarks", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, watermarks: await prisma.etlWatermark.findMany() };
  })

  // Data Quality
  .get("/quality", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, ...(await runDataQualityChecks(undefined, { deadlineMs: warehouseQueryTimeoutMs() })) };
  })
  .get("/quality/history/:dataset", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, history: await getQualityHistory(params.dataset) };
  })

  // Freshness
  .get("/freshness", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, datasets: await getFreshnessDashboard() };
  })
  .get("/freshness/sla-violations", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, violations: await getSlaViolations() };
  })

  // Feature Store
  .get("/features/:group", async ({ requireRole, params, query, set }) => {
    requireRole("ADMIN");
    // Caller errors are 400s, never reported as the warehouse being down (X-88).
    const group = params.group as FeatureGroup;
    if (!(FEATURE_GROUPS as readonly string[]).includes(group)) {
      set.status = 400;
      return { success: false, error: `Unknown feature group. Available: ${FEATURE_GROUPS.join(", ")}` };
    }
    const limit = Number(query.limit ?? 100);
    if (!Number.isFinite(limit)) {
      set.status = 400;
      return { success: false, error: "limit must be a number" };
    }
    const n = Math.max(1, Math.min(Math.floor(limit), 1000));
    const r = await readWarehouse(() => featureStoreService.getFeatures(group, n), {
      reasonCode: FEATURE_STORE_UNAVAILABLE,
      logEvent: "feature_store_unavailable",
      reason: "The feature-store warehouse view did not answer.",
    });
    return r.available ? { success: true, available: true, features: r.value } : { success: true, ...r };
  })
  .get("/features/metadata", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, metadata: await featureStoreService.getFeatureMetadata() };
  })
  .post("/features/export", async ({ requireRole, body, set }) => {
    requireRole("ADMIN");
    const r = await readWarehouse(() => featureStoreService.exportTrainingDataset(body.group, body.split), {
      reasonCode: FEATURE_STORE_UNAVAILABLE,
      logEvent: "feature_store_export_unavailable",
      reason: "The feature-store warehouse view did not answer; no training version was recorded.",
    });
    if (!r.available) {
      // An action that did not happen is not a success (X-88): 503, and nothing was written.
      set.status = 503;
      return { success: false, error: r.reason, ...r };
    }
    return { success: true, ...r.value };
  }, { body: t.Object({ group: FEATURE_GROUP_SCHEMA, split: t.Union([t.Literal("training"), t.Literal("validation"), t.Literal("testing")]) }) })

  // Versioning
  .get("/versions/:type", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, versions: await listVersions(params.type as "dataset") };
  })
  .get("/versions/:type/active", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, version: await getActiveVersion(params.type as "dataset") };
  })
  .post("/versions/rollback", async ({ requireRole, body }) => {
    requireRole("ADMIN");
    const ok = await rollbackVersion(body.versionType, body.versionTag);
    return { success: ok };
  }, { body: t.Object({ versionType: VERSION_TYPE_SCHEMA, versionTag: t.String() }) })

  // Demand Forecast (ARIMA_PLUS)
  .get("/forecast/models", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, models: demandForecastService.listAvailableModels() };
  })
  .get("/forecast/model-metrics", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, ...(await demandForecastService.modelMetrics()) };
  })
  .get("/forecast/:scope/:granularity", async ({ requireRole, params, query, set }) => {
    requireRole("ADMIN");
    const result = await demandForecastService.forecastSafe(
      params.scope as ForecastScope,
      params.granularity as ForecastGranularity,
      query.horizon !== undefined ? Number(query.horizon) : undefined,
      query.confidence !== undefined ? Number(query.confidence) : undefined,
    );
    if (!result.available) {
      // Unknown scope/granularity is a caller error; an infrastructure failure is not.
      set.status = result.reason.startsWith("No trained model") ? 400 : 503;
      return { success: false, error: result.reason, scope: result.scope, granularity: result.granularity };
    }
    // `source` (warehouse | deterministic_fallback) and the fallback's degraded/limitations were
    // dropped here, so a fallback series reached the admin UI looking like a warehouse forecast.
    return {
      success: true,
      forecasts: result.forecasts,
      meta: result.meta,
      source: result.source,
      ...("degraded" in result ? { degraded: result.degraded, limitations: result.limitations, fallbackReason: result.reason } : {}),
    };
  })
  .get("/forecast/surge-planning", async ({ requireRole }) => {
    requireRole("ADMIN");
    const r = await readForecast(() => demandForecastService.surgePlanning());
    return r.available ? { success: true, available: true, data: r.value } : { success: true, ...r };
  })
  .get("/forecast/capacity", async ({ requireRole, query }) => {
    requireRole("ADMIN");
    const r = await readForecast(() => demandForecastService.capacityPlanning(query.city as string | undefined));
    return r.available ? { success: true, available: true, data: r.value } : { success: true, ...r };
  })

  // MLOps (delegates to existing service)
  .get("/mlops/registry", async ({ requireRole }) => {
    requireRole("ADMIN");
    const r = await readRegistry(() => svc.registry());
    return r.available ? { success: true, available: true, ...r.value } : { success: true, ...r };
  })
  .get("/mlops/metrics", async ({ requireRole }) => {
    requireRole("ADMIN");
    const r = await readRegistry(() => svc.modelMetrics());
    return r.available ? { success: true, available: true, data: r.value } : { success: true, ...r };
  })
  .get("/health", async ({ requireRole }) => {
    requireRole("ADMIN");
    /**
     * Composite (X-88/X-90): freshness is Postgres and still answers during a warehouse outage; the
     * warehouse parts state their own unavailability instead of failing the whole panel. The quality
     * score is null when no rule could be evaluated — never 0% for data nobody measured.
     */
    const [freshness, quality, mlops] = await Promise.all([
      getFreshnessDashboard(),
      runDataQualityChecks(undefined, { deadlineMs: warehouseQueryTimeoutMs() }),
      readRegistry(() => svc.health()),
    ]);
    const pipeline = {
      freshness: freshness.filter((f) => f.pipelineHealth === "healthy").length,
      totalDatasets: freshness.length,
      qualityScore: quality.overallScore,
      qualityUnavailable: quality.sourceUnavailable,
      mlops: mlops.available ? { available: true as const, ...mlops.value } : mlops,
    };
    return {
      success: true,
      data: { pipeline },
      pipeline,
    };
  })

  // Phase 2 — ETA Intelligence (label collection only, no ML inference)
  .get("/eta", async ({ requireRole }) => {
    requireRole("ADMIN");
    const { etaIntelligenceService } = await import("../services/eta-intelligence.service");
    return { success: true, ...(await etaIntelligenceService.getDashboardStats()) };
  })
  .get("/eta/quality", async ({ requireRole }) => {
    requireRole("ADMIN");
    const { etaIntelligenceService } = await import("../services/eta-intelligence.service");
    return { success: true, ...(await etaIntelligenceService.getQualityReport()) };
  })
  .get("/eta/readiness", async ({ requireRole }) => {
    requireRole("ADMIN");
    const { etaIntelligenceService } = await import("../services/eta-intelligence.service");
    return { success: true, ...(await etaIntelligenceService.getReadinessReport()) };
  })
  .get("/eta/trips", async ({ requireRole, query }) => {
    requireRole("ADMIN");
    const { etaIntelligenceService } = await import("../services/eta-intelligence.service");
    const trips = await etaIntelligenceService.listTrips(Number(query.limit ?? 50), Number(query.offset ?? 0));
    return { success: true, trips };
  })
  .get("/eta/google", async ({ requireRole }) => {
    requireRole("ADMIN");
    const { etaIntelligenceService } = await import("../services/eta-intelligence.service");
    return { success: true, ...(await etaIntelligenceService.getGoogleStats()) };
  });
