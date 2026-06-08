import {
  BookingStatus,
  WalletTxnStatus,
  WalletTxnType,
  WithdrawalStatus,
} from "@prisma/client";
import prisma from "../lib/prisma";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { razorpayService } from "./razorpay.service";
import { AuditLogService } from "./audit-log.service";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { decryptWithdrawalBankFields } from "./sensitive-data.service";
import { providerWalletReservationService } from "./provider-wallet-reservation.service";

export interface EarningCalculation {
  bookingAmount: number;
  commission: number;
  commissionRate: number;
  bonus: number;
  deduction: number;
  netEarning: number;
}

export interface EarningsSummary {
  period: string;
  earnings: number;
  totalGross: number;
  totalCommission: number;
  totalNet: number;
  averagePerBooking: number;
}

const PERFECT_RATING_BONUS = 50;
const HIGH_VOLUME_BONUS = 100;
const LOW_RATING_DEDUCTION = 100;
const CANCELLATION_PENALTY = 100;
const CANCELLATION_THRESHOLD = 10;

/**
 * Tiered base commission keyed off this-month completed bookings:
 *   < 50          → 20%
 *   50  – 99      → 18%
 *   100 – 199     → 15%
 *   200+          → 12%
 */
export function commissionRateForVolume(monthlyCompleted: number): number {
  if (monthlyCompleted >= 200) return 0.12;
  if (monthlyCompleted >= 100) return 0.15;
  if (monthlyCompleted >= 50) return 0.18;
  return 0.2;
}

export class EarningsService {
  /**
   * Compute commission + bonuses + deductions for a single completed booking.
   * Pure read; does not write anything to the database.
   */
  async calculateBookingEarning(bookingId: string): Promise<EarningCalculation> {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { provider: true },
    });
    if (!booking) throw new Error("Booking not found");
    if (!booking.providerId || !booking.provider) {
      throw new Error("Booking has no provider assigned");
    }

    const monthlyCompleted = await this.countMonthlyCompleted(booking.providerId);
    const commissionRate = commissionRateForVolume(monthlyCompleted);
    const commission = roundCurrency(booking.finalAmount * commissionRate);

    const bonus = this.calculateBonuses(booking.provider);
    const deduction = await this.calculateDeductions(booking.providerId, booking.provider.rating);

    const netEarning = Math.max(0, roundCurrency(booking.finalAmount - commission + bonus - deduction));

    return {
      bookingAmount: booking.finalAmount,
      commission,
      commissionRate,
      bonus,
      deduction,
      netEarning,
    };
  }

  async approveWithdrawal(withdrawalId: string, adminId: string) {
    const w = await prisma.withdrawal.update({
      where: { id: withdrawalId, status: WithdrawalStatus.REQUESTED },
      data: { status: WithdrawalStatus.APPROVED, approvedAt: new Date() },
    });
    void AuditLogService.success("WITHDRAWAL_APPROVED", {
      userId: adminId,
      details: { withdrawalId, providerId: w.providerId, amount: w.amount },
    });
    return w;
  }

  async rejectWithdrawal(withdrawalId: string, adminId: string, reason: string) {
    const w = await prisma.withdrawal.findUnique({
      where: { id: withdrawalId },
      include: { provider: true },
    });
    if (!w || w.status === WithdrawalStatus.COMPLETED) throw new Error("Withdrawal not found or already completed");
    await prisma.withdrawal.update({
      where: { id: withdrawalId },
      data: { status: WithdrawalStatus.CANCELLED, failureReason: reason },
    });
    await providerWalletReservationService.releaseReservation(withdrawalId, adminId, reason);
    void AuditLogService.success("WITHDRAWAL_REJECTED", {
      userId: adminId,
      reason,
      details: { withdrawalId, providerId: w.providerId, amount: w.amount },
    });
    return { withdrawalId, status: WithdrawalStatus.CANCELLED };
  }

  /** Admin process: atomic APPROVED → PROCESSING, then Razorpay payout. */
  async processProviderPayout(withdrawalId: string, adminId?: string): Promise<{
    withdrawalId: string;
    status: WithdrawalStatus;
    amount: number;
    netAmount: number;
    razorpayPayoutId: string | null;
    blocked?: boolean;
  }> {
    recordFinancialMetric("payout_attempt_total", 1);

    type LockResult =
      | { blocked: true; withdrawal: { id: string; status: WithdrawalStatus; amount: number; netAmount: number; razorpayPayoutId: string | null } }
      | { blocked: false; withdrawal: Awaited<ReturnType<typeof prisma.withdrawal.findUnique>> & { provider: { walletBalance: number } } };

    const lockResult = await prisma.$transaction(async (tx): Promise<LockResult> => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          withdrawal_number: string;
          provider_id: string;
          amount: number;
          net_amount: number;
          status: WithdrawalStatus;
          razorpay_payout_id: string | null;
          approved_at: Date | null;
          account_holder_name: string;
          account_number: string;
          ifsc_code: string;
          bank_name: string;
          wallet_balance: number;
        }>
      >`
        SELECT w.id, w.withdrawal_number, w.provider_id, w.amount, w.net_amount, w.status,
               w.razorpay_payout_id, w.approved_at, w.account_holder_name, w.account_number,
               w.ifsc_code, w.bank_name, p.wallet_balance
        FROM withdrawals w
        JOIN providers p ON p.id = w.provider_id
        WHERE w.id = ${withdrawalId}
        FOR UPDATE OF w
      `;
      const row = rows[0];
      if (!row) throw new Error("Withdrawal not found");

      if (row.status === WithdrawalStatus.PROCESSING || row.status === WithdrawalStatus.COMPLETED) {
        recordFinancialMetric("payout_race_blocked_total", 1);
        return {
          blocked: true,
          withdrawal: {
            id: row.id,
            status: row.status,
            amount: row.amount,
            netAmount: row.net_amount,
            razorpayPayoutId: row.razorpay_payout_id,
          },
        };
      }

      if (row.status !== WithdrawalStatus.APPROVED) {
        throw new Error(`Withdrawal cannot be processed in status ${row.status}`);
      }

      const updated = await tx.withdrawal.updateMany({
        where: {
          id: withdrawalId,
          status: WithdrawalStatus.APPROVED,
          razorpayPayoutId: null,
        },
        data: {
          status: WithdrawalStatus.PROCESSING,
          approvedAt: row.approved_at ?? new Date(),
          processedAt: new Date(),
        },
      });

      if (updated.count === 0) {
        recordFinancialMetric("payout_race_blocked_total", 1);
        const current = await tx.withdrawal.findUnique({ where: { id: withdrawalId } });
        if (!current) throw new Error("Withdrawal not found");
        return {
          blocked: true,
          withdrawal: {
            id: current.id,
            status: current.status,
            amount: current.amount,
            netAmount: current.netAmount,
            razorpayPayoutId: current.razorpayPayoutId,
          },
        };
      }

      const withdrawal = await tx.withdrawal.findUnique({
        where: { id: withdrawalId },
        include: { provider: true },
      });
      if (!withdrawal) throw new Error("Withdrawal not found");
      return { blocked: false, withdrawal };
    });

    if (lockResult.blocked) {
      return {
        withdrawalId: lockResult.withdrawal.id,
        status: lockResult.withdrawal.status,
        amount: lockResult.withdrawal.amount,
        netAmount: lockResult.withdrawal.netAmount,
        razorpayPayoutId: lockResult.withdrawal.razorpayPayoutId,
        blocked: true,
      };
    }

    const withdrawal = lockResult.withdrawal;
    const bank = decryptWithdrawalBankFields({
      accountHolderName: withdrawal.accountHolderName,
      accountNumber: withdrawal.accountNumber,
      ifscCode: withdrawal.ifscCode,
      bankName: withdrawal.bankName,
    });

    let payout: { payoutId: string; status: string };
    try {
      payout = await razorpayService.createPayout(withdrawal.withdrawalNumber, withdrawal.netAmount, {
        name: bank.accountHolderName,
        ifsc: bank.ifscCode,
        number: bank.accountNumber,
      });
    } catch (err) {
      await prisma.$transaction([
        prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: { status: WithdrawalStatus.APPROVED, processedAt: null },
        }),
      ]);
      throw err;
    }

    const transactionNumber = await nextWalletTxnNumber();
    const balanceBefore = withdrawal.provider.walletBalance;

    await prisma.$transaction([
      prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: {
          razorpayPayoutId: payout.payoutId,
          razorpayStatus: payout.status,
        },
      }),
      prisma.walletTransaction.create({
        data: {
          transactionNumber,
          providerId: withdrawal.providerId,
          amount: withdrawal.amount,
          walletBalanceBefore: balanceBefore,
          walletBalanceAfter: balanceBefore,
          type: WalletTxnType.WITHDRAWAL,
          status: WalletTxnStatus.PENDING,
          description: `Withdrawal of ₹${withdrawal.amount}`,
          referenceId: withdrawal.id,
          referenceType: "withdrawal",
        },
      }),
      prisma.payoutAttempt.create({
        data: {
          withdrawalId,
          attemptNo: 1,
          status: "PROCESSING",
          razorpayPayoutId: payout.payoutId,
        },
      }),
    ]);

    void AuditLogService.success("WITHDRAWAL_PROCESSING", {
      userId: adminId,
      details: { withdrawalId, payoutId: payout.payoutId, amount: withdrawal.amount },
    });
    recordFinancialMetric("payout_success_total", 1);

    return {
      withdrawalId,
      status: WithdrawalStatus.PROCESSING,
      amount: withdrawal.amount,
      netAmount: withdrawal.netAmount,
      razorpayPayoutId: payout.payoutId,
    };
  }

  async completeProviderPayout(withdrawalId: string) {
    const existing = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!existing) throw new Error("Withdrawal not found");
    if (existing.status === WithdrawalStatus.COMPLETED) return existing;

    const w = await financialTransactionManager.executeWithLedger({
      journal: financialLedgerService.journalForProviderPayout(withdrawalId, existing.netAmount),
      mutate: async (tx) =>
        tx.withdrawal.update({
          where: { id: withdrawalId },
          data: { status: WithdrawalStatus.COMPLETED, completedAt: new Date(), razorpayStatus: "processed" },
        }),
    });
    await providerWalletReservationService.consumeReservation(withdrawalId, undefined);
    await prisma.walletTransaction.updateMany({
      where: { referenceId: withdrawalId, referenceType: "withdrawal" },
      data: { status: WalletTxnStatus.COMPLETED, completedAt: new Date() },
    });
    await prisma.payoutAttempt.create({
      data: { withdrawalId, attemptNo: 99, status: "SUCCESS", razorpayPayoutId: w.razorpayPayoutId },
    }).catch(() => undefined);
    recordFinancialMetric("provider_payout_total", 1);
    recordFinancialMetric("payout_total", 1);
    return w;
  }

  async failProviderPayout(withdrawalId: string, reason?: string) {
    const existing = await prisma.withdrawal.findUnique({ where: { id: withdrawalId } });
    if (!existing) return { handled: false, reason: "NOT_FOUND" };
    if (existing.status === WithdrawalStatus.FAILED || existing.status === WithdrawalStatus.COMPLETED) {
      return { handled: true, reason: "ALREADY_TERMINAL" };
    }

    await prisma.$transaction([
      prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: WithdrawalStatus.FAILED, failureReason: reason, razorpayStatus: "failed" },
      }),
      prisma.walletTransaction.updateMany({
        where: { referenceId: withdrawalId, referenceType: "withdrawal" },
        data: { status: WalletTxnStatus.FAILED },
      }),
      prisma.payoutAttempt.create({
        data: {
          withdrawalId,
          attemptNo: (await prisma.payoutAttempt.count({ where: { withdrawalId } })) + 1,
          status: "FAILED",
          razorpayPayoutId: existing.razorpayPayoutId,
          failureReason: reason,
        },
      }),
    ]);
    await providerWalletReservationService.releaseReservation(withdrawalId, undefined, reason);

    void financialLedgerService
      .recordProviderPayoutReversal(withdrawalId, existing.netAmount)
      .catch(() => undefined);
    void AuditLogService.success("PAYOUT_FAILURE", {
      details: { withdrawalId, amount: existing.netAmount, reason },
    });

    recordFinancialMetric("provider_payout_failed_total", 1);
    recordFinancialMetric("payout_failed_total", 1);
    recordFinancialMetric("payout_reversal_total", 1);
    return { handled: true, reason: "PAYOUT_FAILED" };
  }

  async reconcilePayoutFromWebhook(payoutId: string, status: string, failureReason?: string) {
    const withdrawal = await prisma.withdrawal.findFirst({ where: { razorpayPayoutId: payoutId } });
    if (!withdrawal) return { handled: false, reason: "WITHDRAWAL_NOT_FOUND" };

    const normalized = status.toLowerCase();
    if (normalized === "processed" || normalized === "success") {
      await this.completeProviderPayout(withdrawal.id);
      return { handled: true, reason: "PAYOUT_COMPLETED" };
    }
    if (normalized === "failed" || normalized === "reversed" || normalized === "rejected") {
      await this.failProviderPayout(withdrawal.id, failureReason ?? normalized);
      return { handled: true, reason: "PAYOUT_FAILED" };
    }
    return { handled: false, reason: "UNHANDLED_PAYOUT_STATUS" };
  }

  async listProviderWithdrawals(providerId: string, limit = 20) {
    return prisma.withdrawal.findMany({
      where: { providerId },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        withdrawalNumber: true,
        amount: true,
        netAmount: true,
        processingFee: true,
        status: true,
        razorpayPayoutId: true,
        razorpayStatus: true,
        failureReason: true,
        bankName: true,
        requestedAt: true,
        processedAt: true,
        completedAt: true,
        payoutAttempts: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
  }

  async getPartnerFinanceCenter(providerId: string) {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { walletBalance: true, reservedBalance: true },
    });
    if (!provider) throw new Error("Provider not found");

    const [pendingAgg, lifetimeAgg, withdrawals, earningsByDay] = await Promise.all([
      prisma.withdrawal.aggregate({
        where: {
          providerId,
          status: { in: [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING] },
        },
        _sum: { amount: true },
      }),
      prisma.earning.aggregate({
        where: { providerId },
        _sum: { netEarning: true, grossAmount: true },
      }),
      this.listProviderWithdrawals(providerId, 50),
      prisma.earning.findMany({
        where: { providerId, createdAt: { gte: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) } },
        select: { netEarning: true, createdAt: true },
      }),
    ]);

    const currentBalance = provider.walletBalance;
    const pendingBalance = pendingAgg._sum.amount ?? 0;
    const availableBalance = roundCurrency(
      Math.max(0, providerWalletReservationService.availableBalance(provider.walletBalance, provider.reservedBalance)),
    );
    const lifetimeEarnings = lifetimeAgg._sum.netEarning ?? 0;

    const nextPending = withdrawals.find((w) =>
      ["REQUESTED", "APPROVED", "PROCESSING"].includes(w.status),
    );

    return {
      currentBalance,
      availableBalance,
      pendingBalance,
      lifetimeEarnings,
      lifetimeGross: lifetimeAgg._sum.grossAmount ?? 0,
      nextPayoutDate: nextPending?.processedAt ?? nextPending?.requestedAt ?? null,
      withdrawals: withdrawals.map((w) => ({
        id: w.id,
        reference: w.withdrawalNumber,
        amount: w.amount,
        fee: w.processingFee,
        tax: 0,
        netAmount: w.netAmount,
        status: mapWithdrawalStatus(w.status),
        bank: w.bankName,
        settlementDate: w.completedAt,
        razorpayPayoutId: w.razorpayPayoutId,
        attempts: w.payoutAttempts,
      })),
      analytics: buildEarningsAnalytics(earningsByDay),
    };
  }

  async getEarningsSummary(providerId: string, days = 30): Promise<EarningsSummary> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const earnings = await prisma.earning.findMany({
      where: { providerId, createdAt: { gte: startDate } },
      select: { grossAmount: true, commission: true, netEarning: true },
    });

    const totalGross = roundCurrency(earnings.reduce((s, e) => s + e.grossAmount, 0));
    const totalCommission = roundCurrency(earnings.reduce((s, e) => s + e.commission, 0));
    const totalNet = roundCurrency(earnings.reduce((s, e) => s + e.netEarning, 0));

    return {
      period: `Last ${days} days`,
      earnings: earnings.length,
      totalGross,
      totalCommission,
      totalNet,
      averagePerBooking: earnings.length > 0 ? roundCurrency(totalGross / earnings.length) : 0,
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async countMonthlyCompleted(providerId: string): Promise<number> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    return prisma.booking.count({
      where: {
        providerId,
        status: BookingStatus.COMPLETED,
        completedAt: { gte: startOfMonth },
      },
    });
  }

  private calculateBonuses(provider: { rating: number; totalBookings: number }): number {
    let bonus = 0;
    if (provider.rating >= 4.9) bonus += PERFECT_RATING_BONUS;
    if (provider.totalBookings >= 200) bonus += HIGH_VOLUME_BONUS;
    return bonus;
  }

  private async calculateDeductions(providerId: string, rating: number): Promise<number> {
    let deduction = 0;
    if (rating > 0 && rating < 3.5) deduction += LOW_RATING_DEDUCTION;

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const cancellations = await prisma.booking.count({
      where: {
        providerId,
        status: BookingStatus.CANCELLED_BY_PROVIDER,
        createdAt: { gte: startOfMonth },
      },
    });

    if (cancellations > CANCELLATION_THRESHOLD) {
      deduction += (cancellations - CANCELLATION_THRESHOLD) * CANCELLATION_PENALTY;
    }
    return deduction;
  }
}

function roundCurrency(n: number): number {
  return Math.round(n * 100) / 100;
}

function mapWithdrawalStatus(status: WithdrawalStatus): string {
  switch (status) {
    case WithdrawalStatus.REQUESTED:
    case WithdrawalStatus.APPROVED:
      return "Pending";
    case WithdrawalStatus.PROCESSING:
      return "Processing";
    case WithdrawalStatus.COMPLETED:
      return "Completed";
    case WithdrawalStatus.FAILED:
      return "Failed";
    case WithdrawalStatus.CANCELLED:
      return "Reversed";
    default:
      return status;
  }
}

function buildEarningsAnalytics(rows: Array<{ netEarning: number; createdAt: Date }>) {
  const daily = new Map<string, number>();
  const weekly = new Map<string, number>();
  const monthly = new Map<string, number>();
  const yearly = new Map<string, number>();

  for (const row of rows) {
    const d = row.createdAt;
    const dayKey = d.toISOString().slice(0, 10);
    const weekKey = `${d.getFullYear()}-W${Math.ceil((d.getDate() + 6 - d.getDay()) / 7)}`;
    const monthKey = d.toISOString().slice(0, 7);
    const yearKey = String(d.getFullYear());
    daily.set(dayKey, roundCurrency((daily.get(dayKey) ?? 0) + row.netEarning));
    weekly.set(weekKey, roundCurrency((weekly.get(weekKey) ?? 0) + row.netEarning));
    monthly.set(monthKey, roundCurrency((monthly.get(monthKey) ?? 0) + row.netEarning));
    yearly.set(yearKey, roundCurrency((yearly.get(yearKey) ?? 0) + row.netEarning));
  }

  const toSeries = (m: Map<string, number>) =>
    Array.from(m.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([period, amount]) => ({ period, amount }));

  return { daily: toSeries(daily), weekly: toSeries(weekly), monthly: toSeries(monthly), yearly: toSeries(yearly) };
}

export const earningsService = new EarningsService();
