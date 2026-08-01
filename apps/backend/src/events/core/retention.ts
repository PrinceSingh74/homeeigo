import prisma from "../../lib/prisma";
import { eventPlatformConfig } from "./config";
import { countUnresolvedDeadLetters } from "./dead-letter";

export async function cleanupEventPlatformData(): Promise<{
  publishedOutbox: number;
  consumerReceipts: number;
  resolvedDlq: number;
  completedJobs: number;
}> {
  const now = Date.now();
  const publishedCutoff = new Date(now - eventPlatformConfig.publishedRetentionDays * 86_400_000);
  const receiptCutoff = new Date(now - eventPlatformConfig.receiptRetentionDays * 86_400_000);
  const dlqCutoff = new Date(now - eventPlatformConfig.dlqRetentionDays * 86_400_000);
  const jobCutoff = new Date(now - eventPlatformConfig.scheduledJobRetentionDays * 86_400_000);

  const [publishedOutbox, consumerReceipts, resolvedDlq, completedJobs] = await Promise.all([
    prisma.eventOutbox.deleteMany({
      where: { status: "PUBLISHED", publishedAt: { lt: publishedCutoff } },
    }),
    prisma.eventConsumerReceipt.deleteMany({ where: { processedAt: { lt: receiptCutoff } } }),
    prisma.eventDeadLetter.deleteMany({
      where: { resolvedAt: { not: null, lt: dlqCutoff } },
    }),
    prisma.scheduledJob.deleteMany({
      where: {
        OR: [
          { status: "completed", completedAt: { lt: jobCutoff } },
          { status: "cancelled", cancelledAt: { lt: jobCutoff } },
        ],
      },
    }),
  ]);

  return {
    publishedOutbox: publishedOutbox.count,
    consumerReceipts: consumerReceipts.count,
    resolvedDlq: resolvedDlq.count,
    completedJobs: completedJobs.count,
  };
}

export async function refreshEventPlatformGauges(): Promise<void> {
  const { setGauge } = await import("../../lib/metrics");
  const [pending, oldest, scheduledPending, scheduledLag, dlqUnresolved] = await Promise.all([
    prisma.eventOutbox.count({ where: { status: { in: ["PENDING", "PROCESSING", "FAILED"] } } }),
    prisma.eventOutbox.findFirst({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.scheduledJob.count({ where: { status: "pending" } }),
    prisma.scheduledJob.findFirst({
      where: { status: "pending", runAt: { lt: new Date() } },
      orderBy: { runAt: "asc" },
      select: { runAt: true },
    }),
    countUnresolvedDeadLetters(),
  ]);

  setGauge("homigo_outbox_pending", pending);
  setGauge(
    "homigo_outbox_oldest_pending_age_seconds",
    oldest ? Math.max(0, (Date.now() - oldest.createdAt.getTime()) / 1000) : 0,
  );
  setGauge("homigo_scheduled_jobs_pending", scheduledPending);
  setGauge(
    "homigo_scheduled_job_lag_seconds",
    scheduledLag ? Math.max(0, (Date.now() - scheduledLag.runAt.getTime()) / 1000) : 0,
  );
  setGauge("homigo_dlq_unresolved", dlqUnresolved);
}
