import prisma from "../../lib/prisma";
import { dispatchEvent } from "./event-bus";
import { validateEventEnvelope } from "./validation";
import type { HomigoEvent } from "./homigo-event";
import { getRegisteredConsumers } from "./consumer-registry";
import { hasConsumerProcessed, recordConsumerSuccess } from "./idempotency";
import { logger } from "../../lib/logger";
import { OUTBOX_PUBLISHER_SOURCE } from "./outbox-processor";

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

  let event: HomigoEvent;
  try {
    event = validateEventEnvelope(row.payload);
  } catch (err) {
    return {
      replayed: false,
      reason: `INVALID_ENVELOPE:${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
    };
  }

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

  // Publisher-sourced DLQ rows are not a registered consumer. Looking them up by
  // consumerName returned CONSUMER_NOT_FOUND and left recoverable outbox failures stuck.
  let result =
    row.consumerName === OUTBOX_PUBLISHER_SOURCE
      ? await replayOutboxEvent({ eventId: row.eventId })
      : await replayOutboxEvent({
          eventId: row.eventId,
          consumerName: row.consumerName,
          force,
        });

  // Retention may have deleted the outbox row while the DLQ payload remains.
  if (!result.replayed && result.reason === "OUTBOX_NOT_FOUND") {
    try {
      const event = validateEventEnvelope(row.payload);
      if (row.consumerName === OUTBOX_PUBLISHER_SOURCE) {
        await dispatchEvent(event);
        result = { replayed: true, reason: "BUS_REPLAY_FROM_DLQ_PAYLOAD" };
      } else {
        result = await replayEnvelopeToConsumer(event, row.consumerName, force);
      }
    } catch (err) {
      result = {
        replayed: false,
        reason: `DLQ_PAYLOAD_INVALID:${err instanceof Error ? err.message : String(err)}`.slice(0, 200),
      };
    }
  }

  if (result.replayed) {
    await prisma.eventDeadLetter.update({
      where: { id: dlqId },
      data: { resolvedAt: new Date(), resolution: "manual_replay" },
    });
    if (row.consumerName === OUTBOX_PUBLISHER_SOURCE) {
      await prisma.eventOutbox.updateMany({
        where: { eventId: row.eventId, status: "FAILED" },
        data: {
          status: "PUBLISHED",
          publishedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
        },
      });
    }
  } else if (result.reason === "ALREADY_PROCESSED") {
    // Consumer already applied the side effect. Close the ticket; do not re-run it.
    await prisma.eventDeadLetter.update({
      where: { id: dlqId },
      data: { resolvedAt: new Date(), resolution: "already_processed" },
    });
  }
  return result;
}

async function replayEnvelopeToConsumer(
  event: HomigoEvent,
  consumerName: string,
  force: boolean,
): Promise<{ replayed: boolean; reason: string }> {
  const consumer = getRegisteredConsumers().find((c) => c.name === consumerName);
  if (!consumer) return { replayed: false, reason: "CONSUMER_NOT_FOUND" };
  if (!consumer.eventTypes.includes("*") && !consumer.eventTypes.includes(event.type)) {
    return { replayed: false, reason: "CONSUMER_EVENT_MISMATCH" };
  }
  if (force) {
    await prisma.eventConsumerReceipt.deleteMany({
      where: { consumerName, eventId: event.id },
    });
  }
  if (await hasConsumerProcessed(consumerName, event.id)) {
    return { replayed: false, reason: "ALREADY_PROCESSED" };
  }
  await consumer.handler(event);
  await recordConsumerSuccess(consumerName, event.id);
  return { replayed: true, reason: "CONSUMER_REPLAY_FROM_DLQ_PAYLOAD" };
}

export type { HomigoEvent };
