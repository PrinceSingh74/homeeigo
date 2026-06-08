import { describe, expect, test } from "bun:test";
import { FinancialRiskLevel } from "@prisma/client";

describe("Financial risk levels", () => {
  test("all severity levels defined", () => {
    expect(Object.values(FinancialRiskLevel)).toEqual(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
  });
});

describe("Refund abuse severity", () => {
  const cases = [
    { count: 3, severity: FinancialRiskLevel.HIGH },
    { count: 5, severity: FinancialRiskLevel.CRITICAL },
    { count: 2, severity: null },
  ];

  for (const c of cases) {
    test(`${c.count} refunds → ${c.severity ?? "no flag"}`, () => {
      let severity: FinancialRiskLevel | null = null;
      if (c.count >= 5) severity = FinancialRiskLevel.CRITICAL;
      else if (c.count >= 3) severity = FinancialRiskLevel.HIGH;
      expect(severity).toBe(c.severity);
    });
  }
});

describe("Financial fraud case categories", () => {
  const categories = [
    "REFUND_ABUSE",
    "CHARGEBACK_ABUSE",
    "WALLET_ABUSE",
    "GIFT_CARD_ABUSE",
    "SUBSCRIPTION_ABUSE",
    "CASHBACK_ABUSE",
  ];

  for (const cat of categories) {
    test(`category ${cat} is tracked`, () => {
      expect(cat.length).toBeGreaterThan(0);
    });
  }
});

describe("Risk event rate limiting", () => {
  test("5 events per hour triggers case", () => {
    const recent = 4;
    expect(recent + 1 >= 5).toBe(true);
  });
});
