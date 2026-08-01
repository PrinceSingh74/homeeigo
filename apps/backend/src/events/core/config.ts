import { getSchedulerInstanceId } from "../../lib/distributed-scheduler";

function envBool(key: string, defaultValue: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === "") return defaultValue;
  return v === "true" || v === "1";
}

function envInt(key: string, defaultValue: number, min: number, max: number): number {
  const n = Number(process.env[key]);
  if (!Number.isFinite(n)) return defaultValue;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** Phase 0 event platform configuration (environment-driven). */
export const eventPlatformConfig = {
  outboxEnabled: envBool("EVENTS_OUTBOX_ENABLED", true),
  consumersEnabled: envBool("EVENTS_CONSUMERS_ENABLED", true),
  bookingEventsEnabled: envBool("EVENTS_BOOKING_ENABLED", true),
  paymentEventsEnabled: envBool("EVENTS_PAYMENT_ENABLED", true),
  trackingEventsEnabled: envBool("EVENTS_TRACKING_ENABLED", true),
  partnerEventsEnabled: envBool("EVENTS_PARTNER_ENABLED", true),
  batchSize: envInt("EVENTS_OUTBOX_BATCH_SIZE", 50, 1, 500),
  maxAttempts: envInt("EVENTS_OUTBOX_MAX_ATTEMPTS", 5, 1, 20),
  intervalMs: envInt("EVENTS_OUTBOX_INTERVAL_MS", 5000, 1000, 60_000),
  lockTimeoutMs: envInt("EVENTS_OUTBOX_LOCK_TIMEOUT_MS", 120_000, 10_000, 600_000),
  arrivalRadiusM: envInt("EVENTS_ARRIVAL_RADIUS_M", 100, 30, 500),
  reviewRequestDelayMs: envInt("EVENTS_REVIEW_REQUEST_DELAY_MS", 2 * 60 * 60 * 1000, 60_000, 7 * 24 * 60 * 60 * 1000),
  publishedRetentionDays: envInt("EVENTS_OUTBOX_PUBLISHED_RETENTION_DAYS", 14, 1, 90),
  dlqRetentionDays: envInt("EVENTS_DLQ_RETENTION_DAYS", 90, 7, 365),
  receiptRetentionDays: envInt("EVENTS_RECEIPT_RETENTION_DAYS", 30, 7, 180),
  scheduledJobRetentionDays: envInt("EVENTS_SCHEDULED_JOB_RETENTION_DAYS", 60, 7, 365),
  consumerConcurrency: envInt("EVENTS_CONSUMER_CONCURRENCY", 8, 1, 32),
  maxPayloadBytes: envInt("EVENTS_MAX_PAYLOAD_BYTES", 65_536, 1024, 1_048_576),
  instanceId: () => getSchedulerInstanceId(),
} as const;

export function validateEventPlatformConfig(): void {
  if (eventPlatformConfig.batchSize < 1) {
    throw new Error("EVENTS_OUTBOX_BATCH_SIZE must be >= 1");
  }
}
