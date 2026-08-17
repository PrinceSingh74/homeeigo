import prisma from "../../lib/prisma";

/**
 * The bridge to the existing scheduler — and the only way a workflow step ever gets to run.
 *
 * Every delayed step becomes an ordinary `ScheduledJob`, so it inherits the claim-with-
 * SKIP-LOCKED, lease recovery, retry/backoff, dead-letter, timeout, staleness and leader-lock
 * behaviour that `job-processor.ts` already provides. There is deliberately no second scheduler,
 * no second queue and no second retry engine anywhere in this phase.
 */

export const WORKFLOW_STEP_JOB_TYPE = "automation.workflow_step";

export async function scheduleWorkflowStep(input: {
  instanceId: string;
  runAt: Date;
  triggerEventId?: string | null;
}): Promise<void> {
  await prisma.scheduledJob.create({
    data: {
      jobType: WORKFLOW_STEP_JOB_TYPE,
      triggerEventId: input.triggerEventId ?? null,
      payload: { instanceId: input.instanceId },
      runAt: input.runAt,
    },
  });

  await prisma.workflowInstance.update({
    where: { id: input.instanceId },
    data: { status: "WAITING", nextRunAt: input.runAt },
  });
}
