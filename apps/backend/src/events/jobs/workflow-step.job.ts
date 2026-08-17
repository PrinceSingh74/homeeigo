import { logger } from "../../lib/logger";
import { executeWorkflowStep } from "../../automation/engine/step-executor";
import { WORKFLOW_STEP_JOB_TYPE } from "../../automation/engine/step-scheduler";
import type { ScheduledJobContext } from "../core/job-registry";

/**
 * The single job type through which every workflow step runs.
 *
 * Deliberately thin: it resolves the instance and hands off. All retry, dead-lettering, lease
 * recovery and timeout behaviour belongs to the job processor that invoked it, and none of it is
 * reimplemented here.
 *
 * Staleness is opted out (`maxStalenessMs: null` at registration) because a workflow step is
 * still correct when it runs late — a payment recovery check that fires twenty minutes behind
 * schedule re-reads the payment and behaves correctly. The generic staleness guard is there for
 * jobs whose meaning expires; a workflow's own `maxAgeMs` is the right bound for these.
 */
export async function workflowStepJobHandler(
  payload: Record<string, unknown>,
  ctx: ScheduledJobContext,
): Promise<void> {
  const instanceId = payload.instanceId;
  if (typeof instanceId !== "string" || !instanceId) {
    throw new Error("workflow_step payload missing instanceId");
  }

  const result = await executeWorkflowStep(instanceId, ctx.jobId);

  // Not claimed / already gone are ordinary outcomes under concurrency and redelivery, not errors.
  if (!result.executed) {
    logger.info("workflow_step_noop", { jobId: ctx.jobId, instanceId, outcome: result.outcome });
  }
}

export { WORKFLOW_STEP_JOB_TYPE };
