import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { financeDashboardService } from "./finance-dashboard.service";
import { chargebackWorkflowService } from "./chargeback-workflow.service";

export type ReportPeriod = "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom";

export class ExecutiveReportingService {
  periodToDays(period: ReportPeriod, customDays?: number): number {
    switch (period) {
      case "daily": return 1;
      case "weekly": return 7;
      case "monthly": return 30;
      case "quarterly": return 90;
      case "yearly": return 365;
      case "custom": return Math.max(1, Math.min(365, customDays ?? 30));
      default: return 30;
    }
  }

  async buildExecutiveReport(period: ReportPeriod = "monthly", customDays?: number) {
    const days = this.periodToDays(period, customDays);
    const [overview, trend, chargebackStats] = await Promise.all([
      financeDashboardService.getOverview(days),
      financeDashboardService.dailyTrend(days),
      chargebackWorkflowService.analytics(),
    ]);

    const platformMargin = overview.gmv > 0
      ? round2(((overview.netRevenue - overview.providerPayable) / overview.gmv) * 100)
      : 0;

    return {
      period,
      days,
      generatedAt: new Date().toISOString(),
      gmv: overview.gmv,
      revenue: overview.revenue,
      netRevenue: overview.netRevenue,
      platformMarginPct: platformMargin,
      subscriptionRevenue: overview.mrr,
      giftCardLiability: overview.giftCardLiability,
      walletLiability: overview.walletLiability,
      cashbackLiability: overview.cashbackLiability,
      providerLiability: overview.providerPayable,
      chargebackExposure: overview.chargebackExposure,
      totalLiabilities: overview.totalLiabilities,
      trend,
      chargebackStats,
    };
  }

  async computeFinanceHealthScore(period: ReportPeriod = "monthly"): Promise<{
    score: number;
    components: Record<string, number>;
    report: Awaited<ReturnType<ExecutiveReportingService["buildExecutiveReport"]>>;
  }> {
    const report = await this.buildExecutiveReport(period);
    const cb = report.chargebackStats;

    const liquidity = clamp(100 - (report.totalLiabilities / Math.max(report.gmv, 1)) * 10);
    const growth = clamp(report.trend.length >= 2
      ? ((report.trend[report.trend.length - 1]?.amount ?? 0) / Math.max(report.trend[0]?.amount ?? 1, 1)) * 50
      : 50);
    const revenueStability = clamp(report.netRevenue > 0 ? 80 : 40);
    const risk = clamp(100 - cb.chargebackRatio * 5);
    const chargebacks = clamp(100 - cb.lossRate);
    const liability = clamp(100 - (report.totalLiabilities / Math.max(report.gmv, 1)) * 20);

    const components = {
      liquidity: round2(liquidity),
      growth: round2(growth),
      revenueStability: round2(revenueStability),
      risk: round2(risk),
      chargebacks: round2(chargebacks),
      outstandingLiability: round2(liability),
    };

    const score = round2(
      (components.liquidity * 0.2 +
        components.growth * 0.15 +
        components.revenueStability * 0.2 +
        components.risk * 0.15 +
        components.chargebacks * 0.15 +
        components.outstandingLiability * 0.15),
    );

    return { score, components, report };
  }

  async exportCsv(period: ReportPeriod = "monthly"): Promise<string> {
    const report = await this.buildExecutiveReport(period);
    const header = "metric,value";
    const rows = [
      ["GMV", report.gmv],
      ["Revenue", report.revenue],
      ["Net Revenue", report.netRevenue],
      ["Platform Margin %", report.platformMarginPct],
      ["Subscription Revenue", report.subscriptionRevenue],
      ["Wallet Liability", report.walletLiability],
      ["Gift Card Liability", report.giftCardLiability],
      ["Cashback Liability", report.cashbackLiability],
      ["Provider Liability", report.providerLiability],
      ["Chargeback Exposure", (report.chargebackExposure as { amount?: number }).amount ?? 0],
      ["Total Liabilities", report.totalLiabilities],
    ];
    return [header, ...rows.map(([k, v]) => `${k},${v}`)].join("\n");
  }

  async exportXlsx(period: ReportPeriod = "monthly"): Promise<Buffer> {
    const report = await this.buildExecutiveReport(period);
    const health = await this.computeFinanceHealthScore(period);
    const wb = new ExcelJS.Workbook();
    const summary = wb.addWorksheet("Summary");
    summary.addRows([
      ["Metric", "Value"],
      ["GMV", report.gmv],
      ["Net Revenue", report.netRevenue],
      ["Finance Health Score", health.score],
      ["Wallet Liability", report.walletLiability],
      ["Provider Liability", report.providerLiability],
    ]);
    const trend = wb.addWorksheet("Daily Trend");
    trend.addRow(["Date", "Amount"]);
    for (const row of report.trend) trend.addRow([row.date, row.amount]);
    const buf = await wb.xlsx.writeBuffer();
    return Buffer.from(buf);
  }

  async exportPdf(period: ReportPeriod = "monthly"): Promise<Buffer> {
    const report = await this.buildExecutiveReport(period);
    const health = await this.computeFinanceHealthScore(period);
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fontSize(18).text("HOMIGO Board Report", { underline: true });
      doc.moveDown();
      doc.fontSize(12).text(`Period: ${period} (${report.days} days)`);
      doc.text(`Generated: ${report.generatedAt}`);
      doc.moveDown();
      doc.text(`GMV: ₹${report.gmv.toLocaleString("en-IN")}`);
      doc.text(`Net Revenue: ₹${report.netRevenue.toLocaleString("en-IN")}`);
      doc.text(`Finance Health Score: ${health.score}/100`);
      doc.moveDown();
      doc.text("Liabilities:");
      doc.text(`  Wallet: ₹${report.walletLiability}`);
      doc.text(`  Provider: ₹${report.providerLiability}`);
      doc.text(`  Chargeback Exposure: ₹${(report.chargebackExposure as { amount?: number }).amount ?? 0}`);
      doc.end();
    });
  }
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const executiveReportingService = new ExecutiveReportingService();
