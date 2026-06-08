import type { OpsAlertSeverity } from "@prisma/client";
import prisma from "../lib/prisma";
import { recordOpsMetric } from "../lib/ops-metrics";

export type OpsAlertType =
  | "payment_failure_spike"
  | "refund_failure_spike"
  | "settlement_mismatch"
  | "chargeback_spike"
  | "webhook_failure"
  | "database_slow_query"
  | "redis_failure"
  | "queue_backlog"
  | "provider_dispatch_failure"
  | "notification_failure"
  | "otp_failure";

export class OpsAlertService {
  async raise(
    alertType: OpsAlertType | string,
    severity: OpsAlertSeverity,
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    recordOpsMetric("ops_alerts_total", 1, { alertType, severity });

    const recent = await prisma.opsAlert.count({
      where: {
        alertType,
        resolved: false,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent >= 5) return null;

    return prisma.opsAlert.create({
      data: {
        alertType,
        severity,
        message,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });
  }

  async list(query: { resolved?: boolean; severity?: OpsAlertSeverity; limit?: number } = {}) {
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    return prisma.opsAlert.findMany({
      where: {
        ...(query.resolved !== undefined ? { resolved: query.resolved } : {}),
        ...(query.severity ? { severity: query.severity } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async resolve(id: string) {
    return prisma.opsAlert.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }

  async openCount() {
    return prisma.opsAlert.count({ where: { resolved: false } });
  }
}

export const opsAlertService = new OpsAlertService();
