/**
 * Resolve historical ops alerts whose underlying condition is no longer active.
 *
 *   bun --env-file=.env run scripts/resolve-stale-ops-alerts.ts
 *   bun --env-file=.env run scripts/resolve-stale-ops-alerts.ts --apply
 */
import "../src/load-env";
import prisma from "../src/lib/prisma";
import { redisClient } from "../src/lib/redis";

const apply = process.argv.includes("--apply");

async function main() {
  if (redisClient.isEnabled) await redisClient.connect();

  const redisHealthy = !redisClient.isEnabled || (await redisClient.healthCheck());
  let dbHealthy = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbHealthy = true;
  } catch {
    dbHealthy = false;
  }

  const open = await prisma.opsAlert.findMany({
    where: { resolved: false },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });

  const toResolve: string[] = [];
  for (const alert of open) {
    if (alert.alertType === "redis_failure" && redisHealthy) {
      toResolve.push(alert.id);
      continue;
    }
    if (alert.alertType === "database_slow_query" && dbHealthy) {
      // Transient slow-query spikes — auto-resolve when DB probe is healthy now.
      toResolve.push(alert.id);
      continue;
    }
    if (alert.alertType === "settlement_mismatch") {
      const latest = await prisma.settlementSyncRun.findFirst({ orderBy: { startedAt: "desc" } });
      if (latest && latest.discrepanciesFound === 0) {
        toResolve.push(alert.id);
      }
    }
  }

  const unique = [...new Set(toResolve)];
  console.log(
    JSON.stringify(
      {
        openTotal: open.length,
        candidates: unique.length,
        redisHealthy,
        dbHealthy,
        apply,
      },
      null,
      2,
    ),
  );

  if (apply && unique.length > 0) {
    const result = await prisma.opsAlert.updateMany({
      where: { id: { in: unique } },
      data: { resolved: true, resolvedAt: new Date() },
    });
    console.log(`Resolved ${result.count} stale ops alerts`);
  }

  // Bulk-resolve historical settlement_mismatch when the latest sync is clean.
  const latestSync = await prisma.settlementSyncRun.findFirst({ orderBy: { startedAt: "desc" } });
  if (apply && latestSync && latestSync.discrepanciesFound === 0) {
    const settled = await prisma.opsAlert.updateMany({
      where: { resolved: false, alertType: "settlement_mismatch" },
      data: { resolved: true, resolvedAt: new Date() },
    });
    if (settled.count > 0) console.log(`Resolved ${settled.count} historical settlement_mismatch alerts`);
  }

  // Historical spike alerts: resolve when current hourly condition is no longer active.
  if (apply) {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const failedOtp = await prisma.activityLog.count({
      where: { action: "FAILED_LOGIN", createdAt: { gte: since } },
    });
    const failedRefunds = await prisma.refundRequest.count({
      where: { status: "FAILED", createdAt: { gte: since } },
    });
    if (failedOtp < 50) {
      const otpCleared = await prisma.opsAlert.updateMany({
        where: { resolved: false, alertType: "otp_failure" },
        data: { resolved: true, resolvedAt: new Date() },
      });
      if (otpCleared.count > 0) console.log(`Resolved ${otpCleared.count} historical otp_failure alerts (current=${failedOtp}/hr)`);
    }
    if (failedRefunds < 5) {
      const refundCleared = await prisma.opsAlert.updateMany({
        where: { resolved: false, alertType: "refund_failure_spike" },
        data: { resolved: true, resolvedAt: new Date() },
      });
      if (refundCleared.count > 0) console.log(`Resolved ${refundCleared.count} historical refund_failure_spike alerts (current=${failedRefunds}/hr)`);
    }
  }

  // Resolve redis_failure alerts when Redis is currently healthy.
  if (apply && redisHealthy) {
    const redisCleared = await prisma.opsAlert.updateMany({
      where: { resolved: false, alertType: "redis_failure" },
      data: { resolved: true, resolvedAt: new Date() },
    });
    if (redisCleared.count > 0) console.log(`Resolved ${redisCleared.count} redis_failure alerts`);
  }

  const remaining = await prisma.opsAlert.count({ where: { resolved: false } });
  console.log(`Open ops alerts remaining: ${remaining}`);
  process.exit(remaining > 0 && apply ? 0 : remaining === 0 ? 0 : 1);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
