/** Stage G — Single booking lifecycle workload (unique phones, stageGRunId marker). */
import prisma from "/app/src/lib/prisma.ts";
import { bookingService } from "/app/src/services/booking.service.ts";
import { assignmentEngine } from "/app/src/services/assignment-engine.service.ts";
import { trackingService } from "/app/src/services/tracking.service.ts";
import { processOutboxBatch } from "/app/src/events/core/outbox-processor.ts";
import { bootstrapEventConsumers, resetEventConsumersForTests } from "/app/src/events/consumers/index.ts";
import { eventPlatformConfig } from "/app/src/events/core/config.ts";
import { EVENT_TYPES } from "/app/src/events/catalog/event-types.ts";

const STAGE_G_RUN_ID = process.env.STAGE_G_RUN_ID ?? `stageG-${Date.now()}`;
const STAGE_G_SEQ = process.env.STAGE_G_SEQ ?? "0";
const runTag = STAGE_G_RUN_ID.replace(/[^a-zA-Z0-9]/g, "").slice(-12);
const phoneSuffix = `${runTag}${STAGE_G_SEQ}${String(Date.now()).slice(-4)}`;

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
  const customerEmail = `stageG-${STAGE_G_RUN_ID}-c${STAGE_G_SEQ}@homigo-staging.test`;
  const providerEmail = `stageG-${STAGE_G_RUN_ID}-p${STAGE_G_SEQ}@homigo-staging.test`;
  const customerPhone = `+9198${phoneSuffix}1`;
  const providerPhone = `+9198${phoneSuffix}2`;
  const customerId = `usrG_${phoneSuffix}_${STAGE_G_SEQ}`;
  const providerUserId = `usrGp_${phoneSuffix}_${STAGE_G_SEQ}`;
  const providerId = `provG_${phoneSuffix}_${STAGE_G_SEQ}`;
  const addressId = `addrG_${phoneSuffix}_${STAGE_G_SEQ}`;
  const serviceId = `svcG_${phoneSuffix}_${STAGE_G_SEQ}`;
  const locId = `locG_${phoneSuffix}_${STAGE_G_SEQ}`;
  const slug = `stageG-${STAGE_G_RUN_ID}-seq${STAGE_G_SEQ}-${phoneSuffix}`;
  const serviceName = `StageG Soak ${STAGE_G_RUN_ID} seq${STAGE_G_SEQ}`;

  await prisma.$executeRaw`
    INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
    VALUES (${customerId}, ${customerEmail}, ${customerPhone}, 'StageG', 'Customer', 'CUSTOMER'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
    VALUES (${providerUserId}, ${providerEmail}, ${providerPhone}, 'StageG', 'Partner', 'VENDOR'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO addresses (id, user_id, label, address_line1, city, state, zip_code, country, full_address, latitude, longitude, is_default, created_at, updated_at)
    VALUES (${addressId}, ${customerId}, 'StageG', 'Synthetic soak address', 'Delhi', 'Delhi', '110001', 'IN', 'StageG Delhi', 28.6139, 77.2090, true, NOW(), NOW())`;
  await prisma.$executeRaw`
    INSERT INTO services (id, name, slug, description, category, base_price, estimated_duration, is_active, created_at, updated_at)
    VALUES (${serviceId}, ${serviceName}, ${slug}, 'Stage G soak cert', 'cleaning', 500, 120, true, NOW(), NOW())`;
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
    console.log(JSON.stringify({ STAGE_G_RUN_ID, STAGE_G_SEQ, summary: "BLOCKED", reason: "staging cert env required" }));
    process.exit(2);
  }

  resetEventConsumersForTests();
  bootstrapEventConsumers();

  const { customerId, providerId, serviceId, addressId, lat, lng } = await ensureFixtures();

  const created = await bookingService.create(customerId, {
    serviceId,
    scheduledDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
    addressId,
  });
  if ("error" in created) {
    console.log(JSON.stringify({ STAGE_G_RUN_ID, STAGE_G_SEQ, summary: "FAIL", phase: "create", error: created.error }));
    process.exit(1);
  }
  const bookingId = created.booking.id;

  await flushOutbox();
  await waitForOutboxPublished(EVENT_TYPES.BOOKING_CREATED, bookingId);

  await assignmentEngine.dispatchBookingNow(bookingId);
  const acc = await bookingService.accept(providerId, bookingId, 30);
  if (!acc.ok) {
    console.log(JSON.stringify({ STAGE_G_RUN_ID, STAGE_G_SEQ, summary: "FAIL", phase: "accept", error: acc.error }));
    process.exit(1);
  }
  await flushOutbox();
  await waitForOutboxPublished(EVENT_TYPES.BOOKING_ASSIGNED, bookingId);

  if (eventPlatformConfig.trackingEventsEnabled) {
    await trackingService.updateLocation(providerId, { bookingId, latitude: lat, longitude: lng, accuracy: 10, speed: 5 });
  }

  const start = await bookingService.start(providerId, bookingId, lat, lng);
  if (!start?.id) {
    console.log(JSON.stringify({ STAGE_G_RUN_ID, STAGE_G_SEQ, summary: "FAIL", phase: "start" }));
    process.exit(1);
  }
  await flushOutbox();
  await waitForOutboxPublished(EVENT_TYPES.BOOKING_STARTED, bookingId);

  const complete = await bookingService.complete(providerId, bookingId, lat, lng);
  if (!complete?.booking) {
    console.log(JSON.stringify({ STAGE_G_RUN_ID, STAGE_G_SEQ, summary: "FAIL", phase: "complete" }));
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
        stage: "G",
        STAGE_G_RUN_ID,
        STAGE_G_SEQ,
        summary,
        BOOKING_ID: bookingId,
        EVENTS: eventMatrix,
        OUTBOX_PENDING: await prisma.eventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } }),
        DLQ: await prisma.eventDeadLetter.count({ where: { resolvedAt: null } }),
      },
      null,
      2,
    ),
  );

  const exitCode = summary === "PASS" ? 0 : 1;
  try {
    await prisma.$disconnect();
  } catch {
    /* cert teardown - avoid Prisma drop panic on Bun exit */
  }
  process.exit(exitCode);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
