import { prisma } from "../lib/prisma";
import {
  CommissionStatus,
  FraudEventType,
  FraudRiskLevel,
  ReferralStatus,
  WalletTxnStatus,
  WalletTxnType,
} from "@prisma/client";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { financialLedgerService } from "./financial-ledger.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { AuditLogService } from "./audit-log.service";
import { hcoinService } from "./hcoin.service";
import { referralFraudService } from "./referral-fraud.service";
import { fraudSignalService } from "./fraud-signal.service";
import { fraudAdminService } from "./fraud-admin.service";
import type { FraudContext } from "../lib/fraud-context";

/** Business rule: flat reward credited to the referrer per qualified referral. */
export const REFERRAL_COMMISSION = 100;

const WITHDRAWABLE_STATUSES: CommissionStatus[] = [CommissionStatus.APPROVED];

export class ReferralService {
  /**
   * Called at signup when a new user used someone's referral code. Records a
   * PENDING referral. Self-referral is rejected. Fraud engine may block entirely.
   */
  async recordSignup(
    referrerId: string,
    refereeId: string,
    code: string,
    ctx: FraudContext = {},
  ): Promise<boolean> {
    if (referrerId === refereeId) {
      await referralFraudService.logDecision({
        action: "BLOCK_SELF_REFERRAL",
        targetUserId: referrerId,
        reason: "same_user_id",
      });
      return false;
    }
    const existing = await prisma.referralTransaction.findUnique({ where: { refereeId } });
    if (existing) return false;

    const fraud = await referralFraudService.onReferralSignup(referrerId, refereeId, code, ctx);
    if (!fraud.allowed) {
      await prisma.referralTransaction.create({
        data: {
          referrerId,
          refereeId,
          code,
          status: ReferralStatus.FRAUD_BLOCKED,
          fraudFlagged: true,
          riskScore: fraud.riskScore,
        },
      });
      return false;
    }

    await prisma.$transaction([
      prisma.referralTransaction.create({
        data: {
          referrerId,
          refereeId,
          code,
          status: ReferralStatus.PENDING,
          fraudFlagged: fraud.riskScore >= 50,
          riskScore: fraud.riskScore,
        },
      }),
      prisma.user.update({ where: { id: referrerId }, data: { referralCount: { increment: 1 } } }),
    ]);
    return true;
  }

  /**
   * Called when a booking is COMPLETED. If the customer was referred and their
   * referral is still PENDING, qualify it and create commission (fraud-gated).
   */
  async onBookingCompleted(
    refereeId: string,
    bookingId: string,
    ctx: FraudContext = {},
  ): Promise<void> {
    const txn = await prisma.referralTransaction.findUnique({ where: { refereeId } });
    if (!txn || txn.status !== ReferralStatus.PENDING) return;

    const { status, riskScore, factors } = await referralFraudService.commissionStatusForQualification(
      txn.referrerId,
      refereeId,
      ctx,
    );

    if (status === CommissionStatus.REJECTED) {
      await prisma.referralTransaction.update({
        where: { id: txn.id },
        data: { status: ReferralStatus.FRAUD_BLOCKED, fraudFlagged: true, riskScore },
      });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.referralTransaction.findUnique({ where: { id: txn.id } });
      if (!fresh || fresh.status !== ReferralStatus.PENDING) return;
      await tx.referralTransaction.update({
        where: { id: txn.id },
        data: { status: ReferralStatus.QUALIFIED, qualifiedAt: new Date(), riskScore },
      });
      const commission = await tx.referralCommission.create({
        data: {
          referrerId: txn.referrerId,
          refereeId,
          transactionId: txn.id,
          bookingId,
          amount: REFERRAL_COMMISSION,
          status,
          riskScore,
          frozenAt: status === CommissionStatus.FROZEN ? new Date() : undefined,
        },
      });
      await fraudSignalService.capture(
        FraudEventType.COMMISSION,
        { ...ctx, userId: txn.referrerId },
        { id: commission.id, type: "referral_commission" },
      );
      if (status === CommissionStatus.FROZEN || status === CommissionStatus.REVIEW) {
        await referralFraudService.createAlert({
          userId: txn.referrerId,
          commissionId: commission.id,
          referralTransactionId: txn.id,
          category: status === CommissionStatus.FROZEN ? "COMMISSION_FROZEN" : "COMMISSION_REVIEW",
          severity: riskScore >= 65 ? FraudRiskLevel.HIGH : FraudRiskLevel.MEDIUM,
          title: `Commission ${status.toLowerCase()} — manual review required`,
          description: factors.join("; "),
        });
      }
    });

    if (status === CommissionStatus.APPROVED) {
      void hcoinService.earn(txn.referrerId, "REFERRAL_QUALIFIED", txn.id).catch(() => {});
      void prisma.notification
        .create({
          data: {
            userId: txn.referrerId,
            type: "REFERRAL",
            title: "Referral reward earned 🎉",
            message: `You earned ₹${REFERRAL_COMMISSION} — your referral completed their first booking.`,
          },
        })
        .catch(() => {});
    }
  }

  private async balanceParts(userId: string) {
    const [earnedAgg, withdrawnAgg, frozenAgg] = await Promise.all([
      prisma.referralCommission.aggregate({
        where: { referrerId: userId, status: { in: WITHDRAWABLE_STATUSES } },
        _sum: { amount: true },
      }),
      prisma.referralWithdrawal.aggregate({ where: { userId }, _sum: { amount: true } }),
      prisma.referralCommission.aggregate({
        where: {
          referrerId: userId,
          status: { in: [CommissionStatus.FROZEN, CommissionStatus.REVIEW, CommissionStatus.PENDING] },
        },
        _sum: { amount: true },
      }),
    ]);
    const totalEarned = earnedAgg._sum.amount ?? 0;
    const withdrawn = withdrawnAgg._sum.amount ?? 0;
    const frozen = frozenAgg._sum.amount ?? 0;
    return { totalEarned, withdrawn, balance: totalEarned - withdrawn, frozen };
  }

  async summary(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { referralCode: true, referralCount: true },
    });
    const [pending, qualified, parts, risk] = await Promise.all([
      prisma.referralTransaction.count({ where: { referrerId: userId, status: ReferralStatus.PENDING } }),
      prisma.referralTransaction.count({ where: { referrerId: userId, status: ReferralStatus.QUALIFIED } }),
      this.balanceParts(userId),
      prisma.fraudRiskScore.findUnique({ where: { userId } }),
    ]);
    return {
      code: user?.referralCode ?? null,
      referralCount: user?.referralCount ?? 0,
      pending,
      qualified,
      commissionPerReferral: REFERRAL_COMMISSION,
      frozenBalance: parts.frozen,
      riskScore: risk?.score ?? 0,
      riskLevel: risk?.level?.toLowerCase() ?? "low",
      ...parts,
    };
  }

  async history(userId: string) {
    const txns = await prisma.referralTransaction.findMany({
      where: { referrerId: userId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    const refereeIds = txns.map((t) => t.refereeId);
    const [referees, commissions] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: refereeIds } },
        select: { id: true, firstName: true, lastName: true },
      }),
      prisma.referralCommission.findMany({ where: { referrerId: userId } }),
    ]);
    const nameById = new Map(
      referees.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || "HOMIGO user"]),
    );
    const commByTxn = new Map(commissions.map((c) => [c.transactionId, c]));
    return {
      referrals: txns.map((t) => {
        const comm = commByTxn.get(t.id);
        return {
          id: t.id,
          refereeName: nameById.get(t.refereeId) ?? "HOMIGO user",
          status: t.status,
          fraudFlagged: t.fraudFlagged,
          amount: comm?.amount ?? 0,
          commissionStatus: comm?.status?.toLowerCase() ?? null,
          createdAt: t.createdAt,
          qualifiedAt: t.qualifiedAt,
        };
      }),
    };
  }

  /** Withdraw approved referral earnings into the user's main HOMIGO wallet. */
  async withdraw(
    userId: string,
    amount: number,
    ctx: FraudContext = {},
  ): Promise<{ ok: true; balance: number; walletBalance: number } | { error: string }> {
    if (!Number.isInteger(amount) || amount <= 0) return { error: "INVALID_AMOUNT" };

    const risk = await referralFraudService.onWithdrawal(userId, amount, ctx);
    if (risk.level === "CRITICAL") {
      await referralFraudService.logDecision({
        action: "BLOCK_WITHDRAWAL",
        targetUserId: userId,
        reason: risk.factors.join("; "),
      });
      return { error: "WITHDRAWAL_BLOCKED" };
    }

    const { balance } = await this.balanceParts(userId);
    if (amount > balance) return { error: "INSUFFICIENT_BALANCE" };
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
      if (!user) throw new Error("USER_NOT_FOUND");
      await tx.referralWithdrawal.create({ data: { userId, amount, status: "completed" } });
      const updated = await tx.user.update({
        where: { id: userId },
        data: { walletBalance: { increment: amount } },
      });
      const walletTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: await nextWalletTxnNumber(),
          userId,
          amount,
          walletBalanceBefore: user.walletBalance,
          walletBalanceAfter: updated.walletBalance,
          type: WalletTxnType.CREDIT,
          description: "Referral earnings → wallet",
          referenceType: "referral_withdrawal",
          status: WalletTxnStatus.COMPLETED,
        },
      });
      // Double-entry: DR Referral Marketing Expense, CR Customer Wallet — keyed by
      // the wallet txn so the ledger CUSTOMER_WALLET balance tracks the real wallet.
      await financialLedgerService
        .recordReferralCommission({
          walletTxnId: walletTxn.id,
          referrerUserId: userId,
          amount,
        })
        .catch(() => undefined);
      return { walletBalance: updated.walletBalance, walletTxnId: walletTxn.id };
    });

    recordFinancialMetric("referral_commission_total", 1);
    recordFinancialMetric("referral_commission_amount", amount);
    await AuditLogService.success("REFERRAL_COMMISSION_CREDITED", {
      userId,
      details: { amount, walletTxnId: result.walletTxnId, referenceType: "referral_withdrawal" },
    });

    const parts = await this.balanceParts(userId);
    return { ok: true, balance: parts.balance, walletBalance: result.walletBalance };
  }

  async leaderboard(limit = 10) {
    const grouped = await prisma.referralCommission.groupBy({
      by: ["referrerId"],
      where: { status: CommissionStatus.APPROVED },
      _sum: { amount: true },
      _count: { _all: true },
      orderBy: { _sum: { amount: "desc" } },
      take: limit,
    });
    const users = await prisma.user.findMany({
      where: { id: { in: grouped.map((g) => g.referrerId) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const nameById = new Map(
      users.map((u) => [u.id, [u.firstName, u.lastName].filter(Boolean).join(" ") || "HOMIGO user"]),
    );
    return grouped.map((g, i) => ({
      rank: i + 1,
      name: nameById.get(g.referrerId) ?? "HOMIGO user",
      referrals: g._count._all,
      earned: g._sum.amount ?? 0,
    }));
  }

  async adminAnalytics() {
    const overview = await fraudAdminService.overview();
    const leaderboard = await this.leaderboard(10);
    const suspiciousUsers = await fraudAdminService.highRiskUsers(10);

    return {
      totalReferrals: overview.totalReferrals,
      qualified: overview.qualified,
      pending: overview.totalReferrals - overview.qualified - overview.fraudBlocked,
      totalCommission: overview.commissionApproved,
      totalWithdrawn: await prisma.referralWithdrawal.aggregate({ _sum: { amount: true } }).then((r) => r._sum.amount ?? 0),
      frozenCommissions: overview.frozenCommissions,
      fraudRatePct: overview.fraudRatePct,
      leaderboard,
      fraudFlags: suspiciousUsers.map((u) => ({
        userId: u.userId,
        name: u.name,
        email: u.email,
        pendingReferrals: 0,
        riskScore: u.score,
        level: u.level,
        reason: (u.factors as string[]).slice(0, 2).join(", ") || "Elevated risk score",
      })),
    };
  }
}

export const referralService = new ReferralService();
