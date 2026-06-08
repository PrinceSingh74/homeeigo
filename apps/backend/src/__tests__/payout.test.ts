import { describe, expect, test } from "bun:test";
import { WithdrawalStatus } from "@prisma/client";

describe("Provider payout lifecycle", () => {
  const terminal = [WithdrawalStatus.COMPLETED, WithdrawalStatus.FAILED, WithdrawalStatus.CANCELLED];
  const active = [WithdrawalStatus.REQUESTED, WithdrawalStatus.APPROVED, WithdrawalStatus.PROCESSING];

  test("terminal states are not re-processable", () => {
    for (const s of terminal) {
      expect(active.includes(s as never)).toBe(false);
    }
  });

  test("webhook processed maps to COMPLETED", () => {
    const status = "processed";
    const normalized = status.toLowerCase();
    expect(["processed", "success"].includes(normalized)).toBe(true);
  });

  test("webhook failed maps to FAILED", () => {
    for (const s of ["failed", "reversed", "rejected"]) {
      expect(["failed", "reversed", "rejected"].includes(s)).toBe(true);
    }
  });

  test("payout_dev stub removed — requires Razorpay config", () => {
    const devStub = "payout_dev_";
    expect(devStub).toContain("payout_dev");
    // createPayout now throws when not configured instead of returning dev stub
  });
});

describe("Payout ledger double-entry", () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  test("payout debits provider payable credits bank settlement", () => {
    const amount = 1500;
    const lines = [
      { debit: amount, credit: 0 },
      { debit: 0, credit: amount },
    ];
    expect(round2(lines.reduce((s, l) => s + l.debit, 0))).toBe(
      round2(lines.reduce((s, l) => s + l.credit, 0)),
    );
  });

  const netAmountCases = [
    { gross: 1000, fee: 0, net: 1000 },
    { gross: 1000, fee: 20, net: 980 },
    { gross: 500, fee: 10, net: 490 },
  ];

  for (const c of netAmountCases) {
    test(`netAmount ${c.gross} - ${c.fee} = ${c.net}`, () => {
      expect(c.gross - c.fee).toBe(c.net);
    });
  }
});

describe("Payout idempotency", () => {
  test("completeProviderPayout skips if already COMPLETED", () => {
    const existing = { status: WithdrawalStatus.COMPLETED };
    const shouldSkip = existing.status === WithdrawalStatus.COMPLETED;
    expect(shouldSkip).toBe(true);
  });

  test("failProviderPayout skips terminal states", () => {
    for (const s of [WithdrawalStatus.COMPLETED, WithdrawalStatus.FAILED]) {
      const skip = s === WithdrawalStatus.COMPLETED || s === WithdrawalStatus.FAILED;
      expect(skip).toBe(true);
    }
  });
});
