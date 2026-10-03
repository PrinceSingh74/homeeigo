/**
 * Phase 23 — document numbers are unique under concurrency (ISOLATED homigo_test DB).
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/document-numbers.concurrency.test.ts
 *
 * The generators used to read the day's highest number and add one; concurrent creates minted the
 * same number. They now bump one `document_sequences` row per (scope, day) atomically.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { nextBookingNumber, nextWalletTxnNumber, nextWithdrawalNumber } from "../lib/booking-number";
import { dbReachable } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const PRODUCTION_BOOKING_NUMBER = /^HOMIGO-\d{8}-\d{5}$/;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
});

describe("document numbers", () => {
  test("150 concurrent booking numbers: all unique, all in the production format", async () => {
    if (!dbOk) return;
    const nums = await Promise.all(Array.from({ length: 150 }, () => nextBookingNumber()));
    expect(new Set(nums).size).toBe(150);
    for (const n of nums) expect(n).toMatch(PRODUCTION_BOOKING_NUMBER);
  });

  test("100 concurrent wallet + 100 withdrawal numbers: unique per scope", async () => {
    if (!dbOk) return;
    const [w, d] = await Promise.all([
      Promise.all(Array.from({ length: 100 }, () => nextWalletTxnNumber())),
      Promise.all(Array.from({ length: 100 }, () => nextWithdrawalNumber())),
    ]);
    expect(new Set(w).size).toBe(100);
    expect(new Set(d).size).toBe(100);
    for (const n of w) expect(n).toMatch(/^WXN-\d{8}-\d{5,}$/);
  });

  test("the first number of a day continues after numbers the old generator already minted", async () => {
    if (!dbOk) return;
    const ymd = new Date().toISOString().slice(0, 10);
    // Simulate a mid-day deploy: no counter row yet, but bookings already exist today.
    await prisma.$executeRaw`DELETE FROM document_sequences WHERE scope = 'booking' AND day = ${ymd}::date`;
    const existing = await prisma.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(SUBSTRING(booking_number FROM '^HOMIGO-[0-9]{8}-([0-9]{5})$')::int) AS max
      FROM bookings WHERE booking_number LIKE ${"HOMIGO-" + ymd.replace(/-/g, "") + "-%"}`;
    const next = await nextBookingNumber();
    expect(Number(next.slice(-5))).toBe(Number(existing[0]?.max ?? 0) + 1);
  });
});
