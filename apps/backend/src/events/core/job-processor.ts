import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { incCounter, observeHist } from "../../lib/metrics";
import { runWithLeaderLock } from "../../lib/distributed-scheduler";
import { eventPlatformConfig } from "./config";
import { computeRetryDelayMs } from "./retry";
import { recordDeadLetter } from "./dead-letter";
import { getJobHandler, type ScheduledJobContext } from "./job-registry";
import { refreshEventPlatformGauges } from "./retention";

/** Attributed as the DLQ "consumer" when a scheduled job exhausts its attempts. */
const JOB_RUNNER_SOURCE = "scheduled.job.runner";

let jobTimer: ReturnType<typeof setInterval> | null = null;
let shuttingDown = false;

type ClaimedJob = {
  id: string;
  job_type: string;
  payload: unknown;
  attempts: number;
  run_at: Date;
  trigger_event_id: string | null;
};

/** Recover jobs whose worker died mid-flight — lease expiry, mirrors the outbox processor. */
async function recoverStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - eventPlatformConfig.jobLeaseMs);
  const result = await prisma.scheduledJob.updateMany({
    where: { status: "running", startedAt: { lt: cutoff } },
    data: { status: "pending", startedAt: null },
  });
  if (result.count > 0) {
    logger.warn("scheduled_job_stale_recovered", { count: result.count });
  }
  return result.count;
}

/** Claims `pending` only — retries re-enter via `pending`, so terminal states stay terminal. */
async function claimJobBatch(): Promise<ClaimedJob[]> {
  return prisma.$queryRaw<ClaimedJob[]>`
    UPDATE scheduled_jobs AS j
    SET status = 'running', started_at = NOW(), attempts = j.attempts + 1
    WHERE j.id IN (
      SELECT id
      FROM scheduled_jobs
      WHERE status = 'pending'
        AND run_at <= NOW()
      ORDER BY run_at ASC
      LIMIT ${eventPlatformConfig.jobBatchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j.id, j.job_type, j.payload, j.attempts, j.run_at, j.trigger_event_id
  `;
}

async function markCompleted(job: ClaimedJob, startedMs: number): Promise<void> {
  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: { status: "completed", completedAt: new Date(), lastError: null },
  });
  incCounter("homigo_scheduled_job_executions_total", { job_type: job.job_type, result: "success" });
  observeHist("homigo_scheduled_job_duration_seconds", (Date.now() - startedMs) / 1000);
}

/**
 * Terminal non-execution: the job was deliberately not run (too stale, or no handler).
 * Distinct from `failed` so operators can tell "we chose not to" from "it broke".
 */
async function markSkipped(job: ClaimedJob, reason: string): Promise<void> {
  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: { status: "skipped", completedAt: new Date(), lastError: reason },
  });
  incCounter("homigo_scheduled_job_executions_total", { job_type: job.job_type, result: "skipped" });
  logger.info("scheduled_job_skipped", { jobId: job.id, jobType: job.job_type, reason });
}

async function markFailed(job: ClaimedJob, error: string, maxAttempts: number): Promise<void> {
  if (job.attempts >= maxAttempts) {
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { status: "failed", lastError: error.slice(0, 4000) },
    });
    await recordDeadLetter({
      eventId: job.id,
      eventType: `job:${job.job_type}`,
      consumerName: JOB_RUNNER_SOURCE,
      payload: (job.payload ?? {}) as Record<string, unknown>,
      error,
      attempts: job.attempts,
    }).catch((err) => {
      logger.error("scheduled_job_dead_letter_failed", {
        jobId: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    });
    incCounter("homigo_scheduled_job_executions_total", { job_type: job.job_type, result: "failed_terminal" });
    incCounter("homigo_dlq_total", { consumer: JOB_RUNNER_SOURCE, event_type: `job:${job.job_type}` });
    logger.error("scheduled_job_failed_terminal", { jobId: job.id, jobType: job.job_type, attempts: job.attempts, error });
    return;
  }
  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: {
      status: "pending",
      startedAt: null,
      lastError: error.slice(0, 4000),
      runAt: computeRetryDelayMs(job.attempts),
    },
  });
  incCounter("homigo_scheduled_job_executions_total", { job_type: job.job_type, result: "retry" });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Job timed out after ${ms}ms: ${label}`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

async function executeJob(job: ClaimedJob): Promise<void> {
  const startedMs = Date.now();
  const definition = getJobHandler(job.job_type);

  // An unregistered job type will never succeed. Park it terminally instead of
  // letting it retry forever, and dead-letter it so it stays visible.
  if (!definition) {
    await markFailed(job, `No handler registered for job type "${job.job_type}"`, 0);
    return;
  }

  const staleness =
    definition.maxStalenessMs === undefined
      ? eventPlatformConfig.jobMaxStalenessMs
      : definition.maxStalenessMs;

  if (staleness !== null) {
    const lateBy = Date.now() - job.run_at.getTime();
    if (lateBy > staleness) {
      await markSkipped(job, `stale: due ${Math.round(lateBy / 60_000)}min ago, limit ${Math.round(staleness / 60_000)}min`);
      return;
    }
  }

  const ctx: ScheduledJobContext = {
    jobId: job.id,
    jobType: job.job_type,
    attempt: job.attempts,
    runAt: job.run_at,
    triggerEventId: job.trigger_event_id,
  };

  try {
    await withTimeout(
      definition.handler((job.payload ?? {}) as Record<string, unknown>, ctx),
      eventPlatformConfig.jobTimeoutMs,
      job.job_type,
    );
    await markCompleted(job, startedMs);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markFailed(job, message, definition.maxAttempts ?? eventPlatformConfig.jobMaxAttempts);
    logger.error("scheduled_job_execution_failed", {
      jobId: job.id,
      jobType: job.job_type,
      attempts: job.attempts,
      error: message,
    });
  }
}

export async function processScheduledJobBatch(): Promise<{ claimed: number; recovered: number }> {
  if (!eventPlatformConfig.jobsEnabled || shuttingDown) return { claimed: 0, recovered: 0 };

  const recovered = await recoverStaleJobs();
  const jobs = await claimJobBatch();
  for (const job of jobs) {
    if (shuttingDown) break;
    await executeJob(job);
  }
  await refreshEventPlatformGauges();
  return { claimed: jobs.length, recovered };
}

export async function runScheduledJobTick(): Promise<void> {
  await runWithLeaderLock(
    "maintenance:scheduled_jobs",
    Math.ceil(eventPlatformConfig.jobIntervalMs / 1000) + 5,
    async () => {
      await processScheduledJobBatch();
    },
  );
}

export function startScheduledJobProcessor(): void {
  if (jobTimer || !eventPlatformConfig.jobsEnabled) return;
  void runScheduledJobTick();
  jobTimer = setInterval(() => void runScheduledJobTick(), eventPlatformConfig.jobIntervalMs);
  (jobTimer as { unref?: () => void }).unref?.();
  logger.info("scheduled_job_processor_started", {
    intervalMs: eventPlatformConfig.jobIntervalMs,
    batchSize: eventPlatformConfig.jobBatchSize,
  });
}

export function stopScheduledJobProcessor(): void {
  shuttingDown = true;
  if (jobTimer) clearInterval(jobTimer);
  jobTimer = null;
}
