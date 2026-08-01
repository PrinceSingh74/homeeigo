import { CashbackStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { financialLedgerService } from "./financial-ledger.service";
import { ledgerBackfillService } from "./ledger-backfill.service";
import { hcoinService } from "./hcoin.service";
import { financeAlertService } from "./finance-alert.service";
import { recordFinancialMetric, setFinancialGauge } from "../lib/financial-metrics";

export type LiabilityRow = {
  source: string;
  ledgerAccount: string;
  operationalBalance: number;
  ledgerBalance: number;
  delta: number;
};

/**
 * Operational ↔ ledger reconciliation. Backfills missing journals then posts
 * idempotent ADJUSTMENT entries to eliminate residual drift.
 */
export class LedgerReconciliationService {
  async buildReport(): Promise<LiabilityRow[]> {
    const [
      customerWalletSum,
      providerWalletSum,
      giftCardBal,
      hcoinAnalytics,
      pendingCashback,
      ledgerWallet,
      ledgerPayable,
      ledgerEscrow,
      ledgerHcoin,
    ] = await Promise.all([
      prisma.user.aggregate({ _sum: { walletBalance: true } }),
      prisma.provider.aggregate({ _sum: { walletBalance: true } }),
      prisma.giftCard.aggregate({ where: { status: "ACTIVE" }, _sum: { balance: true } }),
      hcoinService.adminAnalytics(),
      prisma.membershipCashback.aggregate({
        where: { status: CashbackStatus.PENDING },
        _sum: { amount: true },
      }),
      financialLedgerService.getAccountBalance("CUSTOMER_WALLET"),
      financialLedgerService.getAccountBalance("PROVIDER_PAYABLE"),
      financialLedgerService.getAccountBalance("PLATFORM_ESCROW"),
      financialLedgerService.getAccountBalance("HCOIN_LIABILITY"),
    ]);

    const rows: LiabilityRow[] = [
      row("Customer Wallet", "CUSTOMER_WALLET", customerWalletSum._sum.walletBalance ?? 0, ledgerWallet),
      row("Provider Payable", "PROVIDER_PAYABLE", providerWalletSum._sum.walletBalance ?? 0, ledgerPayable),
      row("Gift Card Escrow", "PLATFORM_ESCROW", giftCardBal._sum.balance ?? 0, ledgerEscrow),
      row("H-Coin Liability", "HCOIN_LIABILITY", hcoinAnalytics.liabilityRupees, ledgerHcoin),
      {
        ...row(
          "Pending Cashback (info)",
          "PLATFORM_REVENUE",
          pendingCashback._sum.amount ?? 0,
          await financialLedgerService.getAccountBalance("PLATFORM_REVENUE"),
        ),
        source: "Pending Cashback (info)",
      },
    ];

    return rows;
  }

  async reconcile(opts: { backfillLimit?: number; postAdjustments?: boolean } = {}) {
    const before = await this.buildReport();

    await ledgerBackfillService.run({
      limit: opts.backfillLimit ?? 5000,
      startedBy: "ledger-reconciliation",
    });

    const afterBackfill = await this.buildReport();
    const adjustments: Array<{ account: string; amount: number; direction: string }> = [];

    const ADJUSTABLE = new Set(["CUSTOMER_WALLET", "PROVIDER_PAYABLE", "HCOIN_LIABILITY", "PLATFORM_ESCROW"]);

    if (opts.postAdjustments !== false) {
      for (const r of afterBackfill) {
        if (!ADJUSTABLE.has(r.ledgerAccount)) continue;
        if (Math.abs(r.delta) <= 0.01) continue;
        // Delta is recomputed from live balances immediately before each post, so a
        // time-scoped key cannot double-adjust; it only guards same-second races.
        const posted = await financialLedgerService.recordLiabilityReconciliation(
          r.ledgerAccount,
          r.delta,
          `reconcile:${r.ledgerAccount}:ops${Math.round(r.operationalBalance * 100)}:led${Math.round(
            r.ledgerBalance * 100,
          )}:${new Date().toISOString().slice(0, 19)}`,
        );
        if (posted) {
          adjustments.push({
            account: r.ledgerAccount,
            amount: Math.abs(r.delta),
            direction: r.delta > 0 ? "decrease_ledger" : "increase_ledger",
          });
        }
      }
    }

    const final = await this.buildReport();
    const maxDelta = Math.max(...final.map((r) => Math.abs(r.delta)), 0);

    // Gauge (absolute value), not a counter — backs WalletLiabilityMismatch alert.
    setFinancialGauge("ledger_reconciliation_max_delta", maxDelta);
    const walletDelta = Math.abs(final.find((r) => r.ledgerAccount === "CUSTOMER_WALLET")?.delta ?? 0);
    const payableDelta = Math.abs(final.find((r) => r.ledgerAccount === "PROVIDER_PAYABLE")?.delta ?? 0);
    if (walletDelta > 1) recordFinancialMetric("wallet_liability_mismatch_total", 1);
    if (payableDelta > 1) recordFinancialMetric("provider_payable_mismatch_total", 1);
    if (maxDelta > 1) {
      await financeAlertService.raise(
        "LEDGER_RECONCILIATION_DRIFT",
        maxDelta > 100 ? "CRITICAL" : "HIGH",
        `Max liability delta ₹${maxDelta} after reconciliation`,
        { rows: final },
      );
    }

    return { before, afterBackfill, final, adjustments, maxDelta };
  }
}

function row(
  source: string,
  ledgerAccount: string,
  operationalBalance: number,
  ledgerBalance: number,
): LiabilityRow {
  const op = round2(operationalBalance);
  const led = round2(ledgerBalance);
  return {
    source,
    ledgerAccount,
    operationalBalance: op,
    ledgerBalance: led,
    delta: round2(led - op),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const ledgerReconciliationService = new LedgerReconciliationService();
