/**
 * Stage F Step 18 — Controlled alert lifecycle certification (STAGING ONLY).
 * Creates reversible synthetic DB conditions; does NOT modify alert rules or production.
 */
import crypto from "crypto";
import prisma from "/app/src/lib/prisma.ts";
import { refreshEventPlatformGauges } from "/app/src/events/core/retention.ts";
import { EVENT_TYPES } from "/app/src/events/catalog/event-types.ts";

const STEP18_RUN_ID = process.env.STEP18_RUN_ID ?? `stage18-cert-${Date.now()}`;
const MARKER = `STEP18_${STEP18_RUN_ID}`;

type PhaseResult = {
  phase: string;
  ok: boolean;
  detail: string;
  counts?: Record<string, number>;
};

const phases: PhaseResult[] = [];
const log = (phase: string, ok: boolean, detail: string, counts?: Record<string, number>) => {
  phases.push({ phase, ok, detail, counts });
  console.log(`[${ok ? "PASS" : "FAIL"}] ${phase}: ${detail}`);
};

async function migrationCount(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

async function gaugeSnapshot() {
  await refreshEventPlatformGauges();
  const [pending, dlq, oldest, jobLag] = await Promise.all([
    prisma.eventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } } }),
    prisma.eventDeadLetter.count({ where: { resolvedAt: null } }),
    prisma.eventOutbox.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.scheduledJob.findFirst({
      where: { status: "pending", runAt: { lt: new Date() } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
  ]);
  return {
    homigo_outbox_pending: pending,
    homigo_dlq_unresolved: dlq,
    homigo_outbox_oldest_pending_age_seconds: oldest
      ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000)
      : 0,
    homigo_scheduled_job_lag_seconds: jobLag
      ? Math.max(0, (Date.now() - jobLag.runAt.getTime()) / 1000)
      : 0,
  };
}

async function seedBacklog(count: number) {
  const rows: string[] = [];
  const futureAvailable = new Date(Date.now() + 86_400_000);
  for (let i = 0; i < count; i++) {
    const id = `step18_ob_${STEP18_RUN_ID}_${i}`;
    const eventId = crypto.randomUUID();
    await prisma.eventOutbox.create({
      data: {
        id,
        eventId,
        eventType: EVENT_TYPES.BOOKING_CREATED,
        aggregateType: "booking",
        aggregateId: `step18_bk_${STEP18_RUN_ID}`,
        payload: { step18CertMarker: MARKER, index: i },
        status: "PENDING",
        attempts: 0,
        availableAt: futureAvailable,
        metadata: { certification: MARKER },
      },
    });
    rows.push(id);
  }
  return rows;
}

async function seedDlq(count: number) {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const row = await prisma.eventDeadLetter.create({
      data: {
        eventId: crypto.randomUUID(),
        eventType: EVENT_TYPES.BOOKING_CREATED,
        consumerName: "step18.cert.v1",
        payload: { step18CertMarker: MARKER, index: i },
        error: "STEP18_SYNTHETIC_DLQ",
        attempts: 3,
      },
    });
    ids.push(row.id);
  }
  return ids;
}

async function seedStalePending() {
  const id = `step18_stale_${STEP18_RUN_ID}`;
  const eventId = crypto.randomUUID();
  const staleAt = new Date(Date.now() - 1_100_000);
  const futureAvailable = new Date(Date.now() + 86_400_000);
  await prisma.$executeRaw`
    INSERT INTO event_outbox (
      id, event_id, event_type, event_version, aggregate_type, aggregate_id,
      payload, status, attempts, available_at, created_at, updated_at
    ) VALUES (
      ${id}, ${eventId}, ${EVENT_TYPES.BOOKING_CREATED}, '1.0', 'booking', ${`step18_stale_bk_${STEP18_RUN_ID}`},
      ${JSON.stringify({ step18CertMarker: MARKER })}::jsonb, 'PENDING'::"EventOutboxStatus", 0, ${futureAvailable}, ${staleAt}, NOW()
    )`;
  return id;
}

async function seedOverdueJob() {
  const id = `step18_job_${STEP18_RUN_ID}`;
  const runAt = new Date(Date.now() - 7_200_000);
  await prisma.scheduledJob.create({
    data: {
      id,
      jobType: "step18.cert.overdue",
      payload: { step18CertMarker: MARKER },
      runAt,
      status: "pending",
    },
  });
  return id;
}

async function cleanup() {
  await prisma.eventOutbox.deleteMany({ where: { id: { startsWith: "step18_" } } });
  await prisma.eventOutbox.deleteMany({ where: { aggregateId: { startsWith: "step18_" } } });
  await prisma.eventDeadLetter.deleteMany({ where: { consumerName: "step18.cert.v1" } });
  await prisma.scheduledJob.deleteMany({ where: { id: { startsWith: "step18_" } } });
  await prisma.scheduledJob.deleteMany({ where: { jobType: "step18.cert.overdue" } });
  await refreshEventPlatformGauges();
}

async function main() {
  console.log("=== STAGE F STEP 18 — ALERT CERTIFICATION HARNESS ===");
  console.log(`STEP18_RUN_ID=${STEP18_RUN_ID}`);
  console.log(`MARKER=${MARKER}`);

  const mig = await migrationCount();
  log("MIGRATIONS", mig === 31, `${mig}/31`);

  const baseline = await gaugeSnapshot();
  log("BASELINE", true, JSON.stringify(baseline));

  const backlogIds = await seedBacklog(550);
  const afterBacklog = await gaugeSnapshot();
  log("OUTBOX_BACKLOG_SEED", afterBacklog.homigo_outbox_pending > 500, `pending=${afterBacklog.homigo_outbox_pending}`, afterBacklog);

  const staleId = await seedStalePending();
  const afterStale = await gaugeSnapshot();
  log("STALE_PENDING_SEED", afterStale.homigo_outbox_oldest_pending_age_seconds > 900, `oldest_age_s=${afterStale.homigo_outbox_oldest_pending_age_seconds}`, afterStale);

  const dlqIds = await seedDlq(26);
  const afterDlq = await gaugeSnapshot();
  log("DLQ_SEED", afterDlq.homigo_dlq_unresolved >= 26, `dlq=${afterDlq.homigo_dlq_unresolved}`, afterDlq);

  const jobId = await seedOverdueJob();
  const afterJob = await gaugeSnapshot();
  log("SCHEDULED_JOB_LAG_SEED", afterJob.homigo_scheduled_job_lag_seconds > 3600, `lag_s=${afterJob.homigo_scheduled_job_lag_seconds}`, afterJob);

  await refreshEventPlatformGauges();
  const postInject = await gaugeSnapshot();
  log("POST_INJECT", true, JSON.stringify(postInject));

  console.log(
    JSON.stringify(
      {
        STEP18_RUN_ID,
        MARKER,
        baseline,
        postInject,
        synthetic: {
          backlogOutboxIds: backlogIds.length,
          staleOutboxId: staleId,
          dlqIds,
          overdueJobId: jobId,
        },
        phases,
        note: "Poll Prometheus /api/v1/alerts externally for Pending/Firing transitions; run cleanup phase after observation window.",
      },
      null,
      2,
    ),
  );
}

if (process.env.STEP18_CLEANUP === "1") {
  cleanup()
    .then(async () => {
      const final = await gaugeSnapshot();
      console.log(JSON.stringify({ STEP18_RUN_ID, cleanup: "done", final }, null, 2));
      await prisma.$disconnect();
    })
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
} else {
  main()
    .then(() => prisma.$disconnect())
    .catch(async (e) => {
      console.error(e);
      await prisma.$disconnect();
      process.exit(1);
    });
}
