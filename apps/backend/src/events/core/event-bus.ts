import { logger } from "../../lib/logger";
import { incCounter } from "../../lib/metrics";
import { eventPlatformConfig } from "./config";
import { matchConsumers } from "./consumer-registry";
import { recordDeadLetter } from "./dead-letter";
import { hasConsumerProcessed, recordConsumerSkipped, recordConsumerSuccess } from "./idempotency";
import type { HomigoEvent } from "./homigo-event";
import { isTransientConsumerError, computeRetryDelayMs } from "./retry";
import { validateEventEnvelope } from "./validation";

const CONSUMER_INLINE_MAX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function invokeConsumer(
  consumerName: string,
  handler: (e: HomigoEvent) => Promise<void>,
  event: HomigoEvent,
): Promise<void> {
  const start = Date.now();
  try {
    await handler(event);
    await recordConsumerSuccess(consumerName, event.id);
    incCounter("homigo_consumer_processed_total", { consumer: consumerName, event_type: normalizeEventType(event.type) });
    logger.info("event_consumer_ok", {
      eventId: event.id,
      eventType: event.type,
      eventVersion: event.homigo.version,
      aggregateType: event.homigo.aggregateType,
      aggregateId: event.homigo.aggregateId,
      consumer: consumerName,
      durationMs: Date.now() - start,
      correlationId: event.homigo.correlationId,
      traceId: event.homigo.traceId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    incCounter("homigo_consumer_failed_total", { consumer: consumerName, event_type: normalizeEventType(event.type) });
    logger.warn("event_consumer_failed", {
      eventId: event.id,
      eventType: event.type,
      eventVersion: event.homigo.version,
      aggregateType: event.homigo.aggregateType,
      aggregateId: event.homigo.aggregateId,
      consumer: consumerName,
      error: message,
      correlationId: event.homigo.correlationId,
      traceId: event.homigo.traceId,
    });
    throw err;
  }
}

function normalizeEventType(type: string): string {
  return type.replace(/^homigo\./, "");
}

async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length || 1) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

async function processConsumer(consumer: ReturnType<typeof matchConsumers>[number], event: HomigoEvent): Promise<void> {
  if (await hasConsumerProcessed(consumer.name, event.id)) {
    incCounter("homigo_consumer_skipped_total", { consumer: consumer.name, reason: "idempotent" });
    return;
  }

  const maxAttempts = Math.min(consumer.maxAttempts, CONSUMER_INLINE_MAX_ATTEMPTS);
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await invokeConsumer(consumer.name, consumer.handler, event);
      return;
    } catch (err) {
      lastError = err;
      if (!isTransientConsumerError(err) || attempt >= maxAttempts) break;
      incCounter("homigo_consumer_retry_total", { consumer: consumer.name });
      await sleep(computeRetryDelayMs(attempt).getTime() - Date.now());
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);

  try {
    await recordDeadLetter({
      eventId: event.id,
      eventType: event.type,
      consumerName: consumer.name,
      payload: event,
      error: message,
      attempts: maxAttempts,
    });
    incCounter("homigo_dlq_total", { consumer: consumer.name, event_type: normalizeEventType(event.type) });
  } catch (dlqErr) {
    // DB unavailable at the exact dead-lettering moment: the DLQ write itself failed.
    // Do NOT count this as homigo_dlq_total (it was never persisted) and do NOT write
    // a consumer receipt below — leaving no receipt means a future replay of this
    // event (operators can call replayOutboxEvent({ eventId, consumerName }) once the
    // DB recovers) will retry this consumer instead of being silently skipped forever.
    incCounter("homigo_dlq_persist_failed_total", { consumer: consumer.name, event_type: normalizeEventType(event.type) });
    logger.error("event_dead_letter_persist_failed", {
      eventId: event.id,
      eventType: event.type,
      consumer: consumer.name,
      consumerError: message,
      dlqPersistError: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
      correlationId: event.homigo.correlationId,
      traceId: event.homigo.traceId,
    });
    return;
  }

  await recordConsumerSkipped(consumer.name, event.id, `dlq:${message.slice(0, 200)}`).catch((receiptErr) => {
    // DLQ row is safely persisted above; only the idempotency receipt failed to write.
    // Not data loss (the DLQ row is the source of truth for replay), just a residual
    // gap where a future redelivery could redundantly retry an already-dead-lettered event.
    logger.error("event_consumer_receipt_persist_failed", {
      eventId: event.id,
      consumer: consumer.name,
      error: receiptErr instanceof Error ? receiptErr.message : String(receiptErr),
    });
  });
}

/** Dispatch event to all matching consumers with idempotency and bounded inline retry. */
export async function dispatchEvent(eventInput: unknown): Promise<void> {
  if (!eventPlatformConfig.consumersEnabled) return;

  const event = validateEventEnvelope(eventInput);
  const matched = matchConsumers(event.type);

  await runWithConcurrency(matched, eventPlatformConfig.consumerConcurrency, async (consumer) => {
    try {
      await processConsumer(consumer, event);
    } catch {
      // processConsumer handles DLQ internally; never fail unrelated consumers
    }
  });
}

export const eventBus = { dispatch: dispatchEvent };
