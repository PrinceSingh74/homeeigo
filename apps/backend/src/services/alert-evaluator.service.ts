import prisma from "../lib/prisma";
import { redisClient } from "../lib/redis";
import { roomManager } from "../lib/websocket";
import { opsAlertService } from "./ops-alert.service";
import { setOpsGauge } from "../lib/ops-metrics";

export class AlertEvaluatorService {
  async evaluateAll(): Promise<{ raised: number }> {
    let raised = 0;
    const checks = [
      this.checkPaymentFailures(),
      this.checkRefundFailures(),
      this.checkSettlementMismatch(),
      this.checkChargebackSpike(),
      this.checkWebhookFailures(),
      this.checkDatabaseLatency(),
      this.checkRedis(),
      this.checkQueueBacklog(),
      this.checkProviderDispatch(),
      this.checkNotificationFailures(),
      this.checkOtpFailures(),
    ];
    const results = await Promise.all(checks);
    raised = results.filter(Boolean).length;
    return { raised };
  }

  private async checkPaymentFailures(): Promise<boolean> {
    const since = new Date(Date.now() - 15 * 60 * 1000);
    const failed = await prisma.payment.count({
      where: { status: "FAILED", createdAt: { gte: since } },
    });
    if (failed >= 10) {
      await opsAlertService.raise(
        "payment_failure_spike",
        "CRITICAL",
        `${failed} payment failures in last 15 minutes`,
        { failed, windowMinutes: 15 },
      );
      return true;
    }
    return false;
  }

  private async checkRefundFailures(): Promise<boolean> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const failed = await prisma.refundRequest.count({
      where: { status: "FAILED", createdAt: { gte: since } },
    });
    if (failed >= 5) {
      await opsAlertService.raise(
        "refund_failure_spike",
        "WARNING",
        `${failed} refund failures in last hour`,
        { failed },
      );
      return true;
    }
    return false;
  }

  private async checkSettlementMismatch(): Promise<boolean> {
    const run = await prisma.settlementSyncRun.findFirst({
      orderBy: { startedAt: "desc" },
    });
    if (run && run.discrepanciesFound > 0) {
      await opsAlertService.raise(
        "settlement_mismatch",
        "CRITICAL",
        `Settlement sync found ${run.discrepanciesFound} discrepancies`,
        { runId: run.id, discrepancies: run.discrepanciesFound },
      );
      return true;
    }
    return false;
  }

  private async checkChargebackSpike(): Promise<boolean> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const count = await prisma.chargeback.count({
      where: { createdAt: { gte: since } },
    });
    if (count >= 10) {
      await opsAlertService.raise(
        "chargeback_spike",
        "ESCALATION",
        `${count} chargebacks in last 24 hours`,
        { count },
      );
      return true;
    }
    return false;
  }

  private async checkWebhookFailures(): Promise<boolean> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const failed = await prisma.appLogEntry.count({
      where: {
        category: "WEBHOOK",
        level: "error",
        createdAt: { gte: since },
      },
    });
    if (failed >= 20) {
      await opsAlertService.raise(
        "webhook_failure",
        "WARNING",
        `${failed} webhook errors in last hour`,
        { failed },
      );
      return true;
    }
    return false;
  }

  private async checkDatabaseLatency(): Promise<boolean> {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      const ms = Date.now() - start;
      if (ms > 500) {
        await opsAlertService.raise(
          "database_slow_query",
          "WARNING",
          `Database probe latency ${ms}ms exceeds 500ms`,
          { latencyMs: ms },
        );
        return true;
      }
    } catch (err) {
      await opsAlertService.raise(
        "database_slow_query",
        "CRITICAL",
        `Database probe failed: ${err instanceof Error ? err.message : "unknown"}`,
      );
      return true;
    }
    return false;
  }

  private async checkRedis(): Promise<boolean> {
    if (!redisClient.isEnabled) return false;
    const ok = await redisClient.healthCheck();
    setOpsGauge("redis_up_gauge", ok ? 1 : 0);
    if (!ok) {
      await opsAlertService.raise("redis_failure", "CRITICAL", "Redis health check failed");
      return true;
    }
    return false;
  }

  private async checkQueueBacklog(): Promise<boolean> {
    const pending = await prisma.assignmentJob.count({
      where: { status: { in: ["PENDING", "DISPATCHED"] } },
    });
    setOpsGauge("assignment_queue_backlog", pending);
    if (pending >= 100) {
      await opsAlertService.raise(
        "queue_backlog",
        "WARNING",
        `Assignment queue backlog: ${pending} jobs`,
        { pending },
      );
      return true;
    }
    return false;
  }

  private async checkProviderDispatch(): Promise<boolean> {
    const since = new Date(Date.now() - 30 * 60 * 1000);
    const failed = await prisma.assignmentJob.count({
      where: { status: { in: ["TIMEOUT", "EXHAUSTED"] }, updatedAt: { gte: since } },
    });
    if (failed >= 10) {
      await opsAlertService.raise(
        "provider_dispatch_failure",
        "WARNING",
        `${failed} provider dispatch failures in 30 minutes`,
        { failed },
      );
      return true;
    }
    return false;
  }

  private async checkNotificationFailures(): Promise<boolean> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const failed = await prisma.appLogEntry.count({
      where: {
        category: "APPLICATION",
        level: "error",
        message: { contains: "notification", mode: "insensitive" },
        createdAt: { gte: since },
      },
    });
    if (failed >= 15) {
      await opsAlertService.raise(
        "notification_failure",
        "WARNING",
        `${failed} notification delivery errors in last hour`,
        { failed },
      );
      return true;
    }
    return false;
  }

  private async checkOtpFailures(): Promise<boolean> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const failed = await prisma.activityLog.count({
      where: {
        action: "FAILED_LOGIN",
        createdAt: { gte: since },
      },
    });
    if (failed >= 50) {
      await opsAlertService.raise(
        "otp_failure",
        "INFO",
        `${failed} failed login/OTP attempts in last hour`,
        { failed },
      );
      return true;
    }
    return false;
  }

  updateWsMetrics(): void {
    const stats = roomManager.getStats();
    setOpsGauge("ws_connections_total", stats.totalConnections);
    setOpsGauge("ws_rooms_total", stats.totalRooms);
  }
}

export const alertEvaluatorService = new AlertEvaluatorService();
