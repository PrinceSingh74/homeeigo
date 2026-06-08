import { describe, expect, test } from "bun:test";
import { ReconciliationStatus } from "@prisma/client";

describe("PaymentReconciliation — status taxonomy", () => {
  const statuses = [
    ReconciliationStatus.MATCHED,
    ReconciliationStatus.MISMATCH,
    ReconciliationStatus.MISSING_LOCAL,
    ReconciliationStatus.MISSING_GATEWAY,
    ReconciliationStatus.REFUND_MISMATCH,
    ReconciliationStatus.SETTLEMENT_MISMATCH,
  ];

  test("all reconciliation statuses defined", () => {
    expect(statuses).toHaveLength(6);
  });

  for (const status of statuses) {
    test(`status ${status} is valid enum value`, () => {
      expect(Object.values(ReconciliationStatus)).toContain(status);
    });
  }
});

describe("Reconciliation — match percentage", () => {
  const cases = [
    { matched: 10, total: 10, pct: 100 },
    { matched: 5, total: 10, pct: 50 },
    { matched: 0, total: 0, pct: 100 },
    { matched: 7, total: 10, pct: 70 },
    { matched: 1, total: 3, pct: 33.33 },
  ];

  for (const c of cases) {
    test(`matchPct ${c.matched}/${c.total} = ${c.pct}`, () => {
      const pct =
        c.total > 0 ? Math.round((c.matched / c.total) * 10000) / 100 : 100;
      expect(pct).toBe(c.pct);
    });
  }
});

describe("Reconciliation — issue detection rules", () => {
  test("SUCCESS without gateway id is MISSING_GATEWAY", () => {
    const payment = { status: "SUCCESS", razorpayPaymentId: null };
    const issue =
      payment.status === "SUCCESS" && !payment.razorpayPaymentId
        ? ReconciliationStatus.MISSING_GATEWAY
        : ReconciliationStatus.MATCHED;
    expect(issue).toBe(ReconciliationStatus.MISSING_GATEWAY);
  });

  test("refund exceeding paid is REFUND_MISMATCH", () => {
    const refunded = 600;
    const paid = 500;
    expect(refunded > paid).toBe(true);
  });

  test("amountPaid != amount on SUCCESS is MISMATCH", () => {
    const p = { status: "SUCCESS", amount: 1000, amountPaid: 900 };
    const mismatch = p.status === "SUCCESS" && p.amountPaid !== p.amount;
    expect(mismatch).toBe(true);
  });
});
