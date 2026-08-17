import crypto from "crypto";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { recordWorkflowStarted } from "../../lib/automation-metrics";
import { getWorkflow, resolveActiveVersion } from "../registry/workflow-registry";
import type { StartInstanceInput } from "../types";
import { scheduleWorkflowStep } from "./step-scheduler";

/**
 * Creating, and only ever creating once.
 *
 * A trigger can be delivered more than once — the outbox retries, a consumer restarts mid-batch,
 * an event is replayed. The idempotency key makes that harmless: it is derived from the workflow,
 * its version, the subject and the triggering event, so a redelivery collides with the instance
 * that already exists instead of opening a second one that would send everything twice.
 *
 * The version is resolved once here and then pinned to the row. Activating v2 tomorrow does not
 * move an instance that started under v1 today.
 */

export function buildIdempotencyKey(input: {
  workflowId: string;
  version: number;
  subjectType: string;
  subjectId: string;
  triggerEventId?: string;
}): string {
  const raw = [
    input.workflowId,
    `v${input.version}`,
    input.subjectType,
    input.subjectId,
    input.triggerEventId ?? "no-event",
  ].join("|");
  return `wf:${crypto.createHash("sha256").update(raw).digest("hex").slice(0, 40)}`;
}

export type StartResult =
  | { started: true; instanceId: string; version: number }
  | { started: false; reason: "NO_ACTIVE_VERSION" | "NOT_REGISTERED" | "DUPLICATE"; instanceId?: string };

export async function startWorkflowInstance(input: StartInstanceInput): Promise<StartResult> {
  const version = await resolveActiveVersion(input.workflowId);
  if (version === null) return { started: false, reason: "NO_ACTIVE_VERSION" };

  const definition = getWorkflow(input.workflowId, version);
  if (!definition) {
    // Activated in the database but absent from code — refuse rather than guess at behaviour.
    logger.error("workflow_active_version_missing_in_code", { workflowId: input.workflowId, version });
    return { started: false, reason: "NOT_REGISTERED" };
  }

  const idempotencyKey = buildIdempotencyKey({
    workflowId: input.workflowId,
    version,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    triggerEventId: input.triggerEventId,
  });

  const existing = await prisma.workflowInstance.findUnique({
    where: { idempotencyKey },
    select: { id: true },
  });
  if (existing) return { started: false, reason: "DUPLICATE", instanceId: existing.id };

  const firstStep = definition.steps[0];

  try {
    const instance = await prisma.workflowInstance.create({
      data: {
        workflowId: input.workflowId,
        workflowVersion: version,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        status: "PENDING",
        currentStepId: firstStep.id,
        stepIndex: 0,
        idempotencyKey,
        triggerEventId: input.triggerEventId,
        traceId: input.traceId,
        correlationId: input.correlationId,
        metadata: (input.metadata ?? {}) as object,
        startedAt: new Date(),
      },
    });

    await scheduleWorkflowStep({ instanceId: instance.id, runAt: new Date(), triggerEventId: input.triggerEventId });
    recordWorkflowStarted(input.workflowId);
    logger.info("workflow_instance_started", {
      instanceId: instance.id,
      workflowId: input.workflowId,
      version,
      subjectId: input.subjectId,
    });
    return { started: true, instanceId: instance.id, version };
  } catch (err) {
    // Two consumers racing the same trigger: the unique index decides, and the loser reports
    // the winner rather than failing. P2002 here is the guard working, not an error.
    if ((err as { code?: string }).code === "P2002") {
      const winner = await prisma.workflowInstance.findUnique({
        where: { idempotencyKey },
        select: { id: true },
      });
      return { started: false, reason: "DUPLICATE", instanceId: winner?.id };
    }
    throw err;
  }
}

export async function cancelWorkflowInstance(instanceId: string, reasonCode: string): Promise<boolean> {
  const result = await prisma.workflowInstance.updateMany({
    where: { id: instanceId, status: { in: ["PENDING", "RUNNING", "WAITING", "SCHEDULED", "PAUSED"] } },
    data: { status: "CANCELLED", reasonCode, completedAt: new Date(), nextRunAt: null },
  });
  return result.count === 1;
}
