/**
 * Phase 1 D4 — customer invoices must not claim GST. Partner is supplier of record.
 * Source-pinned so a copy regression cannot silently restore "GST / Taxes".
 */
import { describe, expect, test } from "bun:test";
import { INVOICE_SUPPLIER_DISCLOSURE } from "../services/invoice.service";
import { reportedGstOnCommission } from "../services/invoice-report.service";
import { TAX_POLICY } from "../lib/pricing-policy";

describe("D4 invoice disclosure", () => {
  test("tax line label is Taxes, not GST", () => {
    expect(TAX_POLICY.label).toBe("Taxes");
    expect(TAX_POLICY.label).not.toMatch(/GST/i);
  });

  test("invoice footer states this is not a GST tax invoice", () => {
    expect(INVOICE_SUPPLIER_DISCLOSURE).toMatch(/not a GST tax invoice/i);
    expect(INVOICE_SUPPLIER_DISCLOSURE).toMatch(/partner is the supplier/i);
    expect(INVOICE_SUPPLIER_DISCLOSURE).toMatch(/facilitator/i);
  });

  test("invoice service uses TAX_POLICY.label and does not hardcode GST / Taxes", async () => {
    const src = await Bun.file(new URL("../services/invoice.service.ts", import.meta.url)).text();
    expect(src).toContain("TAX_POLICY.label");
    expect(src).toContain("INVOICE_SUPPLIER_DISCLOSURE");
    expect(src).not.toMatch(/GST\s*\/\s*Taxes/);
    expect(src).not.toMatch(/GST\/Taxes/);
  });

  test("customer mobile trust copy does not claim GST is included", async () => {
    const trust = await Bun.file(
      new URL("../../../../homigo-mobile/src/components/services/TrustStrip.tsx", import.meta.url),
    ).text();
    const pricing = await Bun.file(
      new URL("../../../../homigo-mobile/src/components/services/TransparentPricing.tsx", import.meta.url),
    ).text();
    expect(trust).not.toMatch(/GST in/i);
    expect(pricing).not.toMatch(/GST Included/i);
  });

  test("partner tax-summary never invents GST on commission (D4 rejected option c)", async () => {
    expect(reportedGstOnCommission(0)).toBe(0);
    expect(reportedGstOnCommission(1000)).toBe(0);
    expect(reportedGstOnCommission(18_000)).toBe(0);
    const src = await Bun.file(new URL("../services/invoice-report.service.ts", import.meta.url)).text();
    expect(src).not.toMatch(/commission\s*\*\s*0\.18/);
    expect(src).toContain("gstRemittedByPlatform: false");
    expect(src).toContain("not a GST tax invoice");
  });
});
