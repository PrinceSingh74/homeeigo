import { SettlementResolutionStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { financeAlertService } from "./finance-alert.service";

const HIGH_VALUE_THRESHOLD = 50_000;

export class SettlementResolutionService {
  async getDetail(discrepancyId: string) {
    return prisma.settlementDiscrepancy.findUnique({
      where: { id: discrepancyId },
      include: {
        notes: { orderBy: { createdAt: "asc" } },
        syncRun: { select: { id: true, startedAt: true, accuracyPct: true } },
      },
    });
  }

  async assign(discrepancyId: string, adminId: string) {
    const row = await prisma.settlementDiscrepancy.findUnique({ where: { id: discrepancyId } });
    if (!row) throw new Error("DISCREPANCY_NOT_FOUND");
    if (row.resolved) throw new Error("ALREADY_RESOLVED");

    const updated = await prisma.settlementDiscrepancy.update({
      where: { id: discrepancyId },
      data: {
        status: SettlementResolutionStatus.ASSIGNED,
        assignedTo: adminId,
        assignedAt: new Date(),
      },
    });

    await this.addNote(discrepancyId, adminId, "Case assigned for investigation");
    void AuditLogService.success("SETTLEMENT_RECORDED", {
      userId: adminId,
      details: { action: "ASSIGN", discrepancyId },
    });

    return updated;
  }

  async investigate(discrepancyId: string, adminId: string) {
    const row = await prisma.settlementDiscrepancy.findUnique({ where: { id: discrepancyId } });
    if (!row) throw new Error("DISCREPANCY_NOT_FOUND");
    if (row.resolved) throw new Error("ALREADY_RESOLVED");

    return prisma.settlementDiscrepancy.update({
      where: { id: discrepancyId },
      data: { status: SettlementResolutionStatus.INVESTIGATING, assignedTo: adminId },
    });
  }

  async escalate(discrepancyId: string, adminId: string, reason: string) {
    const row = await prisma.settlementDiscrepancy.findUnique({ where: { id: discrepancyId } });
    if (!row) throw new Error("DISCREPANCY_NOT_FOUND");
    if (row.resolved) throw new Error("ALREADY_RESOLVED");

    const updated = await prisma.settlementDiscrepancy.update({
      where: { id: discrepancyId },
      data: {
        status: SettlementResolutionStatus.ESCALATED,
        escalatedAt: new Date(),
      },
    });

    await this.addNote(discrepancyId, adminId, `Escalated: ${reason}`);
    await financeAlertService.raise("SETTLEMENT_MISMATCH", "HIGH", `Escalated settlement discrepancy ${discrepancyId}`, {
      discrepancyId,
      reason,
    });

    return updated;
  }

  async approveResolution(discrepancyId: string, adminId: string, notes?: string) {
    const row = await prisma.settlementDiscrepancy.findUnique({ where: { id: discrepancyId } });
    if (!row) throw new Error("DISCREPANCY_NOT_FOUND");
    if (row.resolved) throw new Error("ALREADY_RESOLVED");

    const amount = Math.max(row.expectedAmount ?? 0, row.actualAmount ?? 0);
    const requiresDual = amount >= HIGH_VALUE_THRESHOLD;

    if (requiresDual) {
      if (!row.firstApprovedBy) {
        const updated = await prisma.settlementDiscrepancy.update({
          where: { id: discrepancyId },
          data: {
            firstApprovedBy: adminId,
            status: SettlementResolutionStatus.INVESTIGATING,
            resolutionNotes: notes ?? row.resolutionNotes,
          },
        });
        await this.addNote(discrepancyId, adminId, `First approval recorded (dual approval required, amount ≥ ${HIGH_VALUE_THRESHOLD})`);
        return { ...updated, pendingSecondApproval: true };
      }

      if (row.firstApprovedBy === adminId) {
        throw new Error("MAKER_CANNOT_APPROVE_TWICE");
      }

      const updated = await prisma.settlementDiscrepancy.update({
        where: { id: discrepancyId },
        data: {
          secondApprovedBy: adminId,
          resolved: true,
          resolvedAt: new Date(),
          resolvedBy: adminId,
          status: SettlementResolutionStatus.RESOLVED,
          resolutionNotes: notes ?? row.resolutionNotes,
        },
      });

      await this.addNote(discrepancyId, adminId, "Second approval — case resolved");
      void AuditLogService.success("SETTLEMENT_RECORDED", {
        userId: adminId,
        details: { action: "RESOLVE_DUAL", discrepancyId, amount },
      });

      return { ...updated, pendingSecondApproval: false };
    }

    const updated = await prisma.settlementDiscrepancy.update({
      where: { id: discrepancyId },
      data: {
        resolved: true,
        resolvedAt: new Date(),
        resolvedBy: adminId,
        status: SettlementResolutionStatus.RESOLVED,
        resolutionNotes: notes ?? row.resolutionNotes,
      },
    });

    await this.addNote(discrepancyId, adminId, notes ?? "Resolved");
    void AuditLogService.success("SETTLEMENT_RECORDED", {
      userId: adminId,
      details: { action: "RESOLVE", discrepancyId },
    });

    return { ...updated, pendingSecondApproval: false };
  }

  async addNote(discrepancyId: string, authorId: string, body: string, attachmentKey?: string) {
    return prisma.settlementResolutionNote.create({
      data: { discrepancyId, authorId, body, attachmentKey },
    });
  }

  async healthScore() {
    const [total, open, resolved, escalated, avgResolutionMs] = await Promise.all([
      prisma.settlementDiscrepancy.count(),
      prisma.settlementDiscrepancy.count({ where: { resolved: false } }),
      prisma.settlementDiscrepancy.count({ where: { resolved: true } }),
      prisma.settlementDiscrepancy.count({ where: { status: SettlementResolutionStatus.ESCALATED } }),
      prisma.$queryRaw<Array<{ avg_ms: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) * 1000) AS avg_ms
        FROM settlement_discrepancies
        WHERE resolved = true AND resolved_at IS NOT NULL
      `,
    ]);

    const resolutionRate = total > 0 ? round2((resolved / total) * 100) : 100;
    const healthScore = round2(Math.max(0, resolutionRate - open * 0.5 - escalated * 2));

    return {
      total,
      open,
      resolved,
      escalated,
      resolutionRate,
      healthScore,
      avgResolutionHours: avgResolutionMs[0]?.avg_ms
        ? round2(Number(avgResolutionMs[0].avg_ms) / 3_600_000)
        : null,
    };
  }

  async listOpen(limit = 100) {
    return prisma.settlementDiscrepancy.findMany({
      where: { resolved: false },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { _count: { select: { notes: true } } },
    });
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const settlementResolutionService = new SettlementResolutionService();
