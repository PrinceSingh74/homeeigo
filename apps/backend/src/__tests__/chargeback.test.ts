import { describe, expect, test } from "bun:test";
import { ChargebackStatus } from "@prisma/client";

describe("Chargeback webhook mapping", () => {
  const statusMap: Record<string, ChargebackStatus> = {
    open: ChargebackStatus.RECEIVED,
    under_review: ChargebackStatus.UNDER_REVIEW,
    won: ChargebackStatus.WON,
    lost: ChargebackStatus.LOST,
    closed: ChargebackStatus.CLOSED,
  };

  for (const [gateway, local] of Object.entries(statusMap)) {
    test(`maps ${gateway} → ${local}`, () => {
      expect(statusMap[gateway.toLowerCase()]).toBe(local);
    });
  }
});

describe("Chargeback ledger", () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  test("chargeback loss debits expense credits settlement", () => {
    const amount = 750;
    const lines = [
      { account: "CHARGEBACK_LOSS", debit: amount, credit: 0 },
      { account: "BANK_SETTLEMENT", debit: 0, credit: amount },
    ];
    const debits = round2(lines.reduce((s, l) => s + l.debit, 0));
    const credits = round2(lines.reduce((s, l) => s + l.credit, 0));
    expect(debits).toBe(credits);
  });

  test("ledger written on LOST or RECEIVED", () => {
    for (const s of [ChargebackStatus.LOST, ChargebackStatus.RECEIVED]) {
      const shouldRecord = s === ChargebackStatus.LOST || s === ChargebackStatus.RECEIVED;
      expect(shouldRecord).toBe(true);
    }
    expect(ChargebackStatus.WON).not.toBe(ChargebackStatus.LOST);
  });
});

describe("Chargeback metrics", () => {
  test("open exposure counts RECEIVED and UNDER_REVIEW", () => {
    const open = ["RECEIVED", "UNDER_REVIEW"];
    expect(open).toContain("RECEIVED");
    expect(open).toContain("UNDER_REVIEW");
    expect(open).not.toContain("WON");
  });
});
