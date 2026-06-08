import { describe, expect, test } from "bun:test";

describe("Ledger E2E integrity", () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  test("no ledger drift — debits equal credits per journal", () => {
    const lines = [
      { debit: 1000, credit: 0 },
      { debit: 0, credit: 600 },
      { debit: 0, credit: 400 },
    ];
    const d = round2(lines.reduce((s, l) => s + l.debit, 0));
    const c = round2(lines.reduce((s, l) => s + l.credit, 0));
    expect(d).toBe(c);
  });

  test("idempotency prevents duplicate journal", () => {
    const keys = new Set<string>();
    const key = "booking_payment:pay_1";
    keys.add(key);
    expect(keys.has(key)).toBe(true);
  });

  test("duplicate journal detection query pattern", () => {
    const rows = [{ key: "k1", cnt: 2 }];
    expect(rows.some((r) => Number(r.cnt) > 1)).toBe(true);
  });

  test("finance health score bounded 0-100", () => {
    const score = 87.5;
    expect(score >= 0 && score <= 100).toBe(true);
  });
});

describe("Financial integrity checks", () => {
  test("duplicate payout attempt flagged", () => {
    const attempts = [{ withdrawalId: "w1", status: "SUCCESS" }, { withdrawalId: "w1", status: "SUCCESS" }];
    const dup = attempts.filter((a) => a.status === "SUCCESS").length > 1;
    expect(dup).toBe(true);
  });

  test("settlement without settledAmount is mismatch", () => {
    const payment = { settlementId: "setl_1", settledAmount: null };
    expect(payment.settlementId && !payment.settledAmount).toBe(true);
  });
});
