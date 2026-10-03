import { CashbackStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { financialLedgerService } from "./financial-ledger.service";
import { ledgerBackfillService } from "./ledger-backfill.service";
import { hcoinService } from "./hcoin.service";
import { financeAlertService } from "./finance-alert.service";
import { recordFinancialMetric, setFinancialGauge } from "../lib/financial-metrics";

/** Long enough that "fix" or "ok" cannot pass for a justification. */
export const MIN_ADJUSTMENT_REASON_LENGTH = 20;

export type LiabilityRow = {
  source: string;
  ledgerAccount: string;
  operationalBalance: number;
  ledgerBalance: number;
  delta: number;
};

/**
 * Operational ↔ ledger reconciliation. Backfills missing journals and measures residual drift.
 * Posting correcting ADJUSTMENT entries is opt-in and requires a stated reason — see `reconcile`.
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
      /**
       * INFORMATIONAL ONLY — this delta is not an invariant and must never be adjusted away.
       *
       * `PLATFORM_ESCROW` is commingled. Active gift-card balance is one contributor among several:
       * on 2026-09-21 the account held BOOKING_PAYMENT +₹159,381, PROVIDER_EARNING −₹141,275,
       * WALLET_DEBIT +₹5,275, GIFT_CARD +₹3,800 and REFUND −₹550. Comparing the whole account
       * against gift cards alone therefore reports a "delta" that is mostly unreleased booking
       * escrow doing exactly what it is supposed to do.
       *
       * It used to be adjustable, and the cost is on record: 56 `liability_reconciliation` entries
       * posted −₹17,245 against this account to force it down towards the gift-card figure. Real
       * escrow of ₹26,631 now reads ₹9,386. The plug never converged either, because each booking
       * payment re-opens the gap it was trying to close.
       *
       * Segregating gift-card float into its own account is the real fix; that is a schema and
       * chart-of-accounts decision, so it is not taken here. Until then this row is reported and
       * never acted on.
       */
      { ...row("Gift Card Escrow (info)", "PLATFORM_ESCROW", giftCardBal._sum.balance ?? 0, ledgerEscrow), source: "Gift Card Escrow (info)" },
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

  /**
   * Backfill, measure, and — only when explicitly asked, with a stated reason — post correcting
   * adjustments.
   *
   * `postAdjustments` used to default to TRUE (`opts.postAdjustments !== false`), and the CLI
   * `reconcile:ledger` passed it unconditionally with no reason. So "detect a mismatch" and
   * "silence the mismatch with an ADJUSTMENT" were one command, and the ₹32 wallet drift that
   * `diagnose-wallet-liability.ts` attributes to two specific historical errors could be erased by
   * anyone running it — destroying the evidence of what caused it. That script's own output warned
   * against running this; a warning in another tool's output is not a control.
   *
   * Now: posting is opt-in, and opting in without an `adjustmentReason` throws before anything is
   * written. The reason is carried into every journal description it produces.
   */
  async reconcile(
    opts: { backfillLimit?: number; postAdjustments?: boolean; adjustmentReason?: string } = {},
  ) {
    const post = opts.postAdjustments === true;
    const reason = opts.adjustmentReason?.trim() ?? "";
    if (post && reason.length < MIN_ADJUSTMENT_REASON_LENGTH) {
      throw new Error(
        `ADJUSTMENT_REASON_REQUIRED: posting liability adjustments needs an adjustmentReason of at least ` +
          `${MIN_ADJUSTMENT_REASON_LENGTH} characters stating why the delta is being corrected rather than attributed`,
      );
    }

    const before = await this.buildReport();

    await ledgerBackfillService.run({
      limit: opts.backfillLimit ?? 5000,
      startedBy: "ledger-reconciliation",
    });

    const afterBackfill = await this.buildReport();
    const adjustments: Array<{ account: string; amount: number; direction: string }> = [];

    /**
     * Accounts whose operational counterpart is a genuine one-to-one invariant, so a residual
     * delta really is drift and an adjusting entry really does correct it:
     *
     *   CUSTOMER_WALLET  == SUM(users.wallet_balance)
     *   PROVIDER_PAYABLE == SUM(providers.wallet_balance)
     *   HCOIN_LIABILITY  == floor((issued - redeemed - expired) * COIN_TO_RUPEE)
     *
     * `PLATFORM_ESCROW` was in this set and must not be: it is commingled, and the quantity it was
     * being compared against (active gift-card balance) is only one of its contributors. See the
     * note on the Gift Card Escrow row in `buildReport`.
     */
    const ADJUSTABLE = new Set(["CUSTOMER_WALLET", "PROVIDER_PAYABLE", "HCOIN_LIABILITY"]);

    if (post) {
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
          reason,
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
    /**
     * Only invariant-backed accounts can move this number. Informational rows (gift-card escrow,
     * pending cashback) carry deltas that are structural rather than wrong, and folding them in
     * would pin `ledger_reconciliation_max_delta` permanently above the alert threshold — an alert
     * that always fires is one nobody reads.
     */
    const maxDelta = Math.max(
      ...final.filter((r) => ADJUSTABLE.has(r.ledgerAccount)).map((r) => Math.abs(r.delta)),
      0,
    );

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
