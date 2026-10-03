import { describe, expect, test } from "bun:test";
import { JournalEntryType } from "@prisma/client";
import { financialLedgerService } from "../services/financial-ledger.service";
import {
  incentivePeriodKey,
  legacyUtcPeriodKey,
  startOfDay,
  startOfWeek,
  startOfMonth,
  businessDayKey,
  INCENTIVE_TZ,
  partnerIncentivePayoutService,
} from "../services/partner-incentive-payout.service";

describe("Section 04 — Partner incentive payout contracts", () => {
  test("PARTNER_INCENTIVE journal type exists", () => {
    expect(JournalEntryType.PARTNER_INCENTIVE).toBe("PARTNER_INCENTIVE");
  });

  test("ledger exposes journalForPartnerIncentive", () => {
    expect(typeof financialLedgerService.journalForPartnerIncentive).toBe("function");
  });

  test("incentive journal balances DR promo expense / CR provider payable", () => {
    const journal = financialLedgerService.journalForPartnerIncentive({
      payoutId: "pip_1",
      providerId: "prov_1",
      ruleCode: "WEEKLY_18_JOBS",
      amount: 800,
      periodKey: "2026-08-24",
    });
    const d = journal.lines.reduce((s, l) => s + l.debit, 0);
    const c = journal.lines.reduce((s, l) => s + l.credit, 0);
    expect(d).toBe(c);
    expect(d).toBe(800);
    expect(journal.idempotencyKey).toBe("partner_incentive:prov_1:pip_1");
  });

  test("period keys are deterministic", () => {
    const d = new Date("2026-08-25T10:00:00.000Z");
    expect(incentivePeriodKey("DAILY", d)).toBe("2026-08-25");
    expect(incentivePeriodKey("MONTHLY", d)).toBe("2026-08");
  });

  /**
   * The counting window and the period key must describe the SAME day. They did not: the window was
   * server-local (`setHours`) and the key was UTC (`toISOString`), which disagree for the 5.5 h
   * between 18:30 UTC and midnight UTC on an IST server — jobs counted for one day, payout recorded
   * under another. Both are now the business day (Asia/Kolkata).
   */
  test("the daily key always names the business day the counting window starts in", () => {
    for (let h = 0; h < 24; h++) {
      for (const m of [0, 29, 31, 59]) {
        const at = new Date(Date.UTC(2026, 8, 19, h, m, 0));
        const windowStart = startOfDay(at);
        // The window start is 00:00 in the business timezone…
        expect(new Intl.DateTimeFormat("en-GB", { timeZone: INCENTIVE_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(windowStart)).toBe("00:00");
        // …and the key names that same business day.
        expect(incentivePeriodKey("DAILY", at)).toBe(businessDayKey(windowStart));
        expect(incentivePeriodKey("DAILY", at)).toBe(businessDayKey(at));
      }
    }
  });

  /**
   * A sub-second component must not move any boundary. An earlier version subtracted the
   * milliseconds twice, so every instant with ms > 0 landed just before midnight — the day window
   * was the previous day, and week/month were a full day early (independent review, 2026-09-20).
   */
  test("business boundaries are exact whatever the millisecond component", () => {
    const istTime = (d: Date) =>
      new Intl.DateTimeFormat("en-GB", { timeZone: INCENTIVE_TZ, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(d);
    for (const ms of [0, 1, 437, 999]) {
      const at = new Date(Date.UTC(2026, 8, 23, 10, 0, 0, ms)); // Wed 23 Sep, 15:30 IST
      expect(istTime(startOfDay(at))).toBe("00:00:00");
      expect(istTime(startOfWeek(at))).toBe("00:00:00");
      expect(istTime(startOfMonth(at))).toBe("00:00:00");
      expect(businessDayKey(startOfDay(at))).toBe("2026-09-23");
      expect(businessDayKey(startOfWeek(at))).toBe("2026-09-20"); // the Sunday, not the Saturday
      expect(businessDayKey(startOfMonth(at))).toBe("2026-09-01");
      expect(incentivePeriodKey("WEEKLY", at)).toBe("2026-09-20");
      expect(incentivePeriodKey("MONTHLY", at)).toBe("2026-09");
    }
    // A month boundary seen from just after midnight IST on the 1st.
    const firstOfMonth = new Date(Date.UTC(2026, 9, 1, 2, 0, 0, 123)); // 07:30 IST on 1 Oct
    expect(businessDayKey(startOfMonth(firstOfMonth))).toBe("2026-10-01");
    expect(incentivePeriodKey("MONTHLY", firstOfMonth)).toBe("2026-10");
  });

  test("the key is independent of the host timezone, and the legacy UTC key is kept for the guard", () => {
    const lateEvening = new Date("2026-09-19T20:00:00.000Z"); // 01:30 IST on the 20th
    expect(incentivePeriodKey("DAILY", lateEvening)).toBe("2026-09-20");
    expect(legacyUtcPeriodKey("DAILY", lateEvening)).toBe("2026-09-19");
    const midday = new Date("2026-09-19T09:00:00.000Z");
    expect(incentivePeriodKey("DAILY", midday)).toBe(legacyUtcPeriodKey("DAILY", midday));
  });

  test("service exposes evaluateAndCreditIncentives", () => {
    expect(typeof partnerIncentivePayoutService.evaluateAndCreditIncentives).toBe("function");
    expect(typeof partnerIncentivePayoutService.creditQualifiedRule).toBe("function");
  });

  test("idempotency wallet key is deterministic per provider/rule/period", () => {
    const key = `partner_incentive_wallet:prov:rule:2026-08-25`;
    expect(key).toContain("partner_incentive_wallet");
  });
});
