import { registerConsumer } from "../core/consumer-registry";
import { automationTriggerConsumer, AUTOMATION_TRIGGER_CONSUMER_NAME, triggeredEventTypes } from "./automation-trigger.consumer";
import { validateEventPlatformConfig } from "../core/config";
import { metricsConsumer, METRICS_CONSUMER_NAME } from "./metrics.consumer";
import { auditConsumer, AUDIT_CONSUMER_NAME } from "./audit.consumer";
import {
  automationSchedulerConsumer,
  AUTOMATION_SCHEDULER_CONSUMER_NAME,
} from "./automation-scheduler.consumer";
import { mlFeatureSinkConsumer, ML_FEATURE_SINK_CONSUMER_NAME } from "./ml-feature-sink.consumer";
import { etaLabelConsumer, ETA_LABEL_CONSUMER_NAME } from "./eta-label.consumer";
import { aiContextIndexerConsumer, AI_CONTEXT_INDEXER_CONSUMER_NAME } from "./ai-context-indexer.consumer";
import { EVENT_TYPES } from "../catalog/event-types";

let bootstrapped = false;

export function bootstrapEventConsumers(): void {
  if (bootstrapped) return;
  validateEventPlatformConfig();

  registerConsumer({
    name: METRICS_CONSUMER_NAME,
    eventTypes: "*",
    handler: metricsConsumer,
    maxAttempts: 3,
  });

  registerConsumer({
    name: AUDIT_CONSUMER_NAME,
    eventTypes: [
      EVENT_TYPES.BOOKING_CREATED,
      EVENT_TYPES.BOOKING_ASSIGNED,
      EVENT_TYPES.BOOKING_STARTED,
      EVENT_TYPES.BOOKING_COMPLETED,
      EVENT_TYPES.BOOKING_CANCELLED,
      EVENT_TYPES.PAYMENT_SUCCESS,
      EVENT_TYPES.PAYMENT_FAILED,
      EVENT_TYPES.PARTNER_ONLINE,
      EVENT_TYPES.PARTNER_OFFLINE,
      EVENT_TYPES.PARTNER_PAUSED,
      EVENT_TYPES.PARTNER_RESUMED,
      EVENT_TYPES.PARTNER_AVAILABILITY_UPDATED,
      EVENT_TYPES.PARTNER_SERVICE_AREA_UPDATED,
      EVENT_TYPES.PARTNER_DISPATCHED,
      EVENT_TYPES.PARTNER_ARRIVED,
      EVENT_TYPES.PARTNER_LEAD_CREATED,
      EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED,
      EVENT_TYPES.PARTNER_APPLICATION_APPROVED,
      EVENT_TYPES.PARTNER_ACTIVATED,
    ],
    handler: auditConsumer,
    maxAttempts: 3,
  });

  /**
   * The event → workflow bridge.
   *
   * Subscribes to exactly the event types the trigger registry names, so adding an automation is a
   * change to that registry rather than to this file. Retries and dead-lettering come from the
   * consumer machinery, unchanged.
   */
  registerConsumer({
    name: AUTOMATION_TRIGGER_CONSUMER_NAME,
    eventTypes: triggeredEventTypes(),
    handler: automationTriggerConsumer,
    maxAttempts: 3,
  });

  registerConsumer({
    name: AUTOMATION_SCHEDULER_CONSUMER_NAME,
    eventTypes: [EVENT_TYPES.BOOKING_COMPLETED],
    handler: automationSchedulerConsumer,
    maxAttempts: 3,
  });

  registerConsumer({
    name: ML_FEATURE_SINK_CONSUMER_NAME,
    eventTypes: [EVENT_TYPES.PARTNER_ARRIVED],
    handler: mlFeatureSinkConsumer,
    maxAttempts: 3,
  });

  registerConsumer({
    name: ETA_LABEL_CONSUMER_NAME,
    eventTypes: [EVENT_TYPES.BOOKING_COMPLETED, EVENT_TYPES.PARTNER_ARRIVED],
    handler: etaLabelConsumer,
    maxAttempts: 3,
  });

  registerConsumer({
    name: AI_CONTEXT_INDEXER_CONSUMER_NAME,
    eventTypes: "*",
    handler: aiContextIndexerConsumer,
    maxAttempts: 1,
  });

  bootstrapped = true;
}

export function resetEventConsumersForTests(): void {
  bootstrapped = false;
}
