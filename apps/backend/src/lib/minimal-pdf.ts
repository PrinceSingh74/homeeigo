import PDFDocument from "pdfkit";

/** Legacy helper for tests — prefer chargebackEvidencePdfService.generateLegalPack. */
export function buildEvidencePdfBuffer(opts: {
  title?: string;
  subtitle?: string;
  lines?: string[];
} = {}): Promise<Buffer> {
  const title = opts.title ?? "HOMEEIGO Chargeback Evidence";
  const lines = opts.lines ?? [`Generated: ${new Date().toISOString()}`];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c as Buffer));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.fontSize(16).text(title);
    doc.moveDown();
    for (const line of lines) doc.fontSize(10).text(`• ${line}`);
    doc.end();
  });
}

export async function minimalPdfBuffer(): Promise<Buffer> {
  return buildEvidencePdfBuffer();
}

export function isLikelyValidPdf(buffer: Buffer): boolean {
  if (buffer.length < 400) return false;
  const text = buffer.toString("latin1");
  if (!text.startsWith("%PDF-")) return false;
  if (!text.includes("%%EOF")) return false;
  if (!text.includes("/Contents")) return false;
  return true;
}
