import { PaymentStatus } from "@prisma/client";
import PDFDocument from "pdfkit";
import prisma from "../lib/prisma";
import { PDF_BRAND, PDF_RHYTHM, COMPANY } from "../lib/pdf-branding";
import { userPiiService } from "./user-pii.service";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Deterministic invoice number derived from the (unique) booking number. */
export function invoiceNumberFor(bookingNumber: string): string {
  return `INV-${bookingNumber.replace(/^HOMIGO-/, "")}`;
}

export class InvoiceService {
  /**
   * Render a printable HTML invoice for a SUCCESSFUL payment owned by the user.
   * HTML (not a binary PDF) so it needs no native PDF lib in Bun — the browser's
   * "Save as PDF" produces the downloadable PDF. Returns null if not found/owned.
   */
  async render(userId: string, paymentId: string): Promise<string | null> {
    const p = await prisma.payment.findFirst({
      where: { id: paymentId, userId, status: PaymentStatus.SUCCESS },
      include: { booking: { include: { service: true } }, user: true },
    });
    if (!p || !p.booking || !p.user) return null;

    const b = p.booking;
    const u = p.user;
    const invoiceNo = p.invoiceNumber ?? invoiceNumberFor(b.bookingNumber);
    const issued = (p.completedAt ?? p.createdAt).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
    const customer = `${u.firstName} ${u.lastName}`.trim();
    const contact = await userPiiService.resolveEmailAndPhone(u, { actorId: userId, authorized: true });
    const billedEmail = contact.email ?? "—";
    const billedPhone = contact.phoneNumber ?? "—";

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Invoice ${esc(invoiceNo)} — HOMEEIGO</title>
<style>
  :root{color-scheme:light}
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;background:#f1f5f9;color:#0f172a;padding:24px}
  .sheet{max-width:760px;margin:0 auto;background:#fff;border-radius:16px;padding:40px;box-shadow:0 10px 40px rgba(15,23,42,.08)}
  .top{display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:16px;border-bottom:2px solid #eef2f7;padding-bottom:20px}
  .brand{font-size:26px;font-weight:800;background:linear-gradient(90deg,#2563eb,#7c3aed);-webkit-background-clip:text;background-clip:text;color:transparent}
  .brand small{display:block;font-size:11px;font-weight:600;color:#64748b;-webkit-text-fill-color:#64748b}
  .meta{text-align:right;font-size:13px;color:#475569}
  .meta b{color:#0f172a}
  .paid{display:inline-block;margin-top:6px;background:#dcfce7;color:#15803d;font-weight:700;font-size:11px;padding:3px 10px;border-radius:999px}
  .grid{display:flex;gap:24px;flex-wrap:wrap;margin:24px 0}
  .grid>div{flex:1;min-width:200px}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;font-weight:700;margin-bottom:4px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{text-align:left;padding:12px 8px;font-size:14px}
  th{font-size:11px;text-transform:uppercase;color:#94a3b8;border-bottom:1px solid #e2e8f0}
  td.r,th.r{text-align:right}
  tr.item td{border-bottom:1px solid #f1f5f9}
  .totals{margin-left:auto;margin-top:16px;width:260px;font-size:14px}
  .totals .row{display:flex;justify-content:space-between;padding:6px 0;color:#475569}
  .totals .grand{border-top:2px solid #0f172a;margin-top:6px;padding-top:10px;font-size:18px;font-weight:800;color:#0f172a}
  .foot{margin-top:32px;border-top:1px solid #eef2f7;padding-top:16px;font-size:12px;color:#94a3b8;text-align:center}
  .print{display:block;margin:0 auto 18px;max-width:760px}
  .print button{background:#2563eb;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:700;cursor:pointer}
  @media print{body{background:#fff;padding:0}.sheet{box-shadow:none;border-radius:0}.print{display:none}}
</style></head>
<body>
  <div class="print"><button onclick="window.print()">Download / Print PDF</button></div>
  <div class="sheet">
    <div class="top">
      <div class="brand">HOMEEIGO<small>Premium home services</small></div>
      <div class="meta">
        <div>Invoice <b>${esc(invoiceNo)}</b></div>
        <div>Date: <b>${esc(issued)}</b></div>
        <div>Booking: <b>${esc(b.bookingNumber)}</b></div>
        <div class="paid">PAID</div>
      </div>
    </div>

    <div class="grid">
      <div>
        <div class="label">Billed to</div>
        <div><b>${esc(customer)}</b></div>
        <div>${esc(billedEmail)}</div>
        <div>${esc(billedPhone)}</div>
      </div>
      <div>
        <div class="label">Payment</div>
        <div>Method: <b>${esc(p.paymentMethod)}</b></div>
        ${p.razorpayPaymentId ? `<div>Txn: <b>${esc(p.razorpayPaymentId)}</b></div>` : ""}
        <div>Service date: <b>${esc(b.scheduledDate.toLocaleDateString("en-IN"))}</b></div>
      </div>
    </div>

    <table>
      <thead><tr><th>Description</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr class="item"><td>${esc(b.service.name)}</td><td class="r">${inr(b.baseAmount)}</td></tr>
      </tbody>
    </table>

    <div class="totals">
      <div class="row"><span>Subtotal</span><span>${inr(b.baseAmount)}</span></div>
      <div class="row"><span>GST / Taxes</span><span>${inr(b.taxes)}</span></div>
      <div class="row grand"><span>Total paid</span><span>${inr(b.finalAmount)}</span></div>
    </div>

    <div class="foot">This is a computer-generated invoice from HOMEEIGO · No signature required.</div>
  </div>
</body></html>`;
  }

  /** Generate a binary PDF invoice for email attachment. */
  async generatePdf(userId: string, paymentId: string): Promise<{ buffer: Buffer; invoiceNo: string } | null> {
    const p = await prisma.payment.findFirst({
      where: { id: paymentId, userId, status: PaymentStatus.SUCCESS },
      include: { booking: { include: { service: true } }, user: true },
    });
    if (!p?.booking || !p.user) return null;

    const b = p.booking;
    const u = p.user;
    const invoiceNo = p.invoiceNumber ?? invoiceNumberFor(b.bookingNumber);
    const customer = `${u.firstName} ${u.lastName}`.trim();
    const contact = await userPiiService.resolveEmailAndPhone(u, { actorId: userId, authorized: true });
    const issued = (p.completedAt ?? p.createdAt).toLocaleDateString("en-IN");

    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: "A4", margin: PDF_RHYTHM.margin });
      const chunks: Buffer[] = [];
      doc.on("data", (c) => chunks.push(c as Buffer));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      doc.fillColor(PDF_BRAND.dark).fontSize(20).font("Helvetica-Bold").text("HOMEEIGO", PDF_RHYTHM.margin, PDF_RHYTHM.margin);
      doc.fontSize(10).fillColor(PDF_BRAND.muted).text(COMPANY.tagline, PDF_RHYTHM.margin, doc.y + 2);
      doc.moveDown(1.5);
      doc.fontSize(14).fillColor(PDF_BRAND.dark).font("Helvetica-Bold").text(`Invoice ${invoiceNo}`);
      doc.fontSize(10).fillColor(PDF_BRAND.slate).font("Helvetica")
        .text(`Date: ${issued}`)
        .text(`Booking: ${b.bookingNumber}`)
        .text(`Status: PAID`);
      doc.moveDown();
      doc.fontSize(9).fillColor(PDF_BRAND.muted).text("BILLED TO", PDF_RHYTHM.margin);
      doc.fontSize(11).fillColor(PDF_BRAND.dark).text(customer).text(contact.email ?? "—").text(contact.phoneNumber ?? "—");
      doc.moveDown();
      doc.fontSize(10).fillColor(PDF_BRAND.dark)
        .text(`${b.service.name}`, PDF_RHYTHM.margin)
        .text(`Subtotal: ${inr(b.baseAmount)}`)
        .text(`GST/Taxes: ${inr(b.taxes)}`)
        .font("Helvetica-Bold")
        .text(`Total paid: ${inr(b.finalAmount)}`);
      doc.moveDown(2);
      doc.fontSize(8).fillColor(PDF_BRAND.muted).font("Helvetica")
        .text("Computer-generated invoice · No signature required", PDF_RHYTHM.margin);
      doc.end();
    });

    return { buffer, invoiceNo };
  }
}

export const invoiceService = new InvoiceService();
