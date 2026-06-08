import {
  AdjustmentDirection,
  AdjustmentStatus,
  AdjustmentType,
  Prisma,
  WalletTxnStatus,
  WalletTxnType,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { financialLedgerService } from "./financial-ledger.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { AuditLogService } from "./audit-log.service";

export type CreateAdjustmentInput = {
  type: AdjustmentType;
  direction: AdjustmentDirection;
  amount: number;
  reason: string;
  supportingNotes?: string;
  targetUserId?: string;
  debitAccountCode?: string;
  creditAccountCode?: string;
};

const VALID_ACCOUNTS = new Set([
  "CUSTOMER_FUNDS",
  "PLATFORM_ESCROW",
  "PLATFORM_REVENUE",
  "REFUND_LIABILITY",
  "PROVIDER_PAYABLE",
  "BANK_SETTLEMENT",
  "CHARGEBACK_LOSS",
  "CUSTOMER_WALLET",
  "WALLET_CLEARING",
  "HCOIN_LIABILITY",
  "PROMO_EXPENSE",
  "REFERRAL_MARKETING_EXPENSE",
  "PROMOTIONAL_BREAKAGE_REVENUE",
  "ADJUSTMENT_CLEARING",
]);

/**
 * Maker-checker manual financial adjustment engine.
 * Workflow: PENDING_APPROVAL → APPROVED → EXECUTED (or REJECTED).
 * Every executed adjustment produces an immutable, idempotent ADJUSTMENT journal.
 */
export class FinancialAdjustmentService {
  /** Resolve the debit/credit accounts for a given adjustment. */
  private resolveAccounts(adj: {
    direction: AdjustmentDirection;
    targetUserId: string | null;
    debitAccountCode: string | null;
    creditAccountCode: string | null;
  }): { debit: string; credit: string } {
    if (adj.targetUserId) {
      // Wallet-affecting adjustment.
      return adj.direction === AdjustmentDirection.CREDIT
        ? { debit: "ADJUSTMENT_CLEARING", credit: "CUSTOMER_WALLET" } // credit user wallet
        : { debit: "CUSTOMER_WALLET", credit: "ADJUSTMENT_CLEARING" }; // debit user wallet
    }
    // Pure ledger fix — explicit accounts required.
    return {
      debit: adj.debitAccountCode ?? "ADJUSTMENT_CLEARING",
      credit: adj.creditAccountCode ?? "ADJUSTMENT_CLEARING",
    };
  }

  async create(input: CreateAdjustmentInput, makerId: string) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new Error("INVALID_AMOUNT");
    }
    if (!input.reason || input.reason.trim().length < 3) {
      throw new Error("REASON_REQUIRED");
    }
    if (input.targetUserId) {
      const user = await prisma.user.findUnique({ where: { id: input.targetUserId }, select: { id: true } });
      if (!user) throw new Error("TARGET_USER_NOT_FOUND");
    } else {
      // Pure ledger fix requires valid, distinct accounts.
      if (!input.debitAccountCode || !input.creditAccountCode) throw new Error("ACCOUNTS_REQUIRED");
      if (!VALID_ACCOUNTS.has(input.debitAccountCode) || !VALID_ACCOUNTS.has(input.creditAccountCode)) {
        throw new Error("INVALID_ACCOUNT");
      }
      if (input.debitAccountCode === input.creditAccountCode) throw new Error("ACCOUNTS_MUST_DIFFER");
    }

    const reference = `ADJ-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const idempotencyKey = `adj:${reference}`;

    const adjustment = await prisma.financialAdjustment.create({
      data: {
        reference,
        type: input.type,
        direction: input.direction,
        amount: round2(input.amount),
        targetUserId: input.targetUserId ?? null,
        debitAccountCode: input.debitAccountCode ?? null,
        creditAccountCode: input.creditAccountCode ?? null,
        reason: input.reason.trim(),
        supportingNotes: input.supportingNotes?.trim() ?? null,
        status: AdjustmentStatus.PENDING_APPROVAL,
        makerId,
        idempotencyKey,
      },
    });

    recordFinancialMetric("adjustment_total", 1);
    await AuditLogService.success("FINANCIAL_ADJUSTMENT_CREATED", {
      userId: makerId,
      details: { adjustmentId: adjustment.id, reference, type: input.type, amount: adjustment.amount },
    });
    return adjustment;
  }

  async list(opts: { status?: AdjustmentStatus; limit?: number } = {}) {
    return prisma.financialAdjustment.findMany({
      where: opts.status ? { status: opts.status } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(opts.limit ?? 100, 500),
      include: { approvals: { orderBy: { createdAt: "desc" } } },
    });
  }

  async get(id: string) {
    return prisma.financialAdjustment.findUnique({
      where: { id },
      include: { approvals: { orderBy: { createdAt: "desc" } } },
    });
  }

  async approve(id: string, approverId: string, notes?: string) {
    const adj = await prisma.financialAdjustment.findUnique({ where: { id } });
    if (!adj) throw new Error("ADJUSTMENT_NOT_FOUND");
    if (adj.status !== AdjustmentStatus.PENDING_APPROVAL) throw new Error("INVALID_STATE");
    // Maker-checker separation: the maker may never approve their own adjustment.
    if (adj.makerId === approverId) throw new Error("MAKER_CANNOT_APPROVE");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.financialAdjustmentApproval.create({
        data: { adjustmentId: id, actorId: approverId, action: "APPROVE", notes: notes ?? null },
      });
      return tx.financialAdjustment.update({
        where: { id },
        data: { status: AdjustmentStatus.APPROVED, approverId, approvedAt: new Date() },
      });
    });

    await AuditLogService.success("FINANCIAL_ADJUSTMENT_APPROVED", {
      userId: approverId,
      details: { adjustmentId: id, reference: adj.reference },
    });
    return updated;
  }

  async reject(id: string, approverId: string, reason: string) {
    const adj = await prisma.financialAdjustment.findUnique({ where: { id } });
    if (!adj) throw new Error("ADJUSTMENT_NOT_FOUND");
    const rejectable: AdjustmentStatus[] = [AdjustmentStatus.PENDING_APPROVAL, AdjustmentStatus.APPROVED];
    if (!rejectable.includes(adj.status)) {
      throw new Error("INVALID_STATE");
    }
    if (!reason || reason.trim().length < 3) throw new Error("REASON_REQUIRED");

    const updated = await prisma.$transaction(async (tx) => {
      await tx.financialAdjustmentApproval.create({
        data: { adjustmentId: id, actorId: approverId, action: "REJECT", notes: reason.trim() },
      });
      return tx.financialAdjustment.update({
        where: { id },
        data: { status: AdjustmentStatus.REJECTED, approverId, rejectedReason: reason.trim() },
      });
    });

    await AuditLogService.success("FINANCIAL_ADJUSTMENT_REJECTED", {
      userId: approverId,
      details: { adjustmentId: id, reference: adj.reference, reason: reason.trim() },
    });
    return updated;
  }

  /** Execute an APPROVED adjustment: move money (if any) + write the ledger journal atomically. */
  async execute(id: string, executorId: string) {
    const adj = await prisma.financialAdjustment.findUnique({ where: { id } });
    if (!adj) throw new Error("ADJUSTMENT_NOT_FOUND");
    if (adj.status === AdjustmentStatus.EXECUTED) return adj; // idempotent
    if (adj.status !== AdjustmentStatus.APPROVED) throw new Error("INVALID_STATE");

    const { debit, credit } = this.resolveAccounts(adj);
    const amount = adj.amount;

    const result = await prisma.$transaction(async (tx) => {
      let walletTxnId: string | null = null;

      if (adj.targetUserId) {
        const user = await tx.user.findUnique({
          where: { id: adj.targetUserId },
          select: { walletBalance: true },
        });
        if (!user) throw new Error("TARGET_USER_NOT_FOUND");
        const delta = adj.direction === AdjustmentDirection.CREDIT ? amount : -amount;
        const after = round2(user.walletBalance + delta);
        if (after < 0) throw new Error("INSUFFICIENT_WALLET_BALANCE");

        const updatedUser = await tx.user.update({
          where: { id: adj.targetUserId },
          data: { walletBalance: { increment: delta } },
        });
        const walletTxn = await tx.walletTransaction.create({
          data: {
            transactionNumber: await nextWalletTxnNumber(),
            userId: adj.targetUserId,
            amount: Math.round(amount),
            walletBalanceBefore: user.walletBalance,
            walletBalanceAfter: updatedUser.walletBalance,
            type: adj.direction === AdjustmentDirection.CREDIT ? WalletTxnType.CREDIT : WalletTxnType.DEBIT,
            description: `Manual adjustment ${adj.reference}: ${adj.reason}`,
            referenceType: "financial_adjustment",
            referenceId: adj.id,
            status: WalletTxnStatus.COMPLETED,
          },
        });
        walletTxnId = walletTxn.id;
      }

      const journal = await financialLedgerService.recordAdjustment({
        adjustmentId: adj.id,
        debitAccountCode: debit,
        creditAccountCode: credit,
        amount,
        description: `Manual ${adj.type} adjustment ${adj.reference}`,
        tx: tx as Prisma.TransactionClient,
      });

      return tx.financialAdjustment.update({
        where: { id },
        data: {
          status: AdjustmentStatus.EXECUTED,
          executedAt: new Date(),
          journalId: journal.id,
          walletTxnId,
        },
      });
    });

    recordFinancialMetric("adjustment_amount_total", amount);
    await AuditLogService.success("FINANCIAL_ADJUSTMENT_EXECUTED", {
      userId: executorId,
      details: { adjustmentId: id, reference: adj.reference, amount, debit, credit },
    });
    return result;
  }

  /** Net liability impact of executed wallet-affecting adjustments. */
  async liabilityImpact(): Promise<number> {
    const rows = await prisma.financialAdjustment.findMany({
      where: { status: AdjustmentStatus.EXECUTED, targetUserId: { not: null } },
      select: { direction: true, amount: true },
    });
    return round2(
      rows.reduce((sum, r) => sum + (r.direction === AdjustmentDirection.CREDIT ? r.amount : -r.amount), 0),
    );
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const financialAdjustmentService = new FinancialAdjustmentService();
