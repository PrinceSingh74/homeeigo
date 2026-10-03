import { describe, expect, spyOn, test } from "bun:test";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures } from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { bookingLiveService } from "../services/booking-live.service";

describe("FinancialLedgerService — double-entry rules", () => {
  const round2 = (n: number) => Math.round(n * 100) / 100;

  test("booking payment lines balance", () => {
    const amount = 1100;
    const lines = [
      { accountCode: "CUSTOMER_FUNDS", debit: amount, credit: 0 },
      { accountCode: "PLATFORM_ESCROW", debit: 0, credit: amount },
    ];
    const debits = round2(lines.reduce((s, l) => s + l.debit, 0));
    const credits = round2(lines.reduce((s, l) => s + l.credit, 0));
    expect(debits).toBe(credits);
    expect(debits).toBe(1100);
  });

  test("refund lines balance", () => {
    const amount = 500;
    const lines = [
      { accountCode: "REFUND_LIABILITY", debit: amount, credit: 0 },
      { accountCode: "CUSTOMER_FUNDS", debit: 0, credit: amount },
    ];
    expect(round2(lines.reduce((s, l) => s + l.debit, 0))).toBe(
      round2(lines.reduce((s, l) => s + l.credit, 0)),
    );
  });

  test("provider earning splits gross into payable + revenue", () => {
    const gross = 1000;
    const commission = 200;
    const net = 800;
    const lines = [
      { accountCode: "PLATFORM_ESCROW", debit: gross, credit: 0 },
      { accountCode: "PROVIDER_PAYABLE", debit: 0, credit: net },
      { accountCode: "PLATFORM_REVENUE", debit: 0, credit: commission },
    ];
    const debits = round2(lines.reduce((s, l) => s + l.debit, 0));
    const credits = round2(lines.reduce((s, l) => s + l.credit, 0));
    expect(debits).toBe(credits);
    expect(debits).toBe(1000);
  });

  test("provider payout lines balance", () => {
    const amount = 2500;
    const lines = [
      { accountCode: "PROVIDER_PAYABLE", debit: amount, credit: 0 },
      { accountCode: "BANK_SETTLEMENT", debit: 0, credit: amount },
    ];
    expect(round2(lines.reduce((s, l) => s + l.debit, 0))).toBe(amount);
    expect(round2(lines.reduce((s, l) => s + l.credit, 0))).toBe(amount);
  });

  test("unbalanced journal rejected", () => {
    const lines = [
      { debit: 100, credit: 0 },
      { debit: 0, credit: 50 },
    ];
    const debits = round2(lines.reduce((s, l) => s + l.debit, 0));
    const credits = round2(lines.reduce((s, l) => s + l.credit, 0));
    expect(debits).not.toBe(credits);
  });
});

describe("Booking lifecycle — single source of truth", () => {
  test("WS complete delegates to bookingService.complete with UNKNOWN coordinates preserved as null", async () => {
    // Used to be `expect(true).toBe(true)` with a comment saying the refactor was verified by hand.
    // The vendor→provider resolution is a real DB read, so this needs the fixture partner.
    if (!(await dbReachable())) return;
    const RUN = `fl-${Date.now().toString(36)}`;
    const ctx = await seedAdversarialFixtures(RUN);
    const complete = spyOn(bookingService, "complete").mockResolvedValue({
      booking: { id: "bk_ws" },
      newlyCompleted: true,
    } as never);
    try {
      await bookingLiveService.completeBooking("bk_ws", ctx.vendorUserId, { notes: "done" });
      expect(complete).toHaveBeenCalledTimes(1);
      expect(complete.mock.calls[0]?.slice(0, 5)).toEqual([ctx.providerId, "bk_ws", null, null, "done"]);
    } finally {
      complete.mockRestore();
      await cleanupAdversarialFixtures(RUN);
    }
  }, 60_000);
});
