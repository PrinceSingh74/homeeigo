import prisma from "../lib/prisma";
import { listCanonicalPartnerEvents } from "../events/catalog/partner-event-catalog";
import { listTriggers, triggeredEventTypes } from "../automation/registry/trigger-registry";
import { listWorkflows, quarantinedDefinitions } from "../automation/registry/workflow-registry";
import { listConditions } from "../automation/conditions/condition-registry";
import { engineExecutes } from "../automation/registry/capability-fingerprint";
import { replayDeadLetterById } from "../events/core/replay";
import { AuditLogService } from "./audit-log.service";

export class AdminAutomationService {
  async getOverview() {
    const [
      workflowRows,
      instanceCounts,
      outboxPending,
      outboxFailed,
      dlqCount,
      deliveryFailed,
      shadowCount,
    ] = await Promise.all([
      prisma.workflowDefinition.findMany({
        orderBy: [{ workflowId: "asc" }, { version: "desc" }],
        select: {
          workflowId: true,
          version: true,
          name: true,
          status: true,
          executionMode: true,
          certificationStatus: true,
          riskClass: true,
          updatedAt: true,
        },
      }),
      prisma.workflowInstance.groupBy({
        by: ["status"],
        _count: true,
      }),
      prisma.eventOutbox.count({ where: { status: "PENDING" } }),
      prisma.eventOutbox.count({ where: { status: "FAILED" } }),
      prisma.eventDeadLetter.count(),
      prisma.notificationDelivery.count({ where: { status: "FAILED" } }),
      prisma.automationShadowExecution.count(),
    ]);

    const registered = listWorkflows().map((w) => ({
      workflowId: w.workflowId,
      version: w.version,
      name: w.name,
      trigger: w.trigger,
      executionMode: w.executionMode ?? "LIVE",
      certificationStatus: w.certificationStatus ?? "DRAFT",
      riskClass: w.riskClass ?? null,
      stepCount: w.steps.length,
      /**
       * Steps the engine will refuse rather than run.
       *
       * ACTION and ESCALATION are declared in the type system and terminate at NOT_IMPLEMENTED in
       * the step executor. Without this, the console showed a fully-formed workflow with an
       * escalation step and gave an operator no way to know that certifying it LIVE would produce
       * silence where they expected a queue entry — the workflow would run, advance and complete,
       * and the escalation would simply never have happened.
       */
      unexecutableSteps: w.steps
        .filter((s) => !engineExecutes(s.type))
        .map((s) => ({ stepId: s.id, type: s.type })),
      metadata: w.metadata ?? {},
    }));

    return {
      workflows: { registered, persisted: workflowRows },
      triggers: listTriggers(),
      triggeredEventTypes: triggeredEventTypes(),
      conditions: listConditions(),
      canonicalEvents: listCanonicalPartnerEvents(),
      quarantined: quarantinedDefinitions(),
      metrics: {
        outboxPending,
        outboxFailed,
        dlqCount,
        notificationDeliveryFailed: deliveryFailed,
        shadowExecutions: shadowCount,
        instancesByStatus: Object.fromEntries(instanceCounts.map((r) => [r.status, r._count])),
      },
    };
  }

  async listInstances(query: { workflowId?: string; status?: string; limit?: number }) {
    const limit = Math.min(query.limit ?? 50, 100);
    const rows = await prisma.workflowInstance.findMany({
      where: {
        ...(query.workflowId ? { workflowId: query.workflowId } : {}),
        ...(query.status ? { status: query.status as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        workflowId: true,
        workflowVersion: true,
        status: true,
        executionMode: true,
        subjectType: true,
        subjectId: true,
        triggerEventId: true,
        stepIndex: true,
        stepCount: true,
        createdAt: true,
        completedAt: true,
        nextRunAt: true,
      },
    });
    return rows;
  }

  async listDeadLetters(limit = 50) {
    const rows = await prisma.eventDeadLetter.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 100),
      select: {
        id: true,
        eventId: true,
        eventType: true,
        consumerName: true,
        error: true,
        attempts: true,
        createdAt: true,
        lastAttemptAt: true,
        resolvedAt: true,
        resolution: true,
      },
    });
    // Schema field is `error`. The Admin console and API contract use `errorMessage`.
    return rows.map((row) => ({
      id: row.id,
      eventId: row.eventId,
      eventType: row.eventType,
      consumerName: row.consumerName,
      errorMessage: row.error,
      attempts: row.attempts,
      createdAt: row.createdAt,
      lastAttemptAt: row.lastAttemptAt,
      resolvedAt: row.resolvedAt,
      resolution: row.resolution,
    }));
  }

  async listOutbox(query: { status?: string; limit?: number }) {
    const limit = Math.min(query.limit ?? 50, 100);
    return prisma.eventOutbox.findMany({
      where: query.status ? { status: query.status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        eventId: true,
        eventType: true,
        status: true,
        attempts: true,
        createdAt: true,
        publishedAt: true,
        lastError: true,
      },
    });
  }

  /**
   * Replaying a dead letter re-runs a consumer against a real event. §56 — that is a governance
   * act, so it is recorded through the canonical audit service rather than as a bare ActivityLog
   * row, and it carries an actor and a stated reason.
   *
   * Two things were wrong with what this replaced. The audit was an `activityLog.create` whose
   * failure was swallowed by `.catch(() => undefined)`, so a replay could execute with no record
   * of it at all — the audit failed open on exactly the operation that most needs a trail. And
   * nothing captured *why*: "someone replayed event X" without a reason is a log line, not an
   * audit. The event is now written before the reason can be lost and the replay result, whether
   * it succeeded or refused, is part of the record.
   */
  async replayDeadLetter(id: string, adminId: string, reason: string, traceId?: string) {
    const stated = reason.trim();
    if (stated.length < 10) {
      return {
        replayed: false,
        reason: "REASON_REQUIRED",
        detail: "A replay reason of at least 10 characters is required — re-running a consumer against a real event without a stated cause is not auditable.",
      };
    }

    const dlq = await prisma.eventDeadLetter.findUnique({
      where: { id },
      select: { eventId: true, eventType: true, consumerName: true },
    });

    const result = await replayDeadLetterById(id);

    await AuditLogService.recordGoverned("EVENT_REPLAY_EXECUTED", result.replayed ? "success" : "failure", {
      userId: adminId,
      traceId,
      reason: stated,
      details: {
        scope: "DEAD_LETTER",
        deadLetterId: id,
        eventId: dlq?.eventId,
        eventType: dlq?.eventType,
        targetConsumer: dlq?.consumerName,
        forced: false,
        replayed: result.replayed,
        outcome: result.reason,
      },
    });

    return result;
  }
}

export const adminAutomationService = new AdminAutomationService();
