/**
 * Stage E Step 13 — Multi-instance outbox concurrency, claiming &
 * exactly-once-effect certification.
 *
 * Inserts 20 synthetic outbox events then waits for DEPLOYED staging backend
 * instances to claim/process them. Does NOT call processOutboxBatch locally.
 *
 * Run via Cloud Run Job or locally:
 *   STAGING_EVENTS_CERTIFICATION=1 EVENTS_OUTBOX_ENABLED=true EVENTS_CONSUMERS_ENABLED=true \
 *     bun --env-file=.env.staging run scripts/stage-e-step-13-multi-instance-cert.ts
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { buildBookingCreatedEvent } from "../src/events/catalog/booking.events";
import { emitStandalone } from "../src/events/core/event-publisher";
import { eventPlatformConfig } from "../src/events/core/config";
import { EVENT_TYPES } from "../src/events/catalog/event-types";
import { AUDIT_CONSUMER_NAME } from "../src/events/consumers/audit.consumer";
import { METRICS_CONSUMER_NAME } from "../src/events/consumers/metrics.consumer";
import { AI_CONTEXT_INDEXER_CONSUMER_NAME } from "../src/events/consumers/ai-context-indexer.consumer";

const CERTIFIED_RC_SHA = "c31f154a128022fa7d9c4e44652506eedf3fa3e4";
const STEP13_RUN_ID = `stage13-multi-instance-${Date.now()}`;
const STAGING_URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app";
const EVENT_COUNT = 20;
const DRAIN_TIMEOUT_MS = 180_000;
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

async function verifyConsumerUniqueConstraint(): Promise<boolean> {
  const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
    SELECT indexdef FROM pg_indexes
    WHERE tablename = 'event_consumer_receipts'
      AND indexdef ILIKE '%UNIQUE%'
      AND indexdef ILIKE '%consumer_name%'
      AND indexdef ILIKE '%event_id%'
  `;
  return rows.length > 0;
}

async function createStep13Events(): Promise<{ eventIds: string[]; aggregateIds: string[] }> {
  const eventIds: string[] = [];
  const aggregateIds: string[] = [];

  for (let i = 0; i < EVENT_COUNT; i++) {
    const aggregateId = `step13_bk_${STEP13_RUN_ID}_${i}`;
    aggregateIds.push(aggregateId);
    const event = buildBookingCreatedEvent({
      bookingId: aggregateId,
      bookingNumber: `HG-S13-${i.toString().padStart(2, "0")}`,
      userId: `usr_step13_${i}`,
      serviceId: "svc_step13_cert",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(Date.now() + 86400_000),
      actorType: "system",
      actorId: "step13-cert",
    });
    event.homigo.correlationId = STEP13_RUN_ID;
    await emitStandalone(prisma, event);
    eventIds.push(event.id);
  }

  return { eventIds, aggregateIds };
}

type ClaimObservation = {
  eventId: string;
  lockedBy: string | null;
  status: string;
  observedAt: string;
  attempts: number;
};

async function waitForStagingDrain(eventIds: string[]) {
  const deadline = Date.now() + DRAIN_TIMEOUT_MS;
  const claimObservations: ClaimObservation[] = [];
  const seenProcessing = new Set<string>();
  let peakPending = 0;

  while (Date.now() < deadline) {
    const rows = await prisma.eventOutbox.findMany({
      where: { eventId: { in: eventIds } },
      select: {
        eventId: true,
        status: true,
        lockedBy: true,
        attempts: true,
        publishedAt: true,
        lastError: true,
        updatedAt: true,
        createdAt: true,
      },
    });

    const pending = rows.filter((r) => r.status === "PENDING" || r.status === "PROCESSING").length;
    peakPending = Math.max(peakPending, pending);

    for (const row of rows) {
      if (row.status === "PROCESSING" && row.lockedBy) {
        const key = `${row.eventId}:${row.lockedBy}`;
        if (!seenProcessing.has(key)) {
          seenProcessing.add(key);
          claimObservations.push({
            eventId: row.eventId,
            lockedBy: row.lockedBy,
            status: row.status,
            observedAt: new Date().toISOString(),
            attempts: row.attempts,
          });
        }
      }
    }

    const terminal = rows.filter((r) => r.status === "PUBLISHED" || r.status === "FAILED").length;
    if (terminal === EVENT_COUNT) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }

  const finalRows = await prisma.eventOutbox.findMany({
    where: { eventId: { in: eventIds } },
    select: {
      eventId: true,
      status: true,
      lockedBy: true,
      attempts: true,
      publishedAt: true,
      lastError: true,
      updatedAt: true,
      createdAt: true,
    },
  });

  return { finalRows, claimObservations, peakPending };
}

async function main() {
  console.log("=== STAGE E STEP 13 — MULTI-INSTANCE OUTBOX CERTIFICATION ===");
  console.log(`STEP13_RUN_ID=${STEP13_RUN_ID}`);
  console.log(`certifiedRcSha=${CERTIFIED_RC_SHA}`);
  console.log(`APP_ENV=${process.env.APP_ENV} DB=${process.env.DATABASE_URL?.split("/").pop()?.split("?")[0]}`);

  if (process.env.APP_ENV !== "staging") {
    gate("pre.env", "BLOCKED", "APP_ENV must be staging");
    console.log(JSON.stringify({ gates, summary: "BLOCKED", STEP13_RUN_ID }, null, 2));
    process.exit(2);
  }

  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    gate("pre.cert-mode", "BLOCKED", "STAGING_EVENTS_CERTIFICATION=1 required");
    process.exit(2);
  }

  if (!eventPlatformConfig.outboxEnabled) {
    gate("pre.outbox-flag", "BLOCKED", "EVENTS_OUTBOX_ENABLED must be true on staging service");
    process.exit(2);
  }

  try {
    await prisma.$queryRaw`SELECT 1 FROM event_outbox LIMIT 1`;
  } catch {
    gate("pre.schema", "BLOCKED", "event_outbox missing");
    process.exit(2);
  }

  const migrationsBefore = await migrationCount();
  gate("pre.migrations", migrationsBefore === 31 ? "PASS" : "FAIL", `${migrationsBefore}/31`);

  const uniqueEnforcement = await verifyConsumerUniqueConstraint();
  gate("pre.consumer-unique", uniqueEnforcement ? "PASS" : "FAIL", "event_consumer_receipts (consumer_name, event_id)");

  const health = await fetchHealth();
  gate(
    "pre.health",
    health.status === 200 && health.body.includes('"database":"ok"') ? "PASS" : "FAIL",
    `HTTP ${health.status}`,
  );

  const step13T0 = new Date().toISOString();
  const outboxPendingT0 = await outboxPendingCount();
  const dlqT0 = await dlqUnresolvedCount();

  const existingCounts = await prisma.eventOutbox.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  const statusBaseline = Object.fromEntries(existingCounts.map((r) => [r.status, r._count._all]));

  // ── Create exactly 20 events (batch, no local processing) ──
  const { eventIds, aggregateIds } = await createStep13Events();
  gate("events.generated", eventIds.length === EVENT_COUNT ? "PASS" : "FAIL", String(eventIds.length));
  gate("events.unique", new Set(eventIds).size === EVENT_COUNT ? "PASS" : "FAIL", String(new Set(eventIds).size));

  const persisted = await prisma.eventOutbox.count({ where: { eventId: { in: eventIds } } });
  gate("events.persisted", persisted === EVENT_COUNT ? "PASS" : "FAIL", String(persisted));

  // ── Wait for deployed staging processors (NOT local processOutboxBatch) ──
  const { finalRows, claimObservations, peakPending } = await waitForStagingDrain(eventIds);

  const claimMatrix = finalRows.map((row) => {
    const claim = claimObservations.find((c) => c.eventId === row.eventId);
    return {
      eventId: row.eventId,
      instanceOrWorker: claim?.lockedBy ?? null,
      claimTime: claim?.observedAt ?? null,
      attempts: row.attempts,
      finalStatus: row.status,
      publishedAt: row.publishedAt?.toISOString() ?? null,
      lastError: row.lastError ? row.lastError.slice(0, 200) : null,
    };
  });

  const published = finalRows.filter((r) => r.status === "PUBLISHED").length;
  const pendingFinal = finalRows.filter((r) => r.status === "PENDING").length;
  const processingFinal = finalRows.filter((r) => r.status === "PROCESSING").length;
  const failedFinal = finalRows.filter((r) => r.status === "FAILED").length;

  gate("process.terminal", published === EVENT_COUNT ? "PASS" : "FAIL", `${published}/${EVENT_COUNT} PUBLISHED`);
  gate("process.pending", pendingFinal === 0 ? "PASS" : "FAIL", String(pendingFinal));
  gate("process.processing", processingFinal === 0 ? "PASS" : "FAIL", String(processingFinal));
  gate("process.lost", finalRows.length === EVENT_COUNT ? "PASS" : "FAIL", `${finalRows.length}/${EVENT_COUNT}`);
  gate(
    "process.stranded",
    pendingFinal + processingFinal + failedFinal === 0 ? "PASS" : "FAIL",
    `pending=${pendingFinal} processing=${processingFinal} failed=${failedFinal}`,
  );

  // Claim distribution from observations
  const workerClaims = new Map<string, number>();
  for (const obs of claimObservations) {
    if (obs.lockedBy) workerClaims.set(obs.lockedBy, (workerClaims.get(obs.lockedBy) ?? 0) + 1);
  }
  const workerIds = [...workerClaims.keys()];
  const duplicateClaimEvents = claimObservations.reduce((acc, obs) => {
    acc[obs.eventId] = (acc[obs.eventId] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const uncontrolledDuplicateClaims = Object.values(duplicateClaimEvents).filter((c) => c > 1).length;
  gate("claims.exclusivity", uncontrolledDuplicateClaims === 0 ? "PASS" : "FAIL", String(uncontrolledDuplicateClaims));

  // Consumer receipts
  const receipts = await prisma.eventConsumerReceipt.findMany({
    where: { eventId: { in: eventIds } },
    select: { consumerName: true, eventId: true, result: true, processedAt: true },
  });
  const expectedReceipts = EVENT_COUNT * EXPECTED_CONSUMERS.length;
  const receiptDupes = receipts.length - new Set(receipts.map((r) => `${r.consumerName}:${r.eventId}`)).size;
  const missingReceipts: string[] = [];
  for (const eid of eventIds) {
    for (const consumer of EXPECTED_CONSUMERS) {
      if (!receipts.some((r) => r.eventId === eid && r.consumerName === consumer)) {
        missingReceipts.push(`${consumer}:${eid}`);
      }
    }
  }
  gate("consumers.receipts", missingReceipts.length === 0 ? "PASS" : "FAIL", `${receipts.length}/${expectedReceipts} missing=${missingReceipts.length}`);
  gate("consumers.duplicate", receiptDupes === 0 ? "PASS" : "FAIL", String(receiptDupes));

  // DLQ
  const step13Dlq = await prisma.eventDeadLetter.count({
    where: { eventId: { in: eventIds }, resolvedAt: null },
  });
  gate("dlq.step13", step13Dlq === 0 ? "PASS" : "FAIL", String(step13Dlq));

  // Attempts distribution
  const attempts1 = finalRows.filter((r) => r.attempts === 1).length;
  const attempts2 = finalRows.filter((r) => r.attempts === 2).length;
  const attemptsGt2 = finalRows.filter((r) => r.attempts > 2).length;
  gate("attempts.clean", attemptsGt2 === 0 && attempts2 === 0 ? "PASS" : attempts2 > 0 && attemptsGt2 === 0 ? "PASS" : "FAIL", `1=${attempts1} 2=${attempts2} >2=${attemptsGt2}`);

  const migrationsAfter = await migrationCount();
  gate("post.migrations", migrationsAfter === 31 && migrationsAfter === migrationsBefore ? "PASS" : "FAIL", `${migrationsAfter}/31`);

  const outboxPendingFinal = await outboxPendingCount();
  const dlqFinal = await dlqUnresolvedCount();

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  const evidence = {
    step: 13,
    STEP13_RUN_ID,
    STEP13_T0_UTC: step13T0,
    STEP13_T1_UTC: new Date().toISOString(),
    certifiedRcSha: CERTIFIED_RC_SHA,
    summary,
    gates,
    processingModel: "LEADER_SINGLE_ACTIVE_WITH_SKIP_LOCKED",
    processingModelNote:
      "runOutboxProcessorTick uses Redis leader lock (maintenance:event_outbox); claimBatch uses FOR UPDATE SKIP LOCKED within leader tick",
    eventGeneration: {
      count: EVENT_COUNT,
      eventType: EVENT_TYPES.BOOKING_CREATED,
      eventIds,
      aggregateIds,
      marker: STEP13_RUN_ID,
      method: "emitStandalone batch — no local processOutboxBatch",
    },
    baseline: {
      outboxPendingT0,
      dlqUnresolvedT0: dlqT0,
      statusBaseline,
    },
    claimMatrix,
    claimObservations,
    workerDistribution: Object.fromEntries(workerClaims),
    workerIdsObserved: workerIds,
    reconciliation: {
      generated: EVENT_COUNT,
      persisted,
      terminalSuccess: published,
      terminalFailed: failedFinal,
      finalPending: pendingFinal,
      finalProcessing: processingFinal,
      lost: EVENT_COUNT - finalRows.length,
      stranded: pendingFinal + processingFinal + failedFinal,
      uncontrolledDuplicateClaims,
      duplicateEffectiveProcessing: receiptDupes,
    },
    consumerReconciliation: {
      expectedConsumers: EXPECTED_CONSUMERS,
      expectedReceipts,
      actualReceipts: receipts.length,
      missingReceipts: missingReceipts.length,
      missingSample: missingReceipts.slice(0, 5),
      receiptsByConsumer: EXPECTED_CONSUMERS.map((c) => ({
        consumer: c,
        count: receipts.filter((r) => r.consumerName === c).length,
      })),
    },
    attempts: { attempts1, attempts2, attemptsGt2 },
    dlq: { step13Entries: step13Dlq, unresolvedBefore: dlqT0, unresolvedAfter: dlqFinal },
    outboxDrain: { pendingT0: outboxPendingT0, peakPending, pendingFinal: outboxPendingFinal },
    migrations: { before: migrationsBefore, after: migrationsAfter, schemaModified: migrationsAfter !== migrationsBefore },
    environment: {
      appEnv: process.env.APP_ENV,
      outboxEnabled: eventPlatformConfig.outboxEnabled,
      consumersEnabled: eventPlatformConfig.consumersEnabled,
      intervalMs: eventPlatformConfig.intervalMs,
      batchSize: eventPlatformConfig.batchSize,
      lockTimeoutMs: eventPlatformConfig.lockTimeoutMs,
      stagingUrl: STAGING_URL,
      productionTouched: false,
    },
    cleanupPolicy: "KEEP_FOR_FORENSICS",
  };

  console.log("\n=== STEP13_EVIDENCE_JSON ===");
  console.log(JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
  process.exit(summary === "PASS" ? 0 : summary === "BLOCKED" ? 2 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
