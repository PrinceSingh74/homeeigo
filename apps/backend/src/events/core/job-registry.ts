import { logger } from "../../lib/logger";

export type ScheduledJobContext = {
  jobId: string;
  jobType: string;
  attempt: number;
  runAt: Date;
  triggerEventId: string | null;
};

export type ScheduledJobHandler = (
  payload: Record<string, unknown>,
  ctx: ScheduledJobContext,
) => Promise<void>;

export type ScheduledJobDefinition = {
  jobType: string;
  handler: ScheduledJobHandler;
  /** Overrides eventPlatformConfig.jobMaxAttempts for this job type. */
  maxAttempts?: number;
  /**
   * Overrides eventPlatformConfig.jobMaxStalenessMs. Set to null to opt out of the
   * staleness guard entirely — only for jobs that stay correct no matter how late.
   */
  maxStalenessMs?: number | null;
};

const registry = new Map<string, ScheduledJobDefinition>();

/** Register a handler for a job type. Last registration wins (re-register is safe). */
export function registerJobHandler(definition: ScheduledJobDefinition): void {
  if (registry.has(definition.jobType)) {
    logger.warn("scheduled_job_handler_replaced", { jobType: definition.jobType });
  }
  registry.set(definition.jobType, definition);
}

export function getJobHandler(jobType: string): ScheduledJobDefinition | undefined {
  return registry.get(jobType);
}

export function listJobHandlers(): string[] {
  return [...registry.keys()].sort();
}

/** Test-only: reset the registry between cases. */
export function clearJobHandlers(): void {
  registry.clear();
}
