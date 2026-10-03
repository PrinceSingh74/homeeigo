/**
 * Phase 09 — the frozen policy, end to end against the isolated test database.
 *
 * The claim that matters: a booking sold under one set of terms keeps those terms. Before this,
 * `calculate` always read the live constants, so editing the published policy silently re-priced the
 * refund of every booking ever placed. Here the booking's own snapshot is changed to terms that
 * differ from the platform's, and both the customer-facing quote and the money actually refunded are
 * checked to follow it.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { bookingService } from "../services/booking.service";
import { CANCELLATION_POLICY_VERSION } from "../services/cancellation-policy.service";

const RUN = `p09snap-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 3;

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function createBooking() {
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in created) || !created.booking) throw new Error(`create failed: ${JSON.stringify(created)}`);
  return created.booking.id as string;
}

async function quoteViaApi(bookingId: string) {
  const res = await app.handle(
    new Request(`http://localhost/api/bookings/${bookingId}/cancellation-quote`, {
      headers: { Authorization: `Bearer ${bearer(ctx.customerA)}` },
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  void futureSlot;
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("every new booking records the terms it was sold under", () => {
  test("the snapshot carries the policy version and the published tiers", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } });
    const snap = row.serviceConfigSnapshot as any;
    expect(snap?.policy?.cancellation?.version).toBe(CANCELLATION_POLICY_VERSION);
    const ids = (snap.policy.cancellation.tiers as Array<{ id: string }>).map((t) => t.id);
    expect(ids).toContain("free");
    expect(ids).toContain("late");
    // The id that could never be matched against the published list is gone.
    expect(ids).not.toContain("very_late");
  });

  test("the schedule decision is recorded too — the rules as they stood when it was allowed", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true, slotDurationMinutes: true } });
    const schedule = (row.serviceConfigSnapshot as any)?.schedule;
    expect(schedule?.timeZone).toBe("Asia/Kolkata");
    expect(schedule?.maximumAdvanceDays).toBe(30);
    expect(schedule?.slotDurationMinutes).toBe(row.slotDurationMinutes);
    expect(Array.isArray(schedule?.blackoutDates)).toBe(true);
  });
});

describe.serial("a later policy change cannot re-price a booking already placed", () => {
  test("the customer's quote follows the booking's frozen tiers, not the platform's current ones", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    // Paid, so the quote describes money: an UNPAID booking's quote carries no fee under any tier,
    // because its cancellation keeps none (coding-phase certification 2026-09-28).
    await payWithRealWallet(id, ctx.customerA.id);

    // Today's policy refunds 100% this far out. Freeze terms on THIS booking that do not.
    const before = await quoteViaApi(id);
    expect(before.status).toBe(200);
    expect(before.json.data.quote.tier).toBe("free");
    expect(before.json.data.quote.feePercent).toBe(0);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } });
    const snap = row.serviceConfigSnapshot as any;
    await prisma.booking.update({
      where: { id },
      data: {
        serviceConfigSnapshot: {
          ...snap,
          policy: {
            cancellation: {
              version: "cancellation.sold-under-these",
              tiers: [
                { id: "free", label: "Free", window: "more than 240h", feePercent: 0, refundPercent: 100, minHoursBefore: 240, boundary: "exclusive", message: "Free cancellation." },
                { id: "late", label: "Late", window: "under 240h", feePercent: 35, refundPercent: 65, minHoursBefore: 0, boundary: "inclusive", message: "35% fee applies." },
              ],
            },
          },
        },
      },
    });

    const after = await quoteViaApi(id);
    expect(after.status).toBe(200);
    expect(after.json.data.quote.tier).toBe("late");
    expect(after.json.data.quote.feePercent).toBe(35);
    expect(after.json.data.quote.message).toBe("35% fee applies.");
  });

  test("a booking whose snapshot is unreadable falls back to the live policy instead of failing", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { serviceConfigSnapshot: true } });
    await prisma.booking.update({
      where: { id },
      data: { serviceConfigSnapshot: { ...(row.serviceConfigSnapshot as any), policy: { cancellation: { version: 7 } } } },
    });
    const q = await quoteViaApi(id);
    expect(q.status).toBe(200);
    expect(q.json.data.quote.tier).toBe("free"); // the current policy, applied honestly
  });

  test("a booking created before snapshots existed still quotes, using the current policy", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    await prisma.booking.update({ where: { id }, data: { serviceConfigSnapshot: Prisma.DbNull } });
    const q = await quoteViaApi(id);
    expect(q.status).toBe(200);
    expect(q.json.data.quote.tier).toBe("free");
  });
});

describe.serial("the money follows the frozen policy, not only the quote", () => {
  test("a wallet-paid booking is refunded by the terms it was sold under", async () => {
    if (!dbOk) return;
    const id = await createBooking();
    await payWithRealWallet(id, ctx.customerA.id);
    const paid = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { finalAmount: true, serviceConfigSnapshot: true } });

    // Freeze terms on this booking that keep 35% — today's policy would refund all of it.
    await prisma.booking.update({
      where: { id },
      data: {
        serviceConfigSnapshot: {
          ...(paid.serviceConfigSnapshot as any),
          policy: {
            cancellation: {
              version: "cancellation.sold-under-these",
              tiers: [
                { id: "free", label: "Free", window: "more than 240h", feePercent: 0, refundPercent: 100, minHoursBefore: 240, boundary: "exclusive", message: "Free cancellation." },
                { id: "late", label: "Late", window: "under 240h", feePercent: 35, refundPercent: 65, minHoursBefore: 0, boundary: "inclusive", message: "35% fee applies." },
              ],
            },
          },
        },
      },
    });

    const walletBefore = (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { walletBalance: true } })).walletBalance;
    const result = await bookingService.cancel({ userId: ctx.customerA.id }, id, "policy snapshot test");
    if ("error" in result) throw new Error(`cancel failed: ${result.error}`);

    const expected = Math.round(paid.finalAmount * 0.65 * 100) / 100;
    expect(result.refundAmount).toBe(expected);
    expect(expected).toBeLessThan(paid.finalAmount);

    // The refund itself is dispatched detached from the cancellation transaction, so the credit is
    // not instantaneous — wait for the money rather than assuming it has already landed (asserting
    // the balance immediately read 0 and would have looked like a refund that never happened).
    let delta = 0;
    for (let i = 0; i < 60 && delta === 0; i++) {
      const now = (await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { walletBalance: true } })).walletBalance;
      delta = Math.round((now - walletBefore) * 100) / 100;
      if (delta === 0) await new Promise((r) => setTimeout(r, 250));
    }
    // Exactly the frozen policy's 65%, not the 100% the current published policy would have given.
    expect(delta).toBe(expected);
  });
});
