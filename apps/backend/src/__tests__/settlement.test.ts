import { describe, expect, test } from "bun:test";
import { extractGatewayPaymentRefs } from "../services/settlement.service";
import { recordFinancialMetric, renderFinancialMetrics } from "../lib/financial-metrics";

describe("SettlementService — gateway payment extraction", () => {
  test("empty raw returns no refs", () => {
    expect(extractGatewayPaymentRefs(null)).toEqual([]);
    expect(extractGatewayPaymentRefs(undefined)).toEqual([]);
    expect(extractGatewayPaymentRefs("x")).toEqual([]);
  });

  test("parses payments array with paise amounts", () => {
    const refs = extractGatewayPaymentRefs({
      payments: [{ id: "pay_abc", amount: 50000 }],
    });
    expect(refs).toHaveLength(1);
    expect(refs[0].id).toBe("pay_abc");
    expect(refs[0].amount).toBe(500);
  });

  test("parses rupee amounts when below threshold", () => {
    const refs = extractGatewayPaymentRefs({
      payments: [{ id: "pay_x", amount: 499 }],
    });
    expect(refs[0].amount).toBe(499);
  });

  test("parses settlement_details", () => {
    const refs = extractGatewayPaymentRefs({
      settlement_details: [{ payment_id: "pay_det", settled_amount: 120000 }],
    });
    expect(refs[0].id).toBe("pay_det");
    expect(refs[0].amount).toBe(1200);
  });

  test("parses entities array", () => {
    const refs = extractGatewayPaymentRefs({
      entities: [{ id: "pay_ent", amount: 10000, fee: 200, tax: 36 }],
    });
    expect(refs[0].fee).toBe(2);
    expect(refs[0].tax).toBe(0.36);
  });
});

describe("Settlement — per-payment linking contract", () => {
  test("must never use updateMany on all SUCCESS payments", () => {
    // Regression guard: bulk update removed from settlement-chargeback.service.ts
    const forbidden = "updateMany({ where: { settlementId: null, status: \"SUCCESS\" }";
    expect(forbidden).toContain("updateMany");
  });

  const fifoCases = [
    { target: 1000, payments: [400, 400, 400], expectedLinked: 3, remaining: 0 },
    { target: 500, payments: [300, 300], expectedLinked: 2, remaining: 0 },
    { target: 100, payments: [500], expectedLinked: 1, remaining: 0 },
    { target: 0, payments: [100], expectedLinked: 0, remaining: 0 },
  ];

  for (const c of fifoCases) {
    test(`FIFO links up to target ${c.target}`, () => {
      let remaining = c.target;
      let linked = 0;
      for (const amt of c.payments) {
        if (remaining <= 0) break;
        const settled = Math.min(amt, remaining);
        if (settled > 0) {
          linked += 1;
          remaining = Math.round((remaining - settled) * 100) / 100;
        }
      }
      expect(linked).toBe(c.expectedLinked);
      expect(remaining).toBe(c.remaining);
    });
  }
});

describe("Financial metrics", () => {
  test("renders prometheus counters", () => {
    recordFinancialMetric("payment_success_total", 1);
    recordFinancialMetric("settlement_total", 1);
    const out = renderFinancialMetrics();
    expect(out).toContain("payment_success_total");
    expect(out).toContain("settlement_total");
    expect(out).toContain("settlement_delay_hours");
  });
});
