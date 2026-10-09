/**
 * Phase 1 D4 — customer invoices must not claim GST. Partner is supplier of record.
 * Source-pinned so a copy regression cannot silently restore "GST / Taxes".
 */
import { describe, expect, test } from "bun:test";
import { INVOICE_SUPPLIER_DISCLOSURE } from "../services/invoice.service";
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
});
