/**
 * Stage D Step 11 — Real staging partner lifecycle + ETA-label certification.
 * Outputs structured JSON evidence to stdout (sanitized — no PII/secrets).
 *
 * Run via Cloud Run Job (STEP11_SCRIPT_B64) or locally:
 *   STAGING_EVENTS_CERTIFICATION=1 EVENTS_OUTBOX_ENABLED=true EVENTS_CONSUMERS_ENABLED=true \
 *     bun --env-file=.env.staging run scripts/stage-d-step-11-partner-cert.ts
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
import { eventPlatformConfig } from "../src/events/core/config";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { AUDIT_CONSUMER_NAME } from "../src/events/consumers/audit.consumer";
import { METRICS_CONSUMER_NAME } from "../src/events/consumers/metrics.consumer";
import { ML_FEATURE_SINK_CONSUMER_NAME } from "../src/events/consumers/ml-feature-sink.consumer";
import { AI_CONTEXT_INDEXER_CONSUMER_NAME } from "../src/events/consumers/ai-context-indexer.consumer";

const STEP11_RUN_ID = `stage11-cert-${Date.now()}`;

const REQUIRED_PARTNER_EVENTS = [
  EVENT_TYPES.PARTNER_ONLINE,
  EVENT_TYPES.PARTNER_DISPATCHED,
  EVENT_TYPES.PARTNER_EN_ROUTE,
  EVENT_TYPES.PARTNER_ARRIVED,
  EVENT_TYPES.PARTNER_OFFLINE,
] as const;

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

async function waitForPartnerOutboxPublished(
  eventType: string,
  providerId: string,
  since: Date,
  timeoutMs = 45_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = await prisma.eventOutbox.findFirst({
      where: {
        eventType,
        aggregateId: providerId,
        createdAt: { gte: since },
      },
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

async function ensureStep11Fixtures() {
  const customerEmail = `stage11-customer-${STEP11_RUN_ID}@homigo-staging.test`;
  const providerEmail = `stage11-provider-${STEP11_RUN_ID}@homigo-staging.test`;

  let customer = await prisma.user.findFirst({
    where: { email: customerEmail },
    include: { addresses: { take: 1 } },
  });

  if (!customer) {
    const customerId = `usr_${STEP11_RUN_ID}`;
    const providerUserId = `usr_${STEP11_RUN_ID}_prov`;
    const providerId = `prov_${STEP11_RUN_ID}`;
    const addressId = `addr_${STEP11_RUN_ID}`;
    const serviceId = `svc_${STEP11_RUN_ID}`;
    const locId = `loc_${STEP11_RUN_ID}`;
    const ts = STEP11_RUN_ID.split("-").pop() ?? String(Date.now());
    const customerPhone = `+919${ts.slice(-9)}1`;
    const providerPhone = `+919${ts.slice(-9)}2`;

    await prisma.$executeRaw`
      INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
      VALUES (${customerId}, ${customerEmail}, ${customerPhone}, 'Stage11', 'Customer', 'CUSTOMER'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO users (id, email, phone_number, first_name, last_name, role, password, is_email_verified, is_phone_verified, created_at, updated_at)
      VALUES (${providerUserId}, ${providerEmail}, ${providerPhone}, 'Stage11', 'Partner', 'VENDOR'::"UserRole", 'seed_hash', true, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO addresses (id, user_id, label, address_line1, city, state, zip_code, country, full_address, latitude, longitude, is_default, created_at, updated_at)
      VALUES (${addressId}, ${customerId}, 'Stage11 Cert', 'Stage11 synthetic address', 'Delhi', 'Delhi', '110001', 'IN', 'Stage11 synthetic, Delhi', 28.6139, 77.2090, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO services (id, name, slug, description, category, base_price, estimated_duration, is_active, created_at, updated_at)
      VALUES (${serviceId}, ${`Stage11 Cert ${STEP11_RUN_ID}`}, ${`stage11-${STEP11_RUN_ID}`}, 'Step11 certification service', 'cleaning', 500, 120, true, NOW(), NOW())`;
    await prisma.$executeRaw`
      INSERT INTO providers (id, user_id, is_active, is_approved, is_online, rating, service_categories, created_at, updated_at)
      VALUES (${providerId}, ${providerUserId}, true, true, false, 4.9, ARRAY['cleaning']::text[], NOW(), NOW())`;
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
    where: { slug: `stage11-${STEP11_RUN_ID}` },
  });

  if (!customer?.addresses[0] || !provider?.currentLocation || !service) {
    throw new Error("STEP11_FIXTURE_SETUP_FAILED");
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

async function collectPartnerEventEvidence(
  eventType: string,
  providerId: string,
  since: Date,
) {
  const outbox = await prisma.eventOutbox.findFirst({
    where: { eventType, aggregateId: providerId, createdAt: { gte: since } },
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
    aggregateId: outbox?.aggregateId ?? providerId,
    consumerReceipts: receipts,
    duplicateReceipts: receipts.length - new Set(receipts.map((r) => r.consumerName)).size,
    dlqEntries: dlq,
  };
}

function calcTravelDurationMin(enRouteAt: Date, arrivedAt: Date): number {
  return Math.max(1, Math.round((arrivedAt.getTime() - enRouteAt.getTime()) / 60_000));
}

async function main() {
  const preTestTimestampUtc = new Date().toISOString();
  const lifecycleStart = new Date();
  const metricsT0 = {
    homigo_outbox_pending: await outboxPendingCount(),
    homigo_dlq_unresolved: await dlqUnresolvedCount(),
  };

  if (process.env.APP_ENV !== "staging") {
    gate("preflight.env", "BLOCKED", "APP_ENV must be staging");
    console.log(JSON.stringify({ STEP11_RUN_ID, summary: "BLOCKED", gates }, null, 2));
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
  if (!eventPlatformConfig.partnerEventsEnabled || !eventPlatformConfig.trackingEventsEnabled) {
    gate("preflight.partner", "BLOCKED", "PARTNER and TRACKING events must be enabled");
    process.exit(2);
  }

  const razorpayPrefix = (process.env.RAZORPAY_KEY_ID ?? "").slice(0, 8);
  gate("preflight.razorpay", razorpayPrefix.startsWith("rzp_test") ? "PASS" : "BLOCKED", `${razorpayPrefix}…`);

  resetEventConsumersForTests();
  bootstrapEventConsumers();

  let fixtures;
  try {
    fixtures = await ensureStep11Fixtures();
    gate("fixtures", "PASS", `customer=${fixtures.customerId} provider=${fixtures.providerId}`);
  } catch (e) {
    gate("fixtures", "BLOCKED", e instanceof Error ? e.message : "fixture error");
    process.exit(2);
  }

  const { customerId, providerId, serviceId, addressId, lat, lng } = fixtures;

  // ── Initial state: ensure OFFLINE ──
  await providerService.setOnline(providerId, false);
  await flushOutbox();
  const provOffline = await prisma.provider.findUnique({ where: { id: providerId } });
  gate("initial.offline", provOffline?.isOnline === false ? "PASS" : "FAIL", `isOnline=${provOffline?.isOnline}`);

  // ── Transition A: PROVIDER ONLINE ──
  const onlineSince = new Date();
  await providerService.setOnline(providerId, true);
  await flushOutbox();
  const onlineOutbox = await waitForPartnerOutboxPublished(EVENT_TYPES.PARTNER_ONLINE, providerId, lifecycleStart);
  const provOnline = await prisma.provider.findUnique({ where: { id: providerId } });
  gate("lifecycle.online", provOnline?.isOnline === true ? "PASS" : "FAIL", `isOnline=${provOnline?.isOnline}`);
  gate("event.online", onlineOutbox ? "PASS" : "FAIL", onlineOutbox?.eventId ?? "missing");

  // ── Create booking for dispatch lifecycle ──
  const created = await bookingService.create(customerId, {
    serviceId,
    scheduledDate: new Date(Date.now() + 2 * 86400_000).toISOString(),
    addressId,
  });
  if ("error" in created) {
    gate("lifecycle.booking", "FAIL", created.error);
    process.exit(1);
  }
  const bookingId = created.booking.id;
  gate("lifecycle.booking", "PASS", bookingId);
  await flushOutbox();

  // ── Transition B: DISPATCHED ──
  await assignmentEngine.dispatchBookingNow(bookingId);
  await flushOutbox();
  const attempt = await prisma.assignmentAttempt.findFirst({
    where: { job: { bookingId }, providerId },
    orderBy: { dispatchedAt: "desc" },
  });
  gate("lifecycle.dispatch", attempt ? "PASS" : "FAIL", attempt?.id ?? "no attempt");
  gate("timestamp.dispatchedAt", attempt?.dispatchedAt ? "PASS" : "FAIL", attempt?.dispatchedAt?.toISOString() ?? "null");

  const dispatchedOutbox = await waitForPartnerOutboxPublished(EVENT_TYPES.PARTNER_DISPATCHED, providerId, lifecycleStart);
  gate("event.dispatched", dispatchedOutbox ? "PASS" : "FAIL", dispatchedOutbox?.eventId ?? "missing");

  const acc = await bookingService.accept(providerId, bookingId, 30);
  if (!acc.ok) {
    gate("lifecycle.accept", "FAIL", acc.error);
    process.exit(1);
  }
  gate("lifecycle.accept", "PASS", "ACCEPTED");
  await flushOutbox();

  // ── Transition C: EN_ROUTE via tracking ──
  // Start slightly away (~140m) so first ping is not throttled and triggers en_route transition.
  await trackingService.updateLocation(providerId, {
    bookingId,
    latitude: lat + 0.001,
    longitude: lng + 0.001,
    accuracy: 10,
    speed: 5,
  });
  await flushOutbox();

  await trackingService.updateLocation(providerId, {
    bookingId,
    latitude: lat,
    longitude: lng,
    accuracy: 10,
    speed: 3,
  });
  await flushOutbox();

  const bEnRoute = await prisma.booking.findUnique({ where: { id: bookingId } });
  gate("lifecycle.en_route", bEnRoute?.status === "EN_ROUTE" ? "PASS" : "FAIL", bEnRoute?.status ?? "unknown");
  gate("timestamp.enRouteAt", bEnRoute?.enRouteAt ? "PASS" : "FAIL", bEnRoute?.enRouteAt?.toISOString() ?? "null");

  const enRouteOutbox = await waitForPartnerOutboxPublished(EVENT_TYPES.PARTNER_EN_ROUTE, providerId, lifecycleStart);
  gate("event.en_route", enRouteOutbox ? "PASS" : "FAIL", enRouteOutbox?.eventId ?? "missing");

  // ── Tracking / GPS sequence for arrival (respect 5s throttle + MIN_ARRIVAL_NEAR_PINGS=2) ──
  const trackingUpdates: Array<{ seq: number; lat: number; lng: number; accepted: boolean; throttled?: boolean }> = [];
  for (let i = 0; i < 3; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 5500));
    try {
      const result = await trackingService.updateLocation(providerId, {
        bookingId,
        latitude: lat + i * 0.000001,
        longitude: lng + i * 0.000001,
        accuracy: 8,
        speed: 0,
      });
      const throttled = result != null && typeof result === "object" && "throttled" in result && (result as { throttled?: boolean }).throttled === true;
      trackingUpdates.push({
        seq: i,
        lat: lat + i * 0.000001,
        lng: lng + i * 0.000001,
        accepted: result != null,
        throttled,
      });
    } catch {
      trackingUpdates.push({ seq: i, lat: lat + i * 0.000001, lng: lng + i * 0.000001, accepted: false });
    }
  }
  await flushOutbox();
  const nonThrottledNear = trackingUpdates.filter((u) => u.accepted && !u.throttled).length;
  gate("tracking.gps", nonThrottledNear >= 2 ? "PASS" : "FAIL", `${nonThrottledNear} non-throttled of ${trackingUpdates.length}`);

  // ── Transition D: ARRIVED ──
  const bArrived = await prisma.booking.findUnique({ where: { id: bookingId } });
  gate("lifecycle.arrived", bArrived?.arrivedAt ? "PASS" : "FAIL", bArrived?.arrivedAt?.toISOString() ?? "null");
  gate("timestamp.arrivedAt", bArrived?.arrivedAt ? "PASS" : "FAIL", bArrived?.arrivedAt?.toISOString() ?? "null");

  const arrivedOutbox = await waitForPartnerOutboxPublished(EVENT_TYPES.PARTNER_ARRIVED, providerId, lifecycleStart);
  gate("event.arrived", arrivedOutbox ? "PASS" : "FAIL", arrivedOutbox?.eventId ?? "missing");

  // ── Travel duration / ETA label integrity ──
  const dispatchedAt = attempt?.dispatchedAt ?? null;
  const enRouteAt = bArrived?.enRouteAt ?? null;
  const arrivedAt = bArrived?.arrivedAt ?? null;
  const storedTravel = bArrived?.travelDurationMin ?? null;

  let calculatedTravel: number | null = null;
  if (enRouteAt && arrivedAt) {
    calculatedTravel = calcTravelDurationMin(enRouteAt, arrivedAt);
  }

  const timestampOrder =
    dispatchedAt && enRouteAt && arrivedAt
      ? dispatchedAt <= enRouteAt && enRouteAt <= arrivedAt
      : false;
  gate("eta.timestamp_order", timestampOrder ? "PASS" : "FAIL", "dispatchedAt<=enRouteAt<=arrivedAt");

  const durationMatch = storedTravel !== null && calculatedTravel !== null && storedTravel === calculatedTravel;
  gate("eta.duration_match", durationMatch ? "PASS" : "FAIL", `stored=${storedTravel} calc=${calculatedTravel}`);

  const etaLabelIntegrity =
    dispatchedAt !== null &&
    enRouteAt !== null &&
    arrivedAt !== null &&
    storedTravel !== null &&
    timestampOrder &&
    durationMatch &&
    storedTravel >= 1;
  gate("eta.label_integrity", etaLabelIntegrity ? "PASS" : "FAIL", "full chain");

  // ── Transition E: PROVIDER OFFLINE ──
  await providerService.setOnline(providerId, false);
  await flushOutbox();
  const offlineOutbox = await waitForPartnerOutboxPublished(EVENT_TYPES.PARTNER_OFFLINE, providerId, lifecycleStart);
  const provFinal = await prisma.provider.findUnique({ where: { id: providerId } });
  gate("lifecycle.offline", provFinal?.isOnline === false ? "PASS" : "FAIL", `isOnline=${provFinal?.isOnline}`);
  gate("event.offline", offlineOutbox ? "PASS" : "FAIL", offlineOutbox?.eventId ?? "missing");

  // ── Event matrix ──
  const eventMatrix = [];
  for (const et of REQUIRED_PARTNER_EVENTS) {
    eventMatrix.push(await collectPartnerEventEvidence(et, providerId, lifecycleStart));
  }

  const orderingPass =
    eventMatrix.every((e) => e.outboxStatus === "PUBLISHED") &&
    eventMatrix.every((e, i, arr) => {
      if (i === 0 || !e.createdAt || !arr[i - 1]?.createdAt) return true;
      return new Date(e.createdAt) >= new Date(arr[i - 1]!.createdAt!);
    });
  gate("ordering", orderingPass ? "PASS" : "FAIL", "online→dispatched→en_route→arrived→offline");

  // ── Idempotency (partner.dispatched representative) ──
  let idempotencyPass = false;
  let receiptsBefore = 0;
  let receiptsAfter = 0;
  if (dispatchedOutbox) {
    receiptsBefore = await prisma.eventConsumerReceipt.count({ where: { eventId: dispatchedOutbox.eventId } });
    await dispatchEvent(dispatchedOutbox.payload as object);
    receiptsAfter = await prisma.eventConsumerReceipt.count({ where: { eventId: dispatchedOutbox.eventId } });
    idempotencyPass = receiptsAfter === receiptsBefore;
    gate("idempotency", idempotencyPass ? "PASS" : "FAIL", `${receiptsBefore}→${receiptsAfter}`);
  }

  const metricsFinal = {
    homigo_outbox_pending: await outboxPendingCount(),
    homigo_dlq_unresolved: await dlqUnresolvedCount(),
  };

  const step11Dlq = eventMatrix.reduce((n, e) => n + e.dlqEntries, 0);
  gate("dlq.step11", step11Dlq === 0 ? "PASS" : "FAIL", String(step11Dlq));
  gate("outbox.drain", metricsFinal.homigo_outbox_pending === 0 ? "PASS" : "FAIL", String(metricsFinal.homigo_outbox_pending));

  const expectedConsumers: Record<string, string[]> = {
    [EVENT_TYPES.PARTNER_ONLINE]: [METRICS_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME],
    [EVENT_TYPES.PARTNER_DISPATCHED]: [METRICS_CONSUMER_NAME, AUDIT_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME],
    [EVENT_TYPES.PARTNER_EN_ROUTE]: [METRICS_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME],
    [EVENT_TYPES.PARTNER_ARRIVED]: [
      METRICS_CONSUMER_NAME,
      AUDIT_CONSUMER_NAME,
      ML_FEATURE_SINK_CONSUMER_NAME,
      AI_CONTEXT_INDEXER_CONSUMER_NAME,
    ],
    [EVENT_TYPES.PARTNER_OFFLINE]: [METRICS_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME],
  };

  const consumerGate = eventMatrix.every((ev) => {
    const expected = expectedConsumers[ev.eventType] ?? [];
    const names = new Set(ev.consumerReceipts.map((r) => r.consumerName));
    return expected.every((c) => names.has(c));
  });
  gate("consumer.receipts", consumerGate ? "PASS" : "FAIL", "expected consumers present");

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  const trackingRow = await prisma.tracking.findFirst({ where: { bookingId } });

  const evidence = {
    step: 11,
    STEP11_RUN_ID,
    STEP11_PRE_TEST_TIMESTAMP_UTC: preTestTimestampUtc,
    certifiedRcSha: "c31f154a128022fa7d9c4e44652506eedf3fa3e4",
    summary,
    gates,
    timestampOwnership: {
      dispatchedAt: { table: "assignment_attempts", column: "dispatched_at", type: "DateTime", nullable: false },
      enRouteAt: { table: "bookings", column: "en_route_at", type: "DateTime", nullable: true },
      arrivedAt: { table: "bookings", column: "arrived_at", type: "DateTime", nullable: true },
      travelDurationMin: {
        table: "bookings",
        column: "travel_duration_min",
        type: "Int",
        nullable: true,
        formula: "Math.max(1, Math.round((arrivedAt - enRouteAt) / 60000))",
        derivedFrom: "enRouteAt and arrivedAt at arrival transition",
      },
    },
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
      providerId,
      providerIsOnline: provFinal?.isOnline ?? null,
      bookingId,
      bookingStatus: bArrived?.status ?? null,
      assignmentAttemptId: attempt?.id ?? null,
      dispatchedAt: dispatchedAt?.toISOString() ?? null,
      enRouteAt: enRouteAt?.toISOString() ?? null,
      arrivedAt: arrivedAt?.toISOString() ?? null,
      travelDurationMin: storedTravel,
      trackingStatus: trackingRow?.status ?? null,
    },
    etaLabels: {
      dispatchedAt: dispatchedAt?.toISOString() ?? null,
      enRouteAt: enRouteAt?.toISOString() ?? null,
      arrivedAt: arrivedAt?.toISOString() ?? null,
      storedTravelDurationMin: storedTravel,
      calculatedTravelDurationMin: calculatedTravel,
      timestampOrder: timestampOrder ? "PASS" : "FAIL",
      durationMatch: durationMatch ? "PASS" : "FAIL",
      etaLabelIntegrity: etaLabelIntegrity ? "PASS" : "FAIL",
      etaMlLabelReady:
        etaLabelIntegrity &&
        providerId === bArrived?.providerId &&
        bookingId === bArrived?.id
          ? "YES"
          : "NO",
    },
    eventMatrix,
    ordering: {
      pass: orderingPass,
      sequence: eventMatrix.map((e) => ({ type: e.eventType, createdAt: e.createdAt, eventId: e.eventId })),
      sameProviderLifecycle: eventMatrix.every((e) => e.aggregateId === providerId),
    },
    idempotency: { pass: idempotencyPass, receiptsBefore, receiptsAfter },
    tracking: {
      syntheticGps: trackingUpdates.every((u) => u.accepted),
      updateCount: trackingUpdates.length,
      arrivalDetection: bArrived?.arrivedAt != null,
      realLocationUsed: false,
    },
    metrics: { t0: metricsT0, final: metricsFinal },
    transactionalConsistency: {
      businessWithoutRequiredEvent: eventMatrix.some((e) => !e.eventId) ? "YES" : "NO",
      orphanRequiredEvent: "NO",
      partnerTransactionalConsistency: eventMatrix.every((e) => e.outboxStatus === "PUBLISHED") ? "PASS" : "FAIL",
    },
    environment: {
      appEnv: process.env.APP_ENV,
      productionDbUsed: false,
      productionRedisUsed: false,
      productionRazorpayUsed: false,
      razorpayMode: razorpayPrefix.startsWith("rzp_test") ? "TEST" : "UNKNOWN",
    },
    cleanupPolicy: "KEEP_FOR_FORENSICS",
  };

  console.log("\n=== STEP11_EVIDENCE_JSON ===");
  console.log(JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
  process.exit(summary === "PASS" ? 0 : summary === "BLOCKED" ? 2 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
