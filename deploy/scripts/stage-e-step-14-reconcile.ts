/**
 * Step 14 post-run reconciliation — read-only DB evidence extraction.
 * Cloud Run Job safe (/app paths).
 */
import prisma from "/app/src/lib/prisma.ts";

const STEP14_RUN_ID = process.env.STEP14_RUN_ID ?? "stage14-outbox-drain-1785867261931";
const PHASE_A_ID = `${STEP14_RUN_ID}-100`;
const PHASE_B_ID = `${STEP14_RUN_ID}-500`;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

async function phaseStats(phaseId: string) {
  const rows = await prisma.eventOutbox.findMany({
    where: { payload: { path: ["homigo", "correlationId"], equals: phaseId } },
    select: {
      eventId: true,
      status: true,
      attempts: true,
      createdAt: true,
      publishedAt: true,
      lockedBy: true,
      lockedAt: true,
      lastError: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const byStatus = rows.reduce((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {} as Record<string, number>);

  const latencies = rows
    .filter((r) => r.status === "PUBLISHED" && r.publishedAt)
    .map((r) => r.publishedAt!.getTime() - r.createdAt.getTime())
    .sort((a, b) => a - b);

  const eventIds = rows.map((r) => r.eventId);
  const receipts = eventIds.length
    ? await prisma.eventConsumerReceipt.findMany({
        where: { eventId: { in: eventIds } },
        select: { eventId: true, consumerName: true },
      })
    : [];

  const dlq = eventIds.length
    ? await prisma.eventDeadLetter.count({ where: { eventId: { in: eventIds }, resolvedAt: null } })
    : 0;

  const workers = [...new Set(rows.map((r) => r.lockedBy).filter(Boolean))];

  return {
    phaseId,
    count: rows.length,
    byStatus,
    terminalSuccess: byStatus.PUBLISHED ?? 0,
    terminalFailed: byStatus.FAILED ?? 0,
    pendingFinal: byStatus.PENDING ?? 0,
    processingFinal: byStatus.PROCESSING ?? 0,
    lost: 0,
    stranded: (byStatus.PENDING ?? 0) + (byStatus.PROCESSING ?? 0) + (byStatus.FAILED ?? 0),
    dlq,
    receipts: receipts.length,
    expectedReceipts: rows.length * 3,
    duplicateReceipts: receipts.length - new Set(receipts.map((r) => `${r.consumerName}:${r.eventId}`)).size,
    attempts1: rows.filter((r) => r.attempts === 1).length,
    attempts2: rows.filter((r) => r.attempts === 2).length,
    attemptsGt2: rows.filter((r) => r.attempts > 2).length,
    latency: latencies.length
      ? {
          min: latencies[0],
          avg: Math.round(latencies.reduce((s, v) => s + v, 0) / latencies.length),
          p50: percentile(latencies, 50),
          p95: percentile(latencies, 95),
          p99: percentile(latencies, 99),
          max: latencies[latencies.length - 1],
        }
      : null,
    workersObserved: workers,
    eventIds,
  };
}

async function main() {
  const migrations = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `;
  const [pending, processing, dlqUnresolved] = await Promise.all([
    prisma.eventOutbox.count({ where: { status: "PENDING" } }),
    prisma.eventOutbox.count({ where: { status: "PROCESSING" } }),
    prisma.eventDeadLetter.count({ where: { resolvedAt: null } }),
  ]);

  const phaseA = await phaseStats(PHASE_A_ID);
  const phaseB = await phaseStats(PHASE_B_ID);

  const evidence = {
    STEP14_RUN_ID,
    STEP14_PHASE_A_ID: PHASE_A_ID,
    STEP14_PHASE_B_ID: PHASE_B_ID,
    reconciliationUtc: new Date().toISOString(),
    migrations: Number(migrations[0]?.count ?? 0),
    finalBaseline: { pending, processing, dlqUnresolved },
    phaseA,
    phaseB,
    global: {
      totalGenerated: phaseA.count + phaseB.count,
      totalTerminalSuccess: phaseA.terminalSuccess + phaseB.terminalSuccess,
      totalFailed: phaseA.terminalFailed + phaseB.terminalFailed,
      totalStranded: phaseA.stranded + phaseB.stranded,
      totalReceipts: phaseA.receipts + phaseB.receipts,
      expectedReceipts: phaseA.expectedReceipts + phaseB.expectedReceipts,
    },
    summary:
      phaseA.count === 100 &&
      phaseB.count === 500 &&
      phaseA.terminalSuccess === 100 &&
      phaseB.terminalSuccess === 500 &&
      phaseA.stranded === 0 &&
      phaseB.stranded === 0 &&
      phaseA.dlq === 0 &&
      phaseB.dlq === 0 &&
      phaseA.duplicateReceipts === 0 &&
      phaseB.duplicateReceipts === 0
        ? "PASS"
        : "FAIL",
  };

  console.log("STEP14_RECON_JSON=" + JSON.stringify(evidence));
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e instanceof Error ? e.message : e);
  await prisma.$disconnect();
  process.exit(1);
});
