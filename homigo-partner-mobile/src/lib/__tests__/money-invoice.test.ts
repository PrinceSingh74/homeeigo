/**
 * The earning invoice is an HTML document (backend `invoice-report.service.ts` `partnerEarningHtml`).
 * The app has no WebView, so its rows are read out and shown natively — the server's labels and
 * figures, unchanged. The fixture below is that function's output for one earning with a bonus.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEarningInvoiceHtml } from "../money-invoice.ts";

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Earning ERN-ABCD1234</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:24px auto;color:#1f2937;padding:0 16px}
.h{display:flex;justify-content:space-between;border-bottom:2px solid #7C3AED;padding-bottom:12px}
.brand{font-size:24px;font-weight:800;color:#7C3AED}.row{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #eee}
.total{font-weight:800;font-size:18px;border-top:2px solid #1f2937;margin-top:8px}@media print{.noprint{display:none}}</style></head>
<body><div class="h"><div class="brand">HOMEEIGO</div><div><b>Earning invoice</b><br>ERN-ABCD1234<br>7/10/2026</div></div>
<p>Partner: <b>Asha Verma</b></p><p>Service: <b>Deep cleaning &amp; sanitising</b></p>
<div class="row"><span>Gross amount</span><span>₹658</span></div>
<div class="row"><span>Platform commission</span><span>− ₹131.6</span></div>
<div class="row"><span>Performance bonus</span><span>+ ₹50</span></div>
<div class="row total"><span>Net earning</span><span>₹576.4</span></div>
<p class="noprint" style="text-align:center;margin-top:24px"><button onclick="print()" style="background:#7C3AED;color:#fff;border:0;padding:10px 20px;border-radius:8px;cursor:pointer">Download / Print PDF</button></p>
</body></html>`;

test("reads the document's rows in order, in the server's words and figures", () => {
  const invoice = parseEarningInvoiceHtml(html);
  assert.ok(invoice);
  assert.deepEqual(invoice.lines, [
    { label: "Gross amount", value: "₹658", total: false },
    { label: "Platform commission", value: "− ₹131.6", total: false },
    { label: "Performance bonus", value: "+ ₹50", total: false },
    { label: "Net earning", value: "₹576.4", total: true },
  ]);
});

test("reads the invoice number, the printed date, the partner and the service", () => {
  const invoice = parseEarningInvoiceHtml(html);
  assert.equal(invoice?.invoiceNumber, "ERN-ABCD1234");
  assert.equal(invoice?.printedDate, "7/10/2026");
  assert.equal(invoice?.partner, "Asha Verma");
  assert.equal(invoice?.service, "Deep cleaning & sanitising");
});

test("the print button and the stylesheet are not read as rows", () => {
  const labels = parseEarningInvoiceHtml(html)?.lines.map((l) => l.label) ?? [];
  assert.equal(labels.some((l) => /print|download/i.test(l)), false);
});

test("a document with no readable row is null — the screen then says so instead of guessing", () => {
  assert.equal(parseEarningInvoiceHtml(""), null);
  assert.equal(parseEarningInvoiceHtml("<html><body><p>Invoice not found</p></body></html>"), null);
  assert.equal(parseEarningInvoiceHtml('{"success":false,"error":"Invoice not found"}'), null);
});

test("rows are still read when the header block is missing", () => {
  const invoice = parseEarningInvoiceHtml('<div class="row"><span>Gross amount</span><span>₹100</span></div><div class="row total"><span>Net earning</span><span>₹80</span></div>');
  assert.equal(invoice?.lines.length, 2);
  assert.equal(invoice?.invoiceNumber, null);
  assert.equal(invoice?.partner, null);
});
