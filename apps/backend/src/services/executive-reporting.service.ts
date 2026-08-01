import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  COMPANY,
  PDF_BRAND,
  PDF_RHYTHM,
  drawAttestationBlock,
  drawCompanyDetailsBlock,
  drawExecutiveInsight,
  drawMetricBox,
  drawPdfContinuationHeader,
  drawPdfFooter,
  drawPdfHeader,
  drawPdfWatermark,
  drawScoreBadge,
  drawTrendTwoColumn,
  drawReportContents,
  formatDtPdf,
  formatInrPdf,
  pdfFingerprint,
  pdfKvGrid,
  pdfKvTable,
  pdfSectionTitle,
} from "../lib/pdf-branding";
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
    const chargebackOpen =
      (report.chargebackExposure as { amount?: number }).amount ?? cb.openExposure ?? 0;

    const annualizedGmv = (report.gmv / Math.max(report.days, 1)) * 365;
    const customerLiabilities =
      report.walletLiability + report.giftCardLiability + report.cashbackLiability + chargebackOpen;

    const liquidity = scoreLiquidity(customerLiabilities, annualizedGmv);
    const growth = scoreGrowth(report.trend);
    const revenueStability = scoreRevenueStability(report.trend, report.netRevenue);
    const risk = clamp(100 - cb.chargebackRatio * 5);
    const chargebacks = clamp(100 - cb.lossRate);
    const liability = scoreOutstandingLiability(report.totalLiabilities, annualizedGmv);

    const components = {
      liquidity: round2(liquidity),
      growth: round2(growth),
      revenueStability: round2(revenueStability),
      risk: round2(risk),
      chargebacks: round2(chargebacks),
      outstandingLiability: round2(liability),
    };

    const score = round2(
      components.liquidity * 0.2 +
        components.growth * 0.15 +
        components.revenueStability * 0.2 +
        components.risk * 0.15 +
        components.chargebacks * 0.15 +
        components.outstandingLiability * 0.15,
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
    const health = await this.computeFinanceHealthScore(period);
    const report = health.report;
    const generatedAt = new Date();
    const documentId = `RPT-${generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${period.toUpperCase()}`;
    const fingerprint = pdfFingerprint(`${period}:${report.days}`, generatedAt);
    const cb = report.chargebackStats;
    const chargebackExposure =
      (report.chargebackExposure as { amount?: number }).amount ?? cb.openExposure ?? 0;
    const periodLabel = period.charAt(0).toUpperCase() + period.slice(1);
    const totalPages = 3;

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: PDF_RHYTHM.margin });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const footerMeta = {
        fingerprint,
        generatedAt,
        line2: "Confidential executive report — board and finance leadership only.",
      };

      // ── Page 1: Cover, company, metadata, executive summary ──
      drawPdfWatermark(doc);
      drawPdfHeader(doc, {
        documentId,
        subtitle: "Executive Finance Report",
        badge: "BOARD & EXECUTIVE USE ONLY",
      });

      doc.fillColor(PDF_BRAND.dark).fontSize(PDF_RHYTHM.type.hero).font("Helvetica-Bold").text("Executive Finance Report", PDF_RHYTHM.margin);
      doc
        .fontSize(PDF_RHYTHM.type.subtitle)
        .font("Helvetica")
        .fillColor(PDF_BRAND.muted)
        .text(`${periodLabel} snapshot  ·  ${report.days}-day window  ·  ${COMPANY.division}`, PDF_RHYTHM.margin);
      doc.y += PDF_RHYTHM.blockGap;

      drawCompanyDetailsBlock(doc);

      pdfSectionTitle(doc, 1, "Report metadata");
      pdfKvGrid(doc, [
        ["Report period", `${periodLabel} (${report.days} days)`],
        ["Document ID", documentId],
        ["Reporting window ends", formatDtPdf(generatedAt)],
        ["Integrity hash", fingerprint],
        ["Classification", "Confidential — Board & Finance"],
        ["Data source", "HOMEEIGO Finance Dashboard"],
      ]);

      pdfSectionTitle(doc, 2, "Executive summary");
      const summaryY = doc.y;
      const badgeW = (doc.page.width - PDF_RHYTHM.margin * 2 - PDF_RHYTHM.cardGap * 2) / 3;

      drawScoreBadge(doc, "Finance health", health.score, PDF_RHYTHM.margin, summaryY, badgeW);
      drawMetricBox(doc, "GMV", formatInrPdf(report.gmv), PDF_RHYTHM.margin + badgeW + PDF_RHYTHM.cardGap, summaryY, badgeW);
      drawMetricBox(
        doc,
        "Net revenue",
        formatInrPdf(report.netRevenue),
        PDF_RHYTHM.margin + (badgeW + PDF_RHYTHM.cardGap) * 2,
        summaryY,
        badgeW,
      );
      doc.y = summaryY + PDF_RHYTHM.cardH + PDF_RHYTHM.blockGap;

      pdfKvTable(
        doc,
        [
          ["Gross revenue", formatInrPdf(report.revenue)],
          ["Platform margin", `${report.platformMarginPct}%`],
          ["Subscription / MRR", formatInrPdf(report.subscriptionRevenue)],
          ["Total liabilities", formatInrPdf(report.totalLiabilities)],
        ],
        { compact: true },
      );

      drawExecutiveInsight(doc, health.score, periodLabel, report.days);
      drawReportContents(doc);
      drawPdfFooter(doc, { ...footerMeta, page: 1, totalPages });

      // ── Page 2: Health components, liabilities, chargebacks ──
      doc.addPage();
      drawPdfWatermark(doc);
      drawPdfContinuationHeader(doc, { documentId, sectionHint: "Health · Liabilities · Chargebacks" });

      pdfSectionTitle(doc, 3, "Finance health components");
      const compY = doc.y;
      const compW = (doc.page.width - PDF_RHYTHM.margin * 2 - PDF_RHYTHM.cardGap * 2) / 3;
      const comps = [
        ["Liquidity", health.components.liquidity],
        ["Risk", health.components.risk],
        ["Growth", health.components.growth],
        ["Chargebacks", health.components.chargebacks],
        ["Revenue stability", health.components.revenueStability],
        ["Outstanding liability", health.components.outstandingLiability],
      ] as const;

      for (let i = 0; i < comps.length; i++) {
        const col = i % 3;
        const row = Math.floor(i / 3);
        drawScoreBadge(
          doc,
          comps[i][0],
          comps[i][1],
          PDF_RHYTHM.margin + col * (compW + PDF_RHYTHM.cardGap),
          compY + row * (PDF_RHYTHM.cardH + PDF_RHYTHM.cardGap),
          compW,
        );
      }
      doc.y = compY + (PDF_RHYTHM.cardH + PDF_RHYTHM.cardGap) * 2 + PDF_RHYTHM.sectionGap;

      pdfSectionTitle(doc, 4, "Liabilities & exposure");
      pdfKvTable(
        doc,
        [
          ["Wallet liability", formatInrPdf(report.walletLiability)],
          ["Gift card liability", formatInrPdf(report.giftCardLiability)],
          ["Cashback liability", formatInrPdf(report.cashbackLiability)],
          ["Provider payable", formatInrPdf(report.providerLiability)],
          ["Chargeback exposure (open)", formatInrPdf(chargebackExposure)],
          ["Total liabilities", formatInrPdf(report.totalLiabilities)],
          ["Liability / GMV ratio", report.gmv > 0 ? `${round2((report.totalLiabilities / report.gmv) * 100)}%` : "—"],
        ],
        { compact: true },
      );

      pdfSectionTitle(doc, 5, "Chargeback analytics");
      pdfKvGrid(
        doc,
        [
          ["Total chargebacks", String(cb.total)],
          ["Open / under review", String(cb.open)],
          ["Won disputes", String(cb.won)],
          ["Lost disputes", String(cb.lost)],
          ["Win rate", `${cb.winRate}%`],
          ["Loss rate", `${cb.lossRate}%`],
          ["Chargeback ratio", `${cb.chargebackRatio}%`],
          ["Open exposure", formatInrPdf(cb.openExposure)],
          ["Recovery (won)", formatInrPdf(cb.recoveryAmount)],
          ["Payments baseline", "Successful payments ledger"],
        ],
        2,
      );

      drawPdfFooter(doc, { ...footerMeta, page: 2, totalPages });

      // ── Page 3: Daily trend + attestation ──
      doc.addPage();
      drawPdfWatermark(doc);
      drawPdfContinuationHeader(doc, { documentId, sectionHint: "Trend · Attestation" });

      pdfSectionTitle(doc, 6, "Daily revenue trend");
      if (report.trend.length === 0) {
        doc.fontSize(PDF_RHYTHM.type.body).fillColor(PDF_BRAND.muted).text("No trend data for this period.", PDF_RHYTHM.margin);
        doc.y += PDF_RHYTHM.blockGap;
      } else {
        drawTrendTwoColumn(doc, report.trend, formatInrPdf);
      }

      pdfSectionTitle(doc, 7, "Board attestation & disclaimer");
      drawAttestationBlock(doc, fingerprint);
      drawPdfFooter(doc, { ...footerMeta, page: 3, totalPages });

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

/** Customer wallet / gift-card exposure vs annualised GMV run-rate. */
function scoreLiquidity(customerLiabilities: number, annualizedGmv: number): number {
  const ratio = customerLiabilities / Math.max(annualizedGmv, 1);
  return clamp(100 - ratio * 35);
}

/** Compare average revenue in the second half of the window vs the first half. */
function scoreGrowth(trend: Array<{ amount: number }>): number {
  if (trend.length < 2) return 68;

  const mid = Math.max(1, Math.floor(trend.length / 2));
  const firstHalf = trend.slice(0, mid);
  const secondHalf = trend.slice(mid);
  const avgFirst = average(firstHalf.map((row) => row.amount));
  const avgSecond = average(secondHalf.map((row) => row.amount));

  if (avgFirst <= 0 && avgSecond > 0) return 92;
  if (avgFirst <= 0) return 55;

  const ratio = avgSecond / avgFirst;
  return clamp(68 + (ratio - 1) * 32);
}

/** Reward positive net revenue; soften penalty when the series is still maturing. */
function scoreRevenueStability(trend: Array<{ amount: number }>, netRevenue: number): number {
  if (netRevenue <= 0) return 40;
  if (trend.length < 3) return 78;

  const amounts = trend.map((row) => row.amount);
  const mean = average(amounts);
  if (mean <= 0) return 72;

  const stdDev = Math.sqrt(average(amounts.map((value) => (value - mean) ** 2)));
  const coefficientOfVariation = stdDev / mean;
  const maturityBoost = trend.length < 14 ? 8 : 0;
  return clamp(88 - coefficientOfVariation * 18 + maturityBoost);
}

/** Total balance-sheet liabilities vs annualised GMV — not 30-day flow. */
function scoreOutstandingLiability(totalLiabilities: number, annualizedGmv: number): number {
  const ratio = totalLiabilities / Math.max(annualizedGmv, 1);
  return clamp(100 - ratio * 28);
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export const executiveReportingService = new ExecutiveReportingService();
