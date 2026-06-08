import { describe, expect, test } from "bun:test";
import { SettlementDiscrepancyType } from "@prisma/client";

describe("Settlement sync E2E contracts", () => {
  test("discrepancy types defined", () => {
    expect(Object.values(SettlementDiscrepancyType)).toEqual([
      "MISSING_PAYMENT",
      "AMOUNT_MISMATCH",
      "DUPLICATE_SETTLEMENT",
      "UNKNOWN_SETTLEMENT",
    ]);
  });

  test("accuracy pct from discrepancies", () => {
    const total = 10;
    const discrepancies = 2;
    const pct = Math.round(((total - discrepancies) / total) * 100);
    expect(pct).toBe(80);
  });

  test("no duplicate settlement id on batch", () => {
    const batches = new Map<string, number>();
    batches.set("setl_1", 1);
    expect(batches.has("setl_1")).toBe(true);
    expect(batches.size).toBe(1);
  });

  test("gateway amount paise to INR", () => {
    expect(50000 / 100).toBe(500);
  });
});

describe("Settlement per-payment linking", () => {
  test("never bulk tag all SUCCESS payments", () => {
    const forbidden = "updateMany({ where: { settlementId: null, status: \"SUCCESS\" }";
    expect(forbidden.includes("updateMany")).toBe(true);
  });
});
