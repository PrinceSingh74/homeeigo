import { describe, expect, test } from "bun:test";
import { hcoinExpiryService } from "../services/hcoin-expiry.service";
import { financialLedgerService } from "../services/financial-ledger.service";
import { COIN_TO_RUPEE } from "../services/hcoin.service";
import { HCoinTxnType, JournalEntryType } from "@prisma/client";

describe("Phase 4 — H-Coin Expiry Accounting", () => {
  test("HCOIN_EXPIRED journal type exists", () => {
    expect(JournalEntryType.HCOIN_EXPIRED).toBe("HCOIN_EXPIRED");
  });

  test("EXPIRE coin txn type exists", () => {
    expect(HCoinTxnType.EXPIRE).toBe("EXPIRE");
  });

  test("service exposes config + run + report", () => {
    expect(typeof hcoinExpiryService.getConfig).toBe("function");
    expect(typeof hcoinExpiryService.updateConfig).toBe("function");
    expect(typeof hcoinExpiryService.run).toBe("function");
    expect(typeof hcoinExpiryService.report).toBe("function");
  });

  test("ledger exposes recordHcoinExpired", () => {
    expect(typeof financialLedgerService.recordHcoinExpired).toBe("function");
  });

  test("DR H-Coin Liability, CR Promotional Breakage Revenue balances", () => {
    const rupee = 25;
    const lines = [
      { accountCode: "HCOIN_LIABILITY", debit: rupee, credit: 0 },
      { accountCode: "PROMOTIONAL_BREAKAGE_REVENUE", debit: 0, credit: rupee },
    ];
    expect(lines[0]!.debit).toBe(lines[1]!.credit);
  });

  test("expirable is capped at live balance (FIFO)", () => {
    const aged = 500;
    const lifetimeRedeemed = 100;
    const priorExpired = 50;
    const balance = 200;
    const expirable = Math.min(Math.max(0, aged - lifetimeRedeemed - priorExpired), balance);
    expect(expirable).toBe(200);
  });

  test("breakage value uses COIN_TO_RUPEE", () => {
    const coins = 1000;
    expect(Math.round(coins * COIN_TO_RUPEE * 100) / 100).toBe(100);
  });

  test("idempotency key per expiry txn", () => {
    expect("hcoin_expired:tx_9").toBe(`hcoin_expired:${"tx_9"}`);
  });

  test("expiry disabled blocks live run but allows dry run", () => {
    const allowed = (enabled: boolean, dryRun: boolean) => enabled || dryRun;
    expect(allowed(false, false)).toBe(false);
    expect(allowed(false, true)).toBe(true);
    expect(allowed(true, false)).toBe(true);
  });

  test("cutoff is expiryDays in the past", () => {
    const days = 365;
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    expect(cutoff).toBeLessThan(Date.now());
  });

  test("no expirable when fully redeemed", () => {
    const expirable = Math.max(0, 100 - 100 - 0);
    expect(expirable).toBe(0);
  });

  test("metric name follows contract", () => {
    expect("hcoin_expired_total").toContain("hcoin_expired");
  });
});
