/**
 * Reads the earning invoice the server writes (`GET /api/providers/me/earnings/:id/invoice`, backend
 * `invoice-report.service.ts` `partnerEarningHtml`). Pure: no React Native import.
 *
 * That answer is a complete HTML document meant for a browser's print dialog. The app has no WebView
 * and no print or share module, and the URL needs the bearer token, so it cannot be opened outside
 * the app. What the document SAYS, though, is a short list of label / amount rows — the same lines
 * the server itemises for a job (gross, commission, a bonus or adjustment, net) — so those rows are
 * read out of it and shown natively, in the server's own words and figures. Nothing is recomputed.
 * If the document's shape ever changes and no row can be read, the result is null and the screen
 * says the invoice cannot be shown here rather than guessing.
 */

export type InvoiceLine = { label: string; value: string; total: boolean };

export type ParsedEarningInvoice = {
  /** `ERN-…` as printed on the document, when it could be read. */
  invoiceNumber: string | null;
  /** The date as the server printed it. */
  printedDate: string | null;
  partner: string | null;
  service: string | null;
  lines: InvoiceLine[];
};

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function text(fragment: string): string {
  return fragment
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (whole: string, name: string) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

function first(html: string, pattern: RegExp): string | null {
  const m = pattern.exec(html);
  const value = m?.[1] ? text(m[1]) : "";
  return value || null;
}

export function parseEarningInvoiceHtml(html: string): ParsedEarningInvoice | null {
  if (typeof html !== "string" || !html) return null;
  const lines: InvoiceLine[] = [];
  const row = /<div class="row( total)?">\s*<span>([\s\S]*?)<\/span>\s*<span>([\s\S]*?)<\/span>\s*<\/div>/g;
  for (let m = row.exec(html); m; m = row.exec(html)) {
    const label = text(m[2] ?? "");
    const value = text(m[3] ?? "");
    if (label && value) lines.push({ label, value, total: Boolean(m[1]) });
  }
  if (lines.length === 0) return null;
  const head = /<b>Earning invoice<\/b>\s*<br\s*\/?>([^<]*)<br\s*\/?>([^<]*)</.exec(html);
  return {
    invoiceNumber: head?.[1] ? text(head[1]) || null : null,
    printedDate: head?.[2] ? text(head[2]) || null : null,
    partner: first(html, /<p>\s*Partner:\s*<b>([\s\S]*?)<\/b>\s*<\/p>/),
    service: first(html, /<p>\s*Service:\s*<b>([\s\S]*?)<\/b>\s*<\/p>/),
    lines,
  };
}
