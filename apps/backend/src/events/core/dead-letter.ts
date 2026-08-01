import type { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { HomigoEvent } from "./homigo-event";

export async function recordDeadLetter(input: {
  eventId: string;
  eventType: string;
  consumerName: string;
  payload: HomigoEvent | Record<string, unknown>;
  error: string;
  attempts?: number;
}): Promise<void> {
  await prisma.eventDeadLetter.create({
    data: {
      eventId: input.eventId,
      eventType: input.eventType,
      consumerName: input.consumerName,
      payload: input.payload as Prisma.InputJsonValue,
      error: input.error.slice(0, 4000),
      attempts: input.attempts ?? 1,
    },
  });
}

export async function countUnresolvedDeadLetters(): Promise<number> {
  return prisma.eventDeadLetter.count({ where: { resolvedAt: null } });
}
