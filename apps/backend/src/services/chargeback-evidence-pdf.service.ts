import crypto from "crypto";
import PDFDocument from "pdfkit";
import { chargebackWorkflowService } from "./chargeback-workflow.service";

type PdfDoc = InstanceType<typeof PDFDocument>;

const BRAND = {
  primary: "#EA580C",
  dark: "#0F172A",
  slate: "#334155",
  muted: "#64748B",
  line: "#E2E8F0",
  panel: "#F8FAFC",
  gold: "#B45309",
};

type EvidencePackage = Awaited<ReturnType<typeof chargebackWorkflowService.buildEvidencePackage>>;

function formatInr(amount: number): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(
    amount,
  );
}

function formatDt(d: Date | string | null | undefined): string {
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

function documentFingerprint(chargebackId: string, generatedAt: Date): string {
  return crypto
    .createHash("sha256")
    .update(`${chargebackId}:${generatedAt.toISOString()}`)
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

function drawWatermark(doc: PdfDoc) {
  doc.save();
  doc.opacity(0.06).fillColor(BRAND.dark).fontSize(56).rotate(-32, { origin: [doc.page.width / 2, doc.page.height / 2] });
  doc.text("CONFIDENTIAL", doc.page.width / 2 - 180, doc.page.height / 2 - 20);
  doc.restore();
}

function drawHeader(doc: PdfDoc, meta: { documentId: string; disputeId: string }) {
  const w = doc.page.width;
  doc.rect(0, 0, w, 88).fill(BRAND.dark);
  doc.rect(0, 84, w, 4).fill(BRAND.primary);

  doc.fillColor("#FFFFFF").fontSize(22).font("Helvetica-Bold").text("HOMEEIGO", 54, 28, { continued: true });
  doc.font("Helvetica").fontSize(11).fillColor("#CBD5E1").text("  ·  Finance & Disputes", { continued: false });

  doc.fontSize(9).fillColor("#94A3B8").text("CERTIFIED DISPUTE EVIDENCE PACK", 54, 52);
  doc.fontSize(8).text(`Document ${meta.documentId}  ·  Case ${meta.disputeId}`, 54, 66);

  doc.fillColor(BRAND.gold).fontSize(8).font("Helvetica-Bold");
  doc.text("RESTRICTED — LEGAL & FINANCE USE ONLY", w - 240, 32, { width: 186, align: "right" });
  doc.font("Helvetica").fontSize(7).fillColor("#94A3B8").text("PCI-aware handling required", w - 240, 48, {
    width: 186,
    align: "right",
  });

  doc.y = 108;
}

function drawFooter(doc: PdfDoc, meta: { fingerprint: string; generatedAt: Date }) {
  const y = doc.page.height - 42;
  doc.strokeColor(BRAND.line).moveTo(54, y).lineTo(doc.page.width - 54, y).stroke();
  doc.fontSize(7).fillColor(BRAND.muted);
  doc.text(
    `HOMEEIGO Technologies · Generated ${formatDt(meta.generatedAt)} · Integrity hash ${meta.fingerprint}`,
    54,
    y + 8,
    { width: doc.page.width - 108, align: "center" },
  );
  doc.text("This document is system-generated and forms part of the chargeback evidence submission record.", 54, y + 20, {
    width: doc.page.width - 108,
    align: "center",
  });
}

function sectionTitle(doc: PdfDoc, n: number, title: string) {
  ensureSpace(doc, 48);
  doc.fillColor(BRAND.primary).fontSize(10).font("Helvetica-Bold").text(`${n}. ${title.toUpperCase()}`, 54);
  doc.moveDown(0.4);
  doc.strokeColor(BRAND.line).moveTo(54, doc.y).lineTo(doc.page.width - 54, doc.y).stroke();
  doc.moveDown(0.6);
}

function ensureSpace(doc: PdfDoc, needed: number) {
  if (doc.y + needed > doc.page.height - 72) {
    doc.addPage();
    drawWatermark(doc);
  }
}

function kvTable(doc: PdfDoc, rows: Array<[string, string]>) {
  const col1 = 190;
  const startX = 54;
  const width = doc.page.width - 108;

  for (const [label, value] of rows) {
    ensureSpace(doc, 26);
    const rowY = doc.y;
    doc.rect(startX, rowY, width, 22).fill(BRAND.panel);
    doc.fillColor(BRAND.muted).fontSize(8).font("Helvetica-Bold").text(label, startX + 10, rowY + 7, { width: col1 - 16 });
    doc.fillColor(BRAND.slate).font("Helvetica").fontSize(8).text(value || "—", startX + col1, rowY + 7, {
      width: width - col1 - 12,
    });
    doc.y = rowY + 24;
  }
  doc.moveDown(0.5);
}

function bulletList(doc: PdfDoc, items: string[], max = 12) {
  doc.fontSize(8).fillColor(BRAND.slate).font("Helvetica");
  for (const item of items.slice(0, max)) {
    ensureSpace(doc, 18);
    doc.text(`• ${item}`, 62, doc.y, { width: doc.page.width - 116 });
  }
  if (items.length > max) {
    doc.fillColor(BRAND.muted).text(`… and ${items.length - max} more entries on file`, 62);
  }
  doc.moveDown(0.5);
}

function certificationBlock(doc: PdfDoc, pkg: EvidencePackage, fingerprint: string) {
  ensureSpace(doc, 160);
  const x = 54;
  const w = doc.page.width - 108;
  const y = doc.y;

  doc.rect(x, y, w, 130).lineWidth(1).strokeColor(BRAND.gold).fillAndStroke(BRAND.panel, BRAND.gold);
  doc.fillColor(BRAND.dark).fontSize(10).font("Helvetica-Bold").text("LEGAL ATTESTATION & CERTIFICATION", x + 14, y + 14);

  const body =
    "I certify that the information contained in this Evidence Pack has been compiled from HOMEEIGO platform records " +
    "(bookings, payments, communications, and uploaded artifacts) for submission in connection with the payment dispute " +
    "identified herein. This document was generated automatically by HOMEEIGO Finance Operations and is intended for acquirer, " +
    "issuer, and payment-network review. Alteration of this pack outside controlled admin workflows voids its evidential weight.";

  doc.font("Helvetica").fontSize(8).fillColor(BRAND.slate).text(body, x + 14, y + 34, { width: w - 28, align: "justify" });

  doc.fontSize(7).fillColor(BRAND.muted);
  doc.text(`Evidence items indexed: ${pkg.evidence.length}`, x + 14, y + 88);
  doc.text(`Timeline events: ${pkg.timeline.length}`, x + 180, y + 88);
  doc.text(`Integrity seal: ${fingerprint}`, x + 14, y + 102);
  doc.text(`Marker: HOMEEIGO CERTIFIED DISPUTE EVIDENCE PACK`, x + 14, y + 116);

  doc.y = y + 142;
}

export class ChargebackEvidencePdfService {
  async generateLegalPack(chargebackId: string): Promise<{ buffer: Buffer; fileName: string; documentId: string }> {
    const pkg = await chargebackWorkflowService.buildEvidencePackage(chargebackId);
    const generatedAt = new Date();
    const documentId = `EVP-${generatedAt.toISOString().slice(0, 10).replace(/-/g, "")}-${chargebackId.slice(-6).toUpperCase()}`;
    const fingerprint = documentFingerprint(chargebackId, generatedAt);
    const disputeRef = pkg.chargeback.razorpayDisputeId ?? chargebackId;

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: 54, bufferPages: true });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      drawWatermark(doc);
      drawHeader(doc, { documentId, disputeId: disputeRef.slice(0, 24) });

      doc.fillColor(BRAND.dark).fontSize(16).font("Helvetica-Bold").text("Dispute Evidence Submission Pack", 54);
      doc.moveDown(0.3);
      doc.fontSize(9).font("Helvetica").fillColor(BRAND.muted).text(
        "Prepared for payment network / acquirer dispute resolution · Homeeigo Finance Operations",
      );
      doc.moveDown(1);

      sectionTitle(doc, 1, "Case summary");
      kvTable(doc, [
        ["Chargeback ID", pkg.chargeback.id],
        ["Gateway dispute reference", pkg.chargeback.razorpayDisputeId ?? "Not linked"],
        ["Dispute status", String(pkg.chargeback.status)],
        ["Disputed amount", formatInr(Number(pkg.chargeback.amount))],
        ["Reason code / narrative", pkg.chargeback.reason ?? "Not specified"],
        ["Response deadline", formatDt(pkg.chargeback.responseDeadline)],
        ["Document generated", formatDt(generatedAt)],
      ]);

      sectionTitle(doc, 2, "Transaction & booking record");
      if (pkg.payment || pkg.booking) {
        kvTable(doc, [
          ["Payment ID", pkg.payment?.id ?? "—"],
          ["Razorpay payment ID", pkg.payment?.razorpayPaymentId ?? "—"],
          ["Payment status", pkg.payment?.status ?? "—"],
          ["Amount paid", pkg.payment ? formatInr(Number(pkg.payment.amountPaid)) : "—"],
          ["Booking reference", pkg.booking?.bookingNumber ?? "—"],
          ["Booking status", pkg.booking?.status ?? "—"],
          ["Scheduled service date", pkg.booking ? formatDt(pkg.booking.scheduledDate) : "—"],
          ["Customer", pkg.booking?.customer ?? "—"],
          ["Service partner", pkg.booking?.provider ?? "—"],
          ["Service", pkg.booking?.service ?? "—"],
          ["Invoice", pkg.invoice?.invoiceNumber ?? "—"],
        ]);
      } else {
        doc.fontSize(8).fillColor(BRAND.muted).text(
          "No platform payment or booking linkage on this chargeback record. Supplementary uploads in Section 4 constitute primary evidence.",
          54,
        );
        doc.moveDown(0.8);
      }

      sectionTitle(doc, 3, "Evidence manifest");
      if (pkg.evidence.length === 0) {
        doc.fontSize(8).fillColor(BRAND.muted).text("No supplemental files uploaded to this case.", 54);
      } else {
        const manifest = pkg.evidence.map(
          (e, i) =>
            `${i + 1}. ${e.fileName} (${e.mimeType}) — uploaded ${formatDt(e.uploadedAt)} · ref ${e.id.slice(-8)}`,
        );
        bulletList(doc, manifest, 20);
      }

      sectionTitle(doc, 4, "Case activity timeline");
      if (pkg.timeline.length === 0) {
        doc.fontSize(8).fillColor(BRAND.muted).text("No timeline events recorded.", 54);
      } else {
        const events = pkg.timeline.map(
          (t) => `${formatDt(t.createdAt as Date)} · ${String(t.action)} — ${String(t.details ?? "")}`,
        );
        bulletList(doc, events, 25);
      }

      if (pkg.communications.length > 0) {
        sectionTitle(doc, 5, "Customer & partner communications");
        const comms = pkg.communications.map(
          (c) => `${formatDt(c.at as Date)} · Ticket ${c.ticketNumber} · ${c.authorRole}: ${c.body.slice(0, 120)}`,
        );
        bulletList(doc, comms, 15);
      }

      if (pkg.providerLogs.length > 0) {
        sectionTitle(doc, pkg.communications.length > 0 ? 6 : 5, "Field service activity log");
        const logs = pkg.providerLogs.map(
          (l) => `${formatDt(l.at as Date)} · ${l.action}${l.description ? ` — ${l.description}` : ""}`,
        );
        bulletList(doc, logs, 15);
      }

      sectionTitle(
        doc,
        pkg.communications.length > 0 && pkg.providerLogs.length > 0
          ? 7
          : pkg.communications.length > 0 || pkg.providerLogs.length > 0
            ? 6
            : 5,
        "Certification",
      );
      certificationBlock(doc, pkg, fingerprint);

      const pages = doc.bufferedPageRange();
      for (let i = 0; i < pages.count; i++) {
        doc.switchToPage(i);
        drawFooter(doc, { fingerprint, generatedAt });
      }

      doc.end();
    });

    const safeDispute = disputeRef.replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 32);
    return {
      buffer,
      fileName: `HOMIGO-Legal-Evidence-${safeDispute}.pdf`,
      documentId,
    };
  }
}

export function isPremiumEvidencePdf(buffer: Buffer): boolean {
  return buffer.toString("latin1").includes("HOMEEIGO CERTIFIED DISPUTE EVIDENCE PACK");
}

export const chargebackEvidencePdfService = new ChargebackEvidencePdfService();
