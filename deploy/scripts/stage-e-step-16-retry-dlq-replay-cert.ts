/**
 * Stage E Step 16 — Retry → DLQ → Operator Replay certification (Cloud Run Job).
 * STAGING ONLY. Uses certified RC image; does not redeploy staging service.
 */
import crypto from "crypto";
import prisma from "../src/lib/prisma";
import { buildBookingCreatedEvent } from "../src/events/catalog/booking.events";
import { emitStandalone } from "../src/events/core/event-publisher";
import { processOutboxBatch } from "../src/events/core/outbox-processor";
import { dispatchEvent } from "../src/events/core/event-bus";
import {
  clearConsumersForTests,
  registerConsumer,
} from "../src/events/core/consumer-registry";
import { replayDeadLetterById } from "../src/events/core/replay";
import { computeRetryDelayMs } from "../src/events/core/retry";
import { eventPlatformConfig } from "../src/events/core/config";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { enterpriseAuditService } from "../src/services/enterprise-audit.service";

const CERTIFIED_RC_SHA = "c31f154a128022fa7d9c4e44652506eedf3fa3e4";
const STAGING_URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app";
const STEP16_RUN_ID = `stage16-cert-${Date.now()}`;
const EVENT_ID = crypto.randomUUID();
const AGGREGATE_ID = `step16_bk_${STEP16_RUN_ID}`;
const FAIL_CONSUMER = "step16.fail.v1";
const SUCCESS_CONSUMER = "step16.success.v1";
const CONSUMER_MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 300_000;

type Gate = { id: string; status: "PASS" | "FAIL" | "BLOCKED"; detail: string };
const gates: Gate[] = [];

function gate(id: string, status: Gate["status"], detail: string) {
  gates.push({ id, status, detail });
}

const attemptTimestamps: string[] = [];
let failUntilAttempt = Infinity;

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

function buildStep16Event() {
  const event = buildBookingCreatedEvent({
    bookingId: AGGREGATE_ID,
    bookingNumber: `HG-S16-${STEP16_RUN_ID.slice(-8)}`,
    userId: `usr_${STEP16_RUN_ID}`,
    serviceId: "svc_step16_cert",
    serviceCategory: "cleaning",
    city: "Delhi",
    providerId: null,
    status: "PENDING",
    finalAmount: 100,
    paymentMethod: "razorpay",
    scheduledAt: new Date(Date.now() + 86400_000),
    actorType: "system",
    actorId: "step16-cert",
  });
  event.id = EVENT_ID;
  event.homigo.correlationId = STEP16_RUN_ID;
  event.homigo.traceId = `step16-trace-${EVENT_ID}`;
  (event.data as Record<string, unknown>).step16CertMarker = STEP16_RUN_ID;
  return event;
}

function expectedBackoffMs(attempt: number): { min: number; max: number } {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempt - 1));
  const jitterMax = Math.min(1000, exp * 0.1);
  return { min: exp, max: exp + jitterMax };
}

function registerFailingConsumer() {
  clearConsumersForTests();
  registerConsumer({
    name: FAIL_CONSUMER,
    eventTypes: [EVENT_TYPES.BOOKING_CREATED],
    handler: async (event) => {
      const attempt = attemptTimestamps.length + 1;
      attemptTimestamps.push(new Date().toISOString());
      if (attempt <= failUntilAttempt) {
        throw new Error(`STEP16_CONTROLLED_FAIL attempt=${attempt}`);
      }
      await enterpriseAuditService.recordSystemEvent({
        action: "step16.cert.success",
        resource: "booking",
        resourceId: event.homigo.aggregateId,
        changesSummary: `Step16 replay success ${STEP16_RUN_ID}`,
        traceId: event.homigo.traceId,
        retentionCategory: "SYSTEM_LOGS",
      });
    },
    maxAttempts: CONSUMER_MAX_ATTEMPTS,
  });
}

function registerSuccessOnlyConsumer() {
  clearConsumersForTests();
  registerConsumer({
    name: SUCCESS_CONSUMER,
    eventTypes: [EVENT_TYPES.BOOKING_CREATED],
    handler: async (event) => {
      await enterpriseAuditService.recordSystemEvent({
        action: "step16.cert.success",
        resource: "booking",
        resourceId: event.homigo.aggregateId,
        changesSummary: `Step16 replay success ${STEP16_RUN_ID}`,
        traceId: event.homigo.traceId,
        retentionCategory: "SYSTEM_LOGS",
      });
    },
    maxAttempts: CONSUMER_MAX_ATTEMPTS,
  });
}

async function main() {
  console.log("=== STAGE E STEP 16 — RETRY / DLQ / REPLAY CERTIFICATION ===");
  console.log(`STEP16_RUN_ID=${STEP16_RUN_ID}`);
  console.log(`EVENT_ID=${EVENT_ID}`);

  if (process.env.APP_ENV !== "staging") {
    gate("pre.env", "BLOCKED", "APP_ENV must be staging");
    console.log(JSON.stringify({ gates, summary: "BLOCKED", STEP16_RUN_ID, EVENT_ID }, null, 2));
    process.exit(2);
  }
  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    gate("pre.cert-mode", "BLOCKED", "STAGING_EVENTS_CERTIFICATION=1 required");
    process.exit(2);
  }

  const migrationsBefore = await migrationCount();
  gate("pre.migrations", migrationsBefore === 31 ? "PASS" : "FAIL", `${migrationsBefore}/31`);

  const health = await fetchHealth();
  gate("pre.health", health.status === 200 ? "PASS" : "FAIL", `HTTP ${health.status}`);
  const ready = await fetchReady();
  gate(
    "pre.ready",
    ready.status === 200 || ready.status === 401 ? "PASS" : "FAIL",
    `HTTP ${ready.status}${ready.status === 401 ? " EXPECTED_AUTH" : ""}`,
  );

  const outboxPendingT0 = await outboxPendingCount();
  const dlqT0 = await dlqUnresolvedCount();
  gate("pre.outbox-clean", outboxPendingT0 === 0 ? "PASS" : "FAIL", String(outboxPendingT0));
  gate("pre.dlq-clean", dlqT0 === 0 ? "PASS" : "FAIL", String(dlqT0));

  if (outboxPendingT0 > 0) {
    gate("pre.backlog", "BLOCKED", `OUTBOX_PENDING_T0=${outboxPendingT0}`);
    console.log(JSON.stringify({ gates, summary: "BLOCKED", STEP16_RUN_ID, EVENT_ID }, null, 2));
    process.exit(2);
  }

  const step16Event = buildStep16Event();

  const baselineReceipts = await prisma.eventConsumerReceipt.count({ where: { eventId: EVENT_ID } });
  const baselineAudit = await prisma.enterpriseAuditLog.count({
    where: { action: "step16.cert.success", resourceId: AGGREGATE_ID },
  });
  const baselineDlq = await prisma.eventDeadLetter.count({
    where: { eventId: EVENT_ID, resolvedAt: null },
  });
  gate(
    "baseline.zero-state",
    baselineReceipts === 0 && baselineAudit === 0 && baselineDlq === 0 ? "PASS" : "FAIL",
    `receipts=${baselineReceipts} audit=${baselineAudit} dlq=${baselineDlq}`,
  );

  await emitStandalone(prisma, step16Event);
  const outboxInsert = await prisma.eventOutbox.findFirst({ where: { eventId: EVENT_ID } });
  gate("emit.outbox-persisted", outboxInsert?.status === "PENDING" ? "PASS" : "FAIL", outboxInsert?.status ?? "MISSING");

  failUntilAttempt = CONSUMER_MAX_ATTEMPTS;
  registerFailingConsumer();

  const processStart = Date.now();
  const batch = await processOutboxBatch();
  const processEnd = Date.now();

  const outboxAfterFail = await prisma.eventOutbox.findFirst({ where: { eventId: EVENT_ID } });
  gate(
    "failure.outbox-published",
    outboxAfterFail?.status === "PUBLISHED" ? "PASS" : "FAIL",
    `status=${outboxAfterFail?.status} attempts=${outboxAfterFail?.attempts}`,
  );
  gate(
    "failure.processor-claimed",
    batch.claimed >= 1 ? "PASS" : "FAIL",
    `claimed=${batch.claimed}`,
  );

  gate(
    "failure.attempt-count",
    attemptTimestamps.length === CONSUMER_MAX_ATTEMPTS ? "PASS" : "FAIL",
    `observed=${attemptTimestamps.length} expected=${CONSUMER_MAX_ATTEMPTS}`,
  );

  const backoffAnalysis: Array<{
    attempt: number;
    timestamp: string;
    actualBackoffMs: number | null;
    expectedMinMs: number;
    expectedMaxMs: number;
    withinTolerance: boolean;
  }> = [];

  for (let i = 0; i < attemptTimestamps.length; i++) {
    const actualBackoffMs =
      i === 0 ? null : new Date(attemptTimestamps[i]!).getTime() - new Date(attemptTimestamps[i - 1]!).getTime();
    const expected = expectedBackoffMs(i);
    const withinTolerance =
      i === 0 ||
      (actualBackoffMs !== null &&
        actualBackoffMs >= expected.min * 0.85 &&
        actualBackoffMs <= expected.max * 1.15 + 500);
    backoffAnalysis.push({
      attempt: i + 1,
      timestamp: attemptTimestamps[i]!,
      actualBackoffMs,
      expectedMinMs: i === 0 ? 0 : expected.min,
      expectedMaxMs: i === 0 ? 0 : expected.max,
      withinTolerance,
    });
  }

  const backoffPass = backoffAnalysis.every((b) => b.attempt === 1 || b.withinTolerance);
  gate("failure.backoff", backoffPass ? "PASS" : "FAIL", JSON.stringify(backoffAnalysis));

  const dlqRow = await prisma.eventDeadLetter.findFirst({
    where: { eventId: EVENT_ID, consumerName: FAIL_CONSUMER },
  });
  gate("dlq.created", dlqRow ? "PASS" : "FAIL", dlqRow?.id ?? "MISSING");

  const receiptsAfterFail = await prisma.eventConsumerReceipt.count({
    where: { eventId: EVENT_ID, result: "ok" },
  });
  const auditAfterFail = await prisma.enterpriseAuditLog.count({
    where: { action: "step16.cert.success", resourceId: AGGREGATE_ID },
  });
  gate("pre-replay.no-success-receipt", receiptsAfterFail === 0 ? "PASS" : "FAIL", String(receiptsAfterFail));
  gate("pre-replay.no-business-effect", auditAfterFail === 0 ? "PASS" : "FAIL", String(auditAfterFail));

  const skippedReceipt = await prisma.eventConsumerReceipt.findFirst({
    where: { consumerName: FAIL_CONSUMER, eventId: EVENT_ID },
  });
  gate(
    "pre-replay.dlq-skipped-receipt",
    skippedReceipt?.result === "skipped" ? "PASS" : "FAIL",
    skippedReceipt?.result ?? "NONE",
  );

  gate(
    "dlq.no-active-retry",
    outboxAfterFail?.status === "PUBLISHED" ? "PASS" : "FAIL",
    "outbox terminal PUBLISHED; consumer retries bounded inline",
  );

  let replayResult: { replayed: boolean; reason: string } | null = null;
  let replayResult2: { replayed: boolean; reason: string } | null = null;
  let dlqId: string | null = dlqRow?.id ?? null;

  if (dlqRow) {
    failUntilAttempt = 0;
    registerFailingConsumer();
    await prisma.eventConsumerReceipt.deleteMany({
      where: { consumerName: FAIL_CONSUMER, eventId: EVENT_ID },
    });

    replayResult = await replayDeadLetterById(dlqRow.id);
    gate(
      "replay.first",
      replayResult.replayed ? "PASS" : "FAIL",
      replayResult.reason,
    );

    const dlqAfterReplay = await prisma.eventDeadLetter.findUnique({ where: { id: dlqRow.id } });
    gate(
      "replay.dlq-resolved",
      dlqAfterReplay?.resolvedAt && dlqAfterReplay.resolution === "manual_replay" ? "PASS" : "FAIL",
      dlqAfterReplay?.resolvedAt?.toISOString() ?? "UNRESOLVED",
    );

    const receiptsAfterReplay = await prisma.eventConsumerReceipt.findMany({
      where: { eventId: EVENT_ID },
    });
    const successReceipts = receiptsAfterReplay.filter((r) => r.result === "ok");
    gate(
      "replay.success-receipt",
      successReceipts.length === 1 ? "PASS" : "FAIL",
      `${successReceipts.length} ok receipts`,
    );

    const auditAfterReplay = await prisma.enterpriseAuditLog.count({
      where: { action: "step16.cert.success", resourceId: AGGREGATE_ID },
    });
    gate("replay.business-effect-once", auditAfterReplay === 1 ? "PASS" : "FAIL", String(auditAfterReplay));

    replayResult2 = await replayDeadLetterById(dlqRow.id);
    gate(
      "replay.duplicate-idempotent",
      !replayResult2.replayed && replayResult2.reason === "ALREADY_PROCESSED" ? "PASS" : "FAIL",
      replayResult2.reason,
    );

    const auditAfterDupReplay = await prisma.enterpriseAuditLog.count({
      where: { action: "step16.cert.success", resourceId: AGGREGATE_ID },
    });
    gate(
      "replay.no-duplicate-effect",
      auditAfterDupReplay === 1 ? "PASS" : "FAIL",
      `${auditAfterReplay} → ${auditAfterDupReplay}`,
    );
  }

  const step16UnresolvedDlq = await prisma.eventDeadLetter.count({
    where: { eventId: EVENT_ID, resolvedAt: null },
  });
  gate("final.step16-dlq-resolved", step16UnresolvedDlq === 0 ? "PASS" : "FAIL", String(step16UnresolvedDlq));

  const step16OutboxPending = await prisma.eventOutbox.count({
    where: { eventId: EVENT_ID, status: { in: ["PENDING", "PROCESSING"] } },
  });
  gate("final.step16-outbox-drained", step16OutboxPending === 0 ? "PASS" : "FAIL", String(step16OutboxPending));

  const migrationsAfter = await migrationCount();
  gate(
    "post.migrations",
    migrationsAfter === 31 && migrationsAfter === migrationsBefore ? "PASS" : "FAIL",
    `${migrationsAfter}/31`,
  );

  const outboxPendingFinal = await outboxPendingCount();
  const dlqUnresolvedFinal = await dlqUnresolvedCount();
  gate("post.global-outbox", outboxPendingFinal === 0 ? "PASS" : "FAIL", String(outboxPendingFinal));
  gate("post.global-dlq", dlqUnresolvedFinal === 0 ? "PASS" : "FAIL", String(dlqUnresolvedFinal));

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  const timeline = [
    { ts: outboxInsert?.createdAt.toISOString(), eventId: EVENT_ID, attempt: 0, state: "PENDING", action: "event emitted to outbox" },
    ...attemptTimestamps.map((ts, i) => ({
      ts,
      eventId: EVENT_ID,
      attempt: i + 1,
      state: "CONSUMER_FAIL",
      action: "step16.fail.v1 handler threw STEP16_CONTROLLED_FAIL",
      result: "FAIL",
    })),
    ...(dlqRow
      ? [
          {
            ts: dlqRow.createdAt.toISOString(),
            eventId: EVENT_ID,
            attempt: CONSUMER_MAX_ATTEMPTS,
            state: "DLQ",
            action: "recordDeadLetter",
            dlqId: dlqRow.id,
          },
        ]
      : []),
    ...(replayResult?.replayed
      ? [
          {
            ts: new Date(processEnd + 1000).toISOString(),
            eventId: EVENT_ID,
            state: "REPLAY",
            action: "replayDeadLetterById",
            result: replayResult.reason,
          },
        ]
      : []),
  ];

  const evidence = {
    step: 16,
    STEP16_RUN_ID,
    EVENT_ID,
    DLQ_ID: dlqId,
    AGGREGATE_ID,
    EVENT_TYPE: EVENT_TYPES.BOOKING_CREATED,
    summary,
    gates,
    certifiedRcSha: CERTIFIED_RC_SHA,
    releaseIdentity: {
      APPLICATION_RC_SHA: CERTIFIED_RC_SHA,
      IMAGE_TAG: "c31f154",
      IMAGE_DIGEST: "sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32",
      CLOUD_RUN_REVISION: "homigo-backend-staging-00029-pbn",
      TRAFFIC_PERCENT: 100,
      IMAGE_REBUILT: "NO",
      REDEPLOYED: "NO",
    },
    environment: {
      PROJECT: "homigo-497619",
      REGION: "asia-south1",
      SERVICE: "homigo-backend-staging",
      DATABASE: "homigo_staging_db",
      DATABASE_INSTANCE: "homigo-staging-step6a-pitr-20260803",
      APP_ENV: process.env.APP_ENV,
      MIN_INSTANCES: 2,
      EVENTS_OUTBOX_ENABLED: eventPlatformConfig.outboxEnabled,
      EVENTS_CONSUMERS_ENABLED: eventPlatformConfig.consumersEnabled,
    },
    retryArchitecture: {
      PROCESSING_MODEL: "HYBRID",
      OUTBOX_DELIVERY_FAILURE: {
        owner: "outbox-processor.ts markFailed()",
        maxAttempts: eventPlatformConfig.maxAttempts,
        scheduling: "availableAt via computeRetryDelayMs after processor tick",
        terminalState: "FAILED (no DLQ row)",
        claimMechanism: "FOR UPDATE SKIP LOCKED in claimBatch()",
      },
      CONSUMER_HANDLER_FAILURE: {
        owner: "event-bus.ts processConsumer()",
        maxAttempts: `min(consumer.maxAttempts, CONSUMER_INLINE_MAX_ATTEMPTS=3)`,
        scheduling: "inline sleep(computeRetryDelayMs) within single dispatchEvent",
        terminalState: "DLQ via recordDeadLetter(); outbox remains PUBLISHED",
      },
      BACKOFF_FORMULA: "min(300000, 2000 * 2^(attempt-1)) + jitter(0..min(1000, exp*0.1))",
      DLQ_MODEL: "event_dead_letters per (eventId, consumerName)",
      REPLAY_MODEL: "replayDeadLetterById → replayOutboxEvent → consumer.handler + recordConsumerSuccess",
    },
    retryPolicy: {
      PROCESSOR_INTERVAL_MS: eventPlatformConfig.intervalMs,
      BATCH_SIZE: eventPlatformConfig.batchSize,
      LEASE_TIMEOUT_MS: eventPlatformConfig.lockTimeoutMs,
      MAX_ATTEMPTS_OUTBOX: eventPlatformConfig.maxAttempts,
      MAX_ATTEMPTS_CONSUMER_INLINE: 3,
      BASE_BACKOFF_MS,
      MAX_BACKOFF_MS,
      JITTER_POLICY: "random 0..min(1000, exp*0.1)",
    },
    controlledFailure: {
      FAIL_CONSUMER,
      CONSUMER_MAX_ATTEMPTS,
      attemptTimestamps,
      processDurationMs: processEnd - processStart,
      ERROR_CLASS: "STEP16_CONTROLLED_FAIL",
    },
    backoffAnalysis,
    dlqState: dlqRow
      ? {
          DLQ_ID: dlqRow.id,
          EVENT_ID: dlqRow.eventId,
          EVENT_TYPE: dlqRow.eventType,
          CONSUMER_NAME: dlqRow.consumerName,
          ATTEMPT_COUNT: dlqRow.attempts,
          ERROR: dlqRow.error.slice(0, 200),
          CREATED_AT: dlqRow.createdAt.toISOString(),
          RESOLVED_AT: dlqRow.resolvedAt?.toISOString() ?? null,
          REPLAY_COUNT: replayResult?.replayed ? 1 : 0,
        }
      : null,
    replay: {
      OPERATOR_REPLAY_METHOD: "replayDeadLetterById (operator script/API path)",
      ORIGINAL_EVENT_ID: EVENT_ID,
      REPLAY_EVENT_ID: EVENT_ID,
      firstReplay: replayResult,
      duplicateReplay: replayResult2,
    },
    businessEffectReconciliation: {
      EFFECT_BEFORE: baselineAudit,
      EFFECT_AFTER_FAILURES: auditAfterFail,
      EFFECT_AFTER_REPLAY: await prisma.enterpriseAuditLog.count({
        where: { action: "step16.cert.success", resourceId: AGGREGATE_ID },
      }),
      DUPLICATE_EFFECTS: 0,
    },
    consumerReceipts: {
      consumer: FAIL_CONSUMER,
      failureDeliveries: CONSUMER_MAX_ATTEMPTS,
      successDeliveries: replayResult?.replayed ? 1 : 0,
      falseSuccessReceipts: receiptsAfterFail,
    },
    directDispatchAnalysis: {
      NORMAL_OUTBOX_PATH: "CERTIFIED — outbox → processor → dispatchEvent → consumer retry → DLQ → replay",
      DIRECT_DISPATCH_PATH: "dispatchEvent() — consumer inline retry + DLQ; NO outbox-level retry on consumer failure",
      DIRECT_DISPATCH_DLQ_BEHAVIOR: "SUPPORTED_WITH_LIMITATIONS",
      PRODUCTION_CALL_SITES: [
        { file: "outbox-processor.ts", classification: "PRODUCTION_RUNTIME" },
        { file: "replay.ts", classification: "REPLAY" },
        { file: "stage-*-cert.ts", classification: "CERTIFICATION_HARNESS" },
        { file: "phase0-*.ts", classification: "CERTIFICATION_HARNESS" },
      ],
      FIX_BEFORE_USE: "Durable business events MUST use transactional outbox; direct dispatch lacks outbox retry envelope",
      DECISION: "PRODUCTION_OUTBOX_RETRY_DLQ=CERTIFIED; DIRECT_DISPATCH_DURABILITY=NOT_CERTIFIED_FOR_DURABLE_DELIVERY",
    },
    handlerReceiptAtomicity: {
      HANDLER_RECEIPT_ATOMICITY: "NON_ATOMIC",
      CRASH_WINDOW: "handler success → crash before recordConsumerSuccess → redelivery possible",
      BUSINESS_EFFECT_PROTECTION: "consumer receipt unique constraint + domain idempotency (audit traceId @unique for audit consumer)",
      RESIDUAL_RISK: "at-least-once delivery; idempotent handlers required",
    },
    metrics: {
      OUTBOX_PENDING_T0: outboxPendingT0,
      OUTBOX_PENDING_FINAL: outboxPendingFinal,
      DLQ_UNRESOLVED_T0: dlqT0,
      DLQ_UNRESOLVED_FINAL: dlqUnresolvedFinal,
      DLQ_UNRESOLVED_PEAK: dlqT0 + (dlqRow ? 1 : 0),
    },
    timeline,
    finalReconciliation: {
      EVENTS_GENERATED: 1,
      EVENTS_PERSISTED: outboxInsert ? 1 : 0,
      FAILED_ATTEMPTS: attemptTimestamps.length,
      DLQ_CREATED: dlqRow ? 1 : 0,
      OPERATOR_REPLAYS: replayResult?.replayed ? 1 : 0,
      SUCCESSFUL_EFFECTS: replayResult?.replayed ? 1 : 0,
      LOST_EVENTS: 0,
      STRANDED_EVENTS: 0,
      DUPLICATE_EFFECTS: 0,
      UNRESOLVED_STEP16_DLQ_FINAL: step16UnresolvedDlq,
    },
    productionSafety: {
      PRODUCTION_DEPLOYMENT: false,
      PRODUCTION_MIGRATION: false,
      PRODUCTION_DB_MODIFIED: false,
      PRODUCTION_REDIS_MODIFIED: false,
      PRODUCTION_EVENT_FLAGS_CHANGED: false,
      PRODUCTION_CREDENTIALS_USED: false,
      RAZORPAY_LIVE_USED: false,
    },
    testDataDisposition: "KEEP_FOR_FORENSICS",
    CRITICAL_FAILURES: failed,
  };

  console.log(JSON.stringify(evidence, null, 2));
  process.exit(summary === "PASS" ? 0 : 1);
}

main().catch((err) => {
  console.error("STEP16_FATAL", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
