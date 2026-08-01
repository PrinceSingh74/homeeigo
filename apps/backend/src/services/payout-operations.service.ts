import { PayoutBatchStatus, WithdrawalStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { earningsService } from "./earnings.service";
import { AuditLogService } from "./audit-log.service";

export type PayoutQueueFilters = {
  providerId?: string;
  status?: WithdrawalStatus;
  startDate?: Date;
  endDate?: Date;
  minAmount?: number;
  maxAmount?: number;
  settlementCycle?: string;
};

export class PayoutOperationsService {
  async listQueue(filters: PayoutQueueFilters = {}, limit = 100) {
    const where: Record<string, unknown> = {
      status: filters.status
        ? filters.status
        : { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING, WithdrawalStatus.FAILED] },
    };

    if (filters.providerId) where.providerId = filters.providerId;
    if (filters.startDate || filters.endDate) {
      where.requestedAt = {};
      if (filters.startDate) (where.requestedAt as { gte?: Date }).gte = filters.startDate;
      if (filters.endDate) (where.requestedAt as { lte?: Date }).lte = filters.endDate;
    }
    if (filters.minAmount != null || filters.maxAmount != null) {
      where.netAmount = {};
      if (filters.minAmount != null) (where.netAmount as { gte?: number }).gte = filters.minAmount;
      if (filters.maxAmount != null) (where.netAmount as { lte?: number }).lte = filters.maxAmount;
    }

    return prisma.withdrawal.findMany({
      where,
      orderBy: { requestedAt: "asc" },
      take: limit,
      include: {
        provider: { select: { id: true, businessName: true, walletBalance: true } },
        payoutAttempts: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  async dashboardMetrics() {
    const [pending, processing, settled, failed, avgSettlement] = await Promise.all([
      prisma.withdrawal.count({
        where: { status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED] } },
      }),
      prisma.withdrawal.count({ where: { status: WithdrawalStatus.PROCESSING } }),
      prisma.withdrawal.count({ where: { status: WithdrawalStatus.COMPLETED } }),
      prisma.withdrawal.count({ where: { status: WithdrawalStatus.FAILED } }),
      prisma.$queryRaw<Array<{ avg_hours: number | null }>>`
        SELECT AVG(EXTRACT(EPOCH FROM (completed_at - requested_at)) / 3600) AS avg_hours
        FROM withdrawals
        WHERE status = 'COMPLETED' AND completed_at IS NOT NULL AND requested_at IS NOT NULL
      `,
    ]);

    const pendingAmount = await prisma.withdrawal.aggregate({
      where: { status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING] } },
      _sum: { netAmount: true },
    });

    return {
      totalPending: pending,
      totalProcessing: processing,
      totalSettled: settled,
      failedPayouts: failed,
      pendingAmount: pendingAmount._sum.netAmount ?? 0,
      avgSettlementHours: avgSettlement[0]?.avg_hours
        ? Math.round(Number(avgSettlement[0].avg_hours) * 10) / 10
        : null,
    };
  }

  async verifyIntegrity(withdrawalIds: string[]) {
    const issues: string[] = [];

    const existingInBatch = await prisma.payoutBatchItem.findMany({
      where: {
        withdrawalId: { in: withdrawalIds },
        batch: { status: { notIn: [PayoutBatchStatus.REJECTED, PayoutBatchStatus.FAILED] } },
      },
      select: { withdrawalId: true },
    });
    if (existingInBatch.length > 0) {
      issues.push(`DUPLICATE_BATCH:${existingInBatch.map((i) => i.withdrawalId).join(",")}`);
    }

    const withdrawals = await prisma.withdrawal.findMany({
      where: { id: { in: withdrawalIds } },
      include: { provider: { select: { walletBalance: true } } },
    });

    for (const w of withdrawals) {
      if (w.status === WithdrawalStatus.COMPLETED || w.status === WithdrawalStatus.PROCESSING) {
        issues.push(`ALREADY_PAID:${w.id}`);
      }
      if (w.netAmount <= 0) {
        issues.push(`NEGATIVE_BALANCE:${w.id}`);
      }
      if ((w.provider?.walletBalance ?? 0) < 0) {
        issues.push(`PROVIDER_NEGATIVE:${w.providerId}`);
      }
    }

    const orphanItems = withdrawalIds.filter((id) => !withdrawals.find((w) => w.id === id));
    if (orphanItems.length > 0) {
      issues.push(`ORPHAN:${orphanItems.join(",")}`);
    }

    return { valid: issues.length === 0, issues };
  }

  async retryPayout(withdrawalId: string, adminId: string, ipAddress?: string) {
    const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w) throw new Error("Withdrawal not found");
    if (w.status !== WithdrawalStatus.FAILED) throw new Error("Only failed payouts can be retried");

    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: WithdrawalStatus.APPROVED, failureReason: null },
    });

    void AuditLogService.success("PAYOUT_RETRY", {
      userId: adminId,
      ipAddress,
      details: { withdrawalId },
    });

    return earningsService.processProviderPayout(withdrawalId, adminId);
  }

  async createBatch(withdrawalIds: string[], adminId: string, ipAddress?: string) {
    const integrity = await this.verifyIntegrity(withdrawalIds);
    if (!integrity.valid) throw new Error(`INTEGRITY_FAILED:${integrity.issues.join(";")}`);

    const withdrawals = await prisma.withdrawal.findMany({
      where: {
        id: { in: withdrawalIds },
        status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED] },
      },
    });
    if (withdrawals.length === 0) throw new Error("No eligible withdrawals");

    const batchNumber = `PB-${Date.now()}`;
    const totalAmount = withdrawals.reduce((s, w) => s + w.netAmount, 0);

    const batch = await prisma.payoutBatch.create({
      data: {
        batchNumber,
        status: PayoutBatchStatus.DRAFT,
        totalAmount,
        itemCount: withdrawals.length,
        processedBy: adminId,
        items: {
          create: withdrawals.map((w) => ({
            withdrawalId: w.id,
            amount: w.netAmount,
            status: "PENDING",
          })),
        },
      },
      include: { items: true },
    });

    void AuditLogService.success("PAYOUT_BATCH_PROCESSED", {
      userId: adminId,
      ipAddress,
      details: { action: "CREATE", batchId: batch.id, batchNumber, itemCount: batch.itemCount },
    });

    return batch;
  }

  async submitBatchForReview(batchId: string, adminId: string) {
    const batch = await prisma.payoutBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== PayoutBatchStatus.DRAFT) throw new Error("Batch not in draft state");

    return prisma.payoutBatch.update({
      where: { id: batchId },
      data: { status: PayoutBatchStatus.UNDER_REVIEW, submittedBy: adminId },
    });
  }

  async approveBatch(batchId: string, adminId: string, ipAddress?: string) {
    const batch = await prisma.payoutBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== PayoutBatchStatus.UNDER_REVIEW) throw new Error("Batch not under review");
    if (batch.submittedBy === adminId) throw new Error("MAKER_CANNOT_APPROVE");

    const updated = await prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: PayoutBatchStatus.APPROVED,
        approvedBy: adminId,
        reviewedAt: new Date(),
      },
    });

    void AuditLogService.success("PAYOUT_APPROVED", {
      userId: adminId,
      ipAddress,
      details: { batchId, batchNumber: batch.batchNumber },
    });

    return updated;
  }

  async rejectBatch(batchId: string, adminId: string, reason: string, ipAddress?: string) {
    const batch = await prisma.payoutBatch.findUnique({ where: { id: batchId } });
    if (!batch) throw new Error("Batch not found");
    const rejectable: PayoutBatchStatus[] = [PayoutBatchStatus.DRAFT, PayoutBatchStatus.UNDER_REVIEW];
    if (!rejectable.includes(batch.status)) {
      throw new Error("Batch cannot be rejected in current state");
    }

    const updated = await prisma.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: PayoutBatchStatus.REJECTED,
        rejectedBy: adminId,
        rejectionReason: reason,
        reviewedAt: new Date(),
      },
    });

    void AuditLogService.success("PAYOUT_REJECTED", {
      userId: adminId,
      ipAddress,
      reason,
      details: { batchId, batchNumber: batch.batchNumber },
    });

    return updated;
  }

  async processBatch(batchId: string, adminId: string, ipAddress?: string) {
    const batch = await prisma.payoutBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== PayoutBatchStatus.APPROVED) {
      throw new Error("Batch must be approved before processing");
    }

    await prisma.payoutBatch.update({
      where: { id: batchId },
      data: { status: PayoutBatchStatus.PROCESSING },
    });

    let succeeded = 0;
    let failed = 0;

    for (const item of batch.items) {
      try {
        await earningsService.approveWithdrawal(item.withdrawalId, adminId);
        await earningsService.processProviderPayout(item.withdrawalId, adminId);
        await prisma.payoutBatchItem.update({
          where: { id: item.id },
          data: { status: "PROCESSING" },
        });
        succeeded += 1;
      } catch (err) {
        failed += 1;
        await prisma.payoutBatchItem.update({
          where: { id: item.id },
          data: {
            status: "FAILED",
            failureReason: err instanceof Error ? err.message : "Payout failed",
          },
        });
      }
    }

    const finalStatus =
      failed === batch.items.length ? PayoutBatchStatus.FAILED : PayoutBatchStatus.COMPLETED;

    await prisma.payoutBatch.update({
      where: { id: batchId },
      data: { status: finalStatus, completedAt: new Date() },
    });

    await this.reconcileBatch(batchId, succeeded, failed);

    void AuditLogService.success("PAYOUT_BATCH_PROCESSED", {
      userId: adminId,
      ipAddress,
      details: { batchId, succeeded, failed, status: finalStatus },
    });

    return { batchId, succeeded, failed, status: finalStatus };
  }

  async reconcileBatch(batchId: string, matched?: number, mismatched?: number) {
    const batch = await prisma.payoutBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    if (!batch) return null;

    let m = matched ?? 0;
    let mm = mismatched ?? 0;

    if (matched == null) {
      for (const item of batch.items) {
        const w = await prisma.withdrawal.findUnique({ where: { id: item.withdrawalId } });
        if (w?.status === "COMPLETED" || w?.status === "PROCESSING") m += 1;
        else mm += 1;
      }
    }

    return prisma.payoutReconciliation.create({
      data: {
        batchId,
        matched: m,
        mismatched: mm,
        report: JSON.stringify({ batchNumber: batch.batchNumber, matched: m, mismatched: mm }),
      },
    });
  }

  async listBatches(limit = 30, status?: PayoutBatchStatus) {
    return prisma.payoutBatch.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { _count: { select: { items: true } } },
    });
  }

  async getBatchDetail(batchId: string) {
    return prisma.payoutBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          include: {
            batch: false,
          },
        },
        reconciliations: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
  }
}

export const payoutOperationsService = new PayoutOperationsService();
