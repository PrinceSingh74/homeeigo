import type { Prisma } from "@prisma/client";
import type { EmitEventInput, HomigoEvent } from "./homigo-event";
import { mergeEventContext } from "./event-context";
import { assertNoProhibitedPii, sanitizeEventPayload } from "./pii";
import { EVENT_VERSION } from "../catalog/event-types";
import crypto from "crypto";

export function buildHomigoEvent<TData extends Record<string, unknown>>(
  input: EmitEventInput<TData>,
): HomigoEvent<TData> {
  const ctx = mergeEventContext({
    correlationId: input.homigo.correlationId,
    causationId: input.homigo.causationId,
    actorType: input.homigo.actorType,
    actorId: input.homigo.actorId,
  });
  const safe = sanitizeEventPayload(input.data);
  assertNoProhibitedPii(safe);
  return {
    specversion: "1.0",
    id: crypto.randomUUID(),
    type: input.type,
    source: input.source,
    time: new Date().toISOString(),
    datacontenttype: "application/json",
    data: safe,
    homigo: {
      version: input.homigo.version ?? EVENT_VERSION,
      aggregateType: input.homigo.aggregateType,
      aggregateId: input.homigo.aggregateId,
      actorType: input.homigo.actorType ?? ctx.actorType,
      actorId: input.homigo.actorId ?? ctx.actorId,
      traceId: ctx.traceId,
      correlationId: input.homigo.correlationId ?? ctx.correlationId,
      causationId: input.homigo.causationId ?? ctx.causationId,
    },
  };
}

/** Persist domain event intent atomically inside the caller's DB transaction. */
export async function emitInTransaction(
  tx: Prisma.TransactionClient,
  event: HomigoEvent,
): Promise<void> {
  await tx.eventOutbox.create({
    data: {
      eventId: event.id,
      eventType: event.type,
      eventVersion: event.homigo.version,
      aggregateType: event.homigo.aggregateType,
      aggregateId: event.homigo.aggregateId,
      actorType: event.homigo.actorType,
      actorId: event.homigo.actorId,
      payload: event as unknown as Prisma.InputJsonValue,
      metadata: {
        traceId: event.homigo.traceId,
        correlationId: event.homigo.correlationId,
        causationId: event.homigo.causationId,
        source: event.source,
        time: event.time,
      },
    },
  });
}

/** Best-effort outbox write outside an existing transaction (prefer emitInTransaction). */
export async function emitStandalone(
  prisma: { eventOutbox: Prisma.TransactionClient["eventOutbox"] },
  event: HomigoEvent,
): Promise<void> {
  await prisma.eventOutbox.create({
    data: {
      eventId: event.id,
      eventType: event.type,
      eventVersion: event.homigo.version,
      aggregateType: event.homigo.aggregateType,
      aggregateId: event.homigo.aggregateId,
      actorType: event.homigo.actorType,
      actorId: event.homigo.actorId,
      payload: event as unknown as Prisma.InputJsonValue,
      metadata: {
        traceId: event.homigo.traceId,
        correlationId: event.homigo.correlationId,
        causationId: event.homigo.causationId,
        source: event.source,
        time: event.time,
      },
    },
  });
}
