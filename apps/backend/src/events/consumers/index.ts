import { registerConsumer } from "../core/consumer-registry";
import { automationTriggerConsumer, AUTOMATION_TRIGGER_CONSUMER_NAME, triggeredEventTypes } from "./automation-trigger.consumer";
import { validateEventPlatformConfig } from "../core/config";
import { metricsConsumer, METRICS_CONSUMER_NAME } from "./metrics.consumer";
import { auditConsumer, AUDIT_CONSUMER_NAME } from "./audit.consumer";
import {
  bookingLifecycleNotifyConsumer,
  BOOKING_LIFECYCLE_NOTIFY_CONSUMER_NAME,
} from "./booking-lifecycle-notify.consumer";
import {
  automationSchedulerConsumer,
  AUTOMATION_SCHEDULER_CONSUMER_NAME,
} from "./automation-scheduler.consumer";
import { mlFeatureSinkConsumer, ML_FEATURE_SINK_CONSUMER_NAME } from "./ml-feature-sink.consumer";
import { etaLabelConsumer, ETA_LABEL_CONSUMER_NAME } from "./eta-label.consumer";
import { aiContextIndexerConsumer, AI_CONTEXT_INDEXER_CONSUMER_NAME } from "./ai-context-indexer.consumer";
import { partnerReferralConsumer, PARTNER_REFERRAL_CONSUMER_NAME } from "./partner-referral.consumer";
import { agentTriggerConsumer } from "./agent-trigger.consumer";
import { agentTriggeredEventTypes } from "../../agents/triggers/agent-trigger-registry";
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
      EVENT_TYPES.BOOKING_RESCHEDULED,
      EVENT_TYPES.BOOKING_PAYMENT_EXPIRED,
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
   * Tells the customer their booking was released when the payment window closed. Nothing else told
   * them: they would open the app and find the slot gone.
   */
  registerConsumer({
    name: BOOKING_LIFECYCLE_NOTIFY_CONSUMER_NAME,
    eventTypes: [EVENT_TYPES.BOOKING_PAYMENT_EXPIRED],
    handler: bookingLifecycleNotifyConsumer,
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

  registerConsumer({
    name: PARTNER_REFERRAL_CONSUMER_NAME,
    eventTypes: [
      EVENT_TYPES.PARTNER_APPLICATION_STARTED,
      EVENT_TYPES.PARTNER_KYC_VERIFIED,
      EVENT_TYPES.PARTNER_TRAINING_COMPLETED,
      EVENT_TYPES.PARTNER_ACTIVATED,
      EVENT_TYPES.PARTNER_LIFECYCLE_CHANGED,
      EVENT_TYPES.BOOKING_COMPLETED,
      EVENT_TYPES.PARTNER_RISK_UPDATED,
    ],
    handler: partnerReferralConsumer,
    maxAttempts: 3,
  });

  /**
   * The event → agent bridge.
   *
   * Subscribes to exactly the event types the agent trigger registry names — currently one — so
   * adding an agent trigger is a change to that registry rather than to this file. The list is
   * computed, not literal, so a registry entry cannot be added without its subscription.
   *
   * `maxAttempts: 1`. An agent run is expensive, bounded and already idempotent by run key;
   * re-delivering the event would at best collapse onto the same run and at worst pay for
   * planning twice to reach that conclusion.
   */
  const agentEventTypes = agentTriggeredEventTypes();
  if (agentEventTypes.length > 0) {
    registerConsumer({
      name: "agent-trigger",
      eventTypes: agentEventTypes,
      handler: agentTriggerConsumer,
      maxAttempts: 1,
    });
  }

  bootstrapped = true;
}

export function resetEventConsumersForTests(): void {
  bootstrapped = false;
}
