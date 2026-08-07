/**
 * Enterprise ETL Scheduler — cron, interval, manual, event-triggered.
 * Uses Phase 0 distributed leader lock; no duplicate scheduler engine.
 */
import crypto from "node:crypto";
import type { EtlRunMode } from "@prisma/client";
import { runWithLeaderLock, getSchedulerInstanceId } from "../../src/lib/distributed-scheduler";
import { logger } from "../../src/lib/logger";
import { ANALYTICS_CONFIG, ETL_JOB_DEFINITIONS } from "../config";
import { runEtlPipeline, runEtlJob } from "../etl/engine";
import { runDataQualityChecks } from "../data-quality/engine";
import { refreshAllFreshness } from "../freshness/service";
import { createVersion } from "../versioning/service";
import { recordSchedulerMetrics } from "../../src/lib/etl-metrics";

const ETL_LOCK_KEY = "maintenance:etl_scheduler";
const ETL_LOCK_TTL = 900;

let etlTimer: ReturnType<typeof setInterval> | null = null;
let lastFullSyncDay: string | null = null;

export type SchedulerTrigger = "interval" | "cron" | "manual" | "event";

export async function runScheduledEtl(options: {
  trigger?: SchedulerTrigger;
  runMode?: EtlRunMode;
  jobIds?: string[];
  correlationId?: string;
} = {}): Promise<{ success: boolean; counts: Record<string, number> }> {
  const correlationId = options.correlationId ?? crypto.randomBytes(16).toString("hex");
  const trigger = options.trigger ?? "interval";
  const t0 = Date.now();

  try {
    const counts = await runEtlPipeline({
      runMode: options.runMode ?? "INCREMENTAL",
      jobIds: options.jobIds,
      correlationId,
    });

    await runDataQualityChecks();
    await refreshAllFreshness();
    await createVersion("pipeline", { trigger, counts, instanceId: getSchedulerInstanceId() });

    const durationMs = Date.now() - t0;
    recordSchedulerMetrics({ trigger, status: "success", durationMs, jobsRun: Object.keys(counts).length });
    logger.info("etl_scheduler_complete", {
      category: "APPLICATION",
      trigger,
      correlationId,
      jobsRun: Object.keys(counts).length,
      durationMs,
    });

    return { success: true, counts };
  } catch (err) {
    const durationMs = Date.now() - t0;
    recordSchedulerMetrics({ trigger, status: "failure", durationMs, jobsRun: 0 });
    logger.error("etl_scheduler_failed", {
      category: "APPLICATION",
      trigger,
      correlationId,
      error: err instanceof Error ? err.message : String(err),
      durationMs,
    });
    return { success: false, counts: {} };
  }
}

/** Leader-locked tick — called from maintenance loop. */
export async function runEtlSchedulerTick(): Promise<void> {
  await runWithLeaderLock(ETL_LOCK_KEY, ETL_LOCK_TTL, async () => {
    const today = new Date().toISOString().slice(0, 10);
    const isFullSyncHour = new Date().getUTCHours() === 2;

    if (isFullSyncHour && lastFullSyncDay !== today) {
      lastFullSyncDay = today;
      await runScheduledEtl({ trigger: "cron", runMode: "FULL" });
    } else {
      await runScheduledEtl({ trigger: "interval", runMode: "INCREMENTAL" });
    }
  });
}

export async function triggerManualEtl(jobIds?: string[], runMode: EtlRunMode = "INCREMENTAL") {
  return runScheduledEtl({ trigger: "manual", runMode, jobIds });
}

export async function triggerEventEtl(eventType: string, aggregateId: string): Promise<void> {
  const domainMap: Record<string, string[]> = {
    "homigo.booking.completed": ["etl.booking", "etl.aggregates"],
    "homigo.payment.captured": ["etl.payment", "etl.ledger"],
    "homigo.partner.arrived": ["etl.booking", "etl.location"],
  };
  const jobIds = domainMap[eventType];
  if (!jobIds) return;
  await runScheduledEtl({
    trigger: "event",
    runMode: "INCREMENTAL",
    jobIds,
    correlationId: `event:${eventType}:${aggregateId}`,
  });
}

export function startEtlScheduler(): void {
  if (etlTimer) return;
  if (process.env.ENABLE_ETL_SCHEDULER === "false") return;

  void runEtlSchedulerTick();
  etlTimer = setInterval(() => void runEtlSchedulerTick(), ANALYTICS_CONFIG.incrementalIntervalMs);
  (etlTimer as { unref?: () => void }).unref?.();
  logger.info("etl_scheduler_started", {
    category: "APPLICATION",
    intervalMs: ANALYTICS_CONFIG.incrementalIntervalMs,
    jobs: ETL_JOB_DEFINITIONS.length,
  });
}

export function stopEtlScheduler(): void {
  if (etlTimer) {
    clearInterval(etlTimer);
    etlTimer = null;
  }
}

/** Run a single job on demand (CLI / admin API). */
export { runEtlJob };
