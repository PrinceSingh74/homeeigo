/**
 * Phase 0 — two-processor concurrency + stale-claim recovery verification.
 * Non-production only. Run: bun --env-file=.env run scripts/phase0-concurrency-verify.ts
 */
import prisma from "../src/lib/prisma";
import { buildBookingCreatedEvent } from "../src/events/catalog/booking.events";
import { emitInTransaction } from "../src/events/core/event-publisher";
import { processOutboxBatch } from "../src/events/core/outbox-processor";
import { eventPlatformConfig } from "../src/events/core/config";
import { bootstrapEventConsumers } from "../src/events/consumers";

const BATCH = 24;

async function seedPending(count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const event = buildBookingCreatedEvent({
      bookingId: `bk_conc_${Date.now()}_${i}`,
      bookingNumber: `HG-C-${Date.now()}-${i}`,
      userId: "conc_test_user",
      serviceId: "conc_service",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });
    await prisma.$transaction(async (tx) => {
      await emitInTransaction(tx, event);
    });
    ids.push(event.id);
  }
  return ids;
}

async function main() {
  process.env.EVENTS_OUTBOX_ENABLED = "true";
  process.env.EVENTS_CONSUMERS_ENABLED = "true";
  bootstrapEventConsumers();

  console.log("=== Phase 0 concurrency verification ===");
  console.log(`DB target: localhost (masked), lockTimeoutMs=${eventPlatformConfig.lockTimeoutMs}`);

  const eventIds = await seedPending(BATCH);
  console.log(`Seeded ${eventIds.length} PENDING events`);

  // Two simultaneous processor batches (same process simulates dual workers against one DB)
  const [a, b] = await Promise.all([processOutboxBatch(), processOutboxBatch()]);
  console.log("Dual batch claim:", { processorA: a, processorB: b });

  const rows = await prisma.eventOutbox.findMany({
    where: { eventId: { in: eventIds } },
    select: { eventId: true, status: true, attempts: true },
  });

  const published = rows.filter((r) => r.status === "PUBLISHED").length;
  const processing = rows.filter((r) => r.status === "PROCESSING").length;
  const pending = rows.filter((r) => r.status === "PENDING").length;
  const failed = rows.filter((r) => r.status === "FAILED").length;

  // Drain remaining
  for (let i = 0; i < 5; i++) {
    const r = await processOutboxBatch();
    if (r.claimed === 0) break;
  }

  const finalRows = await prisma.eventOutbox.findMany({
    where: { eventId: { in: eventIds } },
    select: { eventId: true, status: true, attempts: true },
  });
  const finalPublished = finalRows.filter((r) => r.status === "PUBLISHED").length;
  const maxAttempts = Math.max(...finalRows.map((r) => r.attempts), 0);
  const duplicateClaims = maxAttempts > 2; // each event should be claimed ~1 time (+1 on claim SQL)

  // Stale claim recovery
  const staleEvent = buildBookingCreatedEvent({
    bookingId: `bk_stale_${Date.now()}`,
    bookingNumber: `HG-S-${Date.now()}`,
    userId: "stale_user",
    serviceId: "stale_service",
    serviceCategory: "cleaning",
    city: "Delhi",
    providerId: null,
    status: "PENDING",
    finalAmount: 100,
    paymentMethod: "razorpay",
    scheduledAt: new Date(),
  });
  await prisma.$transaction(async (tx) => {
    await emitInTransaction(tx, staleEvent);
  });
  const staleRow = await prisma.eventOutbox.update({
    where: { eventId: staleEvent.id },
    data: {
      status: "PROCESSING",
      lockedAt: new Date(Date.now() - eventPlatformConfig.lockTimeoutMs - 5000),
      lockedBy: "dead-processor",
      attempts: 1,
    },
  });

  const recovery = await processOutboxBatch();
  const recoveredRow = await prisma.eventOutbox.findUnique({ where: { id: staleRow.id } });
  const staleRecovered =
    recoveredRow?.status === "PUBLISHED" || recoveredRow?.status === "PENDING";

  // Cleanup test rows
  await prisma.eventOutbox.deleteMany({ where: { eventId: { in: [...eventIds, staleEvent.id] } } });
  await prisma.eventConsumerReceipt.deleteMany({
    where: { eventId: { in: [...eventIds, staleEvent.id] } },
  });

  const pass =
    finalPublished === eventIds.length &&
    !duplicateClaims &&
    staleRecovered &&
    recovery.recovered >= 1;

  console.log({
    afterDualClaim: { published, processing, pending, failed },
    finalPublished,
    total: eventIds.length,
    maxAttempts,
    staleRecovered,
    recoveryRecovered: recovery.recovered,
    verdict: pass ? "PASS" : "FAIL",
  });

  if (!pass) process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
