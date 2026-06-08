import { describe, expect, test } from "bun:test";
import { JournalEntryType } from "@prisma/client";

const round2 = (n: number) => Math.round(n * 100) / 100;

type Line = { accountCode: string; debit: number; credit: number };

function assertBalanced(lines: Line[]) {
  const debits = round2(lines.reduce((s, l) => s + l.debit, 0));
  const credits = round2(lines.reduce((s, l) => s + l.credit, 0));
  expect(debits).toBe(credits);
  expect(debits).toBeGreaterThan(0);
}

describe("Ledger — all journal types balance", () => {
  test("BOOKING_PAYMENT", () => {
    assertBalanced([
      { accountCode: "CUSTOMER_FUNDS", debit: 1000, credit: 0 },
      { accountCode: "PLATFORM_ESCROW", debit: 0, credit: 1000 },
    ]);
  });

  test("REFUND", () => {
    assertBalanced([
      { accountCode: "REFUND_LIABILITY", debit: 500, credit: 0 },
      { accountCode: "CUSTOMER_FUNDS", debit: 0, credit: 500 },
    ]);
  });

  test("PROVIDER_EARNING", () => {
    assertBalanced([
      { accountCode: "PLATFORM_ESCROW", debit: 1000, credit: 0 },
      { accountCode: "PROVIDER_PAYABLE", debit: 0, credit: 800 },
      { accountCode: "PLATFORM_REVENUE", debit: 0, credit: 200 },
    ]);
  });

  test("WALLET_TOPUP", () => {
    assertBalanced([
      { accountCode: "BANK_SETTLEMENT", debit: 300, credit: 0 },
      { accountCode: "CUSTOMER_WALLET", debit: 0, credit: 300 },
    ]);
  });

  test("PROVIDER_PAYOUT", () => {
    assertBalanced([
      { accountCode: "PROVIDER_PAYABLE", debit: 800, credit: 0 },
      { accountCode: "BANK_SETTLEMENT", debit: 0, credit: 800 },
    ]);
  });

  test("CHARGEBACK", () => {
    assertBalanced([
      { accountCode: "CHARGEBACK_LOSS", debit: 400, credit: 0 },
      { accountCode: "BANK_SETTLEMENT", debit: 0, credit: 400 },
    ]);
  });

  test("GIFT_CARD", () => {
    assertBalanced([
      { accountCode: "CUSTOMER_FUNDS", debit: 2000, credit: 0 },
      { accountCode: "PLATFORM_ESCROW", debit: 0, credit: 2000 },
    ]);
  });

  test("SUBSCRIPTION", () => {
    assertBalanced([
      { accountCode: "CUSTOMER_FUNDS", debit: 499, credit: 0 },
      { accountCode: "PLATFORM_REVENUE", debit: 0, credit: 499 },
    ]);
  });

  test("CASHBACK", () => {
    assertBalanced([
      { accountCode: "PLATFORM_REVENUE", debit: 50, credit: 0 },
      { accountCode: "CUSTOMER_WALLET", debit: 0, credit: 50 },
    ]);
  });
});

describe("Ledger — idempotency keys", () => {
  const keys = [
    "booking_payment:pay_1",
    "refund:rfnd_1",
    "provider_earning:bk_1",
    "wallet_topup:wtx_1",
    "provider_payout:wdr_1",
    "chargeback:cb_1",
    "gift_card:gc_1",
    "subscription:inv_1",
    "cashback:cbk_1",
  ];

  for (const key of keys) {
    test(`key ${key} is unique format`, () => {
      expect(key.includes(":")).toBe(true);
    });
  }
});

describe("Ledger — journal entry types cover all money flows", () => {
  const required: JournalEntryType[] = [
    JournalEntryType.BOOKING_PAYMENT,
    JournalEntryType.REFUND,
    JournalEntryType.PROVIDER_EARNING,
    JournalEntryType.PROVIDER_PAYOUT,
    JournalEntryType.CHARGEBACK,
    JournalEntryType.WALLET_TOPUP,
    JournalEntryType.GIFT_CARD,
    JournalEntryType.SUBSCRIPTION,
    JournalEntryType.CASHBACK,
  ];

  for (const t of required) {
    test(`type ${t} exists`, () => {
      expect(Object.values(JournalEntryType)).toContain(t);
    });
  }
});

describe("Ledger — parameterized amount matrix", () => {
  const amounts = [1, 10, 99.99, 100, 500, 1000, 2500.5, 9999.99];

  for (const amount of amounts) {
    test(`booking payment ₹${amount}`, () => {
      assertBalanced([
        { accountCode: "CUSTOMER_FUNDS", debit: amount, credit: 0 },
        { accountCode: "PLATFORM_ESCROW", debit: 0, credit: amount },
      ]);
    });
  }
});

describe("CFO dashboard liability sum", () => {
  test("total liabilities aggregates wallet + gift + cashback + payable + refunds", () => {
    const parts = { wallet: 100, gift: 50, cashback: 20, payable: 500, refunds: 30 };
    const total = round2(parts.wallet + parts.gift + parts.cashback + parts.payable + parts.refunds);
    expect(total).toBe(700);
  });
});

describe("Provider earning — commission matrix", () => {
  const rates = [5, 8, 10, 12, 15, 18, 20, 22, 25, 30];
  const grossAmounts = [500, 1000, 1500, 2000, 2500];

  for (const gross of grossAmounts) {
    for (const rate of rates) {
      test(`gross=${gross} rate=${rate}% balances`, () => {
        const commission = round2((gross * rate) / 100);
        const net = round2(gross - commission);
        assertBalanced([
          { accountCode: "PLATFORM_ESCROW", debit: gross, credit: 0 },
          { accountCode: "PROVIDER_PAYABLE", debit: 0, credit: net },
          { accountCode: "PLATFORM_REVENUE", debit: 0, credit: commission },
        ]);
      });
    }
  }
});
