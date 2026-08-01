import { BackfillRunStatus, HCoinTxnType, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { financialLedgerService } from "./financial-ledger.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { AuditLogService } from "./audit-log.service";
import { COIN_TO_RUPEE } from "./hcoin.service";

export type BackfillType =
  | "WALLET_TOPUP"
  | "WALLET_DEBIT"
  | "REFERRAL_COMMISSION"
  | "GIFT_CARD"
  | "CASHBACK"
  | "HCOIN"
  | "PROVIDER_EARNING";

export const BACKFILL_TYPES: BackfillType[] = [
  "WALLET_TOPUP",
  "WALLET_DEBIT",
  "REFERRAL_COMMISSION",
  "GIFT_CARD",
  "CASHBACK",
  "HCOIN",
  "PROVIDER_EARNING",
];

type Counters = { scanned: number; backfilled: number; skipped: number; failed: number };

type IssueRow = { backfillType: string; recordId: string; outcome: string; detail?: string };

/**
 * Historical ledger backfill. Scans operational records that predate ledger
 * coverage, detects missing journals (by the same deterministic idempotency
 * keys the live code uses), and generates them — never duplicating existing ones.
 */
export class LedgerBackfillService {
  async run(opts: { types?: BackfillType[]; limit?: number; startedBy?: string } = {}) {
    const types = opts.types && opts.types.length ? opts.types : BACKFILL_TYPES;
    const limit = Math.min(opts.limit ?? 1000, 5000);

    const run = await prisma.ledgerBackfillRun.create({
      data: { types: types.join(","), status: BackfillRunStatus.RUNNING, startedBy: opts.startedBy ?? null },
    });

    const totals: Counters = { scanned: 0, backfilled: 0, skipped: 0, failed: 0 };
    const issues: IssueRow[] = [];
    const byType: Record<string, Counters> = {};

    try {
      for (const type of types) {
        const c: Counters = { scanned: 0, backfilled: 0, skipped: 0, failed: 0 };
        await this.runType(type, limit, c, issues);
        byType[type] = c;
        totals.scanned += c.scanned;
        totals.backfilled += c.backfilled;
        totals.skipped += c.skipped;
        totals.failed += c.failed;
      }

      // Persist a bounded set of issues for the admin issues view.
      if (issues.length) {
        await prisma.ledgerBackfillIssue.createMany({
          data: issues.slice(0, 2000).map((i) => ({
            runId: run.id,
            backfillType: i.backfillType,
            recordId: i.recordId,
            outcome: i.outcome,
            detail: i.detail ?? null,
          })),
        });
      }

      const completed = await prisma.ledgerBackfillRun.update({
        where: { id: run.id },
        data: {
          status: BackfillRunStatus.COMPLETED,
          recordsScanned: totals.scanned,
          recordsBackfilled: totals.backfilled,
          recordsSkipped: totals.skipped,
          recordsFailed: totals.failed,
          completedAt: new Date(),
          report: JSON.stringify({ byType, totals }),
        },
      });

      if (totals.backfilled > 0) recordFinancialMetric("ledger_backfill_total", totals.backfilled);
      await AuditLogService.success("LEDGER_BACKFILL_RUN", {
        userId: opts.startedBy ?? null,
        details: { runId: run.id, totals },
      });
      return completed;
    } catch (error) {
      await prisma.ledgerBackfillRun.update({
        where: { id: run.id },
        data: {
          status: BackfillRunStatus.FAILED,
          recordsScanned: totals.scanned,
          recordsBackfilled: totals.backfilled,
          recordsSkipped: totals.skipped,
          recordsFailed: totals.failed,
          completedAt: new Date(),
          report: JSON.stringify({ error: error instanceof Error ? error.message : String(error), byType, totals }),
        },
      });
      throw error;
    }
  }

  private async hasJournal(idempotencyKey: string): Promise<boolean> {
    const existing = await prisma.journalEntry.findUnique({ where: { idempotencyKey }, select: { id: true } });
    return Boolean(existing);
  }

  private async runType(type: BackfillType, limit: number, c: Counters, issues: IssueRow[]) {
    switch (type) {
      case "WALLET_TOPUP":
        return this.backfillWalletTopups(limit, c, issues);
      case "WALLET_DEBIT":
        return this.backfillWalletDebits(limit, c, issues);
      case "REFERRAL_COMMISSION":
        return this.backfillReferralCommissions(limit, c, issues);
      case "GIFT_CARD":
        return this.backfillGiftCards(limit, c, issues);
      case "CASHBACK":
        return this.backfillCashback(limit, c, issues);
      case "HCOIN":
        return this.backfillHcoin(limit, c, issues);
      case "PROVIDER_EARNING":
        return this.backfillProviderEarnings(limit, c, issues);
    }
  }

  private async backfillProviderEarnings(limit: number, c: Counters, issues: IssueRow[]) {
    const rows = await prisma.earning.findMany({
      select: { bookingId: true, grossAmount: true, commission: true, netEarning: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      if (!row.bookingId) continue;
      c.scanned++;
      const key = `provider_earning:${row.bookingId}`;
      try {
        if (await this.hasJournal(key)) {
          c.skipped++;
          continue;
        }
        await financialLedgerService.recordProviderEarning(
          row.bookingId,
          row.grossAmount,
          row.commission,
          row.netEarning,
        );
        c.backfilled++;
        issues.push({ backfillType: "PROVIDER_EARNING", recordId: row.bookingId, outcome: "BACKFILLED" });
      } catch (e) {
        c.failed++;
        issues.push({
          backfillType: "PROVIDER_EARNING",
          recordId: row.bookingId,
          outcome: "FAILED",
          detail: msg(e),
        });
      }
    }
  }

  private async backfillWalletTopups(limit: number, c: Counters, issues: IssueRow[]) {
    const rows = await prisma.walletTransaction.findMany({
      where: { type: WalletTxnType.CREDIT, status: WalletTxnStatus.COMPLETED, referenceType: "razorpay_order" },
      select: { id: true, amount: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      c.scanned++;
      const key = `wallet_topup:${row.id}`;
      try {
        if (await this.hasJournal(key)) {
          c.skipped++;
          continue;
        }
        await financialLedgerService.recordWalletTopUp(row.id, row.amount);
        c.backfilled++;
        issues.push({ backfillType: "WALLET_TOPUP", recordId: row.id, outcome: "BACKFILLED" });
      } catch (e) {
        c.failed++;
        issues.push({ backfillType: "WALLET_TOPUP", recordId: row.id, outcome: "FAILED", detail: msg(e) });
      }
    }
  }

  private async backfillWalletDebits(limit: number, c: Counters, issues: IssueRow[]) {
    const rows = await prisma.walletTransaction.findMany({
      where: {
        type: { in: [WalletTxnType.DEBIT, WalletTxnType.REVERSAL] },
        status: WalletTxnStatus.COMPLETED,
      },
      select: { id: true, amount: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      c.scanned++;
      const key = `wallet_debit:${row.id}`;
      try {
        if (await this.hasJournal(key)) {
          c.skipped++;
          continue;
        }
        await financialLedgerService.recordWalletDebit(row.id, Math.abs(row.amount));
        c.backfilled++;
        issues.push({ backfillType: "WALLET_DEBIT", recordId: row.id, outcome: "BACKFILLED" });
      } catch (e) {
        c.failed++;
        issues.push({ backfillType: "WALLET_DEBIT", recordId: row.id, outcome: "FAILED", detail: msg(e) });
      }
    }
  }

  private async backfillReferralCommissions(limit: number, c: Counters, issues: IssueRow[]) {
    const rows = await prisma.walletTransaction.findMany({
      where: { type: WalletTxnType.CREDIT, status: WalletTxnStatus.COMPLETED, referenceType: "referral_withdrawal" },
      select: { id: true, amount: true, userId: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      c.scanned++;
      const key = `referral_commission:${row.id}`;
      try {
        if (!row.userId) {
          c.skipped++;
          continue;
        }
        if (await this.hasJournal(key)) {
          c.skipped++;
          continue;
        }
        await financialLedgerService.recordReferralCommission({
          walletTxnId: row.id,
          referrerUserId: row.userId,
          amount: row.amount,
        });
        c.backfilled++;
        issues.push({ backfillType: "REFERRAL_COMMISSION", recordId: row.id, outcome: "BACKFILLED" });
      } catch (e) {
        c.failed++;
        issues.push({ backfillType: "REFERRAL_COMMISSION", recordId: row.id, outcome: "FAILED", detail: msg(e) });
      }
    }
  }

  private async backfillGiftCards(limit: number, c: Counters, issues: IssueRow[]) {
    const rows = await prisma.giftCard.findMany({
      where: { status: { in: ["ACTIVE", "REDEEMED", "EXPIRED"] } },
      select: { id: true, amount: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      c.scanned++;
      const key = `gift_card:${row.id}`;
      try {
        if (await this.hasJournal(key)) {
          c.skipped++;
          continue;
        }
        await financialLedgerService.recordGiftCardPurchase(row.id, row.amount);
        c.backfilled++;
        issues.push({ backfillType: "GIFT_CARD", recordId: row.id, outcome: "BACKFILLED" });
      } catch (e) {
        c.failed++;
        issues.push({ backfillType: "GIFT_CARD", recordId: row.id, outcome: "FAILED", detail: msg(e) });
      }
    }
  }

  private async backfillCashback(limit: number, c: Counters, issues: IssueRow[]) {
    const rows = await prisma.membershipCashback.findMany({
      where: { status: { in: ["CREDITED", "REDEEMED"] } },
      select: { id: true, amount: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      c.scanned++;
      const key = `cashback:${row.id}`;
      try {
        if (await this.hasJournal(key)) {
          c.skipped++;
          continue;
        }
        await financialLedgerService.recordCashback(row.id, row.amount);
        c.backfilled++;
        issues.push({ backfillType: "CASHBACK", recordId: row.id, outcome: "BACKFILLED" });
      } catch (e) {
        c.failed++;
        issues.push({ backfillType: "CASHBACK", recordId: row.id, outcome: "FAILED", detail: msg(e) });
      }
    }
  }

  private async backfillHcoin(limit: number, c: Counters, issues: IssueRow[]) {
    const rows = await prisma.hCoinTransaction.findMany({
      where: { type: { in: [HCoinTxnType.EARN, HCoinTxnType.REDEEM] } },
      select: { id: true, type: true, amount: true },
      take: limit,
      orderBy: { createdAt: "asc" },
    });
    for (const row of rows) {
      c.scanned++;
      const isEarn = row.type === HCoinTxnType.EARN;
      const key = isEarn ? `hcoin_earned:${row.id}` : `hcoin_redeemed:${row.id}`;
      const rupeeValue = Math.round(row.amount * COIN_TO_RUPEE);
      try {
        if (rupeeValue <= 0) {
          c.skipped++;
          continue;
        }
        if (await this.hasJournal(key)) {
          c.skipped++;
          continue;
        }
        if (isEarn) {
          await financialLedgerService.recordHcoinEarned(row.id, row.amount, rupeeValue);
        } else {
          await financialLedgerService.recordHcoinRedeemed(row.id, row.id, rupeeValue);
        }
        c.backfilled++;
        issues.push({ backfillType: "HCOIN", recordId: row.id, outcome: "BACKFILLED" });
      } catch (e) {
        c.failed++;
        issues.push({ backfillType: "HCOIN", recordId: row.id, outcome: "FAILED", detail: msg(e) });
      }
    }
  }

  async history(limit = 50) {
    return prisma.ledgerBackfillRun.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(limit, 200) });
  }

  async listIssues(runId?: string, limit = 200) {
    return prisma.ledgerBackfillIssue.findMany({
      where: runId ? { runId } : undefined,
      orderBy: { createdAt: "desc" },
      take: Math.min(limit, 1000),
    });
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export const ledgerBackfillService = new LedgerBackfillService();
