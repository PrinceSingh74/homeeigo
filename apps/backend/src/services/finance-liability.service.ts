import { CommissionStatus, LiabilitySnapshotPeriod } from "@prisma/client";
import prisma from "../lib/prisma";
import { financeDashboardService } from "./finance-dashboard.service";
import { hcoinService } from "./hcoin.service";
import { financialAdjustmentService } from "./financial-adjustment.service";

export type LiabilityReport = {
  walletLiability: number;
  giftCardLiability: number;
  cashbackLiability: number;
  refundLiability: number;
  payoutLiability: number;
  chargebackExposure: number;
  settlementPending: number;
  hcoinLiability: number;
  referralLiability: number;
  adjustmentLiability: number;
  providerPayable: number;
  totalLiabilities: number;
  generatedAt: string;
};

/** CFO liability tracking with daily / weekly / monthly snapshots. */
export class FinanceLiabilityService {
  async buildCurrentReport(): Promise<LiabilityReport> {
    const overview = await financeDashboardService.getOverview(30);
    const hcoin = await hcoinService.adminAnalytics();
    const pendingPayouts = await prisma.withdrawal.aggregate({
      where: { status: { in: ["APPROVED", "PROCESSING"] } },
      _sum: { netAmount: true },
    });

    // Referral liability: approved commissions not yet withdrawn into the wallet.
    const [approvedCommissions, referralWithdrawals, adjustmentImpact] = await Promise.all([
      prisma.referralCommission.aggregate({
        where: { status: CommissionStatus.APPROVED },
        _sum: { amount: true },
      }),
      prisma.referralWithdrawal.aggregate({ _sum: { amount: true } }),
      financialAdjustmentService.liabilityImpact(),
    ]);
    const referralLiability = Math.max(
      0,
      round2((approvedCommissions._sum.amount ?? 0) - (referralWithdrawals._sum.amount ?? 0)),
    );
    const adjustmentLiability = round2(adjustmentImpact);

    return {
      walletLiability: overview.walletLiability,
      giftCardLiability: overview.giftCardLiability,
      cashbackLiability: overview.cashbackLiability,
      refundLiability: overview.refundLiability,
      payoutLiability: pendingPayouts._sum.netAmount ?? 0,
      chargebackExposure: overview.chargebackExposure.amount,
      settlementPending: overview.settlementPending.amount,
      hcoinLiability: hcoin.liabilityRupees,
      referralLiability,
      adjustmentLiability,
      providerPayable: overview.providerPayable,
      totalLiabilities: round2(
        overview.walletLiability +
          overview.giftCardLiability +
          overview.cashbackLiability +
          overview.refundLiability +
          (pendingPayouts._sum.netAmount ?? 0) +
          overview.chargebackExposure.amount +
          hcoin.liabilityRupees +
          referralLiability +
          adjustmentLiability,
      ),
      generatedAt: new Date().toISOString(),
    };
  }

  async captureSnapshot(period: LiabilitySnapshotPeriod) {
    const report = await this.buildCurrentReport();
    const snapshotDate = new Date();
    snapshotDate.setUTCHours(0, 0, 0, 0);

    return prisma.financeLiabilitySnapshot.upsert({
      where: {
        period_snapshotDate: { period, snapshotDate },
      },
      create: {
        period,
        snapshotDate,
        walletLiability: report.walletLiability,
        giftCardLiability: report.giftCardLiability,
        cashbackLiability: report.cashbackLiability,
        refundLiability: report.refundLiability,
        payoutLiability: report.payoutLiability,
        chargebackExposure: report.chargebackExposure,
        settlementPending: report.settlementPending,
        hcoinLiability: report.hcoinLiability,
        referralLiability: report.referralLiability,
        adjustmentLiability: report.adjustmentLiability,
        providerPayable: report.providerPayable,
        totalLiabilities: report.totalLiabilities,
        payload: JSON.stringify(report),
      },
      update: {
        walletLiability: report.walletLiability,
        giftCardLiability: report.giftCardLiability,
        cashbackLiability: report.cashbackLiability,
        refundLiability: report.refundLiability,
        payoutLiability: report.payoutLiability,
        chargebackExposure: report.chargebackExposure,
        settlementPending: report.settlementPending,
        hcoinLiability: report.hcoinLiability,
        referralLiability: report.referralLiability,
        adjustmentLiability: report.adjustmentLiability,
        providerPayable: report.providerPayable,
        totalLiabilities: report.totalLiabilities,
        payload: JSON.stringify(report),
      },
    });
  }

  async listSnapshots(period?: LiabilitySnapshotPeriod, limit = 90) {
    return prisma.financeLiabilitySnapshot.findMany({
      where: period ? { period } : undefined,
      orderBy: { snapshotDate: "desc" },
      take: limit,
    });
  }

  async dashboard() {
    const [current, daily, weekly, monthly] = await Promise.all([
      this.buildCurrentReport(),
      this.listSnapshots("DAILY", 30),
      this.listSnapshots("WEEKLY", 12),
      this.listSnapshots("MONTHLY", 12),
    ]);
    return { current, snapshots: { daily, weekly, monthly } };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const financeLiabilityService = new FinanceLiabilityService();
