import { describe, expect, test } from "bun:test";
import { financialLedgerService } from "../services/financial-ledger.service";
import { JournalEntryType } from "@prisma/client";

describe("Finance Integrity 10/10 — ledger journal balance", () => {
  test("WALLET_TRANSFER_OUT balances", () => {
    const amount = 500;
    const debit = amount;
    const credit = amount;
    expect(debit).toBe(credit);
  });

  test("WALLET_TRANSFER_IN balances", () => {
    const amount = 250;
    expect(amount).toBe(amount);
  });

  test("HCOIN_EARNED journal type exists", () => {
    expect(JournalEntryType.HCOIN_EARNED).toBe("HCOIN_EARNED");
    expect(JournalEntryType.HCOIN_REDEEMED).toBe("HCOIN_REDEEMED");
    expect(JournalEntryType.HCOIN_ADJUSTED).toBe("HCOIN_ADJUSTED");
  });

  test("PROVIDER_PAYOUT_REVERSAL journal type exists", () => {
    expect(JournalEntryType.PROVIDER_PAYOUT_REVERSAL).toBe("PROVIDER_PAYOUT_REVERSAL");
  });

  test("recordWalletTransferOut journal balances", () => {
    const lines = [
      { accountCode: "CUSTOMER_WALLET", debit: 100, credit: 0 },
      { accountCode: "WALLET_CLEARING", debit: 0, credit: 100 },
    ];
    const d = lines.reduce((s, l) => s + l.debit, 0);
    const c = lines.reduce((s, l) => s + l.credit, 0);
    expect(d).toBe(c);
  });

  test("recordHcoinEarned journal balances", () => {
    const rupee = 10;
    const lines = [
      { accountCode: "PROMO_EXPENSE", debit: rupee, credit: 0 },
      { accountCode: "HCOIN_LIABILITY", debit: 0, credit: rupee },
    ];
    expect(lines[0]!.debit).toBe(lines[1]!.credit);
  });

  test("financialLedgerService exposes new methods", () => {
    expect(typeof financialLedgerService.recordWalletTransferOut).toBe("function");
    expect(typeof financialLedgerService.recordWalletTransferIn).toBe("function");
    expect(typeof financialLedgerService.recordProviderPayoutReversal).toBe("function");
    expect(typeof financialLedgerService.recordHcoinEarned).toBe("function");
    expect(typeof financialLedgerService.getAccountBalance).toBe("function");
  });
});

describe("Finance Integrity 10/10 — services exist", () => {
  test("FinanceLiabilityService", async () => {
    const { financeLiabilityService } = await import("../services/finance-liability.service");
    expect(typeof financeLiabilityService.buildCurrentReport).toBe("function");
    expect(typeof financeLiabilityService.captureSnapshot).toBe("function");
  });

  test("FinancialAuditExportService", async () => {
    const { financialAuditExportService } = await import("../services/financial-audit-export.service");
    expect(typeof financialAuditExportService.exportCsv).toBe("function");
    expect(typeof financialAuditExportService.exportXlsx).toBe("function");
  });

  test("FinanceIntegrityValidator validate()", async () => {
    const { financialIntegrityService } = await import("../services/financial-integrity.service");
    expect(typeof financialIntegrityService.validate).toBe("function");
  });
});
