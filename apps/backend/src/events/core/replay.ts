import prisma from "../../lib/prisma";
import { eventPlatformConfig } from "./config";
import { dispatchEvent } from "./event-bus";
import { validateEventEnvelope } from "./validation";
import type { HomigoEvent } from "./homigo-event";
import { getRegisteredConsumers } from "./consumer-registry";
import { hasConsumerProcessed, recordConsumerSuccess } from "./idempotency";
import { logger } from "../../lib/logger";

/**
 * Controlled replay — operators only. Does not bypass consumer idempotency unless
 * `force` deletes the receipt first (use only after fixing root cause).
 */
export async function replayOutboxEvent(input: {
  eventId: string;
  consumerName?: string;
  force?: boolean;
}): Promise<{ replayed: boolean; reason: string }> {
  const row = await prisma.eventOutbox.findFirst({
    where: { eventId: input.eventId },
    select: { payload: true, eventType: true, status: true },
  });
  if (!row) return { replayed: false, reason: "OUTBOX_NOT_FOUND" };

  const event = validateEventEnvelope(row.payload);

  if (input.consumerName) {
    const consumer = getRegisteredConsumers().find((c) => c.name === input.consumerName);
    if (!consumer) return { replayed: false, reason: "CONSUMER_NOT_FOUND" };
    if (!consumer.eventTypes.includes("*") && !consumer.eventTypes.includes(event.type)) {
      return { replayed: false, reason: "CONSUMER_EVENT_MISMATCH" };
    }
    if (input.force) {
      await prisma.eventConsumerReceipt.deleteMany({
        where: { consumerName: input.consumerName, eventId: input.eventId },
      });
    }
    if (await hasConsumerProcessed(input.consumerName, input.eventId)) {
      return { replayed: false, reason: "ALREADY_PROCESSED" };
    }
    await consumer.handler(event);
    await recordConsumerSuccess(input.consumerName, input.eventId);
    logger.info("event_replay_consumer", {
      eventId: input.eventId,
      consumer: input.consumerName,
      forced: Boolean(input.force),
    });
    return { replayed: true, reason: "CONSUMER_REPLAY_OK" };
  }

  await dispatchEvent(event);
  logger.info("event_replay_bus", { eventId: input.eventId, eventType: event.type });
  return { replayed: true, reason: "BUS_REPLAY_OK" };
}

export async function replayDeadLetterById(dlqId: string, force = false): Promise<{ replayed: boolean; reason: string }> {
  const row = await prisma.eventDeadLetter.findUnique({ where: { id: dlqId } });
  if (!row) return { replayed: false, reason: "DLQ_NOT_FOUND" };
  const result = await replayOutboxEvent({
    eventId: row.eventId,
    consumerName: row.consumerName,
    force,
  });
  if (result.replayed) {
    await prisma.eventDeadLetter.update({
      where: { id: dlqId },
      data: { resolvedAt: new Date(), resolution: "manual_replay" },
    });
  }
  return result;
}

export type { HomigoEvent };
