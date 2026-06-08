import { HCoinTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { financialLedgerService } from "./financial-ledger.service";
import { AuditLogService } from "./audit-log.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { COIN_TO_RUPEE } from "./hcoin.service";

/**
 * H-Coin expiry accounting. Coins earned before the configurable expiry window
 * and not yet redeemed expire, reducing the user balance and recognising
 * promotional breakage revenue. This never touches the live earn/redeem flows.
 */
export class HCoinExpiryService {
  async getConfig() {
    return prisma.hCoinExpiryConfig.upsert({
      where: { singleton: true },
      create: { singleton: true, enabled: false, expiryDays: 365 },
      update: {},
    });
  }

  async updateConfig(input: { enabled?: boolean; expiryDays?: number }) {
    const config = await this.getConfig();
    return prisma.hCoinExpiryConfig.update({
      where: { id: config.id },
      data: {
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        ...(input.expiryDays !== undefined && input.expiryDays > 0 ? { expiryDays: Math.floor(input.expiryDays) } : {}),
      },
    });
  }

  /**
   * Compute coins eligible to expire for a user (FIFO): coins earned before the
   * cutoff that have not been consumed by lifetime redemptions, capped at the
   * current live balance.
   */
  private async expirableForUser(userId: string, cutoff: Date, balance: number, lifetimeRedeemed: number) {
    const earnedBeforeCutoff = await prisma.hCoinTransaction.aggregate({
      where: { userId, type: HCoinTxnType.EARN, createdAt: { lt: cutoff } },
      _sum: { amount: true },
    });
    const alreadyExpired = await prisma.hCoinTransaction.aggregate({
      where: { userId, type: HCoinTxnType.EXPIRE },
      _sum: { amount: true },
    });
    const aged = earnedBeforeCutoff._sum.amount ?? 0;
    const expired = alreadyExpired._sum.amount ?? 0;
    // Coins still alive from the aged tranche, after redemptions and prior expiries.
    const expirable = Math.max(0, aged - lifetimeRedeemed - expired);
    return Math.min(expirable, balance);
  }

  /** Run an expiry pass. `dryRun` reports without mutating balances/ledger. */
  async run(opts: { startedBy?: string; dryRun?: boolean } = {}) {
    const config = await this.getConfig();
    if (!config.enabled && !opts.dryRun) {
      throw new Error("EXPIRY_DISABLED");
    }
    const cutoff = new Date(Date.now() - config.expiryDays * 24 * 60 * 60 * 1000);

    const wallets = await prisma.hCoinWallet.findMany({
      where: { balance: { gt: 0 } },
      select: { userId: true, balance: true, lifetimeRedeemed: true },
    });

    let coinsExpired = 0;
    let walletsAffected = 0;

    const run = opts.dryRun
      ? null
      : await prisma.hCoinExpiryRun.create({ data: { startedBy: opts.startedBy ?? null } });

    for (const w of wallets) {
      const expirable = await this.expirableForUser(w.userId, cutoff, w.balance, w.lifetimeRedeemed);
      if (expirable <= 0) continue;

      walletsAffected++;
      coinsExpired += expirable;

      if (opts.dryRun || !run) continue;

      const rupeeValue = Math.round(expirable * COIN_TO_RUPEE * 100) / 100;
      const txn = await prisma.$transaction(async (tx) => {
        const updated = await tx.hCoinWallet.update({
          where: { userId: w.userId },
          data: { balance: { decrement: expirable } },
        });
        return tx.hCoinTransaction.create({
          data: {
            userId: w.userId,
            type: HCoinTxnType.EXPIRE,
            amount: expirable,
            reason: "EXPIRY",
            description: `H-Coins expired after ${config.expiryDays} days`,
            referenceId: run.id,
            balanceAfter: updated.balance,
          },
        });
      });

      if (rupeeValue > 0) {
        await financialLedgerService
          .recordHcoinExpired({
            idempotencyKey: `hcoin_expired:${txn.id}`,
            referenceId: txn.id,
            rupeeValue,
            coins: expirable,
          })
          .catch(() => undefined);
      }
      await AuditLogService.success("HCOIN_EXPIRED", {
        userId: w.userId,
        details: { hcoinTxnId: txn.id, coins: expirable, runId: run.id },
      });
      recordFinancialMetric("hcoin_expired_total", 1);
    }

    const rupeeValue = Math.round(coinsExpired * COIN_TO_RUPEE * 100) / 100;

    if (run) {
      await prisma.hCoinExpiryRun.update({
        where: { id: run.id },
        data: { coinsExpired, walletsAffected, rupeeValue },
      });
      await prisma.hCoinExpiryConfig.update({ where: { id: config.id }, data: { lastRunAt: new Date() } });
    }

    return { runId: run?.id ?? null, dryRun: Boolean(opts.dryRun), coinsExpired, walletsAffected, rupeeValue };
  }

  async report(limit = 50) {
    const [config, runs] = await Promise.all([
      this.getConfig(),
      prisma.hCoinExpiryRun.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 200) }),
    ]);
    const totalExpired = await prisma.hCoinTransaction.aggregate({
      where: { type: HCoinTxnType.EXPIRE },
      _sum: { amount: true },
    });
    const expiredCoins = totalExpired._sum.amount ?? 0;
    return {
      config,
      runs,
      totals: {
        coinsExpired: expiredCoins,
        breakageRevenue: Math.round(expiredCoins * COIN_TO_RUPEE * 100) / 100,
      },
    };
  }
}

export const hcoinExpiryService = new HCoinExpiryService();
