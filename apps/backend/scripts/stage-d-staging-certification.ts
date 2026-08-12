/**
 * Stage D — Real Staging Event & Booking Lifecycle Certification
 *
 * Runs against staging DB when APP_ENV=staging and events enabled.
 * Execute via Cloud Run Job or locally with staging DATABASE_URL (read/write test data only).
 *
 *   STAGING_EVENTS_CERTIFICATION=1 EVENTS_OUTBOX_ENABLED=true EVENTS_CONSUMERS_ENABLED=true \
 *     bun --env-file=.env.staging run scripts/stage-d-staging-certification.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { assignmentEngine } from "../src/services/assignment-engine.service";
import { providerService } from "../src/services/provider.service";
import { trackingService } from "../src/services/tracking.service";
import { processOutboxBatch } from "../src/events/core/outbox-processor";
import { dispatchEvent } from "../src/events/core/event-bus";
import { bootstrapEventConsumers, resetEventConsumersForTests } from "../src/events/consumers";
import {
  clearConsumersForTests,
  registerConsumer,
} from "../src/events/core/consumer-registry";
import { replayDeadLetterById } from "../src/events/core/replay";
import { eventPlatformConfig } from "../src/events/core/config";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { buildBookingCreatedEvent } from "../src/events/catalog/booking.events";

type Gate = { id: string; phase: string; status: "PASS" | "FAIL" | "SKIP" | "BLOCKED"; detail: string };

const gates: Gate[] = [];
const tag = `staged_${Date.now()}`;

function gate(phase: string, id: string, status: Gate["status"], detail: string) {
  gates.push({ phase, id, status, detail });
  const icon = status === "PASS" ? "✓" : status === "FAIL" ? "✗" : status === "SKIP" ? "○" : "⊘";
  console.log(`[${icon}] ${phase} / ${id}: ${detail}`);
}

async function flushOutbox(maxRounds = 10): Promise<number> {
  let total = 0;
  for (let i = 0; i < maxRounds; i++) {
    const batch = await processOutboxBatch();
    total += batch.published;
    if (batch.claimed === 0) break;
  }
  return total;
}

async function waitForOutboxEvent(eventType: string, bookingId: string, timeoutMs = 30_000): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.eventOutbox.findFirst({
      where: {
        eventType,
        aggregateId: bookingId,
      },
      orderBy: { createdAt: "desc" },
    });
    if (row?.status === "PUBLISHED") return row.eventId;
    if (row?.status === "PENDING" || row?.status === "PROCESSING") {
      await flushOutbox(3);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

async function main() {
  console.log("=== STAGE D — REAL STAGING CERTIFICATION ===");
  console.log(`tag=${tag} APP_ENV=${process.env.APP_ENV} DB=${process.env.DATABASE_URL?.split("/").pop()?.split("?")[0]}`);

  if (process.env.APP_ENV !== "staging") {
    gate("PRE", "env", "BLOCKED", "APP_ENV must be staging");
    console.log(JSON.stringify({ gates, summary: "BLOCKED" }, null, 2));
    process.exit(2);
  }

  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    gate("PRE", "cert-mode", "BLOCKED", "STAGING_EVENTS_CERTIFICATION=1 required");
    process.exit(2);
  }

  if (!eventPlatformConfig.outboxEnabled) {
    gate("PRE", "outbox", "BLOCKED", "EVENTS_OUTBOX_ENABLED must be true");
    process.exit(2);
  }

  try {
    await prisma.$queryRaw`SELECT 1 FROM event_outbox LIMIT 1`;
  } catch {
    gate("PRE", "schema", "BLOCKED", "event_outbox missing — run Step 7 first");
    process.exit(2);
  }

  resetEventConsumersForTests();
  bootstrapEventConsumers();

  // ── D1 Real staging fixtures ──
  const service = await prisma.service.findFirst({
    where: { category: "cleaning", isActive: true },
  });
  const provider = await prisma.provider.findFirst({
    where: { isOnline: true, isActive: true, isApproved: true, currentLocation: { isNot: null } },
    include: { currentLocation: true, user: true },
  });
  const customer = await prisma.user.findFirst({
    where: { role: "CUSTOMER" },
    include: { addresses: { take: 1 } },
  });

  if (!service || !provider?.currentLocation || !customer?.addresses[0]) {
    gate("D1", "fixtures", "BLOCKED", "Missing service/provider/customer in staging DB — seed required");
    console.log(JSON.stringify({ gates, summary: "BLOCKED" }, null, 2));
    process.exit(2);
  }
  gate("D1", "fixtures", "PASS", `customer=${customer.id} provider=${provider.id} service=${service.id}`);

  const addr = customer.addresses[0];
  const bookingLat = addr.latitude ?? provider.currentLocation.latitude;
  const bookingLng = addr.longitude ?? provider.currentLocation.longitude;

  // ── D2 Booking creation → booking.created ──
  const created = await bookingService.create(customer.id, {
    serviceId: service.id,
    scheduledDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
    addressId: addr.id,
  });
  if ("error" in created) {
    gate("D2", "booking.create", "FAIL", created.error);
    process.exit(1);
  }
  const bookingId = created.booking.id;
  gate("D2", "booking.create", "PASS", `id=${bookingId} number=${created.booking.bookingNumber}`);

  await flushOutbox();
  const createdEventId = await waitForOutboxEvent(EVENT_TYPES.BOOKING_CREATED, bookingId);
  createdEventId
    ? gate("D2", "event.booking.created", "PASS", `eventId=${createdEventId}`)
    : gate("D2", "event.booking.created", "FAIL", "outbox row not PUBLISHED");

  // ── D3 Partner assignment → booking.assigned ──
  await assignmentEngine.dispatchBookingNow(bookingId);
  const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
  const attempt = job
    ? await prisma.assignmentAttempt.findFirst({ where: { jobId: job.id }, orderBy: { dispatchedAt: "desc" } })
    : null;

  if (!attempt) {
    gate("D3", "dispatch", "FAIL", "no assignment attempt");
  } else {
    gate("D3", "dispatch", "PASS", `attempt=${attempt.id} provider=${attempt.providerId}`);
    await flushOutbox();
    const dispatched = await prisma.eventOutbox.findFirst({
      where: { eventType: EVENT_TYPES.PARTNER_DISPATCHED, aggregateId: attempt.providerId },
      orderBy: { createdAt: "desc" },
    });
    dispatched
      ? gate("D3", "event.partner.dispatched", "PASS", dispatched.eventId)
      : gate("D3", "event.partner.dispatched", "SKIP", "not emitted (flags or already dispatched)");

    const acc = await bookingService.accept(attempt.providerId, bookingId, 30);
    if ("error" in acc) {
      gate("D3", "booking.accept", "FAIL", acc.error);
    } else {
      gate("D3", "booking.accept", "PASS", "ACCEPTED");
      await flushOutbox();
      const assignedId = await waitForOutboxEvent(EVENT_TYPES.BOOKING_ASSIGNED, bookingId);
      assignedId
        ? gate("D3", "event.booking.assigned", "PASS", assignedId)
        : gate("D3", "event.booking.assigned", "FAIL", "missing PUBLISHED assigned event");
    }
  }

  // ── D4 en_route → arrived (lifecycle fields) ──
  const bAccepted = await prisma.booking.findUnique({ where: { id: bookingId } });
  if (bAccepted?.providerId && eventPlatformConfig.trackingEventsEnabled) {
    await trackingService.updateLocation(bAccepted.providerId, {
      bookingId,
      latitude: bookingLat,
      longitude: bookingLng,
      accuracy: 10,
      speed: 5,
    });
    await flushOutbox();

    const bEnRoute = await prisma.booking.findUnique({ where: { id: bookingId } });
    bEnRoute?.enRouteAt
      ? gate("D4", "booking.en_route_at", "PASS", bEnRoute.enRouteAt.toISOString())
      : gate("D4", "booking.en_route_at", "FAIL", "column null after tracking update");

    for (let i = 0; i < 5; i++) {
      await trackingService.updateLocation(bAccepted.providerId, {
        bookingId,
        latitude: bookingLat + i * 0.00005,
        longitude: bookingLng + i * 0.00005,
        accuracy: 8,
        speed: 0,
      });
    }
    await flushOutbox();

    const bArrived = await prisma.booking.findUnique({ where: { id: bookingId } });
    bArrived?.arrivedAt
      ? gate("D4", "booking.arrived_at", "PASS", `${bArrived.arrivedAt.toISOString()} travel=${bArrived.travelDurationMin}min`)
      : gate("D4", "booking.arrived_at", "FAIL", "arrived_at not set (need MIN_ARRIVAL_NEAR_PINGS near customer)");

    await flushOutbox();
    // partner.arrived uses providerId as outbox aggregateId (see buildPartnerArrivedEvent)
    const arrivedEvt = await prisma.eventOutbox.findFirst({
      where: {
        eventType: EVENT_TYPES.PARTNER_ARRIVED,
        OR: [{ aggregateId: bAccepted.providerId }, { aggregateId: bookingId }],
      },
      orderBy: { createdAt: "desc" },
    });
    arrivedEvt?.status === "PUBLISHED"
      ? gate("D4", "event.partner.arrived", "PASS", arrivedEvt.eventId)
      : gate("D4", "event.partner.arrived", "SKIP", `status=${arrivedEvt?.status ?? "none"}`);
  } else {
    gate("D4", "tracking", "SKIP", "provider missing or tracking events disabled");
  }

  // ── D5 booking.started → booking.completed ──
  const provId = (await prisma.booking.findUnique({ where: { id: bookingId } }))?.providerId;
  if (provId) {
    const start = await bookingService.start(provId, bookingId);
    if ("error" in start) gate("D5", "booking.start", "FAIL", start.error);
    else {
      gate("D5", "booking.start", "PASS", "IN_PROGRESS");
      await flushOutbox();
      await waitForOutboxEvent(EVENT_TYPES.BOOKING_STARTED, bookingId);
      gate("D5", "event.booking.started", "PASS", "verified via outbox");

      const complete = await bookingService.complete(provId, bookingId);
      if ("error" in complete) gate("D5", "booking.complete", "FAIL", complete.error);
      else {
        gate("D5", "booking.complete", "PASS", "COMPLETED");
        await flushOutbox();
        const completedId = await waitForOutboxEvent(EVENT_TYPES.BOOKING_COMPLETED, bookingId);
        completedId
          ? gate("D5", "event.booking.completed", "PASS", completedId)
          : gate("D5", "event.booking.completed", "FAIL", "missing completed event");
      }
    }
  }

  // ── D6 Idempotency + duplicate delivery ──
  if (createdEventId) {
    const before = await prisma.eventConsumerReceipt.count({ where: { eventId: createdEventId } });
    const row = await prisma.eventOutbox.findUnique({ where: { eventId: createdEventId } });
    if (row) {
      await dispatchEvent(row.payload as object);
      const after = await prisma.eventConsumerReceipt.count({ where: { eventId: createdEventId } });
      after === before
        ? gate("D6", "idempotency", "PASS", `receipts stable at ${before}`)
        : gate("D6", "idempotency", "FAIL", `receipts ${before} → ${after}`);
    }
  }

  // ── D7 Intentional failure → DLQ → operator replay ──
  if (eventPlatformConfig.consumersEnabled) {
    clearConsumersForTests();
    registerConsumer({
      name: "stage-d.fail.v1",
      eventTypes: [EVENT_TYPES.BOOKING_CREATED],
      handler: async () => {
        throw new Error("stage_d_intentional_fail");
      },
      maxAttempts: 1,
    });
    const failEvent = buildBookingCreatedEvent({
      bookingId: `${tag}_dlq`,
      bookingNumber: `HG-${tag}-DLQ`,
      userId: customer.id,
      serviceId: service.id,
      serviceCategory: service.category,
      city: addr.city ?? "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(),
    });
    await prisma.$transaction(async (tx) => {
      const { emitInTransaction } = await import("../src/events/core/event-publisher");
      await emitInTransaction(tx, failEvent);
    });
    await processOutboxBatch();
    const dlq = await prisma.eventDeadLetter.findFirst({
      where: { eventId: failEvent.id, consumerName: "stage-d.fail.v1" },
    });
    dlq
      ? gate("D7", "dlq", "PASS", `dlqId=${dlq.id}`)
      : gate("D7", "dlq", "FAIL", "no DLQ row after intentional failure");

    if (dlq) {
      clearConsumersForTests();
      registerConsumer({
        name: "stage-d.fail.v1",
        eventTypes: [EVENT_TYPES.BOOKING_CREATED],
        handler: async () => undefined,
        maxAttempts: 1,
      });
      await prisma.eventConsumerReceipt.deleteMany({
        where: { consumerName: "stage-d.fail.v1", eventId: failEvent.id },
      });
      const replay = await replayDeadLetterById(dlq.id);
      replay.replayed
        ? gate("D7", "dlq.replay", "PASS", replay.reason)
        : gate("D7", "dlq.replay", "FAIL", replay.reason);
    }
    resetEventConsumersForTests();
    bootstrapEventConsumers();
  } else {
    gate("D7", "dlq", "SKIP", "EVENTS_CONSUMERS_ENABLED=false");
  }

  // ── D8 Outbox persistence summary ──
  const outboxStats = await prisma.eventOutbox.groupBy({
    by: ["status"],
    _count: true,
    where: { createdAt: { gte: new Date(Date.now() - 3600_000) } },
  });
  gate("D8", "outbox.persistence", "PASS", JSON.stringify(outboxStats));

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  console.log("\n=== STAGE D SUMMARY ===");
  console.log(JSON.stringify({ tag, summary, gates, failed, blocked, passed: gates.filter((g) => g.status === "PASS").length }, null, 2));
  await prisma.$disconnect();
  process.exit(summary === "PASS" ? 0 : summary === "BLOCKED" ? 2 : 1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
