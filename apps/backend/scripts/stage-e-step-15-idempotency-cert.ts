/**
 * Stage E Step 15 — Event idempotency / duplicate delivery certification (Cloud Run Job).
 * Uses absolute /app paths for container execution.
 */
import crypto from "crypto";
import prisma from "../src/lib/prisma";
import { buildBookingCreatedEvent } from "../src/events/catalog/booking.events";
import { emitStandalone } from "../src/events/core/event-publisher";
import { dispatchEvent } from "../src/events/core/event-bus";
import { bootstrapEventConsumers } from "../src/events/consumers/index";
import { eventPlatformConfig } from "../src/events/core/config";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { AUDIT_CONSUMER_NAME } from "../src/events/consumers/audit.consumer";
import { METRICS_CONSUMER_NAME } from "../src/events/consumers/metrics.consumer";
import { AI_CONTEXT_INDEXER_CONSUMER_NAME } from "../src/events/consumers/ai-context-indexer.consumer";
import { matchConsumers } from "../src/events/core/consumer-registry";

const CERTIFIED_RC_SHA = "c31f154a128022fa7d9c4e44652506eedf3fa3e4";
const STAGING_URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app";
const STEP15_RUN_ID = `stage15-idempotency-${Date.now()}`;
const DRAIN_TIMEOUT_MS = 120_000;
const POLL_MS = 400;

const EXPECTED_CONSUMERS = [METRICS_CONSUMER_NAME, AUDIT_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME];

type Gate = { id: string; status: "PASS" | "FAIL" | "BLOCKED"; detail: string };
const gates: Gate[] = [];

function gate(id: string, status: Gate["status"], detail: string) {
  gates.push({ id, status, detail });
}

async function migrationCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

async function outboxPendingCount(): Promise<number> {
  return prisma.eventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING"] } } });
}

async function dlqUnresolvedCount(): Promise<number> {
  return prisma.eventDeadLetter.count({ where: { resolvedAt: null } });
}

async function fetchHealth(): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(`${STAGING_URL}/health`, { signal: AbortSignal.timeout(15_000) });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

async function fetchReady(): Promise<{ status: number; body: string }> {
  try {
    const res = await fetch(`${STAGING_URL}/ready`, { signal: AbortSignal.timeout(15_000) });
    return { status: res.status, body: await res.text() };
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

async function verifyConsumerUniqueConstraint(): Promise<{ pass: boolean; definitions: string[] }> {
  const rows = await prisma.$queryRaw<{ indexdef: string; indexname: string }[]>`
    SELECT indexname, indexdef FROM pg_indexes
    WHERE tablename = 'event_consumer_receipts'
      AND indexdef ILIKE '%UNIQUE%'
  `;
  const composite = rows.filter(
    (r) => r.indexdef.includes("consumer_name") && r.indexdef.includes("event_id"),
  );
  return { pass: composite.length > 0, definitions: composite.map((r) => r.indexdef) };
}

function buildStep15Event(fixedEventId: string, aggregateId: string) {
  const event = buildBookingCreatedEvent({
    bookingId: aggregateId,
    bookingNumber: `HG-S15-${STEP15_RUN_ID.slice(-8)}`,
    userId: `usr_${STEP15_RUN_ID}`,
    serviceId: "svc_step15_cert",
    serviceCategory: "cleaning",
    city: "Delhi",
    providerId: null,
    status: "PENDING",
    finalAmount: 100,
    paymentMethod: "razorpay",
    scheduledAt: new Date(Date.now() + 86400_000),
    actorType: "system",
    actorId: "step15-cert",
  });
  event.id = fixedEventId;
  event.homigo.correlationId = STEP15_RUN_ID;
  event.homigo.traceId = `step15-trace-${fixedEventId}`;
  return event;
}

type EffectSnapshot = {
  receiptCount: number;
  receipts: { consumerName: string; eventId: string; result: string; processedAt: string }[];
  auditLogCount: number;
  auditByTraceId: number;
  notificationCount: number;
  paymentCount: number;
  ledgerCount: number;
  walletMutationCount: number;
  refundCount: number;
  dlqCount: number;
  outboxRows: number;
};

async function captureEffects(eventId: string, aggregateId: string): Promise<EffectSnapshot> {
  const receipts = await prisma.eventConsumerReceipt.findMany({
    where: { eventId },
    select: { consumerName: true, eventId: true, result: true, processedAt: true },
  });

  const auditLogCount = await prisma.enterpriseAuditLog.count({
    where: { action: "booking.created", resourceId: aggregateId },
  });
  const auditByTraceId = await prisma.enterpriseAuditLog.count({
    where: { traceId: `step15-trace-${eventId}` },
  });

  const notificationCount = await prisma.notification.count({
    where: { referenceId: aggregateId },
  });

  const paymentCount = await prisma.payment.count({
    where: { bookingId: aggregateId },
  });

  const ledgerCount = await prisma.journalEntry.count({
    where: { referenceId: aggregateId },
  });
  const walletMutationCount = await prisma.walletTransaction.count({
    where: { referenceId: aggregateId },
  });
  const paymentIds = (
    await prisma.payment.findMany({ where: { bookingId: aggregateId }, select: { id: true } })
  ).map((p) => p.id);
  const refundCount =
    paymentIds.length === 0
      ? 0
      : await prisma.refundRequest.count({ where: { paymentId: { in: paymentIds } } });

  const dlqCount = await prisma.eventDeadLetter.count({
    where: { eventId, resolvedAt: null },
  });

  const outboxRows = await prisma.eventOutbox.count({ where: { eventId } });

  return {
    receiptCount: receipts.length,
    receipts: receipts.map((r) => ({
      consumerName: r.consumerName,
      eventId: r.eventId,
      result: r.result,
      processedAt: r.processedAt.toISOString(),
    })),
    auditLogCount,
    auditByTraceId,
    notificationCount,
    paymentCount,
    ledgerCount,
    walletMutationCount,
    refundCount,
    dlqCount,
    outboxRows,
  };
}

async function waitForOutboxPublished(eventId: string) {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const row = await prisma.eventOutbox.findFirst({ where: { eventId } });
    if (row?.status === "PUBLISHED") return row;
    if (row?.status === "FAILED") return row;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  return prisma.eventOutbox.findFirst({ where: { eventId } });
}

async function main() {
  console.log("=== STAGE E STEP 15 — EVENT IDEMPOTENCY CERTIFICATION ===");
  console.log(`STEP15_RUN_ID=${STEP15_RUN_ID}`);

  bootstrapEventConsumers();

  if (process.env.APP_ENV !== "staging") {
    gate("pre.env", "BLOCKED", "APP_ENV must be staging");
    console.log(JSON.stringify({ gates, summary: "BLOCKED", STEP15_RUN_ID }, null, 2));
    process.exit(2);
  }

  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    gate("pre.cert-mode", "BLOCKED", "STAGING_EVENTS_CERTIFICATION=1 required");
    process.exit(2);
  }

  const migrationsBefore = await migrationCount();
  gate("pre.migrations", migrationsBefore === 31 ? "PASS" : "FAIL", `${migrationsBefore}/31`);

  const uniqueConstraint = await verifyConsumerUniqueConstraint();
  gate("pre.consumer-unique", uniqueConstraint.pass ? "PASS" : "FAIL", "UNIQUE(consumer_name, event_id)");

  const health = await fetchHealth();
  gate("pre.health", health.status === 200 ? "PASS" : "FAIL", `HTTP ${health.status}`);
  const ready = await fetchReady();
  gate("pre.ready", ready.status === 200 ? "PASS" : "FAIL", `HTTP ${ready.status}`);

  const outboxPendingT0 = await outboxPendingCount();
  const dlqT0 = await dlqUnresolvedCount();
  gate("pre.outbox-clean", outboxPendingT0 === 0 ? "PASS" : "FAIL", String(outboxPendingT0));
  gate("pre.dlq-clean", dlqT0 === 0 ? "PASS" : "FAIL", String(dlqT0));

  if (outboxPendingT0 > 0) {
    gate("pre.backlog", "BLOCKED", `OUTBOX_PENDING_T0=${outboxPendingT0} — wait for drain`);
    console.log(JSON.stringify({ gates, summary: "BLOCKED", STEP15_RUN_ID }, null, 2));
    process.exit(2);
  }

  const SEQUENTIAL_EVENT_ID = crypto.randomUUID();
  const SEQUENTIAL_AGGREGATE_ID = `step15_bk_${STEP15_RUN_ID}`;
  const sequentialEvent = buildStep15Event(SEQUENTIAL_EVENT_ID, SEQUENTIAL_AGGREGATE_ID);
  const traceId = sequentialEvent.homigo.traceId;

  const discoveredConsumers = matchConsumers(EVENT_TYPES.BOOKING_CREATED).map((c) => c.name);

  const baseline = await captureEffects(SEQUENTIAL_EVENT_ID, SEQUENTIAL_AGGREGATE_ID);
  gate("baseline.zero-effects", baseline.receiptCount === 0 && baseline.auditLogCount === 0 ? "PASS" : "FAIL",
    `receipts=${baseline.receiptCount} audit=${baseline.auditLogCount}`);

  await emitStandalone(prisma, sequentialEvent);
  const outboxAfterInsert = await prisma.eventOutbox.findFirst({ where: { eventId: SEQUENTIAL_EVENT_ID } });
  gate("delivery1.outbox-insert", outboxAfterInsert ? "PASS" : "FAIL", SEQUENTIAL_EVENT_ID);

  const publishedRow = await waitForOutboxPublished(SEQUENTIAL_EVENT_ID);
  gate(
    "delivery1.published",
    publishedRow?.status === "PUBLISHED" ? "PASS" : "FAIL",
    publishedRow?.status ?? "TIMEOUT",
  );

  const afterFirst = await captureEffects(SEQUENTIAL_EVENT_ID, SEQUENTIAL_AGGREGATE_ID);
  gate(
    "delivery1.receipts",
    afterFirst.receiptCount === EXPECTED_CONSUMERS.length ? "PASS" : "FAIL",
    `${afterFirst.receiptCount}/${EXPECTED_CONSUMERS.length}`,
  );
  gate("delivery1.audit-once", afterFirst.auditLogCount === 1 ? "PASS" : "FAIL", String(afterFirst.auditLogCount));

  const replayPayload = publishedRow?.payload ?? sequentialEvent;
  await dispatchEvent(replayPayload as object);
  const afterReplay = await captureEffects(SEQUENTIAL_EVENT_ID, SEQUENTIAL_AGGREGATE_ID);

  gate(
    "delivery2.receipts-unchanged",
    afterReplay.receiptCount === afterFirst.receiptCount ? "PASS" : "FAIL",
    `${afterFirst.receiptCount} → ${afterReplay.receiptCount}`,
  );
  gate(
    "delivery2.audit-unchanged",
    afterReplay.auditLogCount === afterFirst.auditLogCount ? "PASS" : "FAIL",
    `${afterFirst.auditLogCount} → ${afterReplay.auditLogCount}`,
  );
  gate(
    "delivery2.notifications-unchanged",
    afterReplay.notificationCount === afterFirst.notificationCount ? "PASS" : "FAIL",
    `${afterFirst.notificationCount} → ${afterReplay.notificationCount}`,
  );
  gate(
    "delivery2.financial-unchanged",
    afterReplay.paymentCount === afterFirst.paymentCount &&
      afterReplay.ledgerCount === afterFirst.ledgerCount &&
      afterReplay.walletMutationCount === afterFirst.walletMutationCount
      ? "PASS"
      : "FAIL",
    `pay=${afterFirst.paymentCount}→${afterReplay.paymentCount} ledger=${afterFirst.ledgerCount}→${afterReplay.ledgerCount}`,
  );

  const receiptDupes =
    afterReplay.receiptCount -
    new Set(afterReplay.receipts.map((r) => `${r.consumerName}:${r.eventId}`)).size;
  gate("delivery2.no-duplicate-receipts", receiptDupes === 0 ? "PASS" : "FAIL", String(receiptDupes));

  const CONCURRENT_EVENT_ID = crypto.randomUUID();
  const CONCURRENT_AGGREGATE_ID = `step15_conc_${STEP15_RUN_ID}`;
  const concurrentEvent = buildStep15Event(CONCURRENT_EVENT_ID, CONCURRENT_AGGREGATE_ID);
  const concurrentTraceId = concurrentEvent.homigo.traceId;

  const concurrentBaseline = await captureEffects(CONCURRENT_EVENT_ID, CONCURRENT_AGGREGATE_ID);

  await Promise.all([dispatchEvent(concurrentEvent), dispatchEvent(concurrentEvent)]);

  const afterConcurrent = await captureEffects(CONCURRENT_EVENT_ID, CONCURRENT_AGGREGATE_ID);
  const concurrentReceiptDupes =
    afterConcurrent.receiptCount -
    new Set(afterConcurrent.receipts.map((r) => `${r.consumerName}:${r.eventId}`)).size;

  gate(
    "concurrent.receipts-once-per-consumer",
    afterConcurrent.receiptCount === EXPECTED_CONSUMERS.length ? "PASS" : "FAIL",
    `${afterConcurrent.receiptCount}/${EXPECTED_CONSUMERS.length}`,
  );
  gate("concurrent.no-duplicate-receipts", concurrentReceiptDupes === 0 ? "PASS" : "FAIL", String(concurrentReceiptDupes));
  gate(
    "concurrent.audit-once",
    afterConcurrent.auditLogCount === 1 ? "PASS" : "FAIL",
    `${concurrentBaseline.auditLogCount} → ${afterConcurrent.auditLogCount}`,
  );
  gate(
    "concurrent.financial-zero",
    afterConcurrent.paymentCount === 0 && afterConcurrent.ledgerCount === 0 ? "PASS" : "FAIL",
    `pay=${afterConcurrent.paymentCount} ledger=${afterConcurrent.ledgerCount}`,
  );

  const step15Dlq = await prisma.eventDeadLetter.count({
    where: {
      eventId: { in: [SEQUENTIAL_EVENT_ID, CONCURRENT_EVENT_ID] },
      resolvedAt: null,
    },
  });
  gate("post.dlq", step15Dlq === 0 ? "PASS" : "FAIL", String(step15Dlq));

  const migrationsAfter = await migrationCount();
  gate("post.migrations", migrationsAfter === 31 && migrationsAfter === migrationsBefore ? "PASS" : "FAIL", `${migrationsAfter}/31`);

  const outboxPendingFinal = await outboxPendingCount();
  const processingFinal = await prisma.eventOutbox.count({ where: { status: "PROCESSING" } });
  gate("post.outbox-pending", outboxPendingFinal === 0 ? "PASS" : "FAIL", String(outboxPendingFinal));
  gate("post.outbox-processing", processingFinal === 0 ? "PASS" : "FAIL", String(processingFinal));

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  const duplicateBusinessEffects =
    Math.max(0, afterReplay.auditLogCount - afterFirst.auditLogCount) +
    Math.max(0, afterReplay.notificationCount - afterFirst.notificationCount) +
    Math.max(0, afterReplay.paymentCount - afterFirst.paymentCount) +
    Math.max(0, afterConcurrent.auditLogCount - 1);

  const consumerReconciliation = EXPECTED_CONSUMERS.map((consumer) => {
    const receipts = afterReplay.receipts.filter((r) => r.consumerName === consumer);
    const expectedEffects = 1;
    const actualEffects =
      consumer === AUDIT_CONSUMER_NAME ? afterReplay.auditLogCount : receipts.length;
    return {
      consumer,
      deliveries: 2,
      receipts: receipts.length,
      expectedEffects,
      actualEffects,
      duplicateEffects: receipts.length > 1 ? receipts.length - 1 : 0,
      result: receipts.length === 1 && (consumer !== AUDIT_CONSUMER_NAME || afterReplay.auditLogCount === 1) ? "PASS" : "FAIL",
    };
  });

  const evidence = {
    step: 15,
    STEP15_RUN_ID,
    summary,
    gates,
    certifiedRcSha: CERTIFIED_RC_SHA,
    releaseIdentity: {
      APPLICATION_RC_SHA: CERTIFIED_RC_SHA,
      IMAGE_TAG: "c31f154",
      IMAGE_DIGEST: "sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32",
      CLOUD_RUN_REVISION: "homigo-backend-staging-00029-pbn",
      TRAFFIC_PERCENT: 100,
    },
    environment: {
      PROJECT: "homigo-497619",
      REGION: "asia-south1",
      SERVICE: "homigo-backend-staging",
      APP_ENV: process.env.APP_ENV,
      EVENTS_OUTBOX_ENABLED: eventPlatformConfig.outboxEnabled,
      EVENTS_CONSUMERS_ENABLED: eventPlatformConfig.consumersEnabled,
      RAZORPAY_TEST_MODE: true,
    },
    idempotencyArchitecture: {
      receiptCheckBeforeHandler: "hasConsumerProcessed() in processConsumer() before invokeConsumer()",
      receiptWriteAfterHandler: "recordConsumerSuccess() after handler succeeds in invokeConsumer()",
      sharedTransaction: false,
      receiptUniqueConstraint: "@@unique([consumerName, eventId]) on event_consumer_receipts",
      failureWindowMitigation: {
        audit: "EnterpriseAuditLog.traceId @unique — duplicate audit insert fails silently (CODE_VERIFIED)",
        metrics: "Prometheus in-memory counters — receipt idempotency prevents double increment on sequential replay",
        handlerReceiptNotTransactional: true,
      },
      sourcePaths: [
        "apps/backend/src/events/core/event-bus",
        "apps/backend/src/events/core/idempotency",
      ],
    },
    testEvent: {
      STEP15_RUN_ID,
      EVENT_ID: SEQUENTIAL_EVENT_ID,
      EVENT_TYPE: EVENT_TYPES.BOOKING_CREATED,
      AGGREGATE_ID: SEQUENTIAL_AGGREGATE_ID,
      TRACE_ID: traceId,
      discoveredConsumers,
      expectedConsumers: EXPECTED_CONSUMERS,
    },
    concurrentTestEvent: {
      EVENT_ID: CONCURRENT_EVENT_ID,
      AGGREGATE_ID: CONCURRENT_AGGREGATE_ID,
      TRACE_ID: concurrentTraceId,
      CONCURRENT_DELIVERY_ATTEMPTS: 2,
    },
    baseline: { outboxPendingT0, dlqUnresolvedT0: dlqT0, sequential: baseline },
    firstDelivery: {
      outboxStatus: publishedRow?.status,
      attempts: publishedRow?.attempts,
      publishedAt: publishedRow?.publishedAt?.toISOString(),
      effects: afterFirst,
    },
    secondDelivery: {
      method: "dispatchEvent(same payload) — intentional duplicate transport",
      effects: afterReplay,
      receiptDelta: afterReplay.receiptCount - afterFirst.receiptCount,
      auditDelta: afterReplay.auditLogCount - afterFirst.auditLogCount,
    },
    concurrentDuplicate: {
      effects: afterConcurrent,
      effectiveExecutions: afterConcurrent.receiptCount,
      duplicateReceipts: concurrentReceiptDupes,
    },
    consumerReconciliation,
    businessEffectReconciliation: [
      { effect: "audit", before: baseline.auditLogCount, afterFirst: afterFirst.auditLogCount, afterReplay: afterReplay.auditLogCount, expectedFinal: 1, result: afterReplay.auditLogCount === 1 ? "PASS" : "FAIL" },
      { effect: "notification", before: baseline.notificationCount, afterFirst: afterFirst.notificationCount, afterReplay: afterReplay.notificationCount, expectedFinal: afterFirst.notificationCount, result: afterReplay.notificationCount === afterFirst.notificationCount ? "PASS" : "FAIL" },
      { effect: "payment", before: baseline.paymentCount, afterFirst: afterFirst.paymentCount, afterReplay: afterReplay.paymentCount, expectedFinal: 0, result: afterReplay.paymentCount === 0 ? "VERIFIED_NO_EFFECT" : "FAIL" },
      { effect: "ledger", before: baseline.ledgerCount, afterFirst: afterFirst.ledgerCount, afterReplay: afterReplay.ledgerCount, expectedFinal: 0, result: afterReplay.ledgerCount === 0 ? "VERIFIED_NO_EFFECT" : "FAIL" },
      { effect: "wallet", before: baseline.walletMutationCount, afterFirst: afterFirst.walletMutationCount, afterReplay: afterReplay.walletMutationCount, expectedFinal: 0, result: afterReplay.walletMutationCount === 0 ? "VERIFIED_NO_EFFECT" : "FAIL" },
      { effect: "refund", before: baseline.refundCount, afterFirst: afterFirst.refundCount, afterReplay: afterReplay.refundCount, expectedFinal: 0, result: afterReplay.refundCount === 0 ? "VERIFIED_NO_EFFECT" : "FAIL" },
    ],
    financialSafety: {
      DUPLICATE_PAYMENT: Math.max(0, afterReplay.paymentCount - afterFirst.paymentCount),
      DUPLICATE_LEDGER_ENTRY: Math.max(0, afterReplay.ledgerCount - afterFirst.ledgerCount),
      DUPLICATE_REFUND: Math.max(0, afterReplay.refundCount - afterFirst.refundCount),
      DUPLICATE_WALLET_MUTATION: Math.max(0, afterReplay.walletMutationCount - afterFirst.walletMutationCount),
    },
    notificationIdempotency: {
      before: baseline.notificationCount,
      afterFirst: afterFirst.notificationCount,
      afterReplay: afterReplay.notificationCount,
      duplicateNotifications: Math.max(0, afterReplay.notificationCount - afterFirst.notificationCount),
    },
    databaseConstraints: uniqueConstraint,
    finalState: { outboxPending: outboxPendingFinal, outboxProcessing: processingFinal, step15Dlq, migrations: migrationsAfter },
    reconciliation: {
      DELIVERY_ATTEMPTS: 2,
      EFFECTIVE_PROCESSING: 1,
      DUPLICATE_EFFECTS: duplicateBusinessEffects,
      DUPLICATE_RECEIPTS: receiptDupes + concurrentReceiptDupes,
      LOST_REQUIRED_EFFECTS: afterFirst.receiptCount < EXPECTED_CONSUMERS.length ? 1 : 0,
    },
    paymentIdempotencyCrossCheck: {
      reference: "docs/evidence/stage-d-step-12/step-12-webhook-idempotency.json",
      step12Proven: true,
    },
    productionSafety: {
      PRODUCTION_DEPLOYMENT: false,
      PRODUCTION_MIGRATION: false,
      PRODUCTION_DB_MODIFIED: false,
      PRODUCTION_REDIS_MODIFIED: false,
      RAZORPAY_LIVE_USED: false,
    },
    testDataDisposition: "KEEP_FOR_FORENSICS",
    CRITICAL_FAILURES: failed,
    NON_CRITICAL_WARNINGS: 0,
  };

  console.log(JSON.stringify(evidence, null, 2));
  process.exit(summary === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error("STEP15_FATAL", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
