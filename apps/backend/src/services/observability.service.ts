import prisma from "../lib/prisma";
import { redisClient } from "../lib/redis";
import { roomManager } from "../lib/websocket";
import { getRecentSpans, getSpanBufferSize, getTraceDomainCounts } from "../lib/tracing";
import { getSchedulerInstanceId } from "../lib/distributed-scheduler";
import { observability as sentryObs } from "../lib/observability";
import { logAggregationService } from "./log-aggregation.service";
import { opsAlertService } from "./ops-alert.service";
import { financeAlertService } from "./finance-alert.service";
import { alertEvaluatorService } from "./alert-evaluator.service";

async function checkDatabase() {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: "healthy" as const, latencyMs: Date.now() - start };
  } catch (err) {
    return {
      status: "unhealthy" as const,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : "query failed",
    };
  }
}

export class ObservabilityService {
  async getHealthDashboard() {
    const [database, redis, wsStats, logStats, openOpsAlerts, openFinanceAlerts] =
      await Promise.all([
        checkDatabase(),
        redisClient.getMetrics(),
        Promise.resolve(roomManager.getStats()),
        logAggregationService.stats(),
        opsAlertService.openCount(),
        financeAlertService.listOpen(1).then((r) => r.length),
      ]);

    alertEvaluatorService.updateWsMetrics();

    const pendingPayments = await prisma.payment.count({
      where: { status: "PENDING" },
    });
    const pendingAssignments = await prisma.assignmentJob.count({
      where: { status: "PENDING" },
    });
    const integrityRun = await prisma.financialIntegrityRun.findFirst({
      orderBy: { createdAt: "desc" },
    });

    return {
      timestamp: new Date().toISOString(),
      instanceId: getSchedulerInstanceId(),
      wsInstanceId: roomManager.instance,
      sentry: { enabled: sentryObs.isEnabled },
      serviceHealth: {
        database,
        redis: {
          status: redis.available ? "healthy" : redis.enabled ? "degraded" : "disabled",
          topology: redis.topology,
          connectedClients: redis.connectedClients,
          hitRate: redis.hitRate,
        },
        websocket: {
          status: "healthy",
          totalConnections: wsStats.totalConnections,
          totalRooms: wsStats.totalRooms,
          redisFanout: redis.available,
        },
        queue: {
          status: pendingAssignments > 100 ? "degraded" : "healthy",
          assignmentBacklog: pendingAssignments,
        },
        payments: {
          status: pendingPayments > 50 ? "degraded" : "healthy",
          pending: pendingPayments,
        },
        finance: {
          status: integrityRun?.status === "FAIL" ? "degraded" : "healthy",
          lastIntegrityStatus: integrityRun?.status ?? "unknown",
          openAlerts: openFinanceAlerts,
        },
      },
      alerts: {
        opsOpen: openOpsAlerts,
        financeOpen: openFinanceAlerts,
      },
      logs: logStats,
      tracing: {
        bufferSize: getSpanBufferSize(),
        domainCounts: getTraceDomainCounts(),
        recentSpans: getRecentSpans(20),
      },
    };
  }

  async listAlerts(query: { limit?: number; resolved?: boolean } = {}) {
    const [ops, finance] = await Promise.all([
      opsAlertService.list({
        limit: query.limit ?? 50,
        resolved: query.resolved,
      }),
      financeAlertService.listOpen(query.limit ?? 50),
    ]);

    const unified = [
      ...ops.map((a) => ({
        id: a.id,
        source: "ops" as const,
        alertType: a.alertType,
        severity: a.severity,
        message: a.message,
        metadata: a.metadata ? safeJson(a.metadata) : null,
        resolved: a.resolved,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt?.toISOString() ?? null,
      })),
      ...finance.map((a) => ({
        id: a.id,
        source: "finance" as const,
        alertType: a.alertType,
        severity: a.severity,
        message: a.message,
        metadata: a.metadata ? safeJson(a.metadata) : null,
        resolved: a.resolved,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt?.toISOString() ?? null,
      })),
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return unified.slice(0, query.limit ?? 50);
  }

  async resolveAlert(source: "ops" | "finance", id: string) {
    if (source === "ops") return opsAlertService.resolve(id);
    return financeAlertService.resolve(id);
  }

  async runAlertEvaluation() {
    return alertEvaluatorService.evaluateAll();
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export const observabilityService = new ObservabilityService();
