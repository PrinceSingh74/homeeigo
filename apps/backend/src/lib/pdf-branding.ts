import crypto from "crypto";
import PDFDocument from "pdfkit";

export type PdfDoc = InstanceType<typeof PDFDocument>;

export const PDF_BRAND = {
  primary: "#EA580C",
  dark: "#0F172A",
  slate: "#334155",
  muted: "#64748B",
  line: "#E2E8F0",
  panel: "#F8FAFC",
  gold: "#B45309",
  success: "#059669",
};

/** Executive report rhythm — tuned for exactly 3 A4 pages. */
export const PDF_RHYTHM = {
  margin: 54,
  footerHeight: 32,
  sectionGap: 14,
  blockGap: 10,
  rowH: 18,
  rowGap: 2,
  cardH: 44,
  cardGap: 6,
  type: {
    hero: 17,
    subtitle: 8.5,
    section: 9.5,
    label: 7,
    body: 8,
    tableLabel: 7.5,
    tableValue: 8,
    footer: 6.5,
  },
};

export const COMPANY = {
  legalName: process.env.COMPANY_LEGAL_NAME ?? "HOMEEIGO Technologies Private Limited",
  brandName: "HOMEEIGO",
  tagline: "Premium Home Services Platform",
  division: "Finance & Business Intelligence",
  registeredOffice:
    process.env.COMPANY_REGISTERED_OFFICE ??
    "Registered Office: Mumbai, Maharashtra 400001, India",
  cin: process.env.COMPANY_CIN ?? "CIN: Available upon statutory request",
  gstin: process.env.COMPANY_GSTIN ?? "GSTIN: Available upon statutory request",
  email: process.env.COMPANY_FINANCE_EMAIL ?? "finance@homigo.app",
  supportEmail: process.env.COMPANY_SUPPORT_EMAIL ?? "support@homigo.app",
  website: process.env.COMPANY_WEBSITE ?? "https://homigo.com",
  phone: process.env.COMPANY_PHONE ?? "+91 1800-123-456",
};

export function pdfContentBottom(doc: PdfDoc): number {
  return doc.page.height - PDF_RHYTHM.margin - PDF_RHYTHM.footerHeight - 8;
}

export function formatInrPdf(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDtPdf(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function pdfFingerprint(seed: string, generatedAt: Date): string {
  return crypto.createHash("sha256").update(`${seed}:${generatedAt.toISOString()}`).digest("hex").slice(0, 16).toUpperCase();
}

export function drawPdfWatermark(doc: PdfDoc, label = "CONFIDENTIAL") {
  doc.save();
  doc
    .opacity(0.05)
    .fillColor(PDF_BRAND.dark)
    .fontSize(52)
    .rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.text(label, doc.page.width / 2 - 165, doc.page.height / 2 - 18);
  doc.restore();
}

export function drawPdfHeader(
  doc: PdfDoc,
  meta: { documentId: string; subtitle: string; badge?: string },
) {
  const w = doc.page.width;
  const h = 76;
  doc.rect(0, 0, w, h).fill(PDF_BRAND.dark);
  doc.rect(0, h - 3, w, 3).fill(PDF_BRAND.primary);

  doc.fillColor("#FFFFFF").fontSize(20).font("Helvetica-Bold").text(COMPANY.brandName, PDF_RHYTHM.margin, 20, {
    continued: true,
  });
  doc.font("Helvetica").fontSize(10).fillColor("#CBD5E1").text(`  ·  ${COMPANY.division}`, { continued: false });

  doc.fontSize(8.5).fillColor("#94A3B8").text(meta.subtitle.toUpperCase(), PDF_RHYTHM.margin, 44);
  doc.fontSize(7.5).text(`Document ${meta.documentId}`, PDF_RHYTHM.margin, 58);

  doc.fillColor(PDF_BRAND.gold).fontSize(7.5).font("Helvetica-Bold");
  doc.text(meta.badge ?? "BOARD & EXECUTIVE USE ONLY", w - 220, 22, { width: 166, align: "right" });
  doc.font("Helvetica").fontSize(6.5).fillColor("#94A3B8").text(COMPANY.legalName, w - 220, 38, {
    width: 166,
    align: "right",
  });

  doc.y = h + 16;
}

export function drawPdfContinuationHeader(doc: PdfDoc, meta: { documentId: string; sectionHint?: string }) {
  const w = doc.page.width;
  const y = PDF_RHYTHM.margin;
  doc.rect(PDF_RHYTHM.margin, y, w - PDF_RHYTHM.margin * 2, 28).fill(PDF_BRAND.panel);
  doc.rect(PDF_RHYTHM.margin, y, 3, 28).fill(PDF_BRAND.primary);
  doc
    .fillColor(PDF_BRAND.dark)
    .fontSize(8.5)
    .font("Helvetica-Bold")
    .text(`${COMPANY.brandName} · Executive Finance Report`, PDF_RHYTHM.margin + 12, y + 9);
  doc.font("Helvetica").fontSize(7).fillColor(PDF_BRAND.muted);
  doc.text(meta.sectionHint ?? meta.documentId, w - PDF_RHYTHM.margin - 180, y + 10, { width: 170, align: "right" });
  doc.y = y + 38;
}

export function drawPdfFooter(
  doc: PdfDoc,
  meta: { fingerprint: string; generatedAt: Date; line2?: string; page?: number; totalPages?: number },
) {
  const y = doc.page.height - PDF_RHYTHM.margin - PDF_RHYTHM.footerHeight;
  doc.strokeColor(PDF_BRAND.line).lineWidth(0.5).moveTo(PDF_RHYTHM.margin, y).lineTo(doc.page.width - PDF_RHYTHM.margin, y).stroke();
  doc.fontSize(PDF_RHYTHM.type.footer).fillColor(PDF_BRAND.muted);

  const pageLabel =
    meta.page && meta.totalPages ? `Page ${meta.page} of ${meta.totalPages}  ·  ` : "";

  doc.text(
    `${pageLabel}${COMPANY.brandName} · ${COMPANY.website} · ${formatDtPdf(meta.generatedAt)} · ${meta.fingerprint}`,
    PDF_RHYTHM.margin,
    y + 7,
    { width: doc.page.width - PDF_RHYTHM.margin * 2, align: "center", lineBreak: false },
  );
  doc.text(
    meta.line2 ?? "Confidential — finance leadership and board distribution only.",
    PDF_RHYTHM.margin,
    y + 17,
    { width: doc.page.width - PDF_RHYTHM.margin * 2, align: "center", lineBreak: false },
  );
}

export function pdfSectionTitle(doc: PdfDoc, n: number, title: string) {
  const { sectionGap, type } = PDF_RHYTHM;
  doc.fillColor(PDF_BRAND.primary).fontSize(type.section).font("Helvetica-Bold").text(`${n}. ${title.toUpperCase()}`, PDF_RHYTHM.margin);
  doc.moveDown(0.25);
  doc.strokeColor(PDF_BRAND.line).lineWidth(0.75).moveTo(PDF_RHYTHM.margin, doc.y).lineTo(doc.page.width - PDF_RHYTHM.margin, doc.y).stroke();
  doc.moveDown(sectionGap / 14);
}

export function pdfKvTable(doc: PdfDoc, rows: Array<[string, string]>, opts?: { compact?: boolean }) {
  const { margin, rowH, rowGap, type } = PDF_RHYTHM;
  const col1 = 200;
  const width = doc.page.width - margin * 2;
  const compact = opts?.compact ?? false;

  for (const [label, value] of rows) {
    const rowY = doc.y;
    doc.rect(margin, rowY, width, rowH).fill(PDF_BRAND.panel);
    doc
      .fillColor(PDF_BRAND.muted)
      .fontSize(compact ? type.tableLabel : type.tableLabel)
      .font("Helvetica-Bold")
      .text(label, margin + 10, rowY + (compact ? 5 : 5.5), { width: col1 - 14 });
    doc
      .fillColor(PDF_BRAND.slate)
      .font("Helvetica")
      .fontSize(type.tableValue)
      .text(value || "—", margin + col1, rowY + 5.5, { width: width - col1 - 12, align: "right" });
    doc.y = rowY + rowH + rowGap;
  }
  doc.y += PDF_RHYTHM.blockGap - rowGap;
}

export function pdfKvGrid(doc: PdfDoc, rows: Array<[string, string]>, columns = 2) {
  const { margin, rowH, rowGap, type } = PDF_RHYTHM;
  const gap = 8;
  const width = doc.page.width - margin * 2;
  const colW = (width - gap * (columns - 1)) / columns;

  for (let i = 0; i < rows.length; i += columns) {
    const rowY = doc.y;
    for (let c = 0; c < columns; c++) {
      const item = rows[i + c];
      if (!item) continue;
      const x = margin + c * (colW + gap);
      doc.rect(x, rowY, colW, rowH).fill(PDF_BRAND.panel);
      doc.fillColor(PDF_BRAND.muted).fontSize(type.tableLabel).font("Helvetica-Bold").text(item[0], x + 8, rowY + 4, {
        width: colW - 16,
      });
      doc
        .fillColor(PDF_BRAND.slate)
        .font("Helvetica")
        .fontSize(type.tableValue)
        .text(item[1] || "—", x + 8, rowY + 10, { width: colW - 16, align: "left" });
    }
    doc.y = rowY + rowH + rowGap;
  }
  doc.y += PDF_RHYTHM.blockGap - rowGap;
}

export function drawCompanyDetailsBlock(doc: PdfDoc) {
  const { margin, blockGap, type } = PDF_RHYTHM;
  const x = margin;
  const w = doc.page.width - margin * 2;
  const y = doc.y;
  const h = 68;

  doc.rect(x, y, w, h).lineWidth(0.75).strokeColor(PDF_BRAND.gold).fillAndStroke(PDF_BRAND.panel, PDF_BRAND.gold);
  doc.fillColor(PDF_BRAND.dark).fontSize(type.section).font("Helvetica-Bold").text("COMPANY INFORMATION", x + 12, y + 10);

  const mid = x + w / 2 + 4;
  doc.font("Helvetica").fontSize(type.body).fillColor(PDF_BRAND.slate);
  doc.text(COMPANY.legalName, x + 12, y + 26, { width: w / 2 - 16 });
  doc.text(COMPANY.tagline, x + 12, y + 38, { width: w / 2 - 16 });
  doc.text(COMPANY.registeredOffice, x + 12, y + 50, { width: w / 2 - 16 });

  doc.text(COMPANY.cin, mid, y + 26, { width: w / 2 - 20 });
  doc.text(COMPANY.gstin, mid, y + 38, { width: w / 2 - 20 });
  doc.text(`${COMPANY.email} · ${COMPANY.phone}`, mid, y + 50, { width: w / 2 - 20 });
  doc.fontSize(type.label).fillColor(PDF_BRAND.muted).text(COMPANY.website, mid, y + 58, { width: w / 2 - 20 });

  doc.y = y + h + blockGap;
}

export function drawMetricBox(doc: PdfDoc, label: string, value: string, x: number, y: number, w: number) {
  const { cardH, type } = PDF_RHYTHM;
  doc.rect(x, y, w, cardH).fill(PDF_BRAND.panel);
  doc.rect(x, y, 3, cardH).fill(PDF_BRAND.primary);
  doc.fillColor(PDF_BRAND.muted).fontSize(type.label).font("Helvetica-Bold").text(label.toUpperCase(), x + 10, y + 8, {
    width: w - 14,
  });
  doc.fillColor(PDF_BRAND.dark).fontSize(12).font("Helvetica-Bold").text(value, x + 10, y + 22, { width: w - 14 });
}

export function drawScoreBadge(doc: PdfDoc, label: string, score: number, x: number, y: number, w: number) {
  const { cardH, type } = PDF_RHYTHM;
  const color = score >= 80 ? PDF_BRAND.success : score >= 60 ? PDF_BRAND.primary : PDF_BRAND.gold;
  doc.rect(x, y, w, cardH).fill(PDF_BRAND.panel);
  doc.rect(x, y, 3, cardH).fill(color);
  doc.fillColor(PDF_BRAND.muted).fontSize(type.label).font("Helvetica-Bold").text(label.toUpperCase(), x + 10, y + 8, {
    width: w - 14,
  });
  doc.fillColor(PDF_BRAND.dark).fontSize(16).font("Helvetica-Bold").text(`${score}`, x + 10, y + 21);
  doc.fontSize(7.5).font("Helvetica").fillColor(PDF_BRAND.muted).text("/ 100", x + 38, y + 26);
}

export function drawTrendTwoColumn(
  doc: PdfDoc,
  rows: Array<{ date: string; amount: number }>,
  formatAmount: (n: number) => string,
) {
  const { margin, rowH, rowGap, type } = PDF_RHYTHM;
  const gap = 10;
  const width = doc.page.width - margin * 2;
  const colW = (width - gap) / 2;
  const half = Math.ceil(rows.length / 2);
  const left = rows.slice(0, half);
  const right = rows.slice(half);

  const headerY = doc.y;
  for (let c = 0; c < 2; c++) {
    const x = margin + c * (colW + gap);
    doc.rect(x, headerY, colW, rowH).fill(PDF_BRAND.dark);
    doc.fillColor("#FFFFFF").fontSize(type.tableLabel).font("Helvetica-Bold").text("DATE", x + 8, headerY + 5);
    doc.text("REVENUE", x + colW - 72, headerY + 5, { width: 64, align: "right" });
  }
  doc.y = headerY + rowH + 4;

  const maxRows = Math.max(left.length, right.length);
  for (let i = 0; i < maxRows; i++) {
    const rowY = doc.y;
    for (let c = 0; c < 2; c++) {
      const item = c === 0 ? left[i] : right[i];
      const x = margin + c * (colW + gap);
      if (!item) continue;
      doc.rect(x, rowY, colW, rowH).fill(i % 2 === 0 ? PDF_BRAND.panel : "#FFFFFF");
      doc.fillColor(PDF_BRAND.muted).fontSize(type.tableLabel).font("Helvetica").text(item.date, x + 8, rowY + 5);
      doc
        .fillColor(PDF_BRAND.slate)
        .font("Helvetica-Bold")
        .fontSize(type.tableValue)
        .text(formatAmount(item.amount), x + colW - 80, rowY + 5, { width: 72, align: "right" });
    }
    doc.y = rowY + rowH + rowGap;
  }
  doc.y += PDF_RHYTHM.blockGap;
}

export function drawExecutiveInsight(doc: PdfDoc, score: number, periodLabel: string, days: number) {
  const { margin, blockGap, type } = PDF_RHYTHM;
  const x = margin;
  const w = doc.page.width - margin * 2;
  const y = doc.y + 12;
  const h = 56;

  doc.rect(x, y, w, h).fill(PDF_BRAND.panel);
  doc.rect(x, y, 3, h).fill(PDF_BRAND.dark);
  doc.fillColor(PDF_BRAND.dark).fontSize(type.section).font("Helvetica-Bold").text("EXECUTIVE INSIGHT", x + 12, y + 10);
  doc
    .font("Helvetica")
    .fontSize(type.body)
    .fillColor(PDF_BRAND.slate)
    .text(
      `Finance health is ${score}/100 for the ${periodLabel} window (${days} days). Pages 2–3 cover component diagnostics, liability exposure, chargeback analytics, daily revenue trend, and board attestation.`,
      x + 12,
      y + 26,
      { width: w - 24, align: "justify", lineGap: 1.5 },
    );

  doc.y = y + h + blockGap;
}

export function drawReportContents(doc: PdfDoc) {
  const { margin, blockGap, type } = PDF_RHYTHM;
  const x = margin;
  const w = doc.page.width - margin * 2;
  const y = doc.y + 4;
  const items = [
    "Page 1 — Company profile, report metadata, executive KPI summary",
    "Page 2 — Health components, liabilities, chargeback analytics",
    "Page 3 — Daily revenue trend and board attestation",
  ];

  doc.fillColor(PDF_BRAND.muted).fontSize(type.label).font("Helvetica-Bold").text("REPORT CONTENTS", x, y);
  doc.font("Helvetica").fontSize(type.body).fillColor(PDF_BRAND.slate);
  let ly = y + 14;
  for (const item of items) {
    doc.text(item, x + 8, ly, { width: w - 8 });
    ly += 13;
  }
  doc.y = ly + blockGap;
}

export function drawAttestationBlock(doc: PdfDoc, fingerprint: string) {
  const { margin, blockGap, type } = PDF_RHYTHM;
  const x = margin;
  const w = doc.page.width - margin * 2;
  const y = doc.y;
  const h = 98;

  doc.rect(x, y, w, h).lineWidth(0.75).strokeColor(PDF_BRAND.gold).fillAndStroke(PDF_BRAND.panel, PDF_BRAND.gold);
  doc.fillColor(PDF_BRAND.dark).fontSize(type.section).font("Helvetica-Bold").text("FINANCIAL REPORT ATTESTATION", x + 12, y + 10);

  const body =
    "This Executive Finance Report is compiled from HOMEEIGO platform financial records — payment ledger, wallet balances, " +
    "provider settlements, chargeback exposure, and subscription revenue. Figures reflect the stated reporting window and are " +
    "intended for board review and CFO oversight. Distribution outside approved channels is prohibited. Not statutory audited " +
    "statements unless separately certified by appointed auditors.";

  doc.font("Helvetica").fontSize(type.body).fillColor(PDF_BRAND.slate).text(body, x + 12, y + 26, {
    width: w - 24,
    align: "justify",
    lineGap: 1.5,
  });

  doc.fontSize(type.label).fillColor(PDF_BRAND.muted);
  doc.text(`Prepared by ${COMPANY.legalName}`, x + 12, y + 68);
  doc.text(`Contact ${COMPANY.email}`, x + 12, y + 78);
  doc.text(`Integrity ${fingerprint}`, x + 12, y + 88);
  doc.text("HOMEEIGO CERTIFIED EXECUTIVE FINANCE REPORT", x + w / 2, y + 88, { width: w / 2 - 12, align: "right" });

  doc.y = y + h + blockGap;
}

/** @deprecated Use explicit page layout for executive reports. */
export function pdfEnsureSpace(doc: PdfDoc, needed: number) {
  if (doc.y + needed > pdfContentBottom(doc)) {
    doc.addPage();
    drawPdfWatermark(doc);
  }
}
