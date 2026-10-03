import { CashbackStatus, FinancialIntegrityStatus, PaymentStatus, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { financeAlertService } from "./finance-alert.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { financialLedgerService } from "./financial-ledger.service";
import { hcoinService } from "./hcoin.service";

type IntegrityIssue = {
  category: string;
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  referenceId?: string;
  details: string;
};

export class FinancialIntegrityService {
  async runChecks(): Promise<{ runId: string; status: FinancialIntegrityStatus; issues: IntegrityIssue[] }> {
    const issues: IntegrityIssue[] = [];

    const duplicateJournals = await prisma.$queryRaw<Array<{ idempotency_key: string; cnt: bigint }>>`
      SELECT idempotency_key, COUNT(*) as cnt
      FROM journal_entries
      WHERE idempotency_key IS NOT NULL
      GROUP BY idempotency_key
      HAVING COUNT(*) > 1
    `;
    for (const row of duplicateJournals) {
      issues.push({
        category: "DUPLICATE_JOURNAL",
        severity: "CRITICAL",
        referenceId: row.idempotency_key,
        details: `Duplicate journal idempotency key (${row.cnt} entries)`,
      });
    }

    const unbalanced = await prisma.$queryRaw<Array<{ journal_id: string; debit: number; credit: number }>>`
      SELECT journal_id,
        SUM(debit)::float as debit,
        SUM(credit)::float as credit
      FROM ledger_entries
      GROUP BY journal_id
      HAVING ABS(SUM(debit) - SUM(credit)) > 0.01
    `;
    for (const row of unbalanced) {
      issues.push({
        category: "LEDGER_IMBALANCE",
        severity: "CRITICAL",
        referenceId: row.journal_id,
        details: `Journal debits ${row.debit} != credits ${row.credit}`,
      });
    }

    const settlementMismatches = await prisma.payment.findMany({
      where: {
        status: "SUCCESS",
        settlementId: { not: null },
        OR: [{ settledAmount: null }, { settledAmount: { lt: 0 } }],
      },
      select: { id: true },
      take: 20,
    });
    for (const p of settlementMismatches) {
      issues.push({
        category: "SETTLEMENT_MISMATCH",
        severity: "HIGH",
        referenceId: p.id,
        details: "Payment marked settled without settledAmount",
      });
    }

    const payoutMismatches = await prisma.withdrawal.findMany({
      where: { status: "COMPLETED", completedAt: null },
      select: { id: true },
      take: 20,
    });
    for (const w of payoutMismatches) {
      issues.push({
        category: "PAYOUT_MISMATCH",
        severity: "HIGH",
        referenceId: w.id,
        details: "Completed withdrawal missing completedAt",
      });
    }

    /**
     * ── A refund is only a mismatch if the payment never succeeded ──────────
     *
     * This allowed exactly REFUNDED and SUCCESS, so every PARTIALLY_REFUNDED payment was reported as
     * an integrity issue — a status `booking-refund.service` sets DELIBERATELY while a refund is
     * still short of the full amount, and which `admin.service` and `invoice-report.service` already
     * treat as a normal refunded state. The rule predates partial refunds and was never updated.
     *
     * The cost was not cosmetic. Nine partially-refunded payments kept every integrity run at FAIL,
     * which pinned `serviceHealth.finance` to "degraded" permanently. A health signal that is always
     * red carries no information, and a real refund mismatch would have arrived as the tenth line of
     * a list operators had already learned to scroll past.
     *
     * What actually cannot be true is money refunded against a payment that never took any: PENDING,
     * INITIATED, PROCESSING and FAILED are the mismatch, and REFUNDING is a legitimate in-flight
     * state. Measured across the database: 9 PARTIALLY_REFUNDED, 14 REFUNDED, and zero refunds
     * against a payment that never succeeded — so every issue this rule was raising was false.
     */
    const REFUNDABLE_PAYMENT_STATES: PaymentStatus[] = [
      PaymentStatus.SUCCESS,
      PaymentStatus.REFUNDED,
      PaymentStatus.PARTIALLY_REFUNDED,
      PaymentStatus.REFUNDING,
    ];
    const refundMismatches = await prisma.payment.findMany({
      where: { refundedAmount: { gt: 0 }, status: { notIn: REFUNDABLE_PAYMENT_STATES } },
      select: { id: true, refundedAmount: true, status: true, amountPaid: true },
      take: 40,
    });
    for (const p of refundMismatches) {
      /**
       * O10: a capture that lands after PAYMENT_PENDING_TTL closed the window is refunded while the
       * row stays EXPIRED — the booking was never confirmed, but the money was genuinely taken and
       * `amountPaid` records how much. That refund is correct, and the over-refund rule below is
       * what polices its ceiling. Flagging it here would raise a warning on every correct
       * auto-refund for ever, and a control that always fires is scrolled past exactly like one
       * that never does. An EXPIRED row with NOTHING captured is still the mismatch it always was.
       */
      const capturedAfterExpiry = p.status === PaymentStatus.EXPIRED && (p.amountPaid ?? 0) > 0;
      if (capturedAfterExpiry) continue;
      issues.push({
        category: "REFUND_MISMATCH",
        severity: "MEDIUM",
        referenceId: p.id,
        details: `Refund amount ${p.refundedAmount} recorded against a payment in status ${p.status}, which never took payment`,
      });
    }

    /**
     * Refunded more than was ever paid. This is the integrity failure the rule above was NOT
     * checking: it inspected the status and never compared the amounts, so a payment refunded twice
     * over would have passed as long as its status read REFUNDED. Currently zero across the database.
     */
    const overRefunds = await prisma.$queryRaw<Array<{ id: string; amount: number; refunded: number }>>`
      SELECT id, amount::float AS amount, refunded_amount::float AS refunded
      FROM payments
      WHERE refunded_amount > amount + 0.01
      LIMIT 20
    `;
    for (const p of overRefunds) {
      issues.push({
        category: "REFUND_MISMATCH",
        severity: "HIGH",
        referenceId: p.id,
        details: `Refunded ${p.refunded} against a payment of ${p.amount} — more money returned than was taken`,
      });
    }

    /**
     * Refunded more than was paid, per BOOKING and across every tender.
     *
     * The payment-row check above cannot see a wallet refund: a wallet-only booking has no payments
     * row, and a split keeps only its gateway share there. This check adds the wallet leg — the
     * booking's wallet debits against its wallet refunds — for exactly those bookings. A legacy wallet
     * payments row already carries its wallet refunds in refunded_amount, so its wallet transactions are
     * not counted a second time. Also flags a wallet leg refunded beyond what the wallet paid, even
     * when the total happens to fit.
     */
    const bookingOverRefunds = await prisma.$queryRaw<
      Array<{ id: string; gw_paid: bigint; gw_refunded: bigint; w_paid: bigint; w_refunded: bigint }>
    >`
      WITH w AS (
        SELECT reference_id AS booking_id,
               coalesce(sum(amount_paise) FILTER (WHERE type::text = 'DEBIT' AND reference_type = 'booking_wallet_payment'), 0)::bigint AS paid,
               coalesce(sum(amount_paise) FILTER (WHERE type::text = 'REFUND' AND reference_type IN ('booking_cancel_refund', 'booking_admin_refund')), 0)::bigint AS refunded
          FROM wallet_transactions
         WHERE status::text = 'COMPLETED'
           AND reference_type IN ('booking_wallet_payment', 'booking_cancel_refund', 'booking_admin_refund')
         GROUP BY reference_id
      ), t AS (
        SELECT b.id,
               CASE WHEN p.status::text IN ('SUCCESS', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REFUNDING')
                    THEN round(coalesce(p.amount_paid, 0)::numeric * 100)::bigint ELSE 0 END AS gw_paid,
               round(coalesce(p.refunded_amount, 0)::numeric * 100)::bigint AS gw_refunded,
               CASE WHEN p.id IS NULL OR p.payment_method = 'wallet_razorpay_split' THEN w.paid ELSE 0 END AS w_paid,
               CASE WHEN p.id IS NULL OR p.payment_method = 'wallet_razorpay_split' THEN w.refunded ELSE 0 END AS w_refunded
          FROM w
          JOIN bookings b ON b.id = w.booking_id
          LEFT JOIN payments p ON p.booking_id = b.id
      )
      SELECT id, gw_paid, gw_refunded, w_paid, w_refunded
        FROM t
       WHERE gw_refunded + w_refunded > gw_paid + w_paid OR w_refunded > w_paid
       LIMIT 20
    `;
    for (const b of bookingOverRefunds) {
      issues.push({
        category: "REFUND_MISMATCH",
        severity: "HIGH",
        referenceId: b.id,
        details:
          `Booking refunded ${Number(b.gw_refunded + b.w_refunded) / 100} (gateway ${Number(b.gw_refunded) / 100} + wallet ${Number(b.w_refunded) / 100}) ` +
          `against ${Number(b.gw_paid + b.w_paid) / 100} paid (gateway ${Number(b.gw_paid) / 100} + wallet ${Number(b.w_paid) / 100})`,
      });
    }

    const duplicatePayouts = await prisma.$queryRaw<Array<{ withdrawal_id: string; cnt: bigint }>>`
      SELECT withdrawal_id, COUNT(*) as cnt
      FROM payout_attempts
      WHERE status = 'SUCCESS'
      GROUP BY withdrawal_id
      HAVING COUNT(*) > 1
    `;
    for (const row of duplicatePayouts) {
      issues.push({
        category: "DUPLICATE_PAYOUT",
        severity: "CRITICAL",
        referenceId: row.withdrawal_id,
        details: `Multiple SUCCESS payout attempts (${row.cnt})`,
      });
    }

    const orphanJournals = await prisma.journalEntry.findMany({
      where: { lines: { none: {} } },
      select: { id: true },
      take: 20,
    });
    for (const j of orphanJournals) {
      issues.push({
        category: "ORPHAN_JOURNAL",
        severity: "HIGH",
        referenceId: j.id,
        details: "Journal entry has no ledger lines",
      });
    }

    const negativeWallets = await prisma.user.findMany({
      where: { walletBalance: { lt: 0 } },
      select: { id: true, walletBalance: true },
      take: 20,
    });
    for (const u of negativeWallets) {
      issues.push({
        category: "NEGATIVE_BALANCE",
        severity: "CRITICAL",
        referenceId: u.id,
        details: `Customer wallet balance ${u.walletBalance}`,
      });
    }

    const negativeProviders = await prisma.provider.findMany({
      where: { OR: [{ walletBalance: { lt: 0 } }, { reservedBalance: { lt: 0 } }] },
      select: { id: true, walletBalance: true, reservedBalance: true },
      take: 20,
    });
    for (const p of negativeProviders) {
      issues.push({
        category: "NEGATIVE_PROVIDER_BALANCE",
        severity: "CRITICAL",
        referenceId: p.id,
        details: `Provider wallet ${p.walletBalance}, reserved ${p.reservedBalance}`,
      });
    }

    const [customerWalletSum, providerWalletSum, ledgerWallet, ledgerPayable, pendingCashback, giftCardBal, hcoinAnalytics] =
      await Promise.all([
        prisma.user.aggregate({ _sum: { walletBalance: true } }),
        prisma.provider.aggregate({ _sum: { walletBalance: true } }),
        financialLedgerService.getAccountBalance("CUSTOMER_WALLET"),
        financialLedgerService.getAccountBalance("PROVIDER_PAYABLE"),
        prisma.membershipCashback.aggregate({
          where: { status: CashbackStatus.PENDING },
          _sum: { amount: true },
        }),
        prisma.giftCard.aggregate({ where: { status: "ACTIVE" }, _sum: { balance: true } }),
        hcoinService.adminAnalytics(),
      ]);

    const walletOps = customerWalletSum._sum.walletBalance ?? 0;
    if (Math.abs(walletOps - ledgerWallet) > 1) {
      issues.push({
        category: "WALLET_LIABILITY_MISMATCH",
        severity: "HIGH",
        details: `Ops wallet ₹${walletOps} vs ledger CUSTOMER_WALLET ₹${ledgerWallet}`,
      });
    }

    const providerOps = providerWalletSum._sum.walletBalance ?? 0;
    if (Math.abs(providerOps - ledgerPayable) > 1) {
      issues.push({
        category: "PROVIDER_PAYABLE_MISMATCH",
        severity: "HIGH",
        details: `Ops provider wallet ₹${providerOps} vs ledger PROVIDER_PAYABLE ₹${ledgerPayable}`,
      });
    }

    const cashbackOps = pendingCashback._sum.amount ?? 0;
    const cashbackLedger = await financialLedgerService.getAccountBalance("PLATFORM_REVENUE");
    if (cashbackOps > 0 && cashbackOps > cashbackLedger + 1) {
      issues.push({
        category: "CASHBACK_LIABILITY_DRIFT",
        severity: "MEDIUM",
        details: `Pending cashback ₹${cashbackOps} exceeds revenue reserve signal`,
      });
    }

    const giftOps = giftCardBal._sum.balance ?? 0;
    const escrowLedger = await financialLedgerService.getAccountBalance("PLATFORM_ESCROW");
    if (giftOps > 0 && giftOps > escrowLedger + 1) {
      issues.push({
        category: "GIFT_CARD_LIABILITY_DRIFT",
        severity: "MEDIUM",
        details: `Active gift cards ₹${giftOps} vs escrow ledger ₹${escrowLedger}`,
      });
    }

    const hcoinOps = hcoinAnalytics.liabilityRupees;
    const hcoinLedger = await financialLedgerService.getAccountBalance("HCOIN_LIABILITY");
    if (Math.abs(hcoinOps - hcoinLedger) > 1) {
      issues.push({
        category: "HCOIN_LIABILITY_MISMATCH",
        severity: "MEDIUM",
        details: `Ops H-Coin liability ₹${hcoinOps} vs ledger ₹${hcoinLedger}`,
      });
    }

    const walletDebits = await prisma.walletTransaction.findMany({
      where: {
        type: { in: [WalletTxnType.DEBIT, WalletTxnType.REVERSAL] },
        status: WalletTxnStatus.COMPLETED,
      },
      select: { id: true, amount: true, referenceType: true, referenceId: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    for (const txn of walletDebits) {
      /**
       * Which journal proves a debit was recorded depends on what the debit WAS.
       *
       * A peer-to-peer transfer is booked at the moment it happens as a matched pair keyed on the
       * transfer — `wallet_transfer_out:<transferId>` debiting CUSTOMER_WALLET and
       * `wallet_transfer_in:<transferId>` crediting it back — because money moving between two
       * customers leaves the platform owing the same total. Demanding a `wallet_debit:` journal for
       * those was the same false premise that made `ledger-backfill` write a second, wrong journal
       * booking each transfer as a bank withdrawal. Looking for the journal that should actually
       * exist keeps the check able to fire: a transfer with no journal at all is still reported.
       */
      // A tip is booked at the moment it happens as `booking_tip:<bookingId>` (CUSTOMER_WALLET →
      // PROVIDER_PAYABLE, in `rating.service`), for the same reason and with the same consequence.
      const key =
        txn.referenceType === "p2p_transfer" && txn.referenceId
          ? `wallet_transfer_out:${txn.referenceId}`
          : txn.referenceType === "booking_tip" && txn.referenceId
            ? `booking_tip:${txn.referenceId}`
            : `wallet_debit:${txn.id}`;
      const journal = await prisma.journalEntry.findUnique({ where: { idempotencyKey: key } });
      if (!journal) {
        issues.push({
          category: "MISSING_LEDGER_ENTRY",
          severity: "HIGH",
          referenceId: txn.id,
          details: `Completed wallet debit/reversal missing its ledger journal (${key})`,
        });
        break;
      }
    }

    // Referral commission wallet credits must each have a REFERRAL_COMMISSION journal.
    const referralCredits = await prisma.walletTransaction.findMany({
      where: {
        type: WalletTxnType.CREDIT,
        status: WalletTxnStatus.COMPLETED,
        referenceType: "referral_withdrawal",
      },
      select: { id: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    });
    for (const txn of referralCredits) {
      const journal = await prisma.journalEntry.findUnique({
        where: { idempotencyKey: `referral_commission:${txn.id}` },
        select: { id: true },
      });
      if (!journal) {
        issues.push({
          category: "MISSING_REFERRAL_LEDGER_ENTRY",
          severity: "HIGH",
          referenceId: txn.id,
          details: "Referral wallet credit missing REFERRAL_COMMISSION journal",
        });
        break;
      }
    }

    // Executed manual adjustments must each have an ADJUSTMENT journal.
    const executedAdjustments = await prisma.financialAdjustment.findMany({
      where: { status: "EXECUTED" },
      select: { id: true, journalId: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    });
    for (const adj of executedAdjustments) {
      const journal = adj.journalId
        ? await prisma.journalEntry.findUnique({ where: { id: adj.journalId }, select: { id: true } })
        : await prisma.journalEntry.findUnique({
            where: { idempotencyKey: `adjustment:${adj.id}` },
            select: { id: true },
          });
      if (!journal) {
        issues.push({
          category: "MISSING_ADJUSTMENT_JOURNAL",
          severity: "CRITICAL",
          referenceId: adj.id,
          details: "Executed financial adjustment missing ADJUSTMENT journal",
        });
        break;
      }
    }

    // H-Coin expiry transactions must each have a HCOIN_EXPIRED journal.
    const expiryTxns = await prisma.hCoinTransaction.findMany({
      where: { type: "EXPIRE" },
      select: { id: true },
      take: 200,
      orderBy: { createdAt: "desc" },
    });
    for (const txn of expiryTxns) {
      const journal = await prisma.journalEntry.findUnique({
        where: { idempotencyKey: `hcoin_expired:${txn.id}` },
        select: { id: true },
      });
      if (!journal) {
        issues.push({
          category: "MISSING_HCOIN_EXPIRY_JOURNAL",
          severity: "HIGH",
          referenceId: txn.id,
          details: "H-Coin expiry transaction missing HCOIN_EXPIRED journal",
        });
        break;
      }
    }

    // Historical backfill drift: top-ups / debits without journals (sampled).
    const sampledTopups = await prisma.walletTransaction.count({
      where: { type: WalletTxnType.CREDIT, status: WalletTxnStatus.COMPLETED, referenceType: "razorpay_order" },
    });
    if (sampledTopups > 0) {
      const sample = await prisma.walletTransaction.findFirst({
        where: { type: WalletTxnType.CREDIT, status: WalletTxnStatus.COMPLETED, referenceType: "razorpay_order" },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      if (sample) {
        const j = await prisma.journalEntry.findUnique({
          where: { idempotencyKey: `wallet_topup:${sample.id}` },
          select: { id: true },
        });
        if (!j) {
          issues.push({
            category: "MISSING_HISTORICAL_JOURNAL",
            severity: "MEDIUM",
            referenceId: sample.id,
            details: "Historical wallet top-up missing journal — run ledger backfill",
          });
        }
      }
    }

    const status = issues.length === 0 ? FinancialIntegrityStatus.PASS : FinancialIntegrityStatus.FAIL;

    const run = await prisma.financialIntegrityRun.create({
      data: {
        status,
        issuesCount: issues.length,
        report: JSON.stringify({ issues, checkedAt: new Date().toISOString() }),
      },
    });

    if (issues.length > 0) {
      recordFinancialMetric("finance_integrity_failures_total", issues.length);
      for (const issue of issues.filter((i) => i.severity === "CRITICAL" || i.severity === "HIGH").slice(0, 5)) {
        await financeAlertService.raise(issue.category, issue.severity, issue.details, {
          referenceId: issue.referenceId,
          runId: run.id,
        });
      }
    }

    return { runId: run.id, status, issues };
  }

  async getLatestReport() {
    const latest = await prisma.financialIntegrityRun.findFirst({ orderBy: { createdAt: "desc" } });
    if (!latest) return null;
    return { ...latest, report: JSON.parse(latest.report) as { issues: IntegrityIssue[] } };
  }

  async listRuns(limit = 20) {
    return prisma.financialIntegrityRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  }

  /** FinanceIntegrityValidator — 0-100 score + INFO/WARNING/CRITICAL grouping. */
  async validate(): Promise<{
    score: number;
    status: FinancialIntegrityStatus;
    issues: Array<IntegrityIssue & { level: "INFO" | "WARNING" | "CRITICAL" }>;
    bySeverity: { info: number; warning: number; critical: number };
  }> {
    const result = await this.runChecks();
    const penalty = result.issues.reduce((sum, i) => {
      if (i.severity === "CRITICAL") return sum + 15;
      if (i.severity === "HIGH") return sum + 8;
      if (i.severity === "MEDIUM") return sum + 4;
      return sum + 2;
    }, 0);
    const leveled = result.issues.map((i) => ({ ...i, level: toLevel(i.severity) }));
    return {
      score: Math.max(0, 100 - penalty),
      status: result.status,
      issues: leveled,
      bySeverity: {
        info: leveled.filter((i) => i.level === "INFO").length,
        warning: leveled.filter((i) => i.level === "WARNING").length,
        critical: leveled.filter((i) => i.level === "CRITICAL").length,
      },
    };
  }

  async getIntegrityDashboard() {
    const latest = await this.getLatestReport();
    const issues = latest?.report?.issues ?? [];
    const categories = {
      ledger: issues.filter((i) => i.category.includes("LEDGER") || i.category.includes("JOURNAL")).length,
      settlement: issues.filter((i) => i.category.includes("SETTLEMENT")).length,
      refund: issues.filter((i) => i.category.includes("REFUND")).length,
      payout: issues.filter((i) => i.category.includes("PAYOUT")).length,
      chargeback: issues.filter((i) => i.category.includes("CHARGEBACK")).length,
    };
    const penalty = issues.length * 5;
    const integrityScore = Math.max(0, 100 - penalty);
    const financeHealthScore = latest?.status === "PASS" ? integrityScore : Math.max(0, integrityScore - 20);
    return {
      integrityScore,
      financeHealthScore,
      status: latest?.status ?? "UNKNOWN",
      issuesCount: issues.length,
      categories,
      latestRunId: latest?.id,
    };
  }
}

function toLevel(severity: IntegrityIssue["severity"]): "INFO" | "WARNING" | "CRITICAL" {
  if (severity === "CRITICAL") return "CRITICAL";
  if (severity === "LOW") return "INFO";
  return "WARNING";
}

export const financialIntegrityService = new FinancialIntegrityService();
