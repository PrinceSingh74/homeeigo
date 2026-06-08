import { JournalEntryType, LedgerAccountType, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";

export type LedgerLineInput = {
  accountCode: string;
  debit: number;
  credit: number;
};

export type LedgerJournalInput = {
  type: JournalEntryType;
  lines: LedgerLineInput[];
  referenceId?: string;
  referenceType?: string;
  description?: string;
  idempotencyKey: string;
};

type DbClient = Prisma.TransactionClient | typeof prisma;

const CHART_OF_ACCOUNTS: Array<{ code: string; name: string; type: LedgerAccountType }> = [
  { code: "CUSTOMER_FUNDS", name: "Customer Funds (Clearing)", type: "ASSET" },
  { code: "PLATFORM_ESCROW", name: "Platform Escrow", type: "LIABILITY" },
  { code: "PLATFORM_REVENUE", name: "Platform Revenue", type: "REVENUE" },
  { code: "REFUND_LIABILITY", name: "Refund Liability", type: "LIABILITY" },
  { code: "PROVIDER_PAYABLE", name: "Provider Payable", type: "LIABILITY" },
  { code: "BANK_SETTLEMENT", name: "Bank Settlement", type: "ASSET" },
  { code: "CHARGEBACK_LOSS", name: "Chargeback Loss", type: "EXPENSE" },
  { code: "CUSTOMER_WALLET", name: "Customer Wallet Liability", type: "LIABILITY" },
  { code: "WALLET_CLEARING", name: "Wallet Transfer Clearing", type: "ASSET" },
  { code: "HCOIN_LIABILITY", name: "H-Coin Liability", type: "LIABILITY" },
  { code: "PROMO_EXPENSE", name: "Promotional Expense", type: "EXPENSE" },
  { code: "REFERRAL_MARKETING_EXPENSE", name: "Referral Marketing Expense", type: "EXPENSE" },
  { code: "PROMOTIONAL_BREAKAGE_REVENUE", name: "Promotional Breakage Revenue", type: "REVENUE" },
  { code: "ADJUSTMENT_CLEARING", name: "Manual Adjustment Clearing", type: "ASSET" },
];

/**
 * Immutable append-only double-entry ledger.
 * No update/delete — every financial event creates balanced journal lines.
 */
export class FinancialLedgerService {
  async ensureAccountsSeeded() {
    return this.ensureAccountsSeededWithClient(prisma);
  }

  private async ensureAccountsSeededWithClient(db: DbClient) {
    for (const acct of CHART_OF_ACCOUNTS) {
      await db.ledgerAccount.upsert({
        where: { code: acct.code },
        create: acct,
        update: {},
      });
    }
  }

  /** Wallet debit: Debit Customer Wallet liability, Credit Bank Settlement */
  async recordWalletDebit(walletTxnId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.WALLET_DEBIT,
      referenceId: walletTxnId,
      referenceType: "wallet_transaction",
      idempotencyKey: `wallet_debit:${walletTxnId}`,
      description: `Wallet debit ${walletTxnId}`,
      lines: [
        { accountCode: "CUSTOMER_WALLET", debit: amount, credit: 0 },
        { accountCode: "BANK_SETTLEMENT", debit: 0, credit: amount },
      ],
    });
  }

  journalForBookingPayment(paymentId: string, amount: number): LedgerJournalInput {
    return {
      type: JournalEntryType.BOOKING_PAYMENT,
      referenceId: paymentId,
      referenceType: "payment",
      idempotencyKey: `booking_payment:${paymentId}`,
      description: `Booking payment ${paymentId}`,
      lines: [
        { accountCode: "CUSTOMER_FUNDS", debit: amount, credit: 0 },
        { accountCode: "PLATFORM_ESCROW", debit: 0, credit: amount },
      ],
    };
  }

  journalForRefund(paymentId: string, amount: number, refundId?: string): LedgerJournalInput {
    return {
      type: JournalEntryType.REFUND,
      referenceId: paymentId,
      referenceType: "payment",
      idempotencyKey: refundId ? `refund:${refundId}` : `refund:payment:${paymentId}:${amount}`,
      description: `Refund for payment ${paymentId}`,
      lines: [
        { accountCode: "REFUND_LIABILITY", debit: amount, credit: 0 },
        { accountCode: "CUSTOMER_FUNDS", debit: 0, credit: amount },
      ],
    };
  }

  journalForProviderPayout(withdrawalId: string, amount: number): LedgerJournalInput {
    return {
      type: JournalEntryType.PROVIDER_PAYOUT,
      referenceId: withdrawalId,
      referenceType: "withdrawal",
      idempotencyKey: `provider_payout:${withdrawalId}`,
      description: `Provider payout ${withdrawalId}`,
      lines: [
        { accountCode: "PROVIDER_PAYABLE", debit: amount, credit: 0 },
        { accountCode: "BANK_SETTLEMENT", debit: 0, credit: amount },
      ],
    };
  }

  async recordJournal(opts: LedgerJournalInput) {
    return this.recordJournalWithClient(prisma, opts);
  }

  /** Atomic ledger write inside an existing Prisma transaction. */
  async recordJournalInTransaction(tx: Prisma.TransactionClient, opts: LedgerJournalInput) {
    return this.recordJournalWithClient(tx, opts);
  }

  private async recordJournalWithClient(db: DbClient, opts: LedgerJournalInput) {
    if (opts.lines.length < 2) throw new Error("LEDGER_MIN_TWO_LINES");

    const totalDebit = round2(opts.lines.reduce((s, l) => s + l.debit, 0));
    const totalCredit = round2(opts.lines.reduce((s, l) => s + l.credit, 0));
    if (totalDebit !== totalCredit || totalDebit <= 0) {
      throw new Error("LEDGER_UNBALANCED");
    }

    if (opts.idempotencyKey) {
      const existing = await db.journalEntry.findUnique({
        where: { idempotencyKey: opts.idempotencyKey },
        include: { lines: true },
      });
      if (existing) return existing;
    }

    await this.ensureAccountsSeededWithClient(db);

    const accounts = await db.ledgerAccount.findMany({
      where: { code: { in: opts.lines.map((l) => l.accountCode) } },
    });
    const accountMap = new Map(accounts.map((a) => [a.code, a.id]));

    for (const line of opts.lines) {
      if (!accountMap.has(line.accountCode)) throw new Error(`LEDGER_UNKNOWN_ACCOUNT:${line.accountCode}`);
    }

    const entryNumber = await this.nextEntryNumberWithClient(db);

    return db.journalEntry.create({
      data: {
        entryNumber,
        type: opts.type,
        referenceId: opts.referenceId,
        referenceType: opts.referenceType,
        description: opts.description,
        idempotencyKey: opts.idempotencyKey,
        lines: {
          create: opts.lines.map((l) => ({
            accountId: accountMap.get(l.accountCode)!,
            debit: round2(l.debit),
            credit: round2(l.credit),
          })),
        },
      },
      include: { lines: { include: { account: true } } },
    }).then(async (journal) => {
      await this.snapshotBalances(journal.id, opts.lines.map((l) => l.accountCode));
      return journal;
    });
  }

  /** Booking payment captured: Debit Customer Funds, Credit Platform Escrow */
  async recordBookingPayment(paymentId: string, amount: number) {
    return this.recordJournal(this.journalForBookingPayment(paymentId, amount));
  }

  /** Refund: Debit Refund Liability, Credit Customer Funds (outflow) */
  async recordRefund(paymentId: string, amount: number, refundId?: string) {
    return this.recordJournal(this.journalForRefund(paymentId, amount, refundId));
  }

  /** Provider earning on complete: Debit Platform Escrow, Credit Provider Payable + Platform Revenue */
  async recordProviderEarning(bookingId: string, gross: number, commission: number, net: number) {
    return this.recordJournal({
      type: JournalEntryType.PROVIDER_EARNING,
      referenceId: bookingId,
      referenceType: "booking",
      idempotencyKey: `provider_earning:${bookingId}`,
      description: `Provider earning for booking ${bookingId}`,
      lines: [
        { accountCode: "PLATFORM_ESCROW", debit: gross, credit: 0 },
        { accountCode: "PROVIDER_PAYABLE", debit: 0, credit: net },
        { accountCode: "PLATFORM_REVENUE", debit: 0, credit: commission },
      ],
    });
  }

  /** Wallet top-up: Debit Bank Settlement, Credit Customer Wallet */
  async recordWalletTopUp(walletTxnId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.WALLET_TOPUP,
      referenceId: walletTxnId,
      referenceType: "wallet_transaction",
      idempotencyKey: `wallet_topup:${walletTxnId}`,
      description: `Wallet top-up ${walletTxnId}`,
      lines: [
        { accountCode: "BANK_SETTLEMENT", debit: amount, credit: 0 },
        { accountCode: "CUSTOMER_WALLET", debit: 0, credit: amount },
      ],
    });
  }

  /** Provider payout: Debit Provider Payable, Credit Bank Settlement */
  async recordProviderPayout(withdrawalId: string, amount: number) {
    return this.recordJournal(this.journalForProviderPayout(withdrawalId, amount));
  }

  /** Chargeback loss: Debit Chargeback Loss, Credit Bank Settlement */
  async recordChargeback(chargebackId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.CHARGEBACK,
      referenceId: chargebackId,
      referenceType: "chargeback",
      idempotencyKey: `chargeback:${chargebackId}`,
      description: `Chargeback ${chargebackId}`,
      lines: [
        { accountCode: "CHARGEBACK_LOSS", debit: amount, credit: 0 },
        { accountCode: "BANK_SETTLEMENT", debit: 0, credit: amount },
      ],
    });
  }

  /** Gift card purchase: Debit Customer Funds, Credit Platform Escrow */
  async recordGiftCardPurchase(giftCardId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.GIFT_CARD,
      referenceId: giftCardId,
      referenceType: "gift_card",
      idempotencyKey: `gift_card:${giftCardId}`,
      description: `Gift card purchase ${giftCardId}`,
      lines: [
        { accountCode: "CUSTOMER_FUNDS", debit: amount, credit: 0 },
        { accountCode: "PLATFORM_ESCROW", debit: 0, credit: amount },
      ],
    });
  }

  /** Subscription payment: Debit Customer Funds, Credit Platform Revenue */
  async recordSubscription(invoiceId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.SUBSCRIPTION,
      referenceId: invoiceId,
      referenceType: "subscription_invoice",
      idempotencyKey: `subscription:${invoiceId}`,
      description: `Subscription invoice ${invoiceId}`,
      lines: [
        { accountCode: "CUSTOMER_FUNDS", debit: amount, credit: 0 },
        { accountCode: "PLATFORM_REVENUE", debit: 0, credit: amount },
      ],
    });
  }

  /** P2P transfer out: Debit Customer Wallet, Credit Wallet Clearing */
  async recordWalletTransferOut(transferId: string, senderWalletTxnId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.WALLET_TRANSFER_OUT,
      referenceId: transferId,
      referenceType: "wallet_transfer",
      idempotencyKey: `wallet_transfer_out:${transferId}`,
      description: `P2P transfer out ${transferId} (txn ${senderWalletTxnId})`,
      lines: [
        { accountCode: "CUSTOMER_WALLET", debit: amount, credit: 0 },
        { accountCode: "WALLET_CLEARING", debit: 0, credit: amount },
      ],
    });
  }

  /** P2P transfer in: Debit Wallet Clearing, Credit Customer Wallet */
  async recordWalletTransferIn(transferId: string, recipientWalletTxnId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.WALLET_TRANSFER_IN,
      referenceId: transferId,
      referenceType: "wallet_transfer",
      idempotencyKey: `wallet_transfer_in:${transferId}`,
      description: `P2P transfer in ${transferId} (txn ${recipientWalletTxnId})`,
      lines: [
        { accountCode: "WALLET_CLEARING", debit: amount, credit: 0 },
        { accountCode: "CUSTOMER_WALLET", debit: 0, credit: amount },
      ],
    });
  }

  /** Failed payout — reverse a completed payout journal or record reservation release */
  async recordProviderPayoutReversal(withdrawalId: string, amount: number) {
    const completed = await prisma.journalEntry.findUnique({
      where: { idempotencyKey: `provider_payout:${withdrawalId}` },
    });
    if (completed) {
      return this.recordJournal({
        type: JournalEntryType.PROVIDER_PAYOUT_REVERSAL,
        referenceId: withdrawalId,
        referenceType: "withdrawal",
        idempotencyKey: `provider_payout_reversal:${withdrawalId}`,
        description: `Payout reversal ${withdrawalId}`,
        lines: [
          { accountCode: "BANK_SETTLEMENT", debit: amount, credit: 0 },
          { accountCode: "PROVIDER_PAYABLE", debit: 0, credit: amount },
        ],
      });
    }
    return this.recordJournal({
      type: JournalEntryType.PROVIDER_PAYOUT_REVERSAL,
      referenceId: withdrawalId,
      referenceType: "withdrawal",
      idempotencyKey: `payout_failure:${withdrawalId}`,
      description: `Payout failed — reservation released ${withdrawalId}`,
      lines: [
        { accountCode: "PROVIDER_PAYABLE", debit: amount, credit: 0 },
        { accountCode: "PROVIDER_PAYABLE", debit: 0, credit: amount },
      ],
    });
  }

  /** H-Coin earned: Debit Promo Expense, Credit H-Coin Liability (rupee equivalent) */
  async recordHcoinEarned(hcoinTxnId: string, coins: number, rupeeValue: number) {
    return this.recordJournal({
      type: JournalEntryType.HCOIN_EARNED,
      referenceId: hcoinTxnId,
      referenceType: "hcoin_transaction",
      idempotencyKey: `hcoin_earned:${hcoinTxnId}`,
      description: `H-Coin earned ${coins} coins`,
      lines: [
        { accountCode: "PROMO_EXPENSE", debit: rupeeValue, credit: 0 },
        { accountCode: "HCOIN_LIABILITY", debit: 0, credit: rupeeValue },
      ],
    });
  }

  /** H-Coin redeemed to wallet: Debit H-Coin Liability, Credit Customer Wallet */
  async recordHcoinRedeemed(hcoinTxnId: string, walletTxnId: string, rupeeValue: number) {
    return this.recordJournal({
      type: JournalEntryType.HCOIN_REDEEMED,
      referenceId: hcoinTxnId,
      referenceType: "hcoin_transaction",
      idempotencyKey: `hcoin_redeemed:${hcoinTxnId}`,
      description: `H-Coin redeemed → wallet ${walletTxnId}`,
      lines: [
        { accountCode: "HCOIN_LIABILITY", debit: rupeeValue, credit: 0 },
        { accountCode: "CUSTOMER_WALLET", debit: 0, credit: rupeeValue },
      ],
    });
  }

  /** Admin H-Coin adjustment / promo grant */
  async recordHcoinAdjusted(hcoinTxnId: string, rupeeValue: number) {
    return this.recordJournal({
      type: JournalEntryType.HCOIN_ADJUSTED,
      referenceId: hcoinTxnId,
      referenceType: "hcoin_transaction",
      idempotencyKey: `hcoin_adjusted:${hcoinTxnId}`,
      description: `H-Coin admin adjustment ${hcoinTxnId}`,
      lines: [
        { accountCode: "PROMO_EXPENSE", debit: rupeeValue, credit: 0 },
        { accountCode: "HCOIN_LIABILITY", debit: 0, credit: rupeeValue },
      ],
    });
  }

  /** Cashback reversal on refund: Debit Customer Wallet, Credit Platform Revenue */
  async recordCashbackReversal(walletTxnId: string, amount: number, bookingId: string) {
    return this.recordJournal({
      type: JournalEntryType.CASHBACK_REVERSAL,
      referenceId: walletTxnId,
      referenceType: "wallet_transaction",
      idempotencyKey: `cashback_reversal:${bookingId}`,
      description: `Cashback reversed for booking ${bookingId}`,
      lines: [
        { accountCode: "CUSTOMER_WALLET", debit: amount, credit: 0 },
        { accountCode: "PLATFORM_REVENUE", debit: 0, credit: amount },
      ],
    });
  }

  /**
   * Referral commission credited to wallet: DR Referral Marketing Expense,
   * CR Customer Wallet Liability. Keyed by the wallet transaction id so the
   * ledger CUSTOMER_WALLET balance stays in lock-step with the ops wallet.
   */
  async recordReferralCommission(opts: {
    walletTxnId: string;
    referrerUserId: string;
    amount: number;
    referralId?: string;
    referredUserId?: string;
    bookingId?: string;
  }) {
    return this.recordJournal({
      type: JournalEntryType.REFERRAL_COMMISSION,
      referenceId: opts.walletTxnId,
      referenceType: "referral_commission",
      idempotencyKey: `referral_commission:${opts.walletTxnId}`,
      description: `Referral commission credit → wallet (referrer ${opts.referrerUserId}${
        opts.referredUserId ? `, referred ${opts.referredUserId}` : ""
      }${opts.bookingId ? `, booking ${opts.bookingId}` : ""})`,
      lines: [
        { accountCode: "REFERRAL_MARKETING_EXPENSE", debit: opts.amount, credit: 0 },
        { accountCode: "CUSTOMER_WALLET", debit: 0, credit: opts.amount },
      ],
    });
  }

  /** H-Coin expiry (breakage): DR H-Coin Liability, CR Promotional Breakage Revenue */
  async recordHcoinExpired(opts: {
    idempotencyKey: string;
    referenceId: string;
    rupeeValue: number;
    coins: number;
  }) {
    return this.recordJournal({
      type: JournalEntryType.HCOIN_EXPIRED,
      referenceId: opts.referenceId,
      referenceType: "hcoin_expiry",
      idempotencyKey: opts.idempotencyKey,
      description: `H-Coin expiry breakage ${opts.coins} coins`,
      lines: [
        { accountCode: "HCOIN_LIABILITY", debit: opts.rupeeValue, credit: 0 },
        { accountCode: "PROMOTIONAL_BREAKAGE_REVENUE", debit: 0, credit: opts.rupeeValue },
      ],
    });
  }

  /**
   * Manual financial adjustment journal. The two account codes are validated
   * against the chart of accounts inside recordJournal. Idempotent per adjustment.
   */
  async recordAdjustment(opts: {
    adjustmentId: string;
    debitAccountCode: string;
    creditAccountCode: string;
    amount: number;
    description: string;
    tx?: Prisma.TransactionClient;
  }) {
    const input: LedgerJournalInput = {
      type: JournalEntryType.ADJUSTMENT,
      referenceId: opts.adjustmentId,
      referenceType: "financial_adjustment",
      idempotencyKey: `adjustment:${opts.adjustmentId}`,
      description: opts.description,
      lines: [
        { accountCode: opts.debitAccountCode, debit: opts.amount, credit: 0 },
        { accountCode: opts.creditAccountCode, debit: 0, credit: opts.amount },
      ],
    };
    return opts.tx ? this.recordJournalInTransaction(opts.tx, input) : this.recordJournal(input);
  }

  /** Cashback credit: Debit Platform Revenue, Credit Customer Wallet */
  async recordCashback(cashbackId: string, amount: number) {
    return this.recordJournal({
      type: JournalEntryType.CASHBACK,
      referenceId: cashbackId,
      referenceType: "membership_cashback",
      idempotencyKey: `cashback:${cashbackId}`,
      description: `Membership cashback ${cashbackId}`,
      lines: [
        { accountCode: "PLATFORM_REVENUE", debit: amount, credit: 0 },
        { accountCode: "CUSTOMER_WALLET", debit: 0, credit: amount },
      ],
    });
  }

  private async snapshotBalances(journalId: string, accountCodes: string[]) {
    const uniqueCodes = [...new Set(accountCodes)];
    for (const code of uniqueCodes) {
      const account = await prisma.ledgerAccount.findUnique({ where: { code } });
      if (!account) continue;

      const agg = await prisma.ledgerEntry.aggregate({
        where: { accountId: account.id },
        _sum: { debit: true, credit: true },
      });
      const balance = round2((agg._sum.debit ?? 0) - (agg._sum.credit ?? 0));

      await prisma.ledgerBalanceSnapshot.create({
        data: { journalId, accountId: account.id, balance },
      }).catch(() => undefined);
    }
  }

  /** Net balance for a chart account (credit-normal for liabilities/revenue). */
  async getAccountBalance(code: string): Promise<number> {
    const account = await prisma.ledgerAccount.findUnique({ where: { code } });
    if (!account) return 0;
    const agg = await prisma.ledgerEntry.aggregate({
      where: { accountId: account.id },
      _sum: { debit: true, credit: true },
    });
    return round2((agg._sum.credit ?? 0) - (agg._sum.debit ?? 0));
  }

  private async nextEntryNumberWithClient(db: DbClient): Promise<string> {
    const count = await db.journalEntry.count();
    const seq = String(count + 1).padStart(8, "0");
    return `JE-${seq}`;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const financialLedgerService = new FinancialLedgerService();
