import { logger } from "../../lib/logger";
import { recordTriggerMatched, recordTriggerStarted, recordTriggerSkipped } from "../../lib/automation-metrics";
import { triggersFor, triggeredEventTypes } from "../../automation/registry/trigger-registry";
import { startWorkflowInstance } from "../../automation/engine/instance-manager";
import type { HomigoEvent } from "../core/homigo-event";

/**
 * The bridge between the event stream and the workflow engine.
 *
 * Until now nothing started a workflow from an event — `startWorkflowInstance` had no production
 * caller at all, so the engine was complete and unreachable. This connects them, and deliberately
 * does no more than that.
 *
 * What it must never become is the place where business logic accumulates. It imports no payment
 * service, no notification service, no booking operations and no gateway client, and an
 * import-boundary test enforces that. A consumer that could send a message is a consumer someone
 * will eventually make send a message, and then the workflow definition stops being the description
 * of what happens.
 *
 * Idempotency is not reimplemented here. `startWorkflowInstance` already builds a deterministic key
 * from workflow, version, subject and trigger event, guards it with a unique index and treats a
 * collision as the guard working. Adding a second key beside a proven one would give the system two
 * answers to "is this the same trigger".
 */
export async function automationTriggerConsumer(event: HomigoEvent): Promise<void> {
  const triggers = triggersFor(event.type);
  if (triggers.length === 0) return;

  for (const trigger of triggers) {
    recordTriggerMatched(event.type, trigger.workflowId);

    const subjectId = trigger.deriveSubjectId(event);
    if (!subjectId) {
      /**
       * No subject, no workflow.
       *
       * Substituting anything here — a fallback id, the aggregate id, an empty string — would start
       * an automation pointed at the wrong thing or at nothing, and Phase 6B's subject scoping would
       * faithfully enforce access to whatever it was handed.
       */
      recordTriggerSkipped(event.type, trigger.workflowId, "NO_SUBJECT");
      logger.warn("automation_trigger_no_subject", {
        eventType: event.type, eventId: event.id, workflowId: trigger.workflowId,
      });
      continue;
    }

    const result = await startWorkflowInstance({
      workflowId: trigger.workflowId,
      subjectType: trigger.subjectType,
      subjectId,
      triggerEventId: event.id,
      traceId: event.homigo.traceId,
      correlationId: event.homigo.correlationId,
    });

    if (result.started) {
      recordTriggerStarted(event.type, trigger.workflowId);
      logger.info("automation_triggered", {
        eventType: event.type, eventId: event.id,
        workflowId: trigger.workflowId, instanceId: result.instanceId,
      });
    } else {
      // DUPLICATE, NO_ACTIVE_VERSION and NOT_REGISTERED are all ordinary: a redelivered event, or a
      // workflow that exists in the registry but has not been activated yet.
      recordTriggerSkipped(event.type, trigger.workflowId, result.reason ?? "UNKNOWN");
    }
  }
}

export const AUTOMATION_TRIGGER_CONSUMER_NAME = "automation-trigger.v1";
export { triggeredEventTypes };
