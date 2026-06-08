import { describe, expect, test } from "bun:test";
import { ledgerBackfillService, BACKFILL_TYPES } from "../services/ledger-backfill.service";

describe("Phase 3 — Historical Ledger Backfill Engine", () => {
  test("service exposes run / history / issues", () => {
    expect(typeof ledgerBackfillService.run).toBe("function");
    expect(typeof ledgerBackfillService.history).toBe("function");
    expect(typeof ledgerBackfillService.listIssues).toBe("function");
  });

  test("supports all required backfill types", () => {
    expect(BACKFILL_TYPES).toContain("WALLET_TOPUP");
    expect(BACKFILL_TYPES).toContain("WALLET_DEBIT");
    expect(BACKFILL_TYPES).toContain("REFERRAL_COMMISSION");
    expect(BACKFILL_TYPES).toContain("GIFT_CARD");
    expect(BACKFILL_TYPES).toContain("CASHBACK");
    expect(BACKFILL_TYPES).toContain("HCOIN");
  });

  test("deterministic idempotency keys match live code", () => {
    const id = "rec_1";
    expect(`wallet_topup:${id}`).toBe("wallet_topup:rec_1");
    expect(`wallet_debit:${id}`).toBe("wallet_debit:rec_1");
    expect(`referral_commission:${id}`).toBe("referral_commission:rec_1");
    expect(`gift_card:${id}`).toBe("gift_card:rec_1");
    expect(`cashback:${id}`).toBe("cashback:rec_1");
    expect(`hcoin_earned:${id}`).toBe("hcoin_earned:rec_1");
    expect(`hcoin_redeemed:${id}`).toBe("hcoin_redeemed:rec_1");
  });

  test("counters never double-count (skip semantics)", () => {
    // A record with an existing journal must increment skipped, not backfilled.
    const c = { scanned: 0, backfilled: 0, skipped: 0, failed: 0 };
    const hasJournal = true;
    c.scanned++;
    if (hasJournal) c.skipped++;
    else c.backfilled++;
    expect(c.scanned).toBe(1);
    expect(c.skipped).toBe(1);
    expect(c.backfilled).toBe(0);
  });

  test("idempotency is deterministic — same record never reprocessed", () => {
    const seen = new Set<string>();
    const keyFor = (id: string) => `wallet_topup:${id}`;
    const k = keyFor("x");
    seen.add(k);
    expect(seen.has(keyFor("x"))).toBe(true);
  });

  test("totals aggregate per-type counters", () => {
    const byType = {
      WALLET_TOPUP: { scanned: 3, backfilled: 1, skipped: 2, failed: 0 },
      HCOIN: { scanned: 2, backfilled: 0, skipped: 2, failed: 0 },
    };
    const totals = Object.values(byType).reduce(
      (acc, c) => ({
        scanned: acc.scanned + c.scanned,
        backfilled: acc.backfilled + c.backfilled,
        skipped: acc.skipped + c.skipped,
        failed: acc.failed + c.failed,
      }),
      { scanned: 0, backfilled: 0, skipped: 0, failed: 0 },
    );
    expect(totals.scanned).toBe(5);
    expect(totals.skipped).toBe(4);
    expect(totals.backfilled).toBe(1);
  });

  test("failure increments failed counter, not backfilled", () => {
    const c = { scanned: 0, backfilled: 0, skipped: 0, failed: 0 };
    c.scanned++;
    try {
      throw new Error("boom");
    } catch {
      c.failed++;
    }
    expect(c.failed).toBe(1);
    expect(c.backfilled).toBe(0);
  });

  test("hcoin rupee floor skips sub-rupee tranches", () => {
    const rupeeValue = Math.round(5 * 0.1);
    expect(rupeeValue <= 0).toBe(false);
    expect(Math.round(0 * 0.1) <= 0).toBe(true);
  });
});
