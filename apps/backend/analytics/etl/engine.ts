/**
 * Enterprise ETL Engine — incremental, full, recovery, backfill, replay.
 * Reuses Phase 0 retry backoff; idempotent via watermarks + execution audit.
 */
import crypto from "node:crypto";
import type { EtlJobStatus, EtlRunMode } from "@prisma/client";
import prisma from "../../src/lib/prisma";
import { logger } from "../../src/lib/logger";
import { computeRetryDelayMs } from "../../src/events/core/retry";
import { ANALYTICS_CONFIG, ETL_JOB_DEFINITIONS, getJobDefinition } from "../config";
import { getWatermark, updateWatermark, resetWatermark } from "./checkpoint";
import { ETL_JOB_REGISTRY } from "./jobs";
import type { EtlJobContext } from "./types";
import { recordEtlMetrics } from "../../src/lib/etl-metrics";

export type RunEtlOptions = {
  jobIds?: string[];
  runMode?: EtlRunMode;
  traceId?: string;
  correlationId?: string;
  batchSize?: number;
  timeoutMs?: number;
  maxAttempts?: number;
};

function newTraceId(): string {
  return crypto.randomBytes(16).toString("hex");
}

async function createExecution(
  jobId: string,
  runMode: EtlRunMode,
  traceId: string,
  correlationId: string,
  batchSize: number,
  watermark: { lowWatermark: Date | null; highWatermark: Date | null; cursorId: string | null },
  maxAttempts: number,
): Promise<string> {
  const exec = await prisma.etlJobExecution.create({
    data: {
      jobId,
      runMode,
      status: "RUNNING",
      traceId,
      correlationId,
      batchSize,
      lowWatermark: watermark.lowWatermark,
      highWatermark: watermark.highWatermark,
      cursorStart: watermark.cursorId,
      maxAttempts,
      startedAt: new Date(),
    },
  });
  return exec.id;
}

async function finalizeExecution(
  executionId: string,
  status: EtlJobStatus,
  result: { rowsProcessed: number; rowsLoaded: number; lowWatermark: Date | null; highWatermark: Date | null; cursorEnd: string | null; durationMs: number; errorMessage?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await prisma.etlJobExecution.update({
    where: { id: executionId },
    data: {
      status,
      rowsProcessed: BigInt(result.rowsProcessed),
      rowsLoaded: BigInt(result.rowsLoaded),
      lowWatermark: result.lowWatermark,
      highWatermark: result.highWatermark,
      cursorEnd: result.cursorEnd,
      durationMs: result.durationMs,
      errorMessage: result.errorMessage,
      metadata: result.metadata,
      completedAt: new Date(),
    },
  });
}

export async function runEtlJob(jobId: string, options: RunEtlOptions = {}): Promise<{ success: boolean; rowsLoaded: number; executionId: string }> {
  const def = getJobDefinition(jobId);
  if (!def) throw new Error(`Unknown ETL job: ${jobId}`);
  const handler = ETL_JOB_REGISTRY[jobId];
  if (!handler) throw new Error(`No handler registered for: ${jobId}`);

  const runMode = options.runMode ?? "INCREMENTAL";
  const traceId = options.traceId ?? newTraceId();
  const correlationId = options.correlationId ?? traceId;
  const batchSize = options.batchSize ?? def.defaultBatchSize ?? ANALYTICS_CONFIG.defaultBatchSize;
  const timeoutMs = options.timeoutMs ?? ANALYTICS_CONFIG.defaultTimeoutMs;
  const maxAttempts = options.maxAttempts ?? 3;

  if (runMode === "FULL" || runMode === "REPLAY") {
    await resetWatermark(jobId);
  }

  const watermark = await getWatermark(jobId, def.targetTable);
  let attempt = 0;
  let lastError: Error | null = null;

  while (attempt < maxAttempts) {
    attempt++;
    const t0 = Date.now();
    const executionId = await createExecution(jobId, runMode, traceId, correlationId, batchSize, watermark, maxAttempts);

    const ctx: EtlJobContext = {
      jobId,
      runMode,
      traceId,
      correlationId,
      batchSize,
      timeoutMs,
      lowWatermark: watermark.lowWatermark,
      highWatermark: watermark.highWatermark,
      cursorId: watermark.cursorId,
      executionId,
    };

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`ETL timeout after ${timeoutMs}ms`)), timeoutMs),
      );
      const result = await Promise.race([handler(ctx), timeoutPromise]);

      await updateWatermark(jobId, {
        lowWatermark: result.lowWatermark,
        highWatermark: result.highWatermark,
        cursorId: result.cursorEnd,
        rowsDelta: result.rowsLoaded,
      });

      const durationMs = Date.now() - t0;
      await finalizeExecution(executionId, "SUCCEEDED", {
        rowsProcessed: result.rowsExtracted,
        rowsLoaded: result.rowsLoaded,
        lowWatermark: result.lowWatermark,
        highWatermark: result.highWatermark,
        cursorEnd: result.cursorEnd,
        durationMs,
        metadata: result.metadata,
      });

      recordEtlMetrics({ jobId, domain: def.domain, status: "success", durationMs, rowsLoaded: result.rowsLoaded, runMode });
      logger.info("etl_job_succeeded", {
        category: "APPLICATION",
        jobId,
        runMode,
        traceId,
        correlationId,
        rowsLoaded: result.rowsLoaded,
        durationMs,
      });

      return { success: true, rowsLoaded: result.rowsLoaded, executionId };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const durationMs = Date.now() - t0;
      await finalizeExecution(executionId, attempt >= maxAttempts ? "FAILED" : "RECOVERING", {
        rowsProcessed: 0,
        rowsLoaded: 0,
        lowWatermark: watermark.lowWatermark,
        highWatermark: watermark.highWatermark,
        cursorEnd: watermark.cursorId,
        durationMs,
        errorMessage: lastError.message,
      });
      recordEtlMetrics({ jobId, domain: def.domain, status: "failure", durationMs, rowsLoaded: 0, runMode });
      logger.warn("etl_job_retry", {
        category: "APPLICATION",
        jobId,
        attempt,
        maxAttempts,
        traceId,
        error: lastError.message,
      });
      if (attempt < maxAttempts) {
        const delay = computeRetryDelayMs(attempt);
        await new Promise((r) => setTimeout(r, delay.getTime() - Date.now()));
      }
    }
  }

  logger.error("etl_job_failed", {
    category: "APPLICATION",
    jobId,
    traceId,
    error: lastError?.message,
  });
  return { success: false, rowsLoaded: 0, executionId: "" };
}

/** Topological sort by dependencies + priority for batch runs. */
function sortJobs(jobIds: string[]): string[] {
  const selected = new Set(jobIds);
  const sorted: string[] = [];
  const visited = new Set<string>();

  function visit(id: string): void {
    if (visited.has(id) || !selected.has(id)) return;
    visited.add(id);
    const def = getJobDefinition(id);
    for (const dep of def?.dependencies ?? []) visit(dep);
    sorted.push(id);
  }

  const byPriority = [...jobIds].sort((a, b) => (getJobDefinition(a)?.priority ?? 99) - (getJobDefinition(b)?.priority ?? 99));
  for (const id of byPriority) visit(id);
  return sorted;
}

export async function runEtlPipeline(options: RunEtlOptions = {}): Promise<Record<string, number>> {
  const traceId = options.traceId ?? newTraceId();
  const correlationId = options.correlationId ?? traceId;
  const jobIds = options.jobIds ?? ETL_JOB_DEFINITIONS.map((j) => j.id);
  const ordered = sortJobs(jobIds);
  const counts: Record<string, number> = {};

  for (const jobId of ordered) {
    const result = await runEtlJob(jobId, { ...options, traceId, correlationId });
    counts[jobId] = result.rowsLoaded;
  }

  return counts;
}

/** Backward-compatible entry point for run-etl.ts and legacy callers. */
export async function runEtl(): Promise<Record<string, number>> {
  return runEtlPipeline({ runMode: "INCREMENTAL" });
}

export async function runEtlBackfill(jobId: string, since: Date): Promise<{ success: boolean; rowsLoaded: number }> {
  await prisma.etlWatermark.update({
    where: { jobId },
    data: { lowWatermark: since, highWatermark: null, cursorId: null },
  });
  return runEtlJob(jobId, { runMode: "BACKFILL" });
}

export async function getExecutionHistory(jobId: string, limit = 20) {
  return prisma.etlJobExecution.findMany({
    where: { jobId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
