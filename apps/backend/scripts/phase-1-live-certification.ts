#!/usr/bin/env bun
/**
 * Phase 1 Live Certification — all gates must PASS for certification.
 *   bun run --env-file=.env scripts/phase-1-live-certification.ts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BigQuery } from "@google-cloud/bigquery";
import prisma from "../src/lib/prisma";
import { ANALYTICS_CONFIG, ETL_JOB_DEFINITIONS, BQ_DATASETS } from "../analytics/config";
import { ETL_JOB_REGISTRY } from "../analytics/etl/jobs";
import { runEtlPipeline, runEtlJob } from "../analytics/etl/engine";
import { resetWatermark } from "../analytics/etl/checkpoint";
import { runDataQualityChecks } from "../analytics/data-quality/engine";
import { refreshAllFreshness } from "../analytics/freshness/service";
import { demandForecastService } from "../analytics/forecast/demand-forecast.service";
import { mlopsService } from "../src/services/mlops.service";

const P = ANALYTICS_CONFIG.projectId;
const LOC = ANALYTICS_CONFIG.location;
const bq = new BigQuery({ projectId: P });
const evidenceDir = join(import.meta.dir, "../../../docs/evidence/phase-1");
mkdirSync(evidenceDir, { recursive: true });

type Gate = { name: string; passed: boolean; detail: string };
const gates: Gate[] = [];

function gate(name: string, passed: boolean, detail: string): void {
  gates.push({ name, passed, detail });
  console.log(`${passed ? "✅" : "❌"} ${name}: ${detail}`);
}

async function verifyBigQuery(): Promise<void> {
  const requiredDatasets = Object.values(BQ_DATASETS);
  const unique = [...new Set(requiredDatasets)];
  for (const ds of unique) {
    const [exists] = await bq.dataset(ds).exists();
    gate(`bq_dataset_${ds}`, exists, exists ? "exists" : "missing");
  }

  const tables: Array<{ name: string; layer: keyof typeof BQ_DATASETS }> = [
    { name: "fact_bookings", layer: "curated" },
    { name: "dim_partner", layer: "curated" },
    { name: "dim_customer", layer: "curated" },
    { name: "fact_payments", layer: "curated" },
    { name: "fact_notifications", layer: "raw" },
    { name: "fact_domain_events", layer: "raw" },
    { name: "agg_hourly_demand", layer: "analytics" },
  ];
  for (const t of tables) {
    const ds = BQ_DATASETS[t.layer];
    const [exists] = await bq.dataset(ds).table(t.name).exists();
    gate(`bq_table_${t.name}`, exists, exists ? `${ds}.${t.name}` : "missing");
  }

  const [cols] = await bq.query({
    query: `SELECT column_name FROM \`${P}.${BQ_DATASETS.curated}.INFORMATION_SCHEMA.COLUMNS\` WHERE table_name = 'fact_bookings' AND column_name = 'updated_at'`,
    location: LOC,
  });
  gate("bq_fact_bookings_updated_at", cols.length > 0, cols.length ? "present" : "missing");

  const [trainView] = await bq.dataset(BQ_DATASETS.curated).table("vw_train_demand").exists().catch(() => [false]);
  gate("bq_view_vw_train_demand", !!trainView, trainView ? "exists" : "missing");

  const [featView] = await bq.dataset(BQ_DATASETS.feature).table("fs_customer_features_v2").exists().catch(() => [false]);
  gate("bq_view_fs_customer_features_v2", !!featView, featView ? "exists" : "missing");
}

async function verifyModels(): Promise<void> {
  const [models] = await bq.dataset(BQ_DATASETS.curated).getModels();
  const names = new Set(models.map((m) => m.id));
  for (const m of ["model_demand_forecast", "model_demand_forecast_daily", "model_city_demand_forecast"]) {
    gate(`arima_${m}`, names.has(m), names.has(m) ? "trained" : "not found");
  }
}

async function verifyResetWatermark(): Promise<void> {
  const testJob = "etl.cert_test_watermark";
  await prisma.etlWatermark.deleteMany({ where: { jobId: testJob } });
  await resetWatermark(testJob, "cert_test");
  const row = await prisma.etlWatermark.findUnique({ where: { jobId: testJob } });
  gate("reset_watermark_upsert", !!row, row ? "upsert OK (no P2025)" : "failed");
  await prisma.etlWatermark.deleteMany({ where: { jobId: testJob } });
}

async function runLiveEtl(): Promise<Record<string, { success: boolean; rows: number }>> {
  console.log("\n--- Live ETL (all 17 jobs, INCREMENTAL) ---");
  const jobIds = ETL_JOB_DEFINITIONS.map((j) => j.id);
  const results: Record<string, { success: boolean; rows: number }> = {};

  const counts = await runEtlPipeline({ runMode: "INCREMENTAL", jobIds });
  for (const jobId of jobIds) {
    const exec = await prisma.etlJobExecution.findFirst({
      where: { jobId },
      orderBy: { createdAt: "desc" },
    });
    const success = exec?.status === "SUCCEEDED";
    results[jobId] = { success: !!success, rows: counts[jobId] ?? 0 };
    gate(`live_etl_${jobId}`, !!success, success ? `rows=${counts[jobId] ?? 0}` : exec?.errorMessage ?? "FAILED");
  }
  return results;
}

async function verifyForecastApis(): Promise<void> {
  try {
    const forecast = await demandForecastService.forecast("zone", "hourly", 24);
    gate("forecast_api", Array.isArray(forecast), `${forecast.length} rows`);
  } catch (e) {
    gate("forecast_api", false, e instanceof Error ? e.message : String(e));
  }
  try {
    const surge = await demandForecastService.surgePlanning();
    gate("surge_planning", !!surge, surge ? "OK" : "empty");
  } catch (e) {
    gate("surge_planning", false, e instanceof Error ? e.message : String(e));
  }
  try {
    const cap = await demandForecastService.capacityPlanning();
    gate("capacity_planning", !!cap, cap ? "OK" : "empty");
  } catch (e) {
    gate("capacity_planning", false, e instanceof Error ? e.message : String(e));
  }
}

async function verifyPrisma(): Promise<void> {
  const pending = await prisma.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NULL
  `.catch(() => []);
  gate("prisma_no_pending", pending.length === 0, pending.length ? `${pending.length} pending` : "all applied");

  const cols = await prisma.$queryRaw<Array<{ column_name: string }>>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'bookings' AND column_name = 'addons'
  `;
  gate("regression_addons_column", cols.length > 0, cols.length ? "present" : "missing");
}

async function verifyScheduler(): Promise<void> {
  gate("scheduler_max_parallel", ANALYTICS_CONFIG.maxParallelJobs >= 1, `maxParallelJobs=${ANALYTICS_CONFIG.maxParallelJobs}`);
  gate("etl_handlers", Object.keys(ETL_JOB_REGISTRY).length === ETL_JOB_DEFINITIONS.length, `${Object.keys(ETL_JOB_REGISTRY).length} handlers`);
}

async function main(): Promise<void> {
  console.log("HOMIGO Phase 1 Live Certification\n");

  await verifyPrisma();
  await verifyResetWatermark();
  await verifyScheduler();
  await verifyBigQuery();
  await verifyModels();

  const etlResults = await runLiveEtl();

  const dq = await runDataQualityChecks();
  gate("data_quality", dq.criticalFailures === 0, `score=${dq.overallScore}, critical=${dq.criticalFailures}`);

  const freshness = await refreshAllFreshness();
  gate("freshness", freshness.length > 0, `${freshness.length} datasets`);

  await verifyForecastApis();

  try {
    const mlops = await mlopsService.health();
    const ok = mlops.total >= 0 && (mlops.trained > 0 || mlops.partial > 0);
    gate("mlops_health", ok, `trained=${mlops.trained}, partial=${mlops.partial}, blocked=${mlops.blocked}`);
  } catch (e) {
    gate("mlops_health", false, e instanceof Error ? e.message : String(e));
  }

  const passed = gates.filter((g) => g.passed).length;
  const failed = gates.filter((g) => !g.passed);
  const allEtlPass = Object.values(etlResults).every((r) => r.success);

  const report = {
    timestamp: new Date().toISOString(),
    passed,
    total: gates.length,
    allEtlPass,
    gates,
    etlResults,
  };
  writeFileSync(join(evidenceDir, "live-certification.json"), JSON.stringify(report, null, 2));

  console.log(`\n=== ${passed}/${gates.length} gates passed ===`);
  if (failed.length) {
    console.log("Failed:");
    failed.forEach((g) => console.log(`  - ${g.name}: ${g.detail}`));
  }

  if (failed.length > 0 || !allEtlPass) {
    console.log("\nPHASE 1 — NOT CERTIFIED ❌");
    process.exit(1);
  }
  console.log("\nPHASE 1 LIVE CERTIFICATION PASSED ✅");
}

main().catch((e) => { console.error(e); process.exit(1); });
