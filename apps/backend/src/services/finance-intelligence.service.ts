import prisma from "../lib/prisma";
import { financeDashboardService } from "./finance-dashboard.service";
import { financeConfigService } from "./finance-config.service";

/**
 * Finance Intelligence — additive, migration-safe CFO metrics.
 *
 * Transactional figures come from existing tables (payments, earnings,
 * subscription_invoices). Non-transactional inputs (operating expenses, cash on
 * hand, gateway fee %) are resolved via finance_config (DB) with env fallback
 * until the CFO sets values in Finance HQ. When an input is absent the
 * dependent metric is returned as `null` with `missingInputs` populated —
 * never a fabricated 0.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export type FinanceAssumptions = Awaited<ReturnType<typeof financeConfigService.resolve>> & {
  source: "finance_config";
};

export class FinanceIntelligenceService {
  private async assumptions(): Promise<FinanceAssumptions> {
    const resolved = await financeConfigService.resolve();
    return { ...resolved, source: "finance_config" };
  }

  /** Canonical, single-source-of-truth GMV (payment-based) + reconciliation to booking-based. */
  async getCanonicalGmv(days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);

    const [paymentAgg, bookingAgg] = await Promise.all([
      prisma.payment.aggregate({
        where: { status: "SUCCESS", completedAt: { gte: since } },
        _sum: { amountPaid: true },
        _count: true,
      }),
      prisma.booking.aggregate({
        where: { status: "COMPLETED", completedAt: { gte: since } },
        _sum: { totalAmount: true },
        _count: true,
      }),
    ]);

    const paymentBased = round2(paymentAgg._sum.amountPaid ?? 0);
    const bookingBased = round2(bookingAgg._sum.totalAmount ?? 0);
    const deltaPct = paymentBased > 0 ? round2(((paymentBased - bookingBased) / paymentBased) * 100) : 0;

    return {
      periodDays: days,
      generatedAt: new Date().toISOString(),
      gmv: paymentBased,
      canonicalDefinition: "SUM(payment.amountPaid) WHERE status=SUCCESS AND completedAt in window",
      basis: "payment" as const,
      successfulPayments: paymentAgg._count,
      reconciliation: {
        paymentBased,
        bookingBased,
        completedBookings: bookingAgg._count,
        deltaPct,
        note:
          "Canonical GMV is payment-based. Booking-based (SUM completed booking.totalAmount) is shown for reconciliation; a large delta signals unsettled or refunded transactions.",
      },
    };
  }

  /** Full P&L intelligence: gross margin, EBITDA, burn, runway, profit forecast. */
  async getFinanceIntelligence(days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);
    const assumptions = await this.assumptions();

    const [gmvBlock, commissionAgg, subscriptionAgg, refundAgg, overview] = await Promise.all([
      this.getCanonicalGmv(days),
      prisma.earning.aggregate({ where: { earningDate: { gte: since } }, _sum: { commission: true } }),
      prisma.subscriptionInvoice.aggregate({
        where: { status: "paid", createdAt: { gte: since } },
        _sum: { amount: true },
      }),
      prisma.payment.aggregate({
        where: { refundedAmount: { gt: 0 }, updatedAt: { gte: since } },
        _sum: { refundedAmount: true },
      }),
      financeDashboardService.getOverview(days),
    ]);

    const gmv = gmvBlock.gmv;
    const commissionRevenue = round2(commissionAgg._sum.commission ?? 0);
    const subscriptionRevenue = round2(subscriptionAgg._sum.amount ?? 0);
    const refunds = round2(refundAgg._sum.refundedAmount ?? 0);
    const netRevenue = round2(commissionRevenue + subscriptionRevenue);

    const gatewayFees = round2((gmv * assumptions.gatewayFeePct) / 100);
    const cogs = round2(gatewayFees + refunds);

    const grossProfit = round2(netRevenue - cogs);
    const grossMarginPct = netRevenue > 0 ? round2((grossProfit / netRevenue) * 100) : null;

    const monthlyFactor = 30 / Math.max(days, 1);
    const monthlyNetRevenue = round2(netRevenue * monthlyFactor);
    const monthlyCogs = round2(cogs * monthlyFactor);
    const monthlyContribution = round2(monthlyNetRevenue - monthlyCogs);

    const missingInputs: string[] = [];
    const opex = assumptions.operatingExpenseMonthly;
    if (opex == null) missingInputs.push("OPERATING_EXPENSE_MONTHLY");
    if (assumptions.cashOnHand == null) missingInputs.push("CASH_ON_HAND");

    const periodOpex = opex != null ? round2(opex / monthlyFactor) : null;
    const ebitda = opex != null ? round2(grossProfit - (periodOpex ?? 0)) : null;
    const ebitdaMarginPct =
      ebitda != null && netRevenue > 0 ? round2((ebitda / netRevenue) * 100) : null;

    const netMonthlyCashFlow = opex != null ? round2(monthlyContribution - opex) : null;
    const isProfitable = netMonthlyCashFlow != null ? netMonthlyCashFlow >= 0 : null;
    const monthlyBurn =
      netMonthlyCashFlow != null ? round2(netMonthlyCashFlow < 0 ? -netMonthlyCashFlow : 0) : null;

    let runwayMonths: number | null = null;
    let runwayStatus: "profitable" | "finite" | "input_required" = "input_required";
    if (netMonthlyCashFlow != null && assumptions.cashOnHand != null) {
      if (monthlyBurn != null && monthlyBurn <= 0) {
        runwayMonths = null;
        runwayStatus = "profitable";
      } else if (monthlyBurn != null && monthlyBurn > 0) {
        runwayMonths = round2(assumptions.cashOnHand / monthlyBurn);
        runwayStatus = "finite";
      }
    }

    const contributionForecastMonthly = monthlyContribution;
    const profitForecastMonthly = opex != null ? round2(monthlyContribution - opex) : null;
    const profitForecastAnnual = profitForecastMonthly != null ? round2(profitForecastMonthly * 12) : null;

    const configNote =
      assumptions.sources.operatingExpenseMonthly === "missing" ||
      assumptions.sources.cashOnHand === "missing"
        ? "Set values in Finance HQ → CFO Config (or legacy env vars until migrated)."
        : undefined;

    return {
      periodDays: days,
      generatedAt: new Date().toISOString(),
      assumptions,
      missingInputs,
      canonicalGmv: gmvBlock,
      revenue: {
        grossRevenue: gmv,
        commissionRevenue,
        subscriptionRevenue,
        netRevenue,
        refunds,
      },
      cogs: {
        gatewayFees,
        gatewayFeePct: assumptions.gatewayFeePct,
        gatewayFeePctSource: assumptions.sources.gatewayFeePct,
        refunds,
        total: cogs,
      },
      grossMargin: {
        grossProfit,
        grossMarginPct,
        basis: "netRevenue = commission + subscriptions",
      },
      ebitda: {
        available: ebitda != null,
        operatingExpenseMonthly: opex,
        ebitda,
        ebitdaMarginPct,
        note: opex == null ? configNote ?? "OPERATING_EXPENSE_MONTHLY not configured." : undefined,
      },
      burnRate: {
        available: netMonthlyCashFlow != null,
        netMonthlyCashFlow,
        monthlyBurn,
        isProfitable,
        note: netMonthlyCashFlow == null ? configNote ?? "OPERATING_EXPENSE_MONTHLY not configured." : undefined,
      },
      cashRunway: {
        available: runwayStatus !== "input_required",
        cashOnHand: assumptions.cashOnHand,
        runwayMonths,
        status: runwayStatus,
        note:
          runwayStatus === "input_required"
            ? configNote ?? "OPERATING_EXPENSE_MONTHLY and CASH_ON_HAND not configured."
            : undefined,
      },
      forecast: {
        contributionForecastMonthly,
        contributionForecastAnnual: round2(contributionForecastMonthly * 12),
        profitForecastMonthly,
        profitForecastAnnual,
        note:
          profitForecastMonthly == null
            ? configNote ?? "Contribution forecast is live; profit forecast requires OPERATING_EXPENSE_MONTHLY."
            : undefined,
      },
      liabilities: {
        totalLiabilities: overview.totalLiabilities,
        providerPayable: overview.providerPayable,
      },
    };
  }
}

export const financeIntelligenceService = new FinanceIntelligenceService();
