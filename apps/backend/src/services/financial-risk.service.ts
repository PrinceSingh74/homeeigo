import { FinancialRiskLevel } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";

export class FinancialRiskService {
  async recordEvent(opts: {
    userId?: string;
    eventType: string;
    severity: FinancialRiskLevel;
    referenceId?: string;
    referenceType?: string;
    metadata?: Record<string, unknown>;
  }) {
    const recent = await prisma.financialRiskEvent.count({
      where: {
        userId: opts.userId,
        eventType: opts.eventType,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent >= 5) {
      const fraudCase = await this.openCase({
        userId: opts.userId,
        category: opts.eventType,
        severity: FinancialRiskLevel.HIGH,
        title: `Repeated ${opts.eventType}`,
        description: `User triggered ${opts.eventType} ${recent + 1} times in 1 hour`,
        metadata: opts.metadata,
      });
      if (opts.userId) {
        await this.applyHold(opts.userId, {
          walletFrozen: opts.eventType.includes("WALLET"),
          withdrawalsFrozen: true,
          payoutsFrozen: true,
          reason: `Auto-hold: ${opts.eventType}`,
          caseId: fraudCase.id,
        });
      }
    }

    return prisma.financialRiskEvent.create({
      data: {
        userId: opts.userId,
        eventType: opts.eventType,
        severity: opts.severity,
        referenceId: opts.referenceId,
        referenceType: opts.referenceType,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
      },
    });
  }

  async openCase(opts: {
    userId?: string;
    category: string;
    severity: FinancialRiskLevel;
    title: string;
    description: string;
    metadata?: Record<string, unknown>;
  }) {
    const existing = await prisma.financialFraudCase.findFirst({
      where: { userId: opts.userId, category: opts.category, status: "OPEN" },
    });
    if (existing) return existing;

    return prisma.financialFraudCase.create({
      data: {
        userId: opts.userId,
        category: opts.category,
        severity: opts.severity,
        title: opts.title,
        description: opts.description,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
      },
    });
  }

  async applyHold(
    userId: string,
    opts: {
      walletFrozen?: boolean;
      withdrawalsFrozen?: boolean;
      payoutsFrozen?: boolean;
      reason: string;
      caseId?: string;
      providerId?: string;
    },
  ) {
    const provider = opts.providerId
      ? { id: opts.providerId }
      : await prisma.provider.findFirst({ where: { userId }, select: { id: true } });

    return prisma.financialHold.upsert({
      where: { userId },
      create: {
        userId,
        providerId: provider?.id,
        walletFrozen: opts.walletFrozen ?? false,
        withdrawalsFrozen: opts.withdrawalsFrozen ?? false,
        payoutsFrozen: opts.payoutsFrozen ?? false,
        reason: opts.reason,
        caseId: opts.caseId,
      },
      update: {
        walletFrozen: opts.walletFrozen ?? undefined,
        withdrawalsFrozen: opts.withdrawalsFrozen ?? undefined,
        payoutsFrozen: opts.payoutsFrozen ?? undefined,
        reason: opts.reason,
        caseId: opts.caseId,
        liftedAt: null,
      },
    });
  }

  async liftHold(userId: string, adminId: string) {
    const hold = await prisma.financialHold.findUnique({ where: { userId } });
    if (!hold) return null;

    await prisma.financialHold.update({
      where: { userId },
      data: {
        walletFrozen: false,
        withdrawalsFrozen: false,
        payoutsFrozen: false,
        liftedAt: new Date(),
      },
    });

    void AuditLogService.success("FINANCIAL_HOLD_LIFTED", {
      userId: adminId,
      details: { targetUserId: userId },
    });

    return hold;
  }

  async getHold(userId: string) {
    return prisma.financialHold.findUnique({ where: { userId } });
  }

  async isWalletFrozen(userId: string): Promise<boolean> {
    const hold = await this.getHold(userId);
    return hold?.walletFrozen === true && !hold.liftedAt;
  }

  async areWithdrawalsFrozen(userId: string): Promise<boolean> {
    const hold = await this.getHold(userId);
    return hold?.withdrawalsFrozen === true && !hold.liftedAt;
  }

  async detectRefundAbuse(userId: string, paymentId: string) {
    const count = await prisma.payment.count({
      where: { userId, refundedAmount: { gt: 0 }, updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } },
    });
    if (count >= 3) {
      await this.recordEvent({
        userId,
        eventType: "REFUND_ABUSE",
        severity: count >= 5 ? FinancialRiskLevel.CRITICAL : FinancialRiskLevel.HIGH,
        referenceId: paymentId,
        referenceType: "payment",
        metadata: { refundCount30d: count },
      });
    }
  }

  async listOpenCases(limit = 50) {
    return prisma.financialFraudCase.findMany({
      where: { status: "OPEN" },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async listReviewQueue(limit = 50) {
    const [cases, holds] = await Promise.all([
      this.listOpenCases(limit),
      prisma.financialHold.findMany({
        where: { liftedAt: null },
        orderBy: { createdAt: "desc" },
        take: limit,
      }),
    ]);
    return { cases, holds };
  }

  async escalateCase(caseId: string, adminId: string) {
    const c = await prisma.financialFraudCase.update({
      where: { id: caseId },
      data: { severity: FinancialRiskLevel.CRITICAL },
    });
    if (c.userId) {
      await this.applyHold(c.userId, {
        walletFrozen: true,
        withdrawalsFrozen: true,
        payoutsFrozen: true,
        reason: `Escalated case ${caseId}`,
        caseId,
      });
    }
    void AuditLogService.success("FRAUD_CASE_ESCALATED", {
      userId: adminId,
      details: { caseId },
    });
    return c;
  }
}

export const financialRiskService = new FinancialRiskService();
