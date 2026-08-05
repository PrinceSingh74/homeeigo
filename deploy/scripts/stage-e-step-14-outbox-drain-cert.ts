/**
 * Stage E Step 14 — Outbox burst, backpressure, drain & processing-latency certification (Cloud Run Job).
 * Uses absolute /app paths for container execution.
 */
import prisma from "/app/src/lib/prisma.ts";
import { buildBookingCreatedEvent } from "/app/src/events/catalog/booking.events.ts";
import { emitStandalone } from "/app/src/events/core/event-publisher.ts";
import { eventPlatformConfig } from "/app/src/events/core/config.ts";
import { EVENT_TYPES } from "/app/src/events/catalog/event-types.ts";
import { AUDIT_CONSUMER_NAME } from "/app/src/events/consumers/audit.consumer.ts";
import { METRICS_CONSUMER_NAME } from "/app/src/events/consumers/metrics.consumer.ts";
import { AI_CONTEXT_INDEXER_CONSUMER_NAME } from "/app/src/events/consumers/ai-context-indexer.consumer.ts";

const CERTIFIED_RC_SHA = "c31f154a128022fa7d9c4e44652506eedf3fa3e4";
const STEP14_RUN_ID = `stage14-outbox-drain-${Date.now()}`;
const STEP14_PHASE_A_ID = `${STEP14_RUN_ID}-100`;
const STEP14_PHASE_B_ID = `${STEP14_RUN_ID}-500`;
const STAGING_URL = "https://homigo-backend-staging-144968192234.asia-south1.run.app";

const PHASE_A_COUNT = 100;
const PHASE_B_COUNT = 500;
const SAMPLE_MS = 1500;
const PHASE_A_DRAIN_TIMEOUT_MS = 600_000;
const PHASE_B_DRAIN_TIMEOUT_MS = 1_800_000;
const POST_DRAIN_OBSERVE_MS = 15_000;

const EXPECTED_CONSUMERS = [METRICS_CONSUMER_NAME, AUDIT_CONSUMER_NAME, AI_CONTEXT_INDEXER_CONSUMER_NAME];
const TEST_EVENT_TYPE = EVENT_TYPES.BOOKING_CREATED;

type Gate = { id: string; status: "PASS" | "FAIL" | "BLOCKED"; detail: string };
type TimeseriesSample = {
  timestamp: string;
  pending: number;
  processing: number;
  publishedForRun: number;
  failedForRun: number;
  dlqForRun: number;
  oldestPendingAgeSeconds: number | null;
  oldestProcessingAgeSeconds: number | null;
  leaderWorkers: string[];
};

type OutboxRow = {
  eventId: string;
  status: string;
  lockedBy: string | null;
  attempts: number;
  publishedAt: Date | null;
  lastError: string | null;
  updatedAt: Date;
  createdAt: Date;
  lockedAt: Date | null;
};

const gates: Gate[] = [];

function gate(id: string, status: Gate["status"], detail: string) {
  gates.push({ id, status, detail });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function migrationCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

async function globalOutboxCounts(): Promise<{ pending: number; processing: number }> {
  const [pending, processing] = await Promise.all([
    prisma.eventOutbox.count({ where: { status: "PENDING" } }),
    prisma.eventOutbox.count({ where: { status: "PROCESSING" } }),
  ]);
  return { pending, processing };
}

async function dlqUnresolvedCount(): Promise<number> {
  return prisma.eventDeadLetter.count({ where: { resolvedAt: null } });
}

async function fetchHealth(): Promise<{ status: number; body: string; ok: boolean }> {
  try {
    const res = await fetch(`${STAGING_URL}/health`, { signal: AbortSignal.timeout(15_000) });
    const body = await res.text();
    return { status: res.status, body, ok: res.status === 200 && body.includes('"database":"ok"') };
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e), ok: false };
  }
}

async function fetchMetricsSnippet(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  try {
    const res = await fetch(`${STAGING_URL}/metrics`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return out;
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (line.startsWith("#") || !line.trim()) continue;
      const m = line.match(/^(homigo_outbox_pending|homigo_dlq_unresolved|homigo_outbox_publish_total)\{?([^}]*)\}?\s+(\S+)/);
      if (m) {
        const key = m[2] ? `${m[1]}{${m[2]}}` : m[1];
        out[key] = Number(m[3]);
      }
    }
  } catch {
    /* metrics optional */
  }
  return out;
}

async function oldestAgeSeconds(eventIds: string[], status: "PENDING" | "PROCESSING"): Promise<number | null> {
  const ref = status === "PENDING" ? "created_at" : "locked_at";
  const rows = await prisma.$queryRawUnsafe<{ age: number | null }[]>(
    `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(${ref})))::float AS age
     FROM event_outbox
     WHERE status = $1::"EventOutboxStatus" AND event_id = ANY($2::text[])`,
    status,
    eventIds,
  );
  const age = rows[0]?.age;
  return age != null && Number.isFinite(age) ? age : null;
}

async function createBurstEvents(
  phaseId: string,
  count: number,
  indexOffset: number,
): Promise<{ eventIds: string[]; aggregateIds: string[]; injectionStart: string; injectionEnd: string; injectionDurationMs: number }> {
  const eventIds: string[] = [];
  const aggregateIds: string[] = [];
  const injectionStart = new Date().toISOString();
  const t0 = Date.now();

  for (let i = 0; i < count; i++) {
    const idx = indexOffset + i;
    const aggregateId = `step14_bk_${phaseId}_${idx}`;
    aggregateIds.push(aggregateId);
    const event = buildBookingCreatedEvent({
      bookingId: aggregateId,
      bookingNumber: `HG-S14-${idx.toString().padStart(4, "0")}`,
      userId: `usr_step14_${idx}`,
      serviceId: "svc_step14_cert",
      serviceCategory: "cleaning",
      city: "Delhi",
      providerId: null,
      status: "PENDING",
      finalAmount: 100,
      paymentMethod: "razorpay",
      scheduledAt: new Date(Date.now() + 86400_000),
      actorType: "system",
      actorId: "step14-cert",
    });
    event.homigo.correlationId = phaseId;
    await emitStandalone(prisma, event);
    eventIds.push(event.id);
  }

  return {
    eventIds,
    aggregateIds,
    injectionStart,
    injectionEnd: new Date().toISOString(),
    injectionDurationMs: Date.now() - t0,
  };
}

async function sampleRunState(eventIds: string[]): Promise<TimeseriesSample> {
  const rows = await prisma.eventOutbox.findMany({
    where: { eventId: { in: eventIds } },
    select: {
      eventId: true,
      status: true,
      lockedBy: true,
      lockedAt: true,
      createdAt: true,
    },
  });

  const pending = rows.filter((r) => r.status === "PENDING").length;
  const processing = rows.filter((r) => r.status === "PROCESSING").length;
  const publishedForRun = rows.filter((r) => r.status === "PUBLISHED").length;
  const failedForRun = rows.filter((r) => r.status === "FAILED").length;

  const dlqForRun = await prisma.eventDeadLetter.count({
    where: { eventId: { in: eventIds }, resolvedAt: null },
  });

  const leaderWorkers = [...new Set(rows.filter((r) => r.lockedBy).map((r) => r.lockedBy as string))];

  const [oldestPendingAgeSeconds, oldestProcessingAgeSeconds] = await Promise.all([
    oldestAgeSeconds(eventIds, "PENDING"),
    oldestAgeSeconds(eventIds, "PROCESSING"),
  ]);

  return {
    timestamp: new Date().toISOString(),
    pending,
    processing,
    publishedForRun,
    failedForRun,
    dlqForRun,
    oldestPendingAgeSeconds,
    oldestProcessingAgeSeconds,
    leaderWorkers,
  };
}

function computeBacklogMetrics(timeseries: TimeseriesSample[]) {
  if (timeseries.length === 0) {
    return {
      pendingPeak: 0,
      processingPeak: 0,
      timeToPeakMs: 0,
      timeTo50PercentMs: null as number | null,
      timeTo10PercentMs: null as number | null,
      timeToZeroMs: null as number | null,
      backlogConvergence: "FAIL" as const,
    };
  }

  const t0 = new Date(timeseries[0].timestamp).getTime();
  let pendingPeak = 0;
  let processingPeak = 0;
  let peakIdx = 0;

  for (let i = 0; i < timeseries.length; i++) {
    const s = timeseries[i];
    if (s.pending > pendingPeak) {
      pendingPeak = s.pending;
      peakIdx = i;
    }
    processingPeak = Math.max(processingPeak, s.processing);
  }

  const peakTime = new Date(timeseries[peakIdx].timestamp).getTime();
  const timeToPeakMs = peakTime - t0;
  const halfTarget = Math.ceil(pendingPeak * 0.5);
  const tenTarget = Math.ceil(pendingPeak * 0.1);

  let timeTo50PercentMs: number | null = null;
  let timeTo10PercentMs: number | null = null;
  let timeToZeroMs: number | null = null;

  for (let i = peakIdx; i < timeseries.length; i++) {
    const ts = new Date(timeseries[i].timestamp).getTime() - t0;
    if (timeTo50PercentMs == null && timeseries[i].pending <= halfTarget) timeTo50PercentMs = ts;
    if (timeTo10PercentMs == null && timeseries[i].pending <= tenTarget) timeTo10PercentMs = ts;
    if (timeToZeroMs == null && timeseries[i].pending === 0 && timeseries[i].processing === 0) {
      timeToZeroMs = ts;
    }
  }

  let backlogConvergence: "PASS" | "FAIL" = "FAIL";
  const last = timeseries[timeseries.length - 1];
  const lastThird = timeseries.slice(Math.floor(timeseries.length * 0.66));
  const monotonicGrowth =
    lastThird.length >= 3 &&
    lastThird.every((s, i) => i === 0 || s.pending >= lastThird[i - 1].pending) &&
    last.pending > 0;

  if (last.pending === 0 && last.processing === 0 && !monotonicGrowth) {
    backlogConvergence = "PASS";
  }

  return {
    pendingPeak,
    processingPeak,
    timeToPeakMs,
    timeTo50PercentMs,
    timeTo10PercentMs,
    timeToZeroMs,
    backlogConvergence,
  };
}

async function monitorDrain(
  phaseId: string,
  eventIds: string[],
  timeoutMs: number,
  healthChecks: { total: number; failed: number },
): Promise<{
  timeseries: TimeseriesSample[];
  drainStart: string;
  drainEnd: string;
  drainDurationMs: number;
  finalRows: OutboxRow[];
  claimObservations: { eventId: string; lockedBy: string | null; observedAt: string; attempts: number }[];
  healthChecks: { total: number; failed: number };
}> {
  const drainStart = new Date().toISOString();
  const deadline = Date.now() + timeoutMs;
  const timeseries: TimeseriesSample[] = [];
  const claimObservations: { eventId: string; lockedBy: string | null; observedAt: string; attempts: number }[] = [];
  const seenClaims = new Set<string>();

  while (Date.now() < deadline) {
    const sample = await sampleRunState(eventIds);
    timeseries.push(sample);

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
        lockedAt: true,
      },
    });

    for (const row of rows) {
      if (row.status === "PROCESSING" && row.lockedBy) {
        const key = `${row.eventId}:${row.lockedBy}`;
        if (!seenClaims.has(key)) {
          seenClaims.add(key);
          claimObservations.push({
            eventId: row.eventId,
            lockedBy: row.lockedBy,
            observedAt: new Date().toISOString(),
            attempts: row.attempts,
          });
        }
      }
    }

    if (Date.now() % 10_000 < SAMPLE_MS) {
      const h = await fetchHealth();
      healthChecks.total++;
      if (!h.ok) healthChecks.failed++;
    }

    const terminal = rows.filter((r) => r.status === "PUBLISHED" || r.status === "FAILED").length;
    const pending = rows.filter((r) => r.status === "PENDING" || r.status === "PROCESSING").length;
    if (terminal === eventIds.length && pending === 0) break;

    await new Promise((r) => setTimeout(r, SAMPLE_MS));
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
      lockedAt: true,
    },
  });

  const drainEnd = new Date().toISOString();
  return {
    timeseries,
    drainStart,
    drainEnd,
    drainDurationMs: new Date(drainEnd).getTime() - new Date(drainStart).getTime(),
    finalRows,
    claimObservations,
    healthChecks,
  };
}

function latencyStats(rows: OutboxRow[]) {
  const latencies = rows
    .filter((r) => r.status === "PUBLISHED" && r.publishedAt)
    .map((r) => r.publishedAt!.getTime() - r.createdAt.getTime())
    .sort((a, b) => a - b);

  if (latencies.length === 0) {
    return { min: 0, avg: 0, p50: 0, p95: 0, p99: 0, max: 0, count: 0 };
  }

  const sum = latencies.reduce((a, b) => a + b, 0);
  return {
    min: latencies[0],
    avg: Math.round(sum / latencies.length),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    max: latencies[latencies.length - 1],
    count: latencies.length,
  };
}

async function reconcilePhase(
  phaseId: string,
  expectedCount: number,
  eventIds: string[],
  finalRows: OutboxRow[],
  claimObservations: { eventId: string; lockedBy: string | null; observedAt: string; attempts: number }[],
) {
  const persisted = finalRows.length;
  const published = finalRows.filter((r) => r.status === "PUBLISHED").length;
  const pendingFinal = finalRows.filter((r) => r.status === "PENDING").length;
  const processingFinal = finalRows.filter((r) => r.status === "PROCESSING").length;
  const failedFinal = finalRows.filter((r) => r.status === "FAILED").length;
  const lost = expectedCount - finalRows.length;
  const stranded = pendingFinal + processingFinal + failedFinal;

  const duplicateClaimEvents = claimObservations.reduce(
    (acc, obs) => {
      acc[obs.eventId] = (acc[obs.eventId] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  const uncontrolledDuplicateClaims = Object.values(duplicateClaimEvents).filter((c) => c > 1).length;

  const receipts = await prisma.eventConsumerReceipt.findMany({
    where: { eventId: { in: eventIds } },
    select: { consumerName: true, eventId: true, result: true, processedAt: true },
  });
  const expectedReceipts = expectedCount * EXPECTED_CONSUMERS.length;
  const receiptDupes = receipts.length - new Set(receipts.map((r) => `${r.consumerName}:${r.eventId}`)).size;
  const missingReceipts: string[] = [];
  for (const eid of eventIds) {
    for (const consumer of EXPECTED_CONSUMERS) {
      if (!receipts.some((r) => r.eventId === eid && r.consumerName === consumer)) {
        missingReceipts.push(`${consumer}:${eid}`);
      }
    }
  }

  const step14Dlq = await prisma.eventDeadLetter.count({
    where: { eventId: { in: eventIds }, resolvedAt: null },
  });

  const attempts1 = finalRows.filter((r) => r.attempts === 1).length;
  const attempts2 = finalRows.filter((r) => r.attempts === 2).length;
  const attemptsGt2 = finalRows.filter((r) => r.attempts > 2).length;
  const unexplainedRetries = finalRows.filter((r) => r.attempts > 1).length;

  const lat = latencyStats(finalRows);
  const workerIds = [...new Set(claimObservations.map((c) => c.lockedBy).filter(Boolean))];

  const phasePass =
    published === expectedCount &&
    pendingFinal === 0 &&
    processingFinal === 0 &&
    failedFinal === 0 &&
    lost === 0 &&
    stranded === 0 &&
    step14Dlq === 0 &&
    uncontrolledDuplicateClaims === 0 &&
    missingReceipts.length === 0 &&
    receiptDupes === 0;

  return {
    phaseId,
    generated: expectedCount,
    persisted,
    terminalSuccess: published,
    terminalFailed: failedFinal,
    pendingFinal,
    processingFinal,
    lost,
    stranded,
    dlq: step14Dlq,
    uncontrolledDuplicateClaims,
    duplicateEffectiveProcessing: receiptDupes,
    consumerReconciliation: {
      expectedReceipts,
      actualReceipts: receipts.length,
      missingReceipts: missingReceipts.length,
      missingSample: missingReceipts.slice(0, 5),
    },
    attempts: { attempts1, attempts2, attemptsGt2, unexplainedRetries },
    latency: lat,
    workerIdsObserved: workerIds,
    phasePass,
  };
}

async function main() {
  console.log("=== STAGE E STEP 14 — OUTBOX BURST DRAIN CERTIFICATION ===");
  console.log(`STEP14_RUN_ID=${STEP14_RUN_ID}`);
  console.log(`STEP14_PHASE_A_ID=${STEP14_PHASE_A_ID}`);
  console.log(`STEP14_PHASE_B_ID=${STEP14_PHASE_B_ID}`);
  console.log(`certifiedRcSha=${CERTIFIED_RC_SHA}`);

  if (process.env.APP_ENV !== "staging") {
    gate("pre.env", "BLOCKED", "APP_ENV must be staging");
    console.log(JSON.stringify({ gates, summary: "BLOCKED", STEP14_RUN_ID }, null, 2));
    process.exit(2);
  }

  if (process.env.STAGING_EVENTS_CERTIFICATION !== "1") {
    gate("pre.cert-mode", "BLOCKED", "STAGING_EVENTS_CERTIFICATION=1 required");
    process.exit(2);
  }

  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.consumersEnabled) {
    gate("pre.flags", "BLOCKED", "EVENTS_OUTBOX_ENABLED and EVENTS_CONSUMERS_ENABLED must be true");
    process.exit(2);
  }

  const migrationsBefore = await migrationCount();
  gate("pre.migrations", migrationsBefore === 31 ? "PASS" : "FAIL", `${migrationsBefore}/31`);

  const healthChecks = { total: 0, failed: 0 };
  const healthT0 = await fetchHealth();
  healthChecks.total++;
  if (!healthT0.ok) healthChecks.failed++;
  gate("pre.health", healthT0.ok ? "PASS" : "FAIL", `HTTP ${healthT0.status}`);

  const STEP14_T0_UTC = new Date().toISOString();
  const globalT0 = await globalOutboxCounts();
  const dlqT0 = await dlqUnresolvedCount();
  const metricsT0 = await fetchMetricsSnippet();

  const statusBaseline = await prisma.eventOutbox.groupBy({
    by: ["status"],
    _count: { _all: true },
  });

  // ── Phase A: 100-event burst ──
  console.log("\n--- PHASE A: 100-event burst ---");
  const phaseAInjection = await createBurstEvents(STEP14_PHASE_A_ID, PHASE_A_COUNT, 0);
  gate("phaseA.generated", phaseAInjection.eventIds.length === PHASE_A_COUNT ? "PASS" : "FAIL", String(phaseAInjection.eventIds.length));
  gate("phaseA.unique", new Set(phaseAInjection.eventIds).size === PHASE_A_COUNT ? "PASS" : "FAIL", String(new Set(phaseAInjection.eventIds).size));

  const phaseAPersisted = await prisma.eventOutbox.count({ where: { eventId: { in: phaseAInjection.eventIds } } });
  gate("phaseA.persisted", phaseAPersisted === PHASE_A_COUNT ? "PASS" : "FAIL", String(phaseAPersisted));

  const phaseAMonitor = await monitorDrain(STEP14_PHASE_A_ID, phaseAInjection.eventIds, PHASE_A_DRAIN_TIMEOUT_MS, healthChecks);
  const phaseABacklog = computeBacklogMetrics(phaseAMonitor.timeseries);
  const phaseARecon = await reconcilePhase(
    STEP14_PHASE_A_ID,
    PHASE_A_COUNT,
    phaseAInjection.eventIds,
    phaseAMonitor.finalRows,
    phaseAMonitor.claimObservations,
  );

  gate("phaseA.terminal", phaseARecon.terminalSuccess === PHASE_A_COUNT ? "PASS" : "FAIL", `${phaseARecon.terminalSuccess}/${PHASE_A_COUNT}`);
  gate("phaseA.lost", phaseARecon.lost === 0 ? "PASS" : "FAIL", String(phaseARecon.lost));
  gate("phaseA.stranded", phaseARecon.stranded === 0 ? "PASS" : "FAIL", String(phaseARecon.stranded));
  gate("phaseA.dlq", phaseARecon.dlq === 0 ? "PASS" : "FAIL", String(phaseARecon.dlq));
  gate("phaseA.duplicateClaims", phaseARecon.uncontrolledDuplicateClaims === 0 ? "PASS" : "FAIL", String(phaseARecon.uncontrolledDuplicateClaims));
  gate("phaseA.consumers", phaseARecon.consumerReconciliation.missingReceipts === 0 ? "PASS" : "FAIL", `${phaseARecon.consumerReconciliation.actualReceipts}/${phaseARecon.consumerReconciliation.expectedReceipts}`);
  gate("phaseA.backlogConvergence", phaseABacklog.backlogConvergence === "PASS" ? "PASS" : "FAIL", phaseABacklog.backlogConvergence);

  const phaseAPass = phaseARecon.phasePass && phaseABacklog.backlogConvergence === "PASS";
  gate("phaseA.overall", phaseAPass ? "PASS" : "FAIL", phaseAPass ? "100-event burst drained" : "Phase A failed");

  // Post Phase A observation
  await new Promise((r) => setTimeout(r, POST_DRAIN_OBSERVE_MS));

  // ── Phase B: 500-event burst (only if Phase A PASS) ──
  let phaseBExecuted = false;
  let phaseBInjection: Awaited<ReturnType<typeof createBurstEvents>> | null = null;
  let phaseBMonitor: Awaited<ReturnType<typeof monitorDrain>> | null = null;
  let phaseBBacklog: ReturnType<typeof computeBacklogMetrics> | null = null;
  let phaseBRecon: Awaited<ReturnType<typeof reconcilePhase>> | null = null;
  let phaseBPass = false;

  if (phaseAPass) {
    console.log("\n--- PHASE B: 500-event burst ---");
    const PHASE_B_T0 = new Date().toISOString();
    phaseBExecuted = true;
    phaseBInjection = await createBurstEvents(STEP14_PHASE_B_ID, PHASE_B_COUNT, PHASE_A_COUNT);
    gate("phaseB.generated", phaseBInjection.eventIds.length === PHASE_B_COUNT ? "PASS" : "FAIL", String(phaseBInjection.eventIds.length));
    gate("phaseB.unique", new Set(phaseBInjection.eventIds).size === PHASE_B_COUNT ? "PASS" : "FAIL", String(new Set(phaseBInjection.eventIds).size));

    const phaseBPersisted = await prisma.eventOutbox.count({ where: { eventId: { in: phaseBInjection.eventIds } } });
    gate("phaseB.persisted", phaseBPersisted === PHASE_B_COUNT ? "PASS" : "FAIL", String(phaseBPersisted));

    phaseBMonitor = await monitorDrain(STEP14_PHASE_B_ID, phaseBInjection.eventIds, PHASE_B_DRAIN_TIMEOUT_MS, healthChecks);
    phaseBBacklog = computeBacklogMetrics(phaseBMonitor.timeseries);
    phaseBRecon = await reconcilePhase(
      STEP14_PHASE_B_ID,
      PHASE_B_COUNT,
      phaseBInjection.eventIds,
      phaseBMonitor.finalRows,
      phaseBMonitor.claimObservations,
    );

    gate("phaseB.terminal", phaseBRecon.terminalSuccess === PHASE_B_COUNT ? "PASS" : "FAIL", `${phaseBRecon.terminalSuccess}/${PHASE_B_COUNT}`);
    gate("phaseB.lost", phaseBRecon.lost === 0 ? "PASS" : "FAIL", String(phaseBRecon.lost));
    gate("phaseB.stranded", phaseBRecon.stranded === 0 ? "PASS" : "FAIL", String(phaseBRecon.stranded));
    gate("phaseB.dlq", phaseBRecon.dlq === 0 ? "PASS" : "FAIL", String(phaseBRecon.dlq));
    gate("phaseB.duplicateClaims", phaseBRecon.uncontrolledDuplicateClaims === 0 ? "PASS" : "FAIL", String(phaseBRecon.uncontrolledDuplicateClaims));
    gate("phaseB.consumers", phaseBRecon.consumerReconciliation.missingReceipts === 0 ? "PASS" : "FAIL", `${phaseBRecon.consumerReconciliation.actualReceipts}/${phaseBRecon.consumerReconciliation.expectedReceipts}`);
    gate("phaseB.backlogConvergence", phaseBBacklog.backlogConvergence === "PASS" ? "PASS" : "FAIL", phaseBBacklog.backlogConvergence);

    phaseBPass = phaseBRecon.phasePass && phaseBBacklog.backlogConvergence === "PASS";
    gate("phaseB.overall", phaseBPass ? "PASS" : "FAIL", phaseBPass ? "500-event burst drained" : "Phase B failed");
    void PHASE_B_T0;
  } else {
    gate("phaseB.overall", "BLOCKED", "NOT_EXECUTED_DUE_TO_PHASE_A_FAILURE");
  }

  await new Promise((r) => setTimeout(r, POST_DRAIN_OBSERVE_MS));

  const migrationsAfter = await migrationCount();
  gate("post.migrations", migrationsAfter === 31 && migrationsAfter === migrationsBefore ? "PASS" : "FAIL", `${migrationsAfter}/31`);

  const globalFinal = await globalOutboxCounts();
  const dlqFinal = await dlqUnresolvedCount();
  const metricsFinal = await fetchMetricsSnippet();

  const allEventIds = [...phaseAInjection.eventIds, ...(phaseBInjection?.eventIds ?? [])];
  const totalGenerated = phaseBExecuted ? PHASE_A_COUNT + PHASE_B_COUNT : PHASE_A_COUNT;
  const totalTerminalSuccess = (phaseARecon.terminalSuccess) + (phaseBRecon?.terminalSuccess ?? 0);
  const totalLost = (phaseARecon.lost) + (phaseBRecon?.lost ?? 0);
  const totalStranded = (phaseARecon.stranded) + (phaseBRecon?.stranded ?? 0);

  const leaderStart = phaseAMonitor.claimObservations[0]?.lockedBy ?? null;
  const leaderEnd = phaseBMonitor?.claimObservations.at(-1)?.lockedBy ?? phaseAMonitor.claimObservations.at(-1)?.lockedBy ?? null;
  const allWorkers = new Set([
    ...phaseAMonitor.claimObservations.map((c) => c.lockedBy),
    ...(phaseBMonitor?.claimObservations.map((c) => c.lockedBy) ?? []),
  ].filter(Boolean));

  const failed = gates.filter((g) => g.status === "FAIL").length;
  const blocked = gates.filter((g) => g.status === "BLOCKED").length;
  const summary = blocked > 0 && !phaseBExecuted && !phaseAPass ? "BLOCKED" : failed > 0 ? "FAIL" : "PASS";

  const evidence = {
    step: 14,
    STEP14_RUN_ID,
    STEP14_PHASE_A_ID,
    STEP14_PHASE_B_ID,
    STEP14_T0_UTC,
    STEP14_T1_UTC: new Date().toISOString(),
    certifiedRcSha: CERTIFIED_RC_SHA,
    summary,
    gates,
    processingModel: {
      model: "LEADER_SINGLE_ACTIVE_WITH_SKIP_LOCKED",
      leaderLock: "maintenance:event_outbox",
      claimMechanism: "FOR UPDATE SKIP LOCKED",
      batchSize: eventPlatformConfig.batchSize,
      intervalMs: eventPlatformConfig.intervalMs,
      lockTimeoutMs: eventPlatformConfig.lockTimeoutMs,
      maxAttempts: eventPlatformConfig.maxAttempts,
    },
    testEventContract: {
      eventType: TEST_EVENT_TYPE,
      expectedConsumersPerEvent: EXPECTED_CONSUMERS.length,
      expectedConsumers: EXPECTED_CONSUMERS,
      expectedSideEffects: "idempotent consumer receipts only — no notifications, no PII, no live payments",
    },
    baseline: {
      STEP14_T0_UTC,
      outboxPendingT0: globalT0.pending,
      outboxProcessingT0: globalT0.processing,
      dlqUnresolvedT0: dlqT0,
      metricsT0,
      statusBaseline: Object.fromEntries(statusBaseline.map((r) => [r.status, r._count._all])),
      health: healthT0.ok ? "PASS" : "FAIL",
    },
    phaseA: {
      ...phaseAInjection,
      persisted: phaseAPersisted,
      monitor: {
        drainStart: phaseAMonitor.drainStart,
        drainEnd: phaseAMonitor.drainEnd,
        drainDurationMs: phaseAMonitor.drainDurationMs,
        drainRateEventsPerSec: phaseAMonitor.drainDurationMs > 0 ? PHASE_A_COUNT / (phaseAMonitor.drainDurationMs / 1000) : 0,
        timeseries: phaseAMonitor.timeseries,
        backlog: phaseABacklog,
      },
      reconciliation: phaseARecon,
      pass: phaseAPass,
    },
    phaseB: phaseBExecuted
      ? {
          ...phaseBInjection,
          persisted: phaseBInjection!.eventIds.length,
          monitor: {
            drainStart: phaseBMonitor!.drainStart,
            drainEnd: phaseBMonitor!.drainEnd,
            drainDurationMs: phaseBMonitor!.drainDurationMs,
            drainRateEventsPerSec: phaseBMonitor!.drainDurationMs > 0 ? PHASE_B_COUNT / (phaseBMonitor!.drainDurationMs / 1000) : 0,
            timeseries: phaseBMonitor!.timeseries,
            backlog: phaseBBacklog,
          },
          reconciliation: phaseBRecon,
          pass: phaseBPass,
        }
      : { executed: false, reason: "NOT_EXECUTED_DUE_TO_PHASE_A_FAILURE" },
    globalReconciliation: {
      totalGenerated,
      totalPersisted: allEventIds.length,
      totalTerminalSuccess,
      totalFailed: (phaseARecon.terminalFailed) + (phaseBRecon?.terminalFailed ?? 0),
      totalLost,
      totalStranded,
      uncontrolledDuplicateClaims: phaseARecon.uncontrolledDuplicateClaims + (phaseBRecon?.uncontrolledDuplicateClaims ?? 0),
      duplicateEffectiveProcessing: phaseARecon.duplicateEffectiveProcessing + (phaseBRecon?.duplicateEffectiveProcessing ?? 0),
    },
    consumerReconciliation: {
      expectedReceipts: totalGenerated * EXPECTED_CONSUMERS.length,
      phaseA: phaseARecon.consumerReconciliation,
      phaseB: phaseBRecon?.consumerReconciliation ?? null,
    },
    latencyAnalysis: {
      phaseA: phaseARecon.latency,
      phaseB: phaseBRecon?.latency ?? null,
      p95DegradationRatio:
        phaseBRecon && phaseARecon.latency.p95 > 0 ? phaseBRecon.latency.p95 / phaseARecon.latency.p95 : null,
    },
    dlq: {
      unresolvedBefore: dlqT0,
      unresolvedPeak: Math.max(
        dlqT0,
        ...phaseAMonitor.timeseries.map((s) => s.dlqForRun),
        ...(phaseBMonitor?.timeseries.map((s) => s.dlqForRun) ?? []),
      ),
      unresolvedFinal: dlqFinal,
      step14PhaseADlq: phaseARecon.dlq,
      step14PhaseBDlq: phaseBRecon?.dlq ?? 0,
    },
    redisLeader: {
      leaderWorkerStart: leaderStart,
      leaderWorkerEnd: leaderEnd,
      leaderChanges: allWorkers.size > 1 ? allWorkers.size - 1 : 0,
      workersObserved: [...allWorkers],
    },
    runtime: {
      healthChecksTotal: healthChecks.total,
      healthChecksFailed: healthChecks.failed,
      metricsFinal,
    },
    finalBaseline: {
      outboxPendingFinal: globalFinal.pending,
      outboxProcessingFinal: globalFinal.processing,
      dlqUnresolvedFinal: dlqFinal,
    },
    migrations: { before: migrationsBefore, after: migrationsAfter, schemaModified: migrationsAfter !== migrationsBefore },
    environment: {
      appEnv: process.env.APP_ENV,
      outboxEnabled: eventPlatformConfig.outboxEnabled,
      consumersEnabled: eventPlatformConfig.consumersEnabled,
      stagingUrl: STAGING_URL,
      productionTouched: false,
      razorpayLiveUsed: false,
    },
    cleanupPolicy: "KEEP_FOR_FORENSICS",
  };

  console.log("\n=== STEP14_EVIDENCE_JSON ===");
  console.log(JSON.stringify(evidence, null, 2));
  await prisma.$disconnect();
  process.exit(summary === "PASS" ? 0 : summary === "BLOCKED" ? 2 : 1);
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
