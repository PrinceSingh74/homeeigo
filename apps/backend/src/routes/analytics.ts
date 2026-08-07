/**
 * Phase 1 Analytics Platform API — ADMIN only, RBAC-protected, DPDP-ready (no raw PII).
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { mlopsService as svc } from "../services/mlops.service";
import { runEtlPipeline, runEtlJob, getExecutionHistory } from "../../analytics/etl/engine";
import { triggerManualEtl } from "../../analytics/scheduler/etl-scheduler";
import { runDataQualityChecks, getQualityHistory } from "../../analytics/data-quality/engine";
import { getFreshnessDashboard, getSlaViolations } from "../../analytics/freshness/service";
import { featureStoreService } from "../../analytics/feature-store/service";
import { listVersions, getActiveVersion, rollbackVersion } from "../../analytics/versioning/service";
import { demandForecastService } from "../../analytics/forecast/demand-forecast.service";
import { ETL_JOB_DEFINITIONS } from "../../analytics/config";
import prisma from "../lib/prisma";

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
  }, { body: t.Object({ jobIds: t.Optional(t.Array(t.String())), runMode: t.Optional(t.String()) }) })
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
    return { success: true, ...(await runDataQualityChecks()) };
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
  .get("/features/:group", async ({ requireRole, params, query }) => {
    requireRole("ADMIN");
    return { success: true, features: await featureStoreService.getFeatures(params.group as "customer", Number(query.limit ?? 100)) };
  })
  .get("/features/metadata", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, metadata: await featureStoreService.getFeatureMetadata() };
  })
  .post("/features/export", async ({ requireRole, body }) => {
    requireRole("ADMIN");
    return { success: true, ...(await featureStoreService.exportTrainingDataset(body.group, body.split)) };
  }, { body: t.Object({ group: t.String(), split: t.Union([t.Literal("training"), t.Literal("validation"), t.Literal("testing")]) }) })

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
  }, { body: t.Object({ versionType: t.String(), versionTag: t.String() }) })

  // Demand Forecast (ARIMA_PLUS upgrade)
  .get("/forecast/:scope/:granularity", async ({ requireRole, params, query }) => {
    requireRole("ADMIN");
    const rows = await demandForecastService.forecast(
      params.scope as "zone",
      params.granularity as "hourly",
      query.horizon ? Number(query.horizon) : undefined,
    );
    return { success: true, forecasts: rows };
  })
  .get("/forecast/surge-planning", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, data: await demandForecastService.surgePlanning() };
  })
  .get("/forecast/capacity", async ({ requireRole, query }) => {
    requireRole("ADMIN");
    return { success: true, data: await demandForecastService.capacityPlanning(query.city as string | undefined) };
  })

  // MLOps (delegates to existing service)
  .get("/mlops/registry", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.registry()) };
  })
  .get("/mlops/metrics", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, data: await svc.modelMetrics() };
  })
  .get("/health", async ({ requireRole }) => {
    requireRole("ADMIN");
    const [freshness, quality, mlops] = await Promise.all([
      getFreshnessDashboard(),
      runDataQualityChecks(),
      svc.health(),
    ]);
    return {
      success: true,
      pipeline: {
        freshness: freshness.filter((f) => f.pipelineHealth === "healthy").length,
        totalDatasets: freshness.length,
        qualityScore: quality.overallScore,
        mlops,
      },
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
