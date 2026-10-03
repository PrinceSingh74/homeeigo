/**
 * Phase 7 — commission / tax accounting basis is explicit and every basis reconciles exactly.
 * Pure: no DB. The journal builder is the one completion posts (financialLedgerService).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { commissionBaseFor, commissionRateForVolume, resolveCommissionBasis } from "../services/earnings.service";
import { financialLedgerService } from "../services/financial-ledger.service";

const r2 = (n: number) => Math.round(n * 100) / 100;

function settle(finalAmount: number, taxes: number, rate: number, basis: "final_amount" | "pre_tax", bonus = 0, deduction = 0) {
  const commission = r2(commissionBaseFor({ finalAmount, taxes }, basis) * rate);
  const net = Math.max(0, r2(finalAmount - commission + bonus - deduction));
  const journal = financialLedgerService.journalForProviderEarning("b1", finalAmount, commission, net, bonus, deduction);
  const debit = r2(journal.lines.reduce((s, l) => s + l.debit, 0));
  const credit = r2(journal.lines.reduce((s, l) => s + l.credit, 0));
  const byAccount = (code: string) => r2(journal.lines.filter((l) => l.accountCode === code).reduce((s, l) => s + l.credit - l.debit, 0));
  return { commission, net, debit, credit, payable: byAccount("PROVIDER_PAYABLE"), revenue: byAccount("PLATFORM_REVENUE"), escrow: byAccount("PLATFORM_ESCROW") };
}

afterEach(() => {
  delete process.env.COMMISSION_BASE;
});

describe("commission basis", () => {
  test("default is the launch behaviour: commission on the amount paid, tax included", () => {
    expect(resolveCommissionBasis()).toBe("final_amount");
    expect(commissionBaseFor({ finalAmount: 1100, taxes: 100 })).toBe(1100);
  });

  test("COMMISSION_BASE=pre_tax excludes the tax line; anything else falls back to the default", () => {
    process.env.COMMISSION_BASE = "pre_tax";
    expect(commissionBaseFor({ finalAmount: 1100, taxes: 100 })).toBe(1000);
    process.env.COMMISSION_BASE = "garbage";
    expect(resolveCommissionBasis()).toBe("final_amount");
  });

  test("a ₹1100 booking (₹1000 + ₹100 tax), 20% tier — both bases reconcile to the paisa", () => {
    const a = settle(1100, 100, commissionRateForVolume(0), "final_amount");
    expect(a).toMatchObject({ commission: 220, net: 880, payable: 880, revenue: 220, escrow: -1100 });
    expect(a.debit).toBe(a.credit);

    const b = settle(1100, 100, commissionRateForVolume(0), "pre_tax");
    expect(b).toMatchObject({ commission: 200, net: 900, payable: 900, revenue: 200, escrow: -1100 });
    expect(b.debit).toBe(b.credit);
    // Customer charge = what escrow releases = partner share + platform share, under either basis.
    for (const s of [a, b]) expect(r2(s.payable + s.revenue)).toBe(1100);
  });

  test("bonus / deduction and every volume tier keep debit = credit", () => {
    for (const done of [0, 50, 100, 200]) {
      for (const [bonus, deduction] of [[0, 0], [50, 0], [0, 100], [100, 100]]) {
        for (const basis of ["final_amount", "pre_tax"] as const) {
          const s = settle(733.37, 66.67, commissionRateForVolume(done), basis, bonus, deduction);
          expect(s.debit).toBe(s.credit);
          expect(r2(s.payable + s.revenue)).toBe(r2(733.37 + bonus));
        }
      }
    }
  });
});
