/**
 * Phase 14 — stuck workflow detection and governed recovery.
 *
 * ── What "stuck" is allowed to mean ──────────────────────────────────────────────
 *
 * Nothing here invents a time threshold. "This instance has been RUNNING for more than an hour"
 * would be a number nobody agreed to, and every workflow in this platform declares its own limits
 * already. So each condition below is derived from a value the system had before this file
 * existed:
 *
 *   STALE_LEASE          — `status = RUNNING` and untouched for longer than `jobLeaseMs`, which is
 *                          exactly the predicate `step-executor` already uses to decide an
 *                          instance is reclaimable. The worker holding it died.
 *   LOST_WAKEUP          — parked with `nextRunAt` in the past and no pending `ScheduledJob` to
 *                          wake it. The deadline is the instance's own; the missing job is a fact,
 *                          not a judgement. Nothing will ever move this instance again.
 *   EXPIRED_UNTERMINATED — older than its definition's `maxAgeMs` and still non-terminal. The
 *                          definition itself says it should have died by now.
 *
 * A WAITING instance whose `nextRunAt` is in the future is **healthy** and never appears here.
 * Reporting it would recreate the exact confusion Phase 13 removed from the automation dashboard.
 *
 * ── Why the recovery vocabulary is deliberately small ────────────────────────────
 *
 * Requeue and cancel, and nothing else. "Rewind", "compensate" and "retry this step" are absent
 * because this platform has no step-level compensation model: there is no recorded inverse for a
 * step that already ran, so a compensating action would have to be invented per workflow at the
 * moment an operator most needs to trust it. Offering a button that claims to undo work it cannot
 * undo is worse than offering nothing.
 *
 * Neither action re-executes completed work. `stepIndex` is persisted, so a requeued instance
 * resumes at the step it stopped on rather than replaying the ones before it — which is what
 * makes recovery safe for workflows whose earlier steps sent notifications or touched money.
 * STALE_LEASE is reported but NOT actioned: the executor already reclaims expired leases on its
 * own, so an operator "fixing" it would only race the engine.
 */
import type { WorkflowInstanceStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import { incCounter, registerScrapeSampler } from "../lib/metrics";
import { eventPlatformConfig } from "../events/core/config";
import { WORKFLOW_STEP_JOB_TYPE } from "../automation/engine/step-scheduler";
import { AuditLogService } from "./audit-log.service";

export type StuckReason = "STALE_LEASE" | "LOST_WAKEUP" | "EXPIRED_UNTERMINATED";

export type StuckInstance = {
  instanceId: string;
  workflowId: string;
  workflowVersion: number;
  executionMode: string;
  status: WorkflowInstanceStatus;
  reason: StuckReason;
  /** What the evidence actually is, so an operator is not asked to trust a label. */
  evidence: string;
  stepIndex: number;
  stepCount: number;
  ageMs: number;
  /** The instance's `updated_at`, for the optimistic-concurrency check on recovery. */
  updatedAt: string;
  /** Whether an operator action would help, or the engine already handles it. */
  actionable: boolean;
  recommendedAction: "REQUEUE" | "CANCEL" | "NONE";
};

/** Statuses that can still move. Terminal ones are never "stuck" — they are finished. */
const NON_TERMINAL: WorkflowInstanceStatus[] = ["PENDING", "RUNNING", "WAITING", "SCHEDULED", "PAUSED"];

export async function detectStuckInstances(limit = 200): Promise<StuckInstance[]> {
  const now = Date.now();
  const leaseCutoff = new Date(now - eventPlatformConfig.jobLeaseMs);

  const candidates = await prisma.workflowInstance.findMany({
    where: { status: { in: NON_TERMINAL } },
    orderBy: { updatedAt: "asc" },
    take: limit,
  });
  if (candidates.length === 0) return [];

  // Definitions carry maxAgeMs; fetched in one query rather than per instance.
  const definitions = await prisma.workflowDefinition.findMany({
    where: {
      OR: candidates.map((c) => ({ workflowId: c.workflowId, version: c.workflowVersion })),
    },
    select: { workflowId: true, version: true, maxAgeMs: true },
  });
  const maxAgeFor = new Map(definitions.map((d) => [`${d.workflowId}:${d.version}`, d.maxAgeMs]));

  // One query for every pending wake-up, rather than one per parked instance.
  const pendingJobs = await prisma.scheduledJob.findMany({
    where: { jobType: WORKFLOW_STEP_JOB_TYPE, status: "pending" },
    select: { payload: true },
  });
  const wakeable = new Set<string>();
  for (const job of pendingJobs) {
    const id = (job.payload as { instanceId?: string } | null)?.instanceId;
    if (id) wakeable.add(id);
  }

  const stuck: StuckInstance[] = [];
  for (const c of candidates) {
    const ageMs = now - c.createdAt.getTime();
    const maxAgeMs = maxAgeFor.get(`${c.workflowId}:${c.workflowVersion}`);
    const base = {
      instanceId: c.id,
      workflowId: c.workflowId,
      workflowVersion: c.workflowVersion,
      executionMode: c.executionMode,
      status: c.status,
      stepIndex: c.stepIndex,
      stepCount: c.stepCount,
      ageMs,
      /**
       * Carried so a caller can hand it straight back to `recoverInstance` as `observedUpdatedAt`.
       *
       * Recovery requires the status and timestamp the operator was looking at, which is what makes
       * two simultaneous recoveries resolve to one winner. Detection did not return the timestamp,
       * so that requirement was unsatisfiable from this payload: any client would have had to
       * re-read the instance and race the very window the check exists to close.
       */
      updatedAt: c.updatedAt.toISOString(),
    };

    if (maxAgeMs !== undefined && ageMs > maxAgeMs) {
      stuck.push({
        ...base,
        reason: "EXPIRED_UNTERMINATED",
        evidence: `age ${Math.round(ageMs / 1000)}s exceeds the definition's own maxAgeMs of ${Math.round(maxAgeMs / 1000)}s, and the instance is still ${c.status}`,
        actionable: true,
        recommendedAction: "CANCEL",
      });
      continue;
    }

    if (c.status === "RUNNING" && c.updatedAt < leaseCutoff) {
      stuck.push({
        ...base,
        reason: "STALE_LEASE",
        evidence: `RUNNING but untouched for ${Math.round((now - c.updatedAt.getTime()) / 1000)}s, beyond the ${Math.round(eventPlatformConfig.jobLeaseMs / 1000)}s executor lease`,
        // The executor reclaims expired leases itself. An operator acting here races the engine.
        actionable: false,
        recommendedAction: "NONE",
      });
      continue;
    }

    if (c.nextRunAt && c.nextRunAt.getTime() < now && !wakeable.has(c.id)) {
      stuck.push({
        ...base,
        reason: "LOST_WAKEUP",
        evidence: `parked until ${c.nextRunAt.toISOString()}, which has passed, and no pending ${WORKFLOW_STEP_JOB_TYPE} job references this instance — nothing will wake it`,
        actionable: true,
        recommendedAction: "REQUEUE",
      });
    }
  }

  incCounter("homigo_workflow_stuck_detected_total", { reason: "scan" }, 0);
  for (const s of stuck) incCounter("homigo_workflow_stuck_detected_total", { reason: s.reason });
  return stuck;
}

export type RecoveryAction = "REQUEUE" | "CANCEL";

export type RecoveryOutcome = {
  ok: boolean;
  action: RecoveryAction;
  instanceId: string;
  /** Distinguishes "someone else already fixed it" from "this could not be fixed". */
  code: "RECOVERED" | "LOST_RACE" | "NOT_STUCK" | "NOT_FOUND" | "NOT_ACTIONABLE";
  detail: string;
};

/**
 * Recover one instance. §60 — exactly one concurrent operator wins.
 *
 * The win is decided by an optimistic conditional update rather than a lock table: the status and
 * `updatedAt` observed during detection are carried into the WHERE clause, so a second operator
 * acting on the same observation updates zero rows and is told it lost the race. This is the same
 * discipline the step executor uses to take over a lease, and it means two operators clicking
 * "recover" at once can never both requeue — which would put two wake-up jobs on one instance and
 * execute the next step twice.
 */
export async function recoverInstance(args: {
  instanceId: string;
  action: RecoveryAction;
  actorId: string;
  reason: string;
  /** The state the operator saw. Recovery applies only if it still holds. */
  observedStatus: WorkflowInstanceStatus;
  observedUpdatedAt: Date;
  traceId?: string;
}): Promise<RecoveryOutcome> {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    return {
      ok: false,
      action: args.action,
      instanceId: args.instanceId,
      code: "NOT_ACTIONABLE",
      detail: "A recovery reason of at least 10 characters is required — an unexplained state change is not an audit trail.",
    };
  }

  const instance = await prisma.workflowInstance.findUnique({ where: { id: args.instanceId } });
  if (!instance) {
    return { ok: false, action: args.action, instanceId: args.instanceId, code: "NOT_FOUND", detail: "No such workflow instance." };
  }
  if (!NON_TERMINAL.includes(instance.status)) {
    return {
      ok: false,
      action: args.action,
      instanceId: args.instanceId,
      code: "NOT_STUCK",
      detail: `Instance is ${instance.status}, which is terminal. A finished instance is not recovered.`,
    };
  }

  const before = { status: instance.status, stepIndex: instance.stepIndex, nextRunAt: instance.nextRunAt };

  if (args.action === "CANCEL") {
    const updated = await prisma.workflowInstance.updateMany({
      where: { id: args.instanceId, status: args.observedStatus, updatedAt: args.observedUpdatedAt },
      data: {
        status: "CANCELLED",
        completedAt: new Date(),
        reasonCode: "OPERATOR_RECOVERY_CANCEL",
        failureReason: reason.slice(0, 500),
        nextRunAt: null,
      },
    });
    if (updated.count === 0) return lostRace(args);

    // A cancelled instance must not still have a wake-up queued behind it — otherwise the job
    // fires, finds a CANCELLED instance and the cancellation reads as a failure in the step log.
    await cancelPendingJobsFor(args.instanceId);

    await auditRecovery(args, instance, before, { status: "CANCELLED" });
    incCounter("homigo_workflow_recovery_total", { action: "CANCEL", result: "RECOVERED" });
    return { ok: true, action: "CANCEL", instanceId: args.instanceId, code: "RECOVERED", detail: `Instance cancelled at step ${instance.stepIndex}. No step was executed.` };
  }

  // REQUEUE — put back the wake-up that was lost. The instance resumes at its persisted
  // stepIndex, so no completed step runs again.
  const existing = await prisma.scheduledJob.count({
    where: {
      jobType: WORKFLOW_STEP_JOB_TYPE,
      status: "pending",
      payload: { path: ["instanceId"], equals: args.instanceId },
    },
  });
  if (existing > 0) {
    return {
      ok: false,
      action: "REQUEUE",
      instanceId: args.instanceId,
      code: "NOT_STUCK",
      detail: "A pending wake-up job already references this instance; requeueing would run the next step twice.",
    };
  }

  const updated = await prisma.workflowInstance.updateMany({
    where: { id: args.instanceId, status: args.observedStatus, updatedAt: args.observedUpdatedAt },
    data: { reasonCode: "OPERATOR_RECOVERY_REQUEUE" },
  });
  if (updated.count === 0) return lostRace(args);

  await prisma.scheduledJob.create({
    data: {
      jobType: WORKFLOW_STEP_JOB_TYPE,
      triggerEventId: instance.triggerEventId,
      payload: { instanceId: args.instanceId },
      runAt: new Date(),
    },
  });

  await auditRecovery(args, instance, before, { status: instance.status, requeued: true });
  incCounter("homigo_workflow_recovery_total", { action: "REQUEUE", result: "RECOVERED" });
  return {
    ok: true,
    action: "REQUEUE",
    instanceId: args.instanceId,
    code: "RECOVERED",
    detail: `Wake-up requeued. The instance resumes at step ${instance.stepIndex}; earlier steps are not replayed.`,
  };
}

function lostRace(args: { instanceId: string; action: RecoveryAction }): RecoveryOutcome {
  incCounter("homigo_workflow_recovery_total", { action: args.action, result: "LOST_RACE" });
  return {
    ok: false,
    action: args.action,
    instanceId: args.instanceId,
    code: "LOST_RACE",
    detail: "The instance changed since it was observed — another operator or the engine acted first. Re-read its state before retrying.",
  };
}

async function cancelPendingJobsFor(instanceId: string): Promise<void> {
  await prisma.scheduledJob.updateMany({
    where: {
      jobType: WORKFLOW_STEP_JOB_TYPE,
      status: "pending",
      payload: { path: ["instanceId"], equals: instanceId },
    },
    data: { status: "cancelled", cancelledAt: new Date() },
  });
}

/** §61 — workflow, instance, version, actor, old state, new state, reason, timestamp. */
async function auditRecovery(
  args: { instanceId: string; action: RecoveryAction; actorId: string; reason: string; traceId?: string },
  instance: { workflowId: string; workflowVersion: number; executionMode: string; stepIndex: number },
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): Promise<void> {
  /**
   * §46 — fail closed. Recovering an instance moves real workflow state; doing it with no record
   * of who or why is worse than not doing it, because the state change is real either way and only
   * the accountability is missing. `recordGoverned` throws when the audit cannot be persisted.
   */
  await AuditLogService.recordGoverned("WORKFLOW_INSTANCE_RECOVERED", "success", {
    userId: args.actorId,
    traceId: args.traceId,
    reason: args.reason,
    details: {
      action: args.action,
      instanceId: args.instanceId,
      workflowId: instance.workflowId,
      workflowVersion: instance.workflowVersion,
      executionMode: instance.executionMode,
      stepIndex: instance.stepIndex,
      before,
      after,
    },
  });
  logger.info("workflow_instance_recovered", {
    category: "APPLICATION",
    instanceId: args.instanceId,
    action: args.action,
    actorId: args.actorId,
  });
}

/** Re-scan for stuck instances on each scrape, so the counters reflect the current state. */
export function registerWorkflowRecoverySamplers(): void {
  registerScrapeSampler(async () => {
    try {
      await detectStuckInstances();
    } catch {
      /* a failed scan publishes nothing rather than an all-clear */
    }
  });
}
