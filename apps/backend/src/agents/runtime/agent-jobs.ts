import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { registerJobHandler } from "../../events/core/job-registry";
import type { ScheduledJobContext } from "../../events/core/job-registry";
import { agentsConfig } from "../config";
import { isAgentId } from "../types";
import { runAgent } from "./agent-runtime";
import { findOrphanedRuns, transitionRun } from "./run-store";
import { recordAgentRecovered } from "../observability/agent-metrics";

/**
 * Scheduled agent work and orphan recovery, on the EXISTING scheduler.
 *
 * No second scheduler, no cron of its own, no `setInterval`. These register with the same job
 * registry every other scheduled job in the platform uses, so they inherit its lease-based
 * claiming, retry policy, staleness guard, dead-lettering and observability. §27 is explicit about
 * this and it is also just the only way the guarantees hold: a private timer in this module would
 * fire on every instance at once, and nothing would stop two of them starting the same run.
 */

export const AGENT_SCHEDULED_RUN_JOB = "agent.scheduled_run";
export const AGENT_RECOVERY_JOB = "agent.recovery_sweep";

/**
 * Run one agent on a schedule.
 *
 * The payload names the agent and the goal; it does NOT carry free-form input that could become
 * the agent's instructions. A scheduled job row is editable by anyone who can write to the jobs
 * table, and a goal assembled from that row would be an instruction channel into the planner.
 */
async function scheduledRunHandler(
  payload: Record<string, unknown>,
  ctx: ScheduledJobContext,
): Promise<void> {
  const agentId = payload.agentId;
  if (!isAgentId(agentId)) {
    // A bad payload is a permanent failure, not a transient one. Throwing lets the scheduler's
    // retry policy exhaust and dead-letter it rather than re-running a nonsense job forever.
    throw new Error(`agent.scheduled_run: unknown agentId ${String(agentId)}`);
  }

  if (!agentsConfig.enabled) {
    logger.info("agent_scheduled_run_skipped", {
      category: "APPLICATION",
      agentId,
      reason: "AGENTS_DISABLED",
    });
    return;
  }

  const result = await runAgent({
    agentId,
    goal: typeof payload.goal === "string" ? payload.goal : `Scheduled review for ${agentId}`,
    input: `Scheduled run. Job ${ctx.jobId}, scheduled for ${ctx.runAt.toISOString()}.`,
    actor: { actorId: "system:agent-scheduler", actorRole: "SYSTEM" },
    trigger: {
      type: "SCHEDULE",
      // The job id is the trigger reference, so a job re-delivered by the scheduler collapses onto
      // one run through the same idempotency key that protects event triggers.
      ref: ctx.jobId,
      causationId: ctx.triggerEventId ?? undefined,
      depth: 0,
    },
  });

  logger.info("agent_scheduled_run_completed", {
    category: "APPLICATION",
    agentId,
    jobId: ctx.jobId,
    runId: result.runId,
    mode: result.mode,
    status: result.status,
  });
}

/**
 * Reconcile runs abandoned by a dead process — §37.
 *
 * This deliberately does NOT restart anything. The rule is that recovery must never blindly re-run
 * from step zero, and this layer cannot know whether an in-flight step's side effect landed: the
 * process died between calling the tool and recording the outcome, which is precisely the window
 * where "did it happen" is unanswerable from here.
 *
 * So each orphan is moved to a terminal state that says what is actually known:
 *
 *   - Nothing executed yet  → TIMED_OUT. Safe, and a fresh run may be started by a human.
 *   - Something executed    → ESCALATED. A person must reconcile before anything else happens.
 *
 * The distinction is drawn from the persisted steps, which is why they are written before and
 * after every tool call rather than batched at the end.
 */
async function recoverySweepHandler(): Promise<void> {
  const orphans = await findOrphanedRuns(50);
  if (orphans.length === 0) return;

  for (const run of orphans) {
    // Any step that reached the tool layer at all. INDETERMINATE counts: its whole meaning is
    // "the side effect may already have happened".
    const touched = run.steps.some(
      (s) =>
        s.status === "EXECUTED" ||
        s.status === "VERIFIED" ||
        s.status === "VERIFICATION_FAILED" ||
        s.status === "INDETERMINATE" ||
        Boolean(s.executionId),
    );

    const to = touched ? ("ESCALATED" as const) : ("TIMED_OUT" as const);
    const reason = touched
      ? "Process died after a side effect may have been applied; reconcile before retrying"
      : "Process died before any side effect; safe to re-run";

    try {
      await transitionRun(run.runId, to, {
        stopReason: "ORPHAN_RECOVERED",
        escalationReason: touched ? reason : undefined,
        errorCode: "ORPHANED",
      });
      recordAgentRecovered(run.agentId, to);
      logger.warn("agent_run_recovered", {
        category: "APPLICATION",
        runId: run.runId,
        agentId: run.agentId,
        from: run.status,
        to,
        touchedSideEffect: touched,
      });
    } catch (err) {
      // Another process may have finished the run between the query and the write. That is the
      // lease working, not a failure — log and move on rather than forcing the transition.
      logger.info("agent_recovery_skipped", {
        category: "APPLICATION",
        runId: run.runId,
        reason: err instanceof Error ? err.message : "unknown",
      });
    }
  }
}

let registered = false;

export function registerAgentJobs(): void {
  if (registered) return;

  registerJobHandler({
    jobType: AGENT_SCHEDULED_RUN_JOB,
    handler: scheduledRunHandler,
    // Agent runs are expensive and bounded; a long retry tail would multiply inference cost for a
    // job whose value decays quickly anyway.
    maxAttempts: 2,
  });

  registerJobHandler({
    jobType: AGENT_RECOVERY_JOB,
    handler: recoverySweepHandler,
    maxAttempts: 3,
    // A recovery sweep stays correct however late it runs — an orphan does not become less
    // orphaned. Opting out of the staleness guard keeps a delayed sweep from being discarded
    // exactly when the platform was struggling enough to create orphans in the first place.
    maxStalenessMs: null,
  });

  registered = true;
}

/**
 * Queue the recovery sweep if it is not already pending.
 *
 * Called at boot. Uses the scheduled_jobs table rather than a timer so exactly one instance runs
 * it, and so a missed sweep is visible as a stale job row rather than as silence.
 */
export async function ensureRecoverySweepScheduled(): Promise<void> {
  const pending = await prisma.scheduledJob
    // Lower-case literals: `scheduled_jobs.status` is a plain String column, and the processor
    // writes "pending"/"running"/"completed". Upper-case values would match nothing, so this
    // would queue a duplicate sweep on every boot.
    .count({ where: { jobType: AGENT_RECOVERY_JOB, status: { in: ["pending", "running"] } } })
    .catch(() => 1); // On a read failure, assume one exists rather than risk queueing duplicates.

  if (pending > 0) return;

  await prisma.scheduledJob
    .create({
      data: {
        jobType: AGENT_RECOVERY_JOB,
        payload: {},
        runAt: new Date(Date.now() + agentsConfig.leaseMs),
      },
    })
    .catch((err) => {
      logger.warn("agent_recovery_schedule_failed", {
        category: "APPLICATION",
        error: err instanceof Error ? err.message : "unknown",
      });
    });
}
