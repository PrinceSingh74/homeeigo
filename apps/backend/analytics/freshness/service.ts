/**
 * Data Freshness Monitoring — last sync, lag, SLA, pipeline health per dataset.
 */
import prisma from "../../src/lib/prisma";
import { ETL_JOB_DEFINITIONS, getJobDefinition } from "../config";
import { recordFreshnessMetrics } from "../../src/lib/etl-metrics";

export type FreshnessReport = {
  dataset: string;
  lastSyncAt: string | null;
  lagSeconds: number | null;
  freshnessScore: number;
  stalenessScore: number;
  delaySeconds: number | null;
  slaTargetSeconds: number;
  slaMet: boolean;
  pipelineHealth: "healthy" | "degraded" | "stale" | "unknown";
};

function computeHealth(lagSeconds: number | null, slaTarget: number): FreshnessReport["pipelineHealth"] {
  if (lagSeconds == null) return "unknown";
  if (lagSeconds <= slaTarget) return "healthy";
  if (lagSeconds <= slaTarget * 2) return "degraded";
  return "stale";
}

export async function updateFreshnessSnapshot(jobId: string): Promise<FreshnessReport | null> {
  const def = getJobDefinition(jobId);
  if (!def) return null;

  const watermark = await prisma.etlWatermark.findUnique({ where: { jobId } });
  const lastSync = watermark?.lastSyncAt ?? null;
  const lagSeconds = lastSync ? Math.floor((Date.now() - lastSync.getTime()) / 1000) : null;
  const slaTarget = def.slaTargetSeconds;
  const slaMet = lagSeconds != null ? lagSeconds <= slaTarget : false;
  const freshnessScore = lagSeconds != null ? Math.max(0, Math.min(100, 100 - (lagSeconds / slaTarget) * 50)) : 0;
  const stalenessScore = lagSeconds != null ? Math.min(100, (lagSeconds / slaTarget) * 100) : 100;
  const health = computeHealth(lagSeconds, slaTarget);

  await prisma.dataFreshnessSnapshot.upsert({
    where: { dataset: def.targetTable },
    create: {
      dataset: def.targetTable,
      lastSyncAt: lastSync,
      lagSeconds,
      freshnessScore,
      stalenessScore,
      delaySeconds: lagSeconds,
      slaTargetSeconds: slaTarget,
      slaMet,
      pipelineHealth: health,
      sourceRowCount: watermark?.rowsSynced,
    },
    update: {
      lastSyncAt: lastSync,
      lagSeconds,
      freshnessScore,
      stalenessScore,
      delaySeconds: lagSeconds,
      slaMet,
      pipelineHealth: health,
      sourceRowCount: watermark?.rowsSynced,
    },
  });

  recordFreshnessMetrics(def.targetTable, lagSeconds, freshnessScore, slaMet);

  return {
    dataset: def.targetTable,
    lastSyncAt: lastSync?.toISOString() ?? null,
    lagSeconds,
    freshnessScore,
    stalenessScore,
    delaySeconds: lagSeconds,
    slaTargetSeconds: slaTarget,
    slaMet,
    pipelineHealth: health,
  };
}

export async function refreshAllFreshness(): Promise<FreshnessReport[]> {
  const reports: FreshnessReport[] = [];
  for (const def of ETL_JOB_DEFINITIONS) {
    const report = await updateFreshnessSnapshot(def.id);
    if (report) reports.push(report);
  }
  return reports;
}

export async function getFreshnessDashboard(): Promise<FreshnessReport[]> {
  const snapshots = await prisma.dataFreshnessSnapshot.findMany({ orderBy: { dataset: "asc" } });
  return snapshots.map((s) => ({
    dataset: s.dataset,
    lastSyncAt: s.lastSyncAt?.toISOString() ?? null,
    lagSeconds: s.lagSeconds,
    freshnessScore: s.freshnessScore ?? 0,
    stalenessScore: s.stalenessScore ?? 0,
    delaySeconds: s.delaySeconds,
    slaTargetSeconds: s.slaTargetSeconds,
    slaMet: s.slaMet,
    pipelineHealth: s.pipelineHealth as FreshnessReport["pipelineHealth"],
  }));
}

export async function getSlaViolations(): Promise<FreshnessReport[]> {
  const all = await getFreshnessDashboard();
  return all.filter((r) => !r.slaMet);
}
