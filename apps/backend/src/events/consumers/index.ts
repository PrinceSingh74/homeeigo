import { registerConsumer } from "../core/consumer-registry";
import { validateEventPlatformConfig } from "../core/config";
import { metricsConsumer, METRICS_CONSUMER_NAME } from "./metrics.consumer";
import { auditConsumer, AUDIT_CONSUMER_NAME } from "./audit.consumer";
import {
  automationSchedulerConsumer,
  AUTOMATION_SCHEDULER_CONSUMER_NAME,
} from "./automation-scheduler.consumer";
import { mlFeatureSinkConsumer, ML_FEATURE_SINK_CONSUMER_NAME } from "./ml-feature-sink.consumer";
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
      EVENT_TYPES.PARTNER_DISPATCHED,
      EVENT_TYPES.PARTNER_ARRIVED,
    ],
    handler: auditConsumer,
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
