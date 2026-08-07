#!/usr/bin/env bun
/**
 * Phase 2 ETA Intelligence — Enterprise Certification Script
 *   bun run --env-file=.env scripts/phase-2-certification.ts
 *
 * Verifies: label collection, validation, feature engineering, ETL, metrics, APIs.
 * NO ML inference checks — label platform only.
 */
import prisma from "../src/lib/prisma";
import { validateEtaLabel } from "../analytics/eta/validation";
import { engineerEtaFeatures } from "../analytics/eta/feature-engineering";
import { ETL_JOB_DEFINITIONS } from "../analytics/config";
import { ETL_JOB_REGISTRY } from "../analytics/etl/jobs";
import { DATA_QUALITY_RULES } from "../analytics/data-quality/engine";
import { EVENT_TYPES } from "../src/events/catalog/event-types";

type Check = { name: string; passed: boolean; detail: string };

const checks: Check[] = [];

function record(name: string, passed: boolean, detail: string): void {
  checks.push({ name, passed, detail });
  console.log(`${passed ? "✅" : "❌"} ${name}: ${detail}`);
}

async function safeDb<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist") || msg.includes("Unknown model")) return fallback;
    throw err;
  }
}

async function main(): Promise<void> {
  console.log("HOMIGO Phase 2 — ETA Intelligence Certification\n");

  // Module 1: Event types
  record("eta_event_types", Boolean(EVENT_TYPES.ETA_LABEL_CREATED), EVENT_TYPES.ETA_LABEL_CREATED);
  record("eta_trip_completed_event", Boolean(EVENT_TYPES.ETA_TRIP_COMPLETED), EVENT_TYPES.ETA_TRIP_COMPLETED);
  record("eta_feature_updated_event", Boolean(EVENT_TYPES.ETA_FEATURE_UPDATED), EVENT_TYPES.ETA_FEATURE_UPDATED);

  // Module 2: Prisma models
  const labelCount = await safeDb(() => prisma.etaTrainingLabel.count(), -1);
  record("eta_training_labels_table", labelCount >= 0, labelCount >= 0 ? "accessible" : "missing — run migration");

  const snapshotCount = await safeDb(() => prisma.etaGoogleSnapshot.count(), -1);
  record("eta_google_snapshots_table", snapshotCount >= 0, snapshotCount >= 0 ? "accessible" : "missing");

  const gpsCount = await safeDb(() => prisma.etaGpsTrack.count(), -1);
  record("eta_gps_tracks_table", gpsCount >= 0, gpsCount >= 0 ? "accessible" : "missing");

  // Module 3: Validation engine
  const validResult = validateEtaLabel({
    bookingId: "test",
    dispatchTimestamp: new Date(Date.now() - 600_000),
    arrivalTimestamp: new Date(),
    actualTravelDurationSec: 600,
    pickupLatitude: 28.6,
    pickupLongitude: 77.2,
    partnerLatArrival: 28.61,
    partnerLngArrival: 77.21,
    travelDistanceMeters: 1500,
    googleEtaSeconds: 540,
  });
  record("validation_passes_valid_label", validResult.passed, `score=${validResult.qualityScore}`);

  const invalidResult = validateEtaLabel({
    bookingId: "test",
    dispatchTimestamp: null,
    arrivalTimestamp: null,
    actualTravelDurationSec: -100,
    pickupLatitude: 0,
    pickupLongitude: 0,
    partnerLatArrival: null,
    partnerLngArrival: null,
    travelDistanceMeters: null,
    googleEtaSeconds: null,
  });
  record("validation_rejects_invalid_label", !invalidResult.passed, invalidResult.rejectionReasons.join(","));

  // Module 4: Feature engineering
  const features = engineerEtaFeatures({
    dispatchTimestamp: new Date(Date.now() - 900_000),
    arrivalTimestamp: new Date(),
    partnerLatDispatch: 28.55,
    partnerLngDispatch: 77.15,
    partnerLatArrival: 28.61,
    partnerLngArrival: 77.21,
    pickupLatitude: 28.61,
    pickupLongitude: 77.21,
    travelDistanceMeters: 3200,
    actualTravelDurationSec: 900,
    googleEtaSeconds: 840,
    rain: 0,
    temperature: 32,
    historicalRouteCount: 25,
    historicalAvgDuration: 14,
  });
  record("feature_engineering_bearing", features.bearing != null, `bearing=${features.bearing}`);
  record("feature_engineering_distance_bucket", features.distanceBucket === "medium", features.distanceBucket ?? "null");
  record("feature_engineering_rush_hour", typeof features.rushHour === "boolean", String(features.rushHour));

  // Module 5: ETL job registered
  const etaJob = ETL_JOB_DEFINITIONS.find((j) => j.id === "etl.eta");
  record("etl_eta_job_defined", Boolean(etaJob), etaJob?.targetTable ?? "missing");
  record("etl_eta_handler_registered", Boolean(ETL_JOB_REGISTRY["etl.eta"]), "etl.eta handler");

  // Module 6: Data quality rules for ETA
  const etaDqRules = DATA_QUALITY_RULES.filter((r) => r.dataset.startsWith("eta"));
  record("eta_dq_rules", etaDqRules.length >= 4, `${etaDqRules.length} ETA DQ rules`);

  // Module 7: Feature store group
  const { featureStoreService } = await import("../analytics/feature-store/service");
  const metadata = await featureStoreService.getFeatureMetadata();
  record("eta_feature_store_group", metadata.some((m) => m.group === "eta"), "eta group in feature store");

  // Module 8: Service dashboard API
  const { etaIntelligenceService } = await import("../src/services/eta-intelligence.service");
  const stats = await safeDb(() => etaIntelligenceService.getDashboardStats(), null);
  record("eta_dashboard_stats", stats != null, stats ? `${stats.tripsCollected} trips` : "service unavailable");

  const readiness = await safeDb(() => etaIntelligenceService.getReadinessReport(), null);
  record("eta_readiness_report", readiness != null, readiness ? `${readiness.readinessPct}% ready` : "unavailable");

  // Summary
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  console.log(`\n=== Phase 2 Certification: ${passed}/${total} passed ===`);

  const evidence = {
    certifiedAt: new Date().toISOString(),
    phase: "2.0",
    scope: "ETA Intelligence Label Collection",
    mlInference: false,
    checks,
    summary: { passed, total, success: passed === total },
  };

  const outPath = `${import.meta.dir}/../../docs/evidence/phase-2/eta-intelligence-certification.json`;
  try {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    const { dirname } = await import("node:path");
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(evidence, null, 2));
    console.log(`Evidence written to ${outPath}`);
  } catch {
    console.log("Evidence write skipped (docs/evidence/phase-2/)");
  }

  if (passed < total) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
