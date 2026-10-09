import { analyticsWhere, analyticsWhereVia } from "../lib/analytics-scope";
import prisma from "../lib/prisma";

/** CFO dashboard aggregates — liabilities, GMV, revenue proxies. */
export class FinanceDashboardService {
  async getOverview(periodDays = 30) {
    const since = new Date(Date.now() - periodDays * 24 * 60 * 60 * 1000);

    const [
      gmvAgg,
      walletCapturedAgg,
      refundsInPeriodAgg,
      refundLiabilityAgg,
      walletAgg,
      giftCardAgg,
      cashbackAgg,
      providerPayableAgg,
      settlementPending,
      chargebackExposure,
      subscriptionMrr,
    ] = await Promise.all([
      // Scoped like the refund total below: `netRevenue` subtracts one from the other, and an
      // unscoped GMV minus a scoped refund figure is a number about no population at all.
      prisma.payment.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: since }, ...analyticsWhereVia("payment") },
        _sum: { amountPaid: true },
        _count: true,
      }),
      // Wallet-only checkouts have no payment row. A split keeps the gateway remainder on the
      // payment and the wallet share here, so adding them does not double-count.
      prisma.walletTransaction.aggregate({
        where: {
          type: "DEBIT",
          status: "COMPLETED",
          referenceType: "booking_wallet_payment",
          createdAt: { gte: since },
          ...analyticsWhereVia("walletTransaction"),
        },
        _sum: { amount: true },
      }),
      // Scoped: 97.1% of refund_requests are certification artifacts, so the unscoped refund total
      // on this dashboard was overwhelmingly a description of test runs.
      prisma.refundRequest.aggregate({
        where: { status: "COMPLETED", processedAt: { gte: since }, ...analyticsWhere() },
        _sum: { amount: true },
      }),
      // NOT scoped: `refundLiability` feeds `totalLiabilities` and the liability snapshots
      // (finance-liability.service), and a liability is never population-scoped — see walletBalance.
      prisma.payment.aggregate({
        where: { refundedAmount: { gt: 0 } },
        _sum: { refundedAmount: true },
      }),
      // Deliberately NOT scoped. This is a LIABILITY: the platform owes this money to whoever holds
      // the balance, and a fixture user's balance is still a row the ledger reconciliation must
      // account for. Excluding it here would make this figure disagree with
      // `ledger-reconciliation.service` and manufacture a drift that does not exist.
      prisma.user.aggregate({ _sum: { walletBalance: true } }),
      prisma.giftCard.aggregate({
        where: { status: "ACTIVE" },
        _sum: { balance: true },
      }),
      prisma.membershipCashback.aggregate({
        where: { status: "PENDING" },
        _sum: { amount: true },
      }),
      prisma.provider.aggregate({ _sum: { walletBalance: true } }),
      // NOT scoped: captured-but-unsettled money is a gateway receivable reconciled payment by
      // payment (payment-reconciliation.service counts the same rows, unscoped), not a business total.
      prisma.payment.aggregate({
        where: { status: "SUCCESS", settlementId: null },
        _sum: { amountPaid: true },
        _count: true,
      }),
      prisma.chargeback.aggregate({
        where: { status: { in: ["RECEIVED", "OPEN", "UNDER_REVIEW", "EVIDENCE_PENDING", "RESPONDED"] } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", createdAt: { gte: since } },
        _sum: { amount: true },
      }),
    ]);

    const gmv = round2((gmvAgg._sum.amountPaid ?? 0) + (walletCapturedAgg._sum.amount ?? 0));
    const refundsInPeriod = refundsInPeriodAgg._sum.amount ?? 0;
    const refundLiabilityAllTime = refundLiabilityAgg._sum.refundedAmount ?? 0;
    const netRevenue = round2(gmv - refundsInPeriod);
    const walletLiability = walletAgg._sum.walletBalance ?? 0;
    const giftCardLiability = giftCardAgg._sum.balance ?? 0;
    const cashbackLiability = cashbackAgg._sum.amount ?? 0;
    const providerPayable = providerPayableAgg._sum.walletBalance ?? 0;
    const settlementPendingAmount = settlementPending._sum.amountPaid ?? 0;
    const chargebackOpen = chargebackExposure._sum.amount ?? 0;
    const mrr = subscriptionMrr._sum.amount ?? 0;

    return {
      periodDays,
      gmv,
      revenue: gmv,
      netRevenue,
      mrr,
      arr: round2(mrr * 12),
      refundsInPeriod,
      refundLiability: refundLiabilityAllTime,
      walletLiability,
      giftCardLiability,
      cashbackLiability,
      providerPayable,
      settlementPending: { count: settlementPending._count, amount: settlementPendingAmount },
      chargebackExposure: { count: chargebackExposure._count, amount: chargebackOpen },
      totalLiabilities: round2(
        walletLiability + giftCardLiability + cashbackLiability + providerPayable + refundLiabilityAllTime,
      ),
    };
  }

  async dailyTrend(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    // Gateway capture plus wallet booking debits, the same two terms as overview GMV.
    const [payments, wallets] = await Promise.all([
      prisma.payment.findMany({
        where: { status: "SUCCESS", completedAt: { gte: since }, ...analyticsWhereVia("payment") },
        select: { amountPaid: true, completedAt: true },
      }),
      prisma.walletTransaction.findMany({
        where: {
          type: "DEBIT",
          status: "COMPLETED",
          referenceType: "booking_wallet_payment",
          createdAt: { gte: since },
          ...analyticsWhereVia("walletTransaction"),
        },
        select: { amount: true, createdAt: true },
      }),
    ]);

    const byDay = new Map<string, number>();
    for (const p of payments) {
      if (!p.completedAt) continue;
      const key = p.completedAt.toISOString().slice(0, 10);
      byDay.set(key, round2((byDay.get(key) ?? 0) + p.amountPaid));
    }
    for (const w of wallets) {
      const key = w.createdAt.toISOString().slice(0, 10);
      byDay.set(key, round2((byDay.get(key) ?? 0) + w.amount));
    }

    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, amount]) => ({ date, amount }));
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const financeDashboardService = new FinanceDashboardService();
