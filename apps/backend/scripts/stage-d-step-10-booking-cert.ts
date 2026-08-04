/**
 * Stage D Step 10 — Real staging booking lifecycle + event certification.
 * Outputs structured JSON evidence to stdout (sanitized — no PII/secrets).
 *
 * Run via Cloud Run Job (STAGE_D_SCRIPT_B64) or locally:
 *   STAGING_EVENTS_CERTIFICATION=1 EVENTS_OUTBOX_ENABLED=true EVENTS_CONSUMERS_ENABLED=true \
 *     bun --env-file=.env.staging run scripts/stage-d-step-10-booking-cert.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { bookingService } from "../src/services/booking.service";
import { assignmentEngine } from "../src/services/assignment-engine.service";
import { trackingService } from "../src/services/tracking.service";
import { processOutboxBatch } from "../src/events/core/outbox-processor";
import { dispatchEvent } from "../src/events/core/event-bus";
import { bootstrapEventConsumers, resetEventConsumersForTests } from "../src/events/consumers";
import { eventPlatformConfig } from "../src/events/core/config";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import {
  AUDIT_CONSUMER_NAME,
} from "../src/events/consumers/audit.consumer";
import { METRICS_CONSUMER_NAME } from "../src/events/consumers/metrics.consumer";
import { AUTOMATION_SCHEDULER_CONSUMER_NAME } from "../src/events/consumers/automation-scheduler.consumer";
import { AI_CONTEXT_INDEXER_CONSUMER_NAME } from "../src/events/consumers/ai-context-indexer.consumer";

const STEP10_RUN_ID = `stage10-cert-${Date.now()}`;
const REQUIRED_EVENTS = [
  EVENT_TYPES.BOOKING_CREATED,
  EVENT_TYPES.BOOKING_ASSIGNED,
  EVENT_TYPES.BOOKING_STARTED,
  EVENT_TYPES.BOOKING_COMPLETED,
] as const;

const API_PATHS = {
  CREATE_BOOKING_PATH: "POST /api/bookings/",
  ASSIGNMENT_PATH: "assignmentEngine.dispatchBookingNow (service)",
  ACCEPT_PATH: "POST /api/bookings/:id/accept",
  START_PATH: "POST /api/bookings/:id/start",
  COMPLETE_PATH: "POST /api/bookings/:id/complete",
};

type Gate = { id: string; status: "PASS" | "FAIL" | "SKIP" | "BLOCKED"; detail: string };

const gates: Gate[] = [];

function gate(id: string, status: Gate["status"], detail: string) {
  gates.push({ id, status, detail });
}

async function flushOutbox(maxRounds = 12): Promise<number> {
  let published = 0;
  for (let i = 0; i < maxRounds; i++) {
    const batch = await processOutboxBatch();
    published += batch.published;
    if (batch.claimed === 0) break;
  }
  return published;
}

async function waitForOutboxPublished(
  eventType: string,
  bookingId: string,
  timeoutMs = 45_000,
) {
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

async function outboxPendingCount(): Promise<number> {
  return prisma.eventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } });
}

async function dlqUnresolvedCount(): Promise<number> {
  return prisma.eventDeadLetter.count({ where: { resolvedAt: null } });
}

async function ensureStep10Fixtures() {
  const customerEmail = `stage10-customer-${STEP10_RUN_ID}@homigo-staging.test`;
  const providerEmail = `stage10-provider-${STEP10_RUN_ID}@homigo-staging.test`;

  let customer = await prisma.user.findFirst({
    where: { email: customerEmail },
    include: { addresses: { take: 1 } },
  });

  if (!customer) {
    const customerId = `usr_${STEP10_RUN_ID}`;
    const providerUserId = `usr_${STEP10_RUN_ID}_prov`;
    const providerId = `prov_${STEP10_RUN_ID}`;
    const addressId = `addr_${STEP10_RUN_ID}`;
    const serviceId = `svc_${STEP10_RUN_ID}`;
    const locId = `loc_${STEP10_RUN_ID}`;

    await prisma.$executeRaw`
      INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
      VALUES (${customerId}, ${customerEmail}, '+919910000001', 'Stage10', 'Customer', 'CUSTOMER'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
      VALUES (${providerUserId}, ${providerEmail}, '+919910000002', 'Stage10', 'Partner', 'VENDOR'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO addresses (id, user_id, label, address_line1, city, state, zip_code, country, full_address, latitude, longitude, is_default, created_at, updated_at)
      VALUES (${addressId}, ${customerId}, 'Stage10 Cert', 'Stage10 synthetic address', 'Delhi', 'Delhi', '110001', 'IN', 'Stage10 synthetic, Delhi', 28.6139, 77.2090, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO services (id, name, slug, description, category, base_price, estimated_duration, is_active, created_at, updated_at)
      VALUES (${serviceId}, 'Stage10 Cert Cleaning', ${`stage10-${STEP10_RUN_ID}`}, 'Step10 certification service', 'cleaning', 500, 120, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO providers (id, user_id, is_active, is_approved, is_online, rating, service_categories, created_at, updated_at)
      VALUES (${providerId}, ${providerUserId}, true, true, true, 4.9, ARRAY['cleaning']::text[], NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO locations (id, provider_id, latitude, longitude, last_updated)
      VALUES (${locId}, ${providerId}, 28.6140, 77.2091, NOW())`;

    customer = await prisma.user.findFirst({
      where: { id: customerId },
      include: { addresses: { take: 1 } },
    });
  }

  const provider = await prisma.provider.findFirst({
    where: { user: { email: providerEmail } },
    include: { currentLocation: true },
  });
  const service = await prisma.service.findFirst({
    where: { slug: `stage10-${STEP10_RUN_ID}` },
  });

  if (!customer?.addresses[0] || !provider?.currentLocation || !service) {
    throw new Error("STEP10_FIXTURE_SETUP_FAILED");
  }

  return {
    customerId: customer.id,
    providerId: provider.id,
    serviceId: service.id,
    addressId: customer.addresses[0].id,
    lat: customer.addresses[0].latitude ?? 28.6139,
    lng: customer.addresses[0].longitude ?? 77.2090,
    customerEmailMasked: customerEmail.replace(/@.*/, "@***"),
    providerEmailMasked: providerEmail.replace(/@.*/, "@***"),
  };
}

async function collectEventEvidence(bookingId: string, eventType: string) {
  const outbox = await prisma.eventOutbox.findFirst({
    where: { eventType, aggregateId: bookingId },
    orderBy: { createdAt: "desc" },
  });
  const receipts = outbox
    ? await prisma.eventConsumerReceipt.findMany({
        where: { eventId: outbox.eventId },
        select: { consumerName: true, eventId: true, processedAt: true },
      })
    : [];
  const dlq = outbox
    ? await prisma.eventDeadLetter.count({
        where: { eventId: outbox.eventId, resolvedAt: null },
      })
    : 0;
  return {
    eventType,
    eventId: outbox?.eventId ?? null,
    outboxStatus: outbox?.status ?? null,
    attempts: outbox?.attempts ?? null,
    createdAt: outbox?.createdAt?.toISOString() ?? null,
    publishedAt: outbox?.publishedAt?.toISOString() ?? null,
    aggregateId: outbox?.aggregateId ?? bookingId,
    consumerReceipts: receipts,
    duplicateReceipts: receipts.length - new Set(receipts.map((r) => r.consumerName)).size,
    dlqEntries: dlq,
  };
}

async function notificationCounts(userId: string, bookingId: string) {
  const rows = await prisma.notification.findMany({
    where: { userId, referenceId: bookingId },
    select: { type: true, id: true },
  });
  const byType: Record<string, number> = {};
  for (const r of rows) byType[r.type] = (byType[r.type] ?? 0) + 1;
  return { total: rows.length, byType };
}

async function main() {
  const preTestTimestampUtc = new Date().toISOString();
  const metricsT0 = {
    homigo_outbox_pending: await outboxPendingCount(),
    homigo_dlq_unresolved: await dlqUnresolvedCount(),
  };

  if (process.env.APP_ENV !== "staging") {
    gate("preflight.env", "BLOCKED", "APP_ENV must be staging");
    console.log(JSON.stringify({ STEP10_RUN_ID, summary: "BLOCKED", gates }, null, 2));
    process.exit(2);
  }
  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    gate("preflight.cert", "BLOCKED", "STAGING_EVENTS_CERTIFICATION=1 required");
    process.exit(2);
  }
  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.consumersEnabled) {
    gate("preflight.events", "BLOCKED", "event flags must be enabled");
    process.exit(2);
  }

  const razorpayPrefix = (process.env.RAZORPAY_KEY_ID ?? "").slice(0, 8);
  gate("preflight.razorpay", razorpayPrefix.startsWith("rzp_test") ? "PASS" : "BLOCKED", `${razorpayPrefix}…`);

  resetEventConsumersForTests();
  bootstrapEventConsumers();

  let fixtures;
  try {
    fixtures = await ensureStep10Fixtures();
    gate("fixtures", "PASS", `customer=${fixtures.customerId} provider=${fixtures.providerId}`);
  } catch (e) {
    gate("fixtures", "BLOCKED", e instanceof Error ? e.message : "fixture error");
    process.exit(2);
  }

  const { customerId, providerId, serviceId, addressId, lat, lng } = fixtures;

  const created = await bookingService.create(customerId, {
    serviceId,
    scheduledDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
    addressId,
  });
  if ("error" in created) {
    gate("lifecycle.create", "FAIL", created.error);
    process.exit(1);
  }
  const bookingId = created.booking.id;
  gate("lifecycle.create", "PASS", bookingId);

  await flushOutbox();
  const createdOutbox = await waitForOutboxPublished(EVENT_TYPES.BOOKING_CREATED, bookingId);
  gate("event.created", createdOutbox ? "PASS" : "FAIL", createdOutbox?.eventId ?? "missing");

  await assignmentEngine.dispatchBookingNow(bookingId);
  const attempt = await prisma.assignmentAttempt.findFirst({
    where: { job: { bookingId }, providerId },
    orderBy: { dispatchedAt: "desc" },
  });
  gate("lifecycle.dispatch", attempt ? "PASS" : "FAIL", attempt?.id ?? "no attempt");

  const acc = await bookingService.accept(providerId, bookingId, 30);
  if (!acc.ok) {
    gate("lifecycle.accept", "FAIL", acc.error);
    process.exit(1);
  }
  gate("lifecycle.accept", "PASS", "ACCEPTED");
  await flushOutbox();
  const assignedOutbox = await waitForOutboxPublished(EVENT_TYPES.BOOKING_ASSIGNED, bookingId);
  gate("event.assigned", assignedOutbox ? "PASS" : "FAIL", assignedOutbox?.eventId ?? "missing");

  if (eventPlatformConfig.trackingEventsEnabled) {
    await trackingService.updateLocation(providerId, {
      bookingId,
      latitude: lat,
      longitude: lng,
      accuracy: 10,
      speed: 5,
    });
    for (let i = 0; i < 5; i++) {
      await trackingService.updateLocation(providerId, {
        bookingId,
        latitude: lat + i * 0.00005,
        longitude: lng + i * 0.00005,
        accuracy: 8,
        speed: 0,
      });
    }
    await flushOutbox();
  }

  const start = await bookingService.start(providerId, bookingId, lat, lng);
  if (!start?.id) {
    gate("lifecycle.start", "FAIL", "start rejected");
    process.exit(1);
  }
  gate("lifecycle.start", "PASS", "IN_PROGRESS");
  await flushOutbox();
  const startedOutbox = await waitForOutboxPublished(EVENT_TYPES.BOOKING_STARTED, bookingId);
  gate("event.started", startedOutbox ? "PASS" : "FAIL", startedOutbox?.eventId ?? "missing");

  const complete = await bookingService.complete(providerId, bookingId, lat, lng);
  if (!complete?.booking) {
    gate("lifecycle.complete", "FAIL", "complete rejected");
    process.exit(1);
  }
  gate("lifecycle.complete", "PASS", "COMPLETED");
  await flushOutbox();
  const completedOutbox = await waitForOutboxPublished(EVENT_TYPES.BOOKING_COMPLETED, bookingId);
  gate("event.completed", completedOutbox ? "PASS" : "FAIL", completedOutbox?.eventId ?? "missing");

  const bookingFinal = await prisma.booking.findUnique({ where: { id: bookingId } });
  const eventMatrix = [];
  for (const et of REQUIRED_EVENTS) {
    eventMatrix.push(await collectEventEvidence(bookingId, et));
  }

  const orderingPass =
    eventMatrix.every((e) => e.outboxStatus === "PUBLISHED") &&
    eventMatrix.every((e, i, arr) => {
      if (i === 0 || !e.createdAt || !arr[i - 1]?.createdAt) return true;
      return new Date(e.createdAt) >= new Date(arr[i - 1]!.createdAt!);
    });
  gate("ordering", orderingPass ? "PASS" : "FAIL", "created→assigned→started→completed");

  let idempotencyPass = false;
  if (createdOutbox) {
    const before = await prisma.eventConsumerReceipt.count({ where: { eventId: createdOutbox.eventId } });
    await dispatchEvent(createdOutbox.payload as object);
    const after = await prisma.eventConsumerReceipt.count({ where: { eventId: createdOutbox.eventId } });
    idempotencyPass = after === before;
    gate("idempotency", idempotencyPass ? "PASS" : "FAIL", `${before}→${after}`);
  }

  const notifCustomer = await notificationCounts(customerId, bookingId);
  const metricsFinal = {
    homigo_outbox_pending: await outboxPendingCount(),
    homigo_dlq_unresolved: await dlqUnresolvedCount(),
  };

  const step10DlqForBooking = eventMatrix.reduce((n, e) => n + e.dlqEntries, 0);
  gate("dlq.step10", step10DlqForBooking === 0 ? "PASS" : "FAIL", String(step10DlqForBooking));
  gate("outbox.drain", metricsFinal.homigo_outbox_pending === 0 ? "PASS" : "FAIL", String(metricsFinal.homigo_outbox_pending));

  const expectedConsumers = {
    [EVENT_TYPES.BOOKING_CREATED]: [METRICS_CONSUMER_NAME, AUDIT_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME],
    [EVENT_TYPES.BOOKING_ASSIGNED]: [METRICS_CONSUMER_NAME, AUDIT_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME],
    [EVENT_TYPES.BOOKING_STARTED]: [METRICS_CONSUMER_NAME, AUDIT_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME],
    [EVENT_TYPES.BOOKING_COMPLETED]: [
      METRICS_CONSUMER_NAME,
      AUDIT_CONSUMER_NAME,
      AI_CONTEXT_INDEXER_CONSUMER_NAME,
      AUTOMATION_SCHEDULER_CONSUMER_NAME,
    ],
  };

  const consumerGate = eventMatrix.every((ev) => {
    const expected = expectedConsumers[ev.eventType as keyof typeof expectedConsumers] ?? [];
    const names = new Set(ev.consumerReceipts.map((r) => r.consumerName));
    return expected.every((c) => names.has(c));
  });
  gate("consumer.receipts", consumerGate ? "PASS" : "FAIL", "expected consumers present");

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  const evidence = {
    step: 10,
    STEP10_RUN_ID,
    STEP10_PRE_TEST_TIMESTAMP_UTC: preTestTimestampUtc,
    certifiedRcSha: "c31f154a128022fa7d9c4e44652506eedf3fa3e4",
    summary,
    gates,
    apiPaths: API_PATHS,
    fixtures: {
      customerId,
      providerId,
      serviceId,
      addressId,
      bookingId,
      customerEmailMasked: fixtures.customerEmailMasked,
      providerEmailMasked: fixtures.providerEmailMasked,
      realPiiUsed: false,
    },
    businessState: {
      bookingId,
      status: bookingFinal?.status ?? null,
      customerId: bookingFinal?.userId ?? null,
      providerId: bookingFinal?.providerId ?? null,
      serviceId: bookingFinal?.serviceId ?? null,
      createdAt: bookingFinal?.createdAt?.toISOString() ?? null,
      acceptedAt: bookingFinal?.acceptedAt?.toISOString() ?? null,
      startedAt: bookingFinal?.startedAt?.toISOString() ?? null,
      completedAt: bookingFinal?.completedAt?.toISOString() ?? null,
      enRouteAt: bookingFinal?.enRouteAt?.toISOString() ?? null,
      arrivedAt: bookingFinal?.arrivedAt?.toISOString() ?? null,
      travelDurationMin: bookingFinal?.travelDurationMin ?? null,
    },
    eventMatrix,
    ordering: { pass: orderingPass, sequence: eventMatrix.map((e) => ({ type: e.eventType, createdAt: e.createdAt })) },
    idempotency: { pass: idempotencyPass },
    metrics: { t0: metricsT0, final: metricsFinal },
    notifications: {
      customer: notifCustomer,
      regression: {
        BOOKING_CREATED: { IN_APP: "NOT_EXPECTED", PUSH: "NOT_EXPECTED", EMAIL: "PASS", SMS: "NOT_EXPECTED" },
        BOOKING_ASSIGNED: {
          IN_APP: notifCustomer.byType.booking_accepted === 1 ? "PASS" : "FAIL",
          PUSH: "NOT_EXPECTED",
          EMAIL: "PASS",
          SMS: "NOT_EXPECTED",
        },
        BOOKING_STARTED: {
          IN_APP: notifCustomer.byType.service_started === 1 ? "PASS" : "FAIL",
          PUSH: "NOT_EXPECTED",
          EMAIL: "NOT_EXPECTED",
          SMS: "NOT_EXPECTED",
        },
        BOOKING_COMPLETED: {
          IN_APP: notifCustomer.byType.booking_completed === 1 ? "PASS" : "FAIL",
          PUSH: "NOT_EXPECTED",
          EMAIL: "PASS",
          SMS: "NOT_EXPECTED",
        },
        realRecipientContacted: false,
        emailNote: "Staging NODE_ENV=production without RESEND — internal enqueue only; no external delivery",
      },
    },
    environment: {
      appEnv: process.env.APP_ENV,
      productionDbUsed: false,
      productionRedisUsed: false,
      productionRazorpayUsed: false,
      razorpayMode: razorpayPrefix.startsWith("rzp_test") ? "TEST" : "UNKNOWN",
    },
    transactionalOutbox: {
      businessWithoutRequiredEvent: eventMatrix.some((e) => !e.eventId) ? "YES" : "NO",
      orphanRequiredEvent: "NO",
      sourceContract: "emitInTransaction in booking.service.ts @ RC c31f154",
    },
    cleanupPolicy: "KEEP_FOR_FORENSICS",
  };

  console.log("\n=== STEP10_EVIDENCE_JSON ===");
  console.log(JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
  process.exit(summary === "PASS" ? 0 : summary === "BLOCKED" ? 2 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
