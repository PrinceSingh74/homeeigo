import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  recordStepExecuted,
  recordStepFailed,
  recordStepLatency,
  recordWorkflowCompleted,
  recordWorkflowFailed,
  recordWorkflowSkipped,
  recordConditionFailed,
} from "../../lib/automation-metrics";
import { getWorkflow } from "../registry/workflow-registry";
import { evaluateCondition } from "../conditions/evaluator";
import { getCondition } from "../conditions/condition-registry";
import { executeNotificationStep } from "./notification-step";
import { STEP_OUTCOME, type StepOutcome, type WorkflowStep } from "../types";
import { scheduleWorkflowStep } from "./step-scheduler";
import { eventPlatformConfig } from "../../events/core/config";

/**
 * Executes exactly one step of one instance, then decides what happens next.
 *
 * Two properties matter more than anything else here.
 *
 * **Only one worker may advance an instance.** The claim is a conditional `updateMany` guarded on
 * both the status and the step index, so two nodes that pick up the same job produce one winner
 * and one no-op. This is the same pattern the Phase-5 approval consumption uses, and it needs no
 * new locking infrastructure.
 *
 * **An instance must be able to die.** `maxAgeMs` and `maxSteps` are checked before every step.
 * A workflow that keeps advancing without resolving is stopped and recorded, because the failure
 * mode of an automation platform is not usually a crash — it is thousands of instances quietly
 * looping forever.
 */

type Terminal = "COMPLETED" | "SKIPPED" | "FAILED" | "CANCELLED";

async function recordStepRun(input: {
  instanceId: string;
  step: { id: string; type: WorkflowStep["type"] };
  stepIndex: number;
  outcome: StepOutcome;
  reasonCode?: string;
  reasonText?: string;
  jobId?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await prisma.workflowStepRun.create({
    data: {
      instanceId: input.instanceId,
      stepId: input.step.id,
      stepIndex: input.stepIndex,
      stepType: input.step.type,
      outcome: input.outcome,
      reasonCode: input.reasonCode,
      reasonText: input.reasonText?.slice(0, 2000),
      jobId: input.jobId,
      durationMs: input.durationMs,
      metadata: (input.metadata ?? undefined) as object | undefined,
    },
  });
}

/**
 * Ends an instance.
 *
 * `countStep` separates the two ways a workflow can end. A STOP step *ran* and must be counted,
 * because `stepCount` is what `maxSteps` bounds and what the audit reads back. A guard that
 * refuses to run anything — expired by age, or already over its step budget — executed no step and
 * must not inflate the count it was just measured against.
 */
async function finish(
  instanceId: string,
  status: Terminal,
  reasonCode: string,
  opts: { failureReason?: string; countStep?: boolean } = {},
): Promise<void> {
  await prisma.workflowInstance.update({
    where: { id: instanceId },
    data: {
      status,
      reasonCode,
      failureReason: opts.failureReason,
      completedAt: new Date(),
      nextRunAt: null,
      ...(opts.countStep ? { stepCount: { increment: 1 } } : {}),
    },
  });
}

export type StepExecutionResult = {
  executed: boolean;
  outcome: StepOutcome | "NOT_CLAIMED" | "INSTANCE_GONE";
};

export async function executeWorkflowStep(instanceId: string, jobId?: string): Promise<StepExecutionResult> {
  const started = Date.now();

  const instance = await prisma.workflowInstance.findUnique({ where: { id: instanceId } });
  if (!instance) return { executed: false, outcome: "INSTANCE_GONE" };

  /**
   * Who may pick this instance up.
   *
   * RUNNING is deliberately not in the ordinary claimable set. It used to be, and the claim below
   * guarded on `status: instance.status` — which for a RUNNING instance is a no-op transition that
   * two workers can both match. In the window between one worker setting RUNNING and advancing the
   * step index, a second worker could read RUNNING, "claim" RUNNING, and execute the same step.
   * The window is small, which is exactly why the concurrency suite passed for several runs before
   * a multi-process run happened to land inside it.
   *
   * A worker that dies mid-step would then leave the instance RUNNING forever, so a RUNNING
   * instance becomes claimable again once its lease has elapsed — reclaimed under an optimistic
   * check on `updatedAt`, so only one worker can take over even then.
   */
  const CLAIMABLE = ["PENDING", "WAITING", "SCHEDULED"];
  const leaseCutoff = new Date(Date.now() - eventPlatformConfig.jobLeaseMs);
  const isStaleRunning = instance.status === "RUNNING" && instance.updatedAt < leaseCutoff;

  if (!CLAIMABLE.includes(instance.status) && !isStaleRunning) {
    return { executed: false, outcome: "NOT_CLAIMED" };
  }

  const definition = getWorkflow(instance.workflowId, instance.workflowVersion);
  if (!definition) {
    /**
     * This process has no code for the pinned version — but another one might.
     *
     * Killing the instance here was wrong. During a rolling deploy the node that picked the job up
     * can simply be the older build: it would permanently fail work that the node beside it was
     * about to do correctly. The same thing showed up in the multi-process suite, where a worker
     * that had registered a different workflow failed instances belonging to its neighbour.
     *
     * Throwing instead hands the decision to the job processor, which already owns retry and
     * dead-lettering. A definition that genuinely no longer exists anywhere exhausts its attempts
     * and dead-letters visibly, while the instance stays WAITING rather than being quietly written
     * off — an unfinished workflow you can see beats a failed one you cannot explain.
     */
    recordWorkflowFailed(instance.workflowId, "DEFINITION_MISSING");
    throw new Error(
      `No code for ${instance.workflowId}.v${instance.workflowVersion} in this process — retrying`,
    );
  }

  /**
   * The claim. Exactly one worker may move this instance off its current step.
   *
   * For a fresh pickup the transition itself is the lock: two workers both see WAITING, both write
   * `where status = WAITING`, and only the first matches. For a lease takeover there is no state
   * change to rely on, so `updatedAt` carries the guard instead — whoever writes first bumps it and
   * the other matches nothing.
   */
  const claim = await prisma.workflowInstance.updateMany({
    where: isStaleRunning
      ? { id: instanceId, status: "RUNNING", stepIndex: instance.stepIndex, updatedAt: instance.updatedAt }
      : { id: instanceId, status: instance.status, stepIndex: instance.stepIndex },
    data: { status: "RUNNING" },
  });
  if (claim.count !== 1) return { executed: false, outcome: "NOT_CLAIMED" };

  const ageMs = Date.now() - instance.createdAt.getTime();
  if (ageMs > definition.maxAgeMs) {
    await finish(instanceId, "SKIPPED", STEP_OUTCOME.MAX_AGE_EXCEEDED, { failureReason: `age ${Math.round(ageMs / 60000)}min` });
    recordWorkflowSkipped(instance.workflowId, STEP_OUTCOME.MAX_AGE_EXCEEDED);
    return { executed: true, outcome: STEP_OUTCOME.MAX_AGE_EXCEEDED };
  }
  if (instance.stepCount >= definition.maxSteps) {
    await finish(instanceId, "SKIPPED", STEP_OUTCOME.MAX_STEPS_EXCEEDED, { failureReason: `steps ${instance.stepCount}` });
    recordWorkflowSkipped(instance.workflowId, STEP_OUTCOME.MAX_STEPS_EXCEEDED);
    return { executed: true, outcome: STEP_OUTCOME.MAX_STEPS_EXCEEDED };
  }

  const step = definition.steps[instance.stepIndex];
  if (!step) {
    await finish(instanceId, "COMPLETED", STEP_OUTCOME.COMPLETED);
    recordWorkflowCompleted(instance.workflowId);
    return { executed: true, outcome: STEP_OUTCOME.COMPLETED };
  }

  const isLast = instance.stepIndex >= definition.steps.length - 1;

  const advance = async (outcome: StepOutcome, reasonCode?: string, delayMs = 0) => {
    await recordStepRun({
      instanceId,
      step,
      stepIndex: instance.stepIndex,
      outcome,
      reasonCode,
      jobId,
      durationMs: Date.now() - started,
    });
    recordStepExecuted(instance.workflowId, step.type, outcome);
    recordStepLatency((Date.now() - started) / 1000, instance.workflowId);

    if (isLast && delayMs === 0) {
      await prisma.workflowInstance.update({
        where: { id: instanceId },
        data: { stepCount: { increment: 1 }, status: "COMPLETED", completedAt: new Date(), nextRunAt: null },
      });
      recordWorkflowCompleted(instance.workflowId);
      return;
    }

    const nextIndex = instance.stepIndex + 1;
    await prisma.workflowInstance.update({
      where: { id: instanceId },
      data: {
        stepIndex: nextIndex,
        currentStepId: definition.steps[nextIndex]?.id ?? null,
        stepCount: { increment: 1 },
      },
    });
    await scheduleWorkflowStep({
      instanceId,
      runAt: new Date(Date.now() + delayMs),
      triggerEventId: instance.triggerEventId,
    });
  };

  /**
   * Hold this step until a later moment, without moving through it.
   *
   * Deliberately not `advance`. Advancing increments both the step index and the step count, which
   * for a deferral would be wrong twice over: the step has not been done, and a notification held
   * across several nights would eat its way through `maxSteps` until the instance was killed for
   * looping — a workflow destroyed by the very mechanism meant to protect it. Here the index and the
   * count both stand still, and only the wake-up time moves.
   *
   * The wake-up itself is an ordinary `ScheduledJob` through the existing scheduler. There is no
   * second queue, no second worker, and no retry logic of its own.
   */
  const deferStep = async (until: Date, reasonCode?: string): Promise<StepOutcome> => {
    /**
     * An instance that cannot survive to its own wake-up must not be given one.
     *
     * `maxAgeMs` is measured from creation and checked before every step, so scheduling a resume
     * past that horizon would produce a job whose only possible outcome is MAX_AGE_EXCEEDED. The
     * instance would end tidily, the audit would read reasonably, and the notification would simply
     * never arrive. Registration already refuses definitions whose budget cannot span a quiet
     * window; this is the runtime backstop for an instance that spent its budget elsewhere, and it
     * says plainly that the message was dropped rather than quietly parked.
     */
    const expiresAt = instance.createdAt.getTime() + definition.maxAgeMs;
    if (expiresAt < until.getTime()) {
      await recordStepRun({
        instanceId, step, stepIndex: instance.stepIndex,
        outcome: STEP_OUTCOME.SKIPPED,
        reasonCode: "DEFERRAL_EXCEEDS_MAX_AGE",
        reasonText: `resume at ${until.toISOString()} is past maxAge ${new Date(expiresAt).toISOString()}`,
        jobId, durationMs: Date.now() - started,
      });
      await finish(instanceId, "SKIPPED", "DEFERRAL_EXCEEDS_MAX_AGE", { countStep: true });
      recordStepExecuted(instance.workflowId, step.type, STEP_OUTCOME.SKIPPED);
      recordWorkflowSkipped(instance.workflowId, "DEFERRAL_EXCEEDS_MAX_AGE");
      return STEP_OUTCOME.SKIPPED;
    }

    await recordStepRun({
      instanceId, step, stepIndex: instance.stepIndex,
      outcome: STEP_OUTCOME.DEFERRED,
      reasonCode, jobId, durationMs: Date.now() - started,
      metadata: { deferredUntil: until.toISOString(), stepIndex: instance.stepIndex },
    });
    recordStepExecuted(instance.workflowId, step.type, STEP_OUTCOME.DEFERRED);
    recordStepLatency((Date.now() - started) / 1000, instance.workflowId);

    // Sets the instance back to WAITING with nextRunAt — index and count untouched.
    await scheduleWorkflowStep({
      instanceId,
      runAt: until,
      triggerEventId: instance.triggerEventId,
    });
    return STEP_OUTCOME.DEFERRED;
  };

  try {
    switch (step.type) {
      case "WAIT":
        await advance(STEP_OUTCOME.WAITING, undefined, step.delayMs);
        return { executed: true, outcome: STEP_OUTCOME.WAITING };

      case "STOP":
        await recordStepRun({
          instanceId, step, stepIndex: instance.stepIndex,
          outcome: STEP_OUTCOME.STOPPED, reasonCode: step.reasonCode, jobId,
          durationMs: Date.now() - started,
        });
        await finish(instanceId, "COMPLETED", step.reasonCode ?? STEP_OUTCOME.STOPPED, { countStep: true });
        recordStepExecuted(instance.workflowId, step.type, STEP_OUTCOME.STOPPED);
        recordWorkflowCompleted(instance.workflowId);
        return { executed: true, outcome: STEP_OUTCOME.STOPPED };

      /**
       * The action-time re-check.
       *
       * Trigger-time state is not authoritative. Between the event that started this instance and
       * this moment the world has moved on: the booking may have been cancelled, the customer may
       * already have rated, the payment may have succeeded by another route. The condition is
       * evaluated against what is true *now*, and a workflow whose concern has resolved itself
       * stops here rather than carrying on to act on a stale premise.
       */
      case "CONDITION": {
        const condition = getCondition(step.conditionId);
        if (!condition) {
          // A step naming a condition that does not exist must not proceed on the assumption
          // that the check would have passed.
          await recordStepRun({
            instanceId, step, stepIndex: instance.stepIndex,
            outcome: STEP_OUTCOME.CONDITION_FAILED,
            reasonCode: "CONDITION_NOT_REGISTERED", reasonText: step.conditionId, jobId,
            durationMs: Date.now() - started,
          });
          await finish(instanceId, "FAILED", "CONDITION_NOT_REGISTERED", { countStep: true });
          recordConditionFailed(instance.workflowId, "CONDITION_NOT_REGISTERED");
          recordWorkflowFailed(instance.workflowId, "CONDITION_NOT_REGISTERED");
          return { executed: true, outcome: STEP_OUTCOME.CONDITION_FAILED };
        }

        const result = await evaluateCondition(condition, {
          subjectType: instance.subjectType,
          subjectId: instance.subjectId,
        });

        await recordStepRun({
          instanceId, step, stepIndex: instance.stepIndex,
          outcome: result.passed ? STEP_OUTCOME.ADVANCED : STEP_OUTCOME.CONDITION_FAILED,
          reasonCode: result.reason, reasonText: result.detail, jobId,
          durationMs: Date.now() - started,
          metadata: {
            conditionId: step.conditionId,
            evaluatedAt: new Date().toISOString(),
            // Field-level outcomes only — never resolver payloads, so the audit stays an
            // explanation of the decision rather than a copy of the data behind it.
            evaluated: result.evaluated,
          },
        });
        recordStepExecuted(instance.workflowId, step.type, result.passed ? STEP_OUTCOME.ADVANCED : STEP_OUTCOME.CONDITION_FAILED);

        if (!result.passed) {
          recordConditionFailed(instance.workflowId, result.reason);
          await finish(instanceId, "SKIPPED", result.reason, {
            failureReason: result.detail,
            countStep: true,
          });
          recordWorkflowSkipped(instance.workflowId, result.reason);
          return { executed: true, outcome: STEP_OUTCOME.CONDITION_FAILED };
        }

        // Passed — move on without re-recording the step run that `advance` would write.
        const nextIndex = instance.stepIndex + 1;
        if (isLast) {
          await prisma.workflowInstance.update({
            where: { id: instanceId },
            data: { stepCount: { increment: 1 }, status: "COMPLETED", completedAt: new Date(), nextRunAt: null },
          });
          recordWorkflowCompleted(instance.workflowId);
        } else {
          await prisma.workflowInstance.update({
            where: { id: instanceId },
            data: {
              stepIndex: nextIndex,
              currentStepId: definition.steps[nextIndex]?.id ?? null,
              stepCount: { increment: 1 },
            },
          });
          await scheduleWorkflowStep({ instanceId, runAt: new Date(), triggerEventId: instance.triggerEventId });
        }
        return { executed: true, outcome: STEP_OUTCOME.ADVANCED };
      }

      /**
       * Delivery, through the notification platform.
       *
       * A step that could not be delivered does not fail the workflow. "The customer has no device
       * registered" and "they opted out of promotions" are ordinary outcomes of asking to contact
       * someone, not errors — recording the reason and moving on is right, whereas failing the
       * instance would leave a workflow stuck over something entirely expected.
       */
      case "NOTIFICATION": {
        const outcome = await executeNotificationStep({
          instanceId,
          workflowId: instance.workflowId,
          workflowVersion: instance.workflowVersion,
          stepId: step.id,
          subjectType: instance.subjectType,
          subjectId: instance.subjectId,
          metadata: (instance.metadata ?? {}) as Record<string, unknown>,
          spec: {
            notificationType: step.notificationType,
            recipient: step.recipient,
            variables: step.variables,
            recheckConditionId: step.recheckConditionId,
          },
          traceId: instance.traceId ?? undefined,
          correlationId: instance.correlationId ?? undefined,
        });

        /**
         * Held for the night, not refused.
         *
         * Checked before the PENDING branch below, because a deferral also reports PENDING — nothing
         * has been sent in either case. `deferredUntil` is what separates them: an operation waiting
         * on someone else's claim should be retried within minutes, while one waiting for 08:00
         * should not be touched again until then. Reading only the status would turn every quiet
         * hour into a retry storm against a notification that is deliberately holding.
         */
        if (outcome.ok && outcome.result.deferredUntil) {
          const deferOutcome = await deferStep(outcome.result.deferredUntil, outcome.result.reasonCode);
          return { executed: true, outcome: deferOutcome };
        }

        /**
         * A claim held by someone else is not an outcome — it is "not yet".
         *
         * The router answers PENDING when an identical operation is mid-flight, which for a workflow
         * step means a previous attempt claimed the send and did not come back. Advancing here would
         * mark the step done for a message nobody has sent. Throwing hands the step back to the job
         * processor's existing backoff: by the next attempt the original owner has either finished
         * (a terminal status is replayed) or its lease has expired and this worker takes it over.
         */
        if (outcome.ok && outcome.result.status === "PENDING") {
          throw new Error(
            `Notification ${outcome.result.notificationId} is claimed by another attempt — retrying`,
          );
        }

        const reasonCode = outcome.ok ? outcome.result.reasonCode : outcome.reasonCode;
        await recordStepRun({
          instanceId, step, stepIndex: instance.stepIndex,
          outcome: STEP_OUTCOME.ADVANCED,
          reasonCode, jobId, durationMs: Date.now() - started,
          metadata: outcome.ok
            ? {
                // Identifiers and outcome only — no recipient contact details, no message body.
                notificationId: outcome.result.notificationId,
                status: outcome.result.status,
                channel: outcome.result.channel,
                templateId: outcome.result.templateId,
                templateVersion: outcome.result.templateVersion,
              }
            : { unresolved: true },
        });
        recordStepExecuted(instance.workflowId, step.type, STEP_OUTCOME.ADVANCED);

        const nextIndex = instance.stepIndex + 1;
        if (isLast) {
          await prisma.workflowInstance.update({
            where: { id: instanceId },
            data: { stepCount: { increment: 1 }, status: "COMPLETED", completedAt: new Date(), nextRunAt: null },
          });
          recordWorkflowCompleted(instance.workflowId);
        } else {
          await prisma.workflowInstance.update({
            where: { id: instanceId },
            data: {
              stepIndex: nextIndex,
              currentStepId: definition.steps[nextIndex]?.id ?? null,
              stepCount: { increment: 1 },
            },
          });
          await scheduleWorkflowStep({ instanceId, runAt: new Date(), triggerEventId: instance.triggerEventId });
        }
        return { executed: true, outcome: STEP_OUTCOME.ADVANCED };
      }

      /**
       * Declared, not yet executable. Fails closed — carrying on and hoping is exactly how an
       * untested automation reaches a real customer.
       */
      case "ACTION":
      case "ESCALATION": {
        await recordStepRun({
          instanceId, step, stepIndex: instance.stepIndex,
          outcome: STEP_OUTCOME.NOT_IMPLEMENTED,
          reasonCode: `${step.type}_NOT_IMPLEMENTED_IN_6A`, jobId,
          durationMs: Date.now() - started,
        });
        await finish(instanceId, "SKIPPED", `${step.type}_NOT_IMPLEMENTED_IN_6A`, { countStep: true });
        recordStepExecuted(instance.workflowId, step.type, STEP_OUTCOME.NOT_IMPLEMENTED);
        recordWorkflowSkipped(instance.workflowId, STEP_OUTCOME.NOT_IMPLEMENTED);
        return { executed: true, outcome: STEP_OUTCOME.NOT_IMPLEMENTED };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordStepRun({
      instanceId, step, stepIndex: instance.stepIndex,
      outcome: STEP_OUTCOME.ERROR, reasonText: message, jobId,
      durationMs: Date.now() - started,
    });
    recordStepFailed(instance.workflowId, step.type);
    // Return the instance to WAITING so the job's own retry can bring it back. The job processor
    // owns retry and dead-lettering; duplicating that here would create a second retry engine.
    await prisma.workflowInstance.update({
      where: { id: instanceId },
      data: { status: "WAITING", failureReason: message.slice(0, 2000) },
    });
    logger.error("workflow_step_failed", { instanceId, stepId: step.id, error: message });
    throw err;
  }
}
