import prisma from "../../lib/prisma";

export async function hasConsumerProcessed(consumerName: string, eventId: string): Promise<boolean> {
  const row = await prisma.eventConsumerReceipt.findUnique({
    where: { consumerName_eventId: { consumerName, eventId } },
    select: { id: true },
  });
  return Boolean(row);
}

export async function recordConsumerSuccess(
  consumerName: string,
  eventId: string,
  result = "ok",
): Promise<void> {
  await prisma.eventConsumerReceipt.upsert({
    where: { consumerName_eventId: { consumerName, eventId } },
    create: { consumerName, eventId, result },
    update: { result, processedAt: new Date(), errorMessage: null },
  });
}

export async function recordConsumerSkipped(consumerName: string, eventId: string, reason: string): Promise<void> {
  await prisma.eventConsumerReceipt.upsert({
    where: { consumerName_eventId: { consumerName, eventId } },
    create: { consumerName, eventId, result: "skipped", errorMessage: reason },
    update: { result: "skipped", errorMessage: reason, processedAt: new Date() },
  });
}
