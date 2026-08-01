import { prisma } from "../lib/prisma";
import { HCoinTxnType, WalletTxnType, WalletTxnStatus, JournalEntryType } from "@prisma/client";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { financialLedgerService } from "./financial-ledger.service";
import { AuditLogService } from "./audit-log.service";
import { recordFinancialMetric } from "../lib/financial-metrics";

/** 1 H-Coin = ₹0.10. Minimum redemption keeps the ledger clean. */
export const COIN_TO_RUPEE = 0.1;
export const MIN_REDEEM_COINS = 100;

export type HCoinEvent = "BOOKING_COMPLETED" | "REVIEW_SUBMITTED" | "REFERRAL_QUALIFIED" | "PROMO";

const EVENT_REASON: Record<HCoinEvent, string> = {
  BOOKING_COMPLETED: "BOOKING",
  REVIEW_SUBMITTED: "REVIEW",
  REFERRAL_QUALIFIED: "REFERRAL",
  PROMO: "PROMO",
};

/** Default reward rules, seeded once. Admin can edit coin amounts / toggle. */
const DEFAULT_RULES: { event: HCoinEvent; label: string; coins: number }[] = [
  { event: "BOOKING_COMPLETED", label: "Booking completed", coins: 50 },
  { event: "REVIEW_SUBMITTED", label: "Review submitted", coins: 20 },
  { event: "REFERRAL_QUALIFIED", label: "Referral qualified", coins: 100 },
  { event: "PROMO", label: "Promotional bonus", coins: 0 },
];

export class HCoinService {
  async ensureRulesSeeded(): Promise<void> {
    const count = await prisma.hCoinReward.count();
    if (count > 0) return;
    await prisma.hCoinReward.createMany({ data: DEFAULT_RULES });
  }

  async wallet(userId: string) {
    return prisma.hCoinWallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
  }

  /**
   * Credit coins for an event, using the admin-configured rule. Idempotent per
   * (event, referenceId) so a booking/review can't be rewarded twice.
   */
  async earn(userId: string, event: HCoinEvent, referenceId?: string, description?: string): Promise<void> {
    const rule = await prisma.hCoinReward.findUnique({ where: { event } });
    if (!rule || !rule.isActive || rule.coins <= 0) return;
    const reason = EVENT_REASON[event];
    if (referenceId) {
      const dup = await prisma.hCoinTransaction.findFirst({
        where: { userId, reason, referenceId },
        select: { id: true },
      });
      if (dup) return; // already rewarded
    }
    const rupeeValue = Math.round(rule.coins * COIN_TO_RUPEE);
    const txn = await prisma.$transaction(async (tx) => {
      const wallet = await tx.hCoinWallet.upsert({
        where: { userId },
        create: { userId, balance: rule.coins, lifetimeEarned: rule.coins },
        update: { balance: { increment: rule.coins }, lifetimeEarned: { increment: rule.coins } },
      });
      const created = await tx.hCoinTransaction.create({
        data: {
          userId,
          type: HCoinTxnType.EARN,
          amount: rule.coins,
          reason,
          description: description ?? rule.label,
          referenceId,
          balanceAfter: wallet.balance,
        },
      });
      if (rupeeValue > 0) {
        await financialLedgerService.recordHcoinEarnedInTransaction(tx, created.id, rule.coins, rupeeValue);
      }
      return created;
    });
    void AuditLogService.success("HCOIN_EARNED", {
      userId,
      details: { hcoinTxnId: txn.id, coins: rule.coins, event, referenceId },
    });
    recordFinancialMetric("hcoin_earned_total", 1);
  }

  async history(userId: string, limit = 50) {
    return prisma.hCoinTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async summary(userId: string) {
    const wallet = await this.wallet(userId);
    return {
      balance: wallet.balance,
      lifetimeEarned: wallet.lifetimeEarned,
      lifetimeRedeemed: wallet.lifetimeRedeemed,
      coinValue: COIN_TO_RUPEE,
      minRedeem: MIN_REDEEM_COINS,
      redeemableValue: Math.floor(wallet.balance * COIN_TO_RUPEE),
    };
  }

  /** Redeem coins → credit ₹ to the main HOMIGO wallet (usable on any service / membership). */
  async redeem(userId: string, coins: number): Promise<{ ok: true; coinBalance: number; walletBalance: number; rupees: number } | { error: string }> {
    if (!Number.isInteger(coins) || coins <= 0) return { error: "INVALID_AMOUNT" };
    if (coins < MIN_REDEEM_COINS) return { error: "BELOW_MIN" };
    const wallet = await this.wallet(userId);
    if (coins > wallet.balance) return { error: "INSUFFICIENT_COINS" };
    const rupees = Math.floor(coins * COIN_TO_RUPEE);
    if (rupees <= 0) return { error: "BELOW_MIN" };

    const { rupeesToPaise } = await import("../lib/money-paise");
    const creditPaise = rupeesToPaise(rupees);

    const result = await prisma.$transaction(async (tx) => {
      const hw = await tx.hCoinWallet.update({
        where: { userId },
        data: { balance: { decrement: coins }, lifetimeRedeemed: { increment: coins } },
      });
      const hcoinTxn = await tx.hCoinTransaction.create({
        data: {
          userId,
          type: HCoinTxnType.REDEEM,
          amount: coins,
          reason: "REDEMPTION",
          description: `Redeemed ${coins} H-Coins → ₹${rupees} wallet credit`,
          balanceAfter: hw.balance,
        },
      });
      const user = await tx.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          walletBalance: { increment: rupees },
          walletBalancePaise: { increment: creditPaise },
        },
      });
      const walletTxn = await tx.walletTransaction.create({
        data: {
          transactionNumber: await nextWalletTxnNumber(),
          userId,
          amount: rupees,
          walletBalanceBefore: user?.walletBalance ?? 0,
          walletBalanceAfter: updated.walletBalance,
          type: WalletTxnType.CREDIT,
          description: "H-Coins redemption → wallet",
          referenceId: hcoinTxn.id,
          referenceType: "hcoin_redemption",
          status: WalletTxnStatus.COMPLETED,
        },
      });
      await financialLedgerService.recordJournalInTransaction(tx, {
        type: JournalEntryType.HCOIN_REDEEMED,
        referenceId: hcoinTxn.id,
        referenceType: "hcoin_transaction",
        idempotencyKey: `hcoin_redeemed:${hcoinTxn.id}`,
        description: `H-Coin redeemed → wallet ${walletTxn.id}`,
        lines: [
          { accountCode: "HCOIN_LIABILITY", debit: rupees, credit: 0 },
          { accountCode: "CUSTOMER_WALLET", debit: 0, credit: rupees },
        ],
      });
      await financialLedgerService.recordWalletTopUpInTransaction(tx, walletTxn.id, rupees);
      return {
        coinBalance: hw.balance,
        walletBalance: updated.walletBalance,
        hcoinTxnId: hcoinTxn.id,
        walletTxnId: walletTxn.id,
      };
    });
    void AuditLogService.success("HCOIN_REDEEMED", {
      userId,
      details: { hcoinTxnId: result.hcoinTxnId, coins, rupees },
    });
    recordFinancialMetric("hcoin_redeemed_total", 1);
    return { ok: true, coinBalance: result.coinBalance, walletBalance: result.walletBalance, rupees };
  }

  // ===== Admin =====
  async adminRules() {
    await this.ensureRulesSeeded();
    return prisma.hCoinReward.findMany({ orderBy: { event: "asc" } });
  }

  async adminUpdateRule(id: string, data: { coins?: number; isActive?: boolean }) {
    const rule = await prisma.hCoinReward.findUnique({ where: { id } });
    if (!rule) return null;
    return prisma.hCoinReward.update({ where: { id }, data });
  }

  /** Grant a promotional bonus to a specific user (admin). */
  async adminGrantPromo(userId: string, coins: number, note?: string): Promise<boolean> {
    if (!Number.isInteger(coins) || coins <= 0) return false;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return false;
    const txn = await prisma.$transaction(async (tx) => {
      const wallet = await tx.hCoinWallet.upsert({
        where: { userId },
        create: { userId, balance: coins, lifetimeEarned: coins },
        update: { balance: { increment: coins }, lifetimeEarned: { increment: coins } },
      });
      const created = await tx.hCoinTransaction.create({
        data: {
          userId,
          type: HCoinTxnType.EARN,
          amount: coins,
          reason: "PROMO",
          description: note ?? "Promotional bonus",
          balanceAfter: wallet.balance,
        },
      });
      const rupeeValue = Math.round(coins * COIN_TO_RUPEE);
      await financialLedgerService.recordJournalInTransaction(
        tx,
        financialLedgerService.journalForHcoinAdjusted(created.id, rupeeValue),
      );
      return created;
    });
    void AuditLogService.success("HCOIN_ADJUSTED", {
      userId,
      details: { hcoinTxnId: txn.id, coins, note },
    });
    recordFinancialMetric("hcoin_adjusted_total", 1);
    return true;
  }

  async adminAnalytics() {
    const [issuedAgg, redeemedAgg, holders, rules] = await Promise.all([
      prisma.hCoinTransaction.aggregate({ where: { type: HCoinTxnType.EARN }, _sum: { amount: true } }),
      prisma.hCoinTransaction.aggregate({ where: { type: HCoinTxnType.REDEEM }, _sum: { amount: true } }),
      prisma.hCoinWallet.count({ where: { balance: { gt: 0 } } }),
      this.adminRules(),
    ]);
    const issued = issuedAgg._sum.amount ?? 0;
    const redeemed = redeemedAgg._sum.amount ?? 0;
    return {
      totalIssued: issued,
      totalRedeemed: redeemed,
      outstanding: issued - redeemed,
      liabilityRupees: Math.floor((issued - redeemed) * COIN_TO_RUPEE),
      holders,
      rules,
    };
  }
}

export const hcoinService = new HCoinService();
