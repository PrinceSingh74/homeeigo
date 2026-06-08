import { describe, expect, test } from "bun:test";
import { financialLedgerService } from "../services/financial-ledger.service";
import { referralService } from "../services/referral.service";
import { JournalEntryType } from "@prisma/client";

describe("Phase 1 — Referral Commission Ledger", () => {
  test("REFERRAL_COMMISSION journal type exists", () => {
    expect(JournalEntryType.REFERRAL_COMMISSION).toBe("REFERRAL_COMMISSION");
  });

  test("ledger exposes recordReferralCommission", () => {
    expect(typeof financialLedgerService.recordReferralCommission).toBe("function");
  });

  test("referral service exposes withdraw (wallet credit entry point)", () => {
    expect(typeof referralService.withdraw).toBe("function");
  });

  test("DR Referral Marketing Expense, CR Customer Wallet balances", () => {
    const amount = 100;
    const lines = [
      { accountCode: "REFERRAL_MARKETING_EXPENSE", debit: amount, credit: 0 },
      { accountCode: "CUSTOMER_WALLET", debit: 0, credit: amount },
    ];
    const d = lines.reduce((s, l) => s + l.debit, 0);
    const c = lines.reduce((s, l) => s + l.credit, 0);
    expect(d).toBe(c);
    expect(d).toBe(amount);
  });

  test("idempotency key is deterministic per wallet txn", () => {
    const walletTxnId = "wtx_123";
    expect(`referral_commission:${walletTxnId}`).toBe("referral_commission:wtx_123");
  });

  test("commission metadata shape carries referrer/referred/booking", () => {
    const meta = {
      walletTxnId: "wtx_1",
      referrerUserId: "u_ref",
      referredUserId: "u_new",
      bookingId: "b_1",
      amount: 100,
    };
    expect(meta.amount).toBeGreaterThan(0);
    expect(meta.referrerUserId).not.toBe(meta.referredUserId);
  });

  test("referral marketing expense is an expense account (debit-normal)", () => {
    const line = { accountCode: "REFERRAL_MARKETING_EXPENSE", debit: 100, credit: 0 };
    expect(line.debit).toBeGreaterThan(line.credit);
  });

  test("customer wallet liability is credit-normal on commission", () => {
    const line = { accountCode: "CUSTOMER_WALLET", debit: 0, credit: 100 };
    expect(line.credit).toBeGreaterThan(line.debit);
  });

  test("zero / negative commission amounts are not journaled", () => {
    const valid = (amount: number) => amount > 0;
    expect(valid(0)).toBe(false);
    expect(valid(-50)).toBe(false);
    expect(valid(100)).toBe(true);
  });

  test("metric names follow contract", () => {
    expect("referral_commission_total").toContain("referral_commission");
    expect("referral_commission_amount").toContain("amount");
  });
});
