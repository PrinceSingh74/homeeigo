import type { OpsAlertSeverity } from "@prisma/client";
import prisma from "../lib/prisma";
import { recordOpsMetric } from "../lib/ops-metrics";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildOpsAlertRaisedEvent } from "../events/catalog/support-ops.events";

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
  | "otp_failure"
  | "retention_job_failed";

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

    /**
     * Phase 16 — the alert row and its event are written in ONE transaction.
     *
     * Placed AFTER the suppression check, deliberately. `raise` returns null once five unresolved
     * alerts of a type exist within the hour, and nothing is created — publishing an event on that
     * path would announce an alert that does not exist, and any consumer acting on it would be
     * acting on nothing. The event follows the row: no row, no event.
     *
     * A transaction for a single insert plus its outbox row looks heavier than it is, and it is
     * the only way the two cannot diverge. Without it an alert could exist with no event (a
     * missed agent investigation) or an event could exist with no alert (a consumer chasing a
     * dangling id) depending on which write failed.
     *
     * The payload carries the alert id, type and severity — never `message` or `metadata`. Alert
     * messages are formatted by their producers and routinely embed identifiers, amounts and
     * request context; the consumer that needs the detail reads it through the governed
     * `read.ops.getAlerts` tool.
     */
    return prisma.$transaction(async (tx) => {
      const alert = await tx.opsAlert.create({
        data: {
          alertType,
          severity,
          message,
          metadata: metadata ? JSON.stringify(metadata) : undefined,
        },
      });

      await emitInTransaction(
        tx,
        buildOpsAlertRaisedEvent({
          alertId: alert.id,
          alertType: alert.alertType,
          severity: alert.severity,
          createdAt: alert.createdAt,
        }),
      );

      return alert;
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
