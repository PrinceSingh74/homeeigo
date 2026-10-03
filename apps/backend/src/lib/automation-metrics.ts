import { incCounter, observeHist, setGauge, registerScrapeSampler } from "./metrics";

/** Phase 6A automation counters. Label cardinality is deliberately bounded to workflow + reason. */

export function recordWorkflowStarted(workflowId: string): void {
  incCounter("automation_workflows_started_total", { workflow: workflowId });
}

export function recordWorkflowCompleted(workflowId: string): void {
  incCounter("automation_workflows_completed_total", { workflow: workflowId });
}

export function recordWorkflowFailed(workflowId: string, reason: string): void {
  incCounter("automation_workflows_failed_total", { workflow: workflowId, reason });
}

export function recordWorkflowSkipped(workflowId: string, reason: string): void {
  incCounter("automation_workflows_skipped_total", { workflow: workflowId, reason });
}

export function recordStepExecuted(workflowId: string, stepType: string, outcome: string): void {
  incCounter("automation_steps_executed_total", { workflow: workflowId, step_type: stepType, outcome });
}

export function recordConditionFailed(workflowId: string, reason: string): void {
  incCounter("automation_condition_failed_total", { workflow: workflowId, reason });
}

export function recordStepFailed(workflowId: string, stepType: string): void {
  incCounter("automation_steps_failed_total", { workflow: workflowId, step_type: stepType });
}

export function recordStepLatency(seconds: number, workflowId: string): void {
  observeHist("automation_latency_ms", seconds, { workflow: workflowId });
}

export function setActiveInstances(count: number): void {
  setGauge("automation_active_instances", count);
}

/**
 * Phase 6D shadow counters.
 *
 * Separate names from the live ones on purpose: a rehearsal counted into
 * `automation_notification_governance_suppressed_total` would inflate a real suppression rate and
 * nothing on the chart would say why. Labels stay bounded to workflow, outcome and reason.
 */

export function recordShadowExecution(workflowId: string, outcome: string): void {
  incCounter("automation_shadow_executions_total", { workflow: workflowId, outcome });
}

export function recordShadowWouldSend(workflowId: string): void {
  incCounter("automation_shadow_would_send_total", { workflow: workflowId });
}

export function recordShadowWouldSuppress(workflowId: string, reason: string): void {
  incCounter("automation_shadow_would_suppress_total", { workflow: workflowId, reason });
}

export function recordShadowWouldDefer(workflowId: string): void {
  incCounter("automation_shadow_would_defer_total", { workflow: workflowId });
}

export function recordShadowConditionFailed(workflowId: string, reason: string): void {
  incCounter("automation_shadow_condition_failed_total", { workflow: workflowId, reason });
}

export function recordShadowBlocked(workflowId: string, reason: string): void {
  incCounter("automation_shadow_blocked_total", { workflow: workflowId, reason });
}

export function recordShadowError(workflowId: string, reason: string): void {
  incCounter("automation_shadow_error_total", { workflow: workflowId, reason });
}

/** Phase 6G trigger bridge. Labels bounded to event type, workflow and reason. */

export function recordTriggerMatched(eventType: string, workflowId: string): void {
  incCounter("automation_trigger_matched_total", { event: eventType, workflow: workflowId });
}

export function recordTriggerStarted(eventType: string, workflowId: string): void {
  incCounter("automation_trigger_started_total", { event: eventType, workflow: workflowId });
}

export function recordTriggerSkipped(eventType: string, workflowId: string, reason: string): void {
  incCounter("automation_trigger_skipped_total", { event: eventType, workflow: workflowId, reason });
}

/**
 * Phase 13 — automation inventory and execution gauges.
 *
 * ── Why a sampler was needed at all ────────────────────────────────────────────
 *
 * Every counter above is wired into the engine and fires on real execution. None of them existed in
 * the Prometheus exposition, because a counter that has never incremented has no series — so an
 * Automation dashboard queried nothing and rendered NO_DATA whether the platform had run zero
 * workflows or was not instrumented at all. Those are different states and an operator has to be
 * able to tell them apart.
 *
 * Seeding at zero fixes the counters; it does not answer "how many workflows exist and in what
 * state", which no counter can. That comes from the definition and instance tables, sampled here.
 *
 * ── Semantics kept separate on purpose ─────────────────────────────────────────
 *
 * A registered workflow definition is not an execution. A LIVE workflow is not a SHADOW one. A
 * WAITING instance is parked by design and is not a failure. Collapsing any of those into one
 * "automation health" number would hide the thing an operator is looking for.
 */
import prismaClient from "./prisma";

/** Definition states, from the schema's own enums — never invented here. */
const WORKFLOW_STATUSES = ["DRAFT", "ACTIVE", "DISABLED", "ARCHIVED"] as const;
const EXECUTION_MODES = ["LIVE", "SHADOW"] as const;
const INSTANCE_STATUSES = [
  "PENDING", "RUNNING", "WAITING", "SCHEDULED", "PAUSED",
  "COMPLETED", "SKIPPED", "FAILED", "CANCELLED",
] as const;

/**
 * Create every automation series at zero so the dashboard can distinguish
 * "nothing has run" from "nothing is instrumented".
 *
 * Mirrors `initAiMetricsAtZero`, which is the established pattern for this in the codebase; the
 * label sets are closed enums, so this cannot grow cardinality.
 */
export function initAutomationMetricsAtZero(): void {
  for (const status of WORKFLOW_STATUSES) {
    for (const mode of EXECUTION_MODES) {
      setGauge("homigo_workflow_definitions", 0, { status, mode });
    }
  }
  for (const status of INSTANCE_STATUSES) {
    setGauge("homigo_workflow_instances", 0, { status });
  }
  setGauge("homigo_workflow_instances_running_age_seconds", 0);
  setGauge("homigo_workflow_definitions_total", 0);
  setGauge("homigo_workflow_step_runs_total", 0);
  setGauge("homigo_workflow_step_retries_total", 0);
}

/**
 * Publish automation inventory from the definition and instance tables.
 *
 * Reads only. Grouped counts rather than row scans, and the oldest RUNNING instance is fetched with
 * a single ordered lookup — the dashboard must never become the reason the database is slow.
 */
export function registerAutomationMetricSamplers(): void {
  registerScrapeSampler(async () => {
    try {
      const [defs, instances, oldestRunning, retriedSteps, totalSteps] = await Promise.all([
        prismaClient.workflowDefinition.groupBy({
          by: ["status", "executionMode"],
          _count: { _all: true },
        }),
        prismaClient.workflowInstance.groupBy({
          by: ["status"],
          _count: { _all: true },
        }),
        /**
         * Age of the oldest still-RUNNING instance.
         *
         * Exposed as an age, not as a "stuck" count. No canonical stuck threshold exists in this
         * project — searched, and none is defined — so inventing one here would put a number in
         * front of an operator that no policy stands behind. The age is measurable and true; what
         * counts as too old is a human decision, recorded as STUCK_JOB_THRESHOLD_UNSET.
         */
        prismaClient.workflowInstance.findFirst({
          where: { status: "RUNNING" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        }),
        /**
         * Retries, from canonical state rather than from a counter.
         *
         * `automation_*` retry counters exist and are wired, but they have no series until a retry
         * actually happens — so a dashboard reading them cannot distinguish "no retries" from "not
         * instrumented". `WorkflowStepRun.attempt` is the durable record of the same fact: a step run
         * past its first attempt *is* a retry, and counting rows says so whether or not this process
         * was the one that incremented anything.
         */
        prismaClient.workflowStepRun.count({ where: { attempt: { gt: 1 } } }),
        prismaClient.workflowStepRun.count(),
      ]);

      // Reset the closed label space first, so a state that empties reads 0 rather than staying
      // at its last non-zero value.
      for (const status of WORKFLOW_STATUSES) {
        for (const mode of EXECUTION_MODES) setGauge("homigo_workflow_definitions", 0, { status, mode });
      }
      for (const status of INSTANCE_STATUSES) setGauge("homigo_workflow_instances", 0, { status });

      let defTotal = 0;
      for (const row of defs) {
        const n = row._count._all;
        defTotal += n;
        setGauge("homigo_workflow_definitions", n, {
          status: String(row.status),
          mode: String(row.executionMode),
        });
      }
      setGauge("homigo_workflow_definitions_total", defTotal);

      for (const row of instances) {
        setGauge("homigo_workflow_instances", row._count._all, { status: String(row.status) });
      }

      setGauge(
        "homigo_workflow_instances_running_age_seconds",
        oldestRunning ? Math.max(0, (Date.now() - oldestRunning.createdAt.getTime()) / 1000) : 0,
      );
      setGauge("homigo_workflow_step_runs_total", totalSteps);
      setGauge("homigo_workflow_step_retries_total", retriedSteps);
    } catch {
      /**
       * Leave the last-known values rather than publishing zeros.
       *
       * A database hiccup is not "there are no workflows", and writing 0 here would turn an
       * infrastructure failure into a confident operational statement.
       */
    }
  });
}
