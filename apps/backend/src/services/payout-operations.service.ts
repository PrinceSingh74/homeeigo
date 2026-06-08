import { PayoutBatchStatus, WithdrawalStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { earningsService } from "./earnings.service";
import { AuditLogService } from "./audit-log.service";

export class PayoutOperationsService {
  async listQueue(status?: WithdrawalStatus, limit = 100) {
    return prisma.withdrawal.findMany({
      where: status ? { status } : { status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING, WithdrawalStatus.FAILED] } },
      orderBy: { requestedAt: "asc" },
      take: limit,
      include: {
        provider: { select: { id: true, businessName: true, walletBalance: true } },
        payoutAttempts: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  async retryPayout(withdrawalId: string, adminId: string) {
    const w = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!w) throw new Error("Withdrawal not found");
    if (w.status !== WithdrawalStatus.FAILED) throw new Error("Only failed payouts can be retried");

    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: WithdrawalStatus.APPROVED, failureReason: null },
    });

    void AuditLogService.success("PAYOUT_RETRY", {
      userId: adminId,
      details: { withdrawalId },
    });

    return earningsService.processProviderPayout(withdrawalId, adminId);
  }

  async createBatch(withdrawalIds: string[], adminId: string) {
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

    return batch;
  }

  async processBatch(batchId: string, adminId: string) {
    const batch = await prisma.payoutBatch.findUnique({
      where: { id: batchId },
      include: { items: true },
    });
    if (!batch) throw new Error("Batch not found");
    if (batch.status !== PayoutBatchStatus.DRAFT) throw new Error("Batch already processed");

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
      details: { batchId, succeeded, failed },
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

  async listBatches(limit = 30) {
    return prisma.payoutBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { _count: { select: { items: true } } },
    });
  }
}

export const payoutOperationsService = new PayoutOperationsService();
