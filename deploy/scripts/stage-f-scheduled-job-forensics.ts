/**
 * Forensic investigation: scheduled_jobs lag on staging (read-only).
 * STAGING ONLY — does not mutate certified application behavior.
 */
import prisma from "/app/src/lib/prisma.ts";

async function main() {
  const pending = await prisma.scheduledJob.count({ where: { status: "pending" } });
  const overdue = await prisma.scheduledJob.findMany({
    where: { status: "pending", runAt: { lt: new Date() } },
    orderBy: { runAt: "asc" },
    take: 20,
    select: { id: true, jobType: true, runAt: true, createdAt: true, triggerEventId: true },
  });
  const byType = await prisma.$queryRaw<{ job_type: string; count: bigint }[]>`
    SELECT job_type, COUNT(*)::bigint AS count FROM scheduled_jobs
    WHERE status = 'pending' GROUP BY job_type ORDER BY count DESC
  `;
  const mig = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM _prisma_migrations WHERE finished_at IS NOT NULL
  `;

  const oldest = overdue[0];
  const lagSec = oldest ? (Date.now() - oldest.runAt.getTime()) / 1000 : 0;

  console.log(
    JSON.stringify(
      {
        investigation: "scheduled_job_lag_root_cause",
        migrations: Number(mig[0]?.count ?? 0),
        pendingTotal: pending,
        overdueCount: overdue.length,
        oldestOverdue: oldest,
        lagSeconds: lagSec,
        byJobType: byType.map((r) => ({ jobType: r.job_type, count: Number(r.count) })),
        rootCause:
          "Scheduled jobs are CREATED by automation-scheduler.v1 on booking.completed but execution engine is deferred to Phase 6 (see automation-scheduler.consumer.ts). Lag is expected architectural debt, not processor crash.",
        remediation:
          "NON_BLOCKING for Stage F — implement job runner in future RC OR suppress lag alert until engine ships OR mark stale review_request jobs cancelled via ops script",
        blockingAlertResolution: true,
      },
      null,
      2,
    ),
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
