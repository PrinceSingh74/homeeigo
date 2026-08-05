/** Step 17 — Fresh booking lifecycle cert for permanent Prometheus/Grafana (unique phones per run). */
import prisma from "/app/src/lib/prisma.ts";
import { bookingService } from "/app/src/services/booking.service.ts";
import { assignmentEngine } from "/app/src/services/assignment-engine.service.ts";
import { trackingService } from "/app/src/services/tracking.service.ts";
import { processOutboxBatch } from "/app/src/events/core/outbox-processor.ts";
import { bootstrapEventConsumers, resetEventConsumersForTests } from "/app/src/events/consumers/index.ts";
import { eventPlatformConfig } from "/app/src/events/core/config.ts";
import { EVENT_TYPES } from "/app/src/events/catalog/event-types.ts";

const STEP17_RUN_ID = process.env.STEP17_RUN_ID ?? `stage17-${Date.now()}`;
const phoneSuffix = String(Date.now()).slice(-7);

const REQUIRED_EVENTS = [
  EVENT_TYPES.BOOKING_CREATED,
  EVENT_TYPES.BOOKING_ASSIGNED,
  EVENT_TYPES.BOOKING_STARTED,
  EVENT_TYPES.BOOKING_COMPLETED,
] as const;

async function flushOutbox(maxRounds = 12): Promise<number> {
  let published = 0;
  for (let i = 0; i < maxRounds; i++) {
    const batch = await processOutboxBatch();
    published += batch.published;
    if (batch.claimed === 0) break;
  }
  return published;
}

async function waitForOutboxPublished(eventType: string, bookingId: string, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.eventOutbox.findFirst({
      where: { eventType, aggregateId: bookingId },
      orderBy: { createdAt: "desc" },
    });
    if (row?.status === "PUBLISHED") return row;
    if (row?.status === "PENDING" || row?.status === "PROCESSING") await flushOutbox(3);
    await new Promise((r) => setTimeout(r, 400));
  }
  return null;
}

async function ensureFixtures() {
  const customerEmail = `stage17-${STEP17_RUN_ID}@homigo-staging.test`;
  const providerEmail = `stage17-prov-${STEP17_RUN_ID}@homigo-staging.test`;
  const customerPhone = `+9199${phoneSuffix}1`;
  const providerPhone = `+9199${phoneSuffix}2`;
  const customerId = `usr17_${phoneSuffix}`;
  const providerUserId = `usr17p_${phoneSuffix}`;
  const providerId = `prov17_${phoneSuffix}`;
  const addressId = `addr17_${phoneSuffix}`;
  const serviceId = `svc17_${phoneSuffix}`;
  const locId = `loc17_${phoneSuffix}`;
  const slug = `stage17-${phoneSuffix}`;

  await prisma.$executeRaw`
    INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
    VALUES (${customerId}, ${customerEmail}, ${customerPhone}, 'Stage17', 'Customer', 'CUSTOMER'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
    VALUES (${providerUserId}, ${providerEmail}, ${providerPhone}, 'Stage17', 'Partner', 'VENDOR'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO addresses (id, user_id, label, address_line1, city, state, zip_code, country, full_address, latitude, longitude, is_default, created_at, updated_at)
    VALUES (${addressId}, ${customerId}, 'Stage17', 'Synthetic cert address', 'Delhi', 'Delhi', '110001', 'IN', 'Stage17 Delhi', 28.6139, 77.2090, true, NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO services (id, name, slug, description, category, base_price, estimated_duration, is_active, created_at, updated_at)
    VALUES (${serviceId}, 'Stage17 Cert', ${slug}, 'Step17 permanent recert', 'cleaning', 500, 120, true, NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO providers (id, user_id, is_active, is_approved, is_online, rating, service_categories, created_at, updated_at)
    VALUES (${providerId}, ${providerUserId}, true, true, true, 4.9, ARRAY['cleaning']::text[], NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO locations (id, provider_id, latitude, longitude, last_updated)
    VALUES (${locId}, ${providerId}, 28.6140, 77.2091, NOW())`;

  return { customerId, providerId, serviceId, addressId, lat: 28.6139, lng: 77.2090 };
}

async function main() {
  if (process.env.APP_ENV !== "staging" || process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    console.log(JSON.stringify({ STEP17_RUN_ID, summary: "BLOCKED", reason: "staging cert env required" }));
    process.exit(2);
  }

  resetEventConsumersForTests();
  bootstrapEventConsumers();

  const metricsT0 = {
    note: "Prometheus baseline captured externally before job execution",
  };

  const { customerId, providerId, serviceId, addressId, lat, lng } = await ensureFixtures();

  const created = await bookingService.create(customerId, {
    serviceId,
    scheduledDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
    addressId,
  });
  if ("error" in created) {
    console.log(JSON.stringify({ STEP17_RUN_ID, summary: "FAIL", phase: "create", error: created.error }));
    process.exit(1);
  }
  const bookingId = created.booking.id;

  await flushOutbox();
  await waitForOutboxPublished(EVENT_TYPES.BOOKING_CREATED, bookingId);

  await assignmentEngine.dispatchBookingNow(bookingId);
  const acc = await bookingService.accept(providerId, bookingId, 30);
  if (!acc.ok) {
    console.log(JSON.stringify({ STEP17_RUN_ID, summary: "FAIL", phase: "accept", error: acc.error }));
    process.exit(1);
  }
  await flushOutbox();
  await waitForOutboxPublished(EVENT_TYPES.BOOKING_ASSIGNED, bookingId);

  if (eventPlatformConfig.trackingEventsEnabled) {
    await trackingService.updateLocation(providerId, { bookingId, latitude: lat, longitude: lng, accuracy: 10, speed: 5 });
  }

  const start = await bookingService.start(providerId, bookingId, lat, lng);
  if (!start?.id) {
    console.log(JSON.stringify({ STEP17_RUN_ID, summary: "FAIL", phase: "start" }));
    process.exit(1);
  }
  await flushOutbox();
  await waitForOutboxPublished(EVENT_TYPES.BOOKING_STARTED, bookingId);

  const complete = await bookingService.complete(providerId, bookingId, lat, lng);
  if (!complete?.booking) {
    console.log(JSON.stringify({ STEP17_RUN_ID, summary: "FAIL", phase: "complete" }));
    process.exit(1);
  }
  await flushOutbox();
  await waitForOutboxPublished(EVENT_TYPES.BOOKING_COMPLETED, bookingId);

  const eventMatrix = [];
  for (const et of REQUIRED_EVENTS) {
    const outbox = await prisma.eventOutbox.findFirst({
      where: { eventType: et, aggregateId: bookingId },
      orderBy: { createdAt: "desc" },
      select: { eventType: true, status: true, eventId: true, publishedAt: true },
    });
    eventMatrix.push(outbox);
  }

  const allPublished = eventMatrix.every((e) => e?.status === "PUBLISHED");
  const summary = allPublished ? "PASS" : "FAIL";

  console.log(
    JSON.stringify(
      {
        step: 17,
        STEP17_RUN_ID,
        summary,
        BOOKING_ID: bookingId,
        EVENTS: eventMatrix,
        metricsT0,
        OUTBOX_PENDING: await prisma.eventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
        DLQ: await prisma.eventDeadLetter.count({ where: { resolvedAt: null } }),
        FLAGS: { outbox: eventPlatformConfig.outboxEnabled, consumers: eventPlatformConfig.consumersEnabled },
      },
      null,
      2,
    ),
  );
  process.exit(summary === "PASS" ? 0 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
