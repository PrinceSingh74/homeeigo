import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { MembershipCouponStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  deleteBookingsForUsers,
  futureSlot,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { membershipCouponService } from "../services/membership-coupon.service";
import { quoteTokenForUser } from "./helpers/quote-token";

/**
 * Booking creation runs at READ COMMITTED, not SERIALIZABLE (booking.service.ts `create()`).
 *
 * Measured on 2026-09-21: at SERIALIZABLE, 48% of first attempts aborted with P2034 between
 * creators that shared no user, no provider and no slot — the conflict scan is a bitmap heap scan
 * and SSI predicate locks are page-granular, so every concurrent insert into `bookings` conflicted
 * with every other creator's read. The retry ladder (40 ms · 2^n, up to 8 attempts) WAS the p99:
 * booking_create p95 2.81 s → 302 ms and p99 7.31 s → 398 ms once the level changed, with P2034
 * going 1,143 → 0 over the same 60-second profile.
 *
 * Dropping an isolation level is only safe if nothing depended on it. These tests pin the two
 * guarantees that did, so a future change cannot quietly lose them:
 *
 *   1. one active booking per user slot, under concurrency — held by the GiST exclusion constraints
 *      and the FOR UPDATE scans, both of which work at any isolation level;
 *   2. a membership coupon's redemption cap, which WAS protected by SSI alone and is now protected
 *      by an explicit row lock in `consumeInTransaction`.
 *
 * Without that row lock this file's third test over-redeems: concurrent redemptions each read
 * `redemptionCount = max - 1` and each increment.
 */
const RUN = `iso-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;
let couponId = "";

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 120_000);

afterAll(async () => {
  if (!reachable) return;
  if (couponId) {
    await prisma.membershipCouponRedemption.deleteMany({ where: { couponId } });
    await prisma.membershipCoupon.deleteMany({ where: { id: couponId } });
  }
  await cleanupAdversarialFixtures(RUN);
}, 120_000);

describe("booking create at READ COMMITTED keeps the guarantees SSI used to provide", () => {
  it("the create transaction is READ COMMITTED (the level is a decision, not a default)", async () => {
    const src = await Bun.file("D:/homigo/apps/backend/src/services/booking.service.ts").text();
    const create = src.slice(src.indexOf("  async create("), src.indexOf("  private async notifyBookingConfirmation"));
    expect(create).toContain('isolationLevel: "ReadCommitted"');
    expect(create).not.toContain('isolationLevel: "Serializable"');
  });

  it("concurrent creates for ONE user slot still yield exactly one booking", async () => {
    if (!reachable) return;
    const slot = futureSlot(300);
    await deleteBookingsForUsers([ctx.customerA.id]);

    // Same user, same instant, eight ways at once: the user slot exclusion constraint is the only
    // thing standing between this and a double booking once SSI is gone.
    const { bookingService } = await import("../services/booking.service");
    // Booking create requires a price quote: ONE token, fetched before the race (it is bound to the
    // user and the selection, not the slot) and sent by all eight, so the race itself is unchanged.
    const quoteToken = await quoteTokenForUser(ctx.customerA.id, { serviceId: ctx.serviceId, addressId: ctx.addressAId });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        bookingService.create(ctx.customerA.id, {
          serviceId: ctx.serviceId,
          scheduledDate: slot.toISOString(),
          addressId: ctx.addressAId,
          quoteToken,
        }),
      ),
    );

    const created = results.filter((r) => "booking" in r);
    const refused = results.filter((r) => "error" in r);
    expect(created.length).toBe(1);
    expect(refused.length).toBe(7);
    /**
     * Every refusal is a typed answer, never a raw constraint error leaking out.
     *
     * POOL_BUSY belongs in this list and is not a weakening: `.env.test` pins connection_limit=5 so
     * that dozens of parallel test files cannot exhaust Postgres, and eight simultaneous creates
     * exceed that on purpose. It is backpressure — the request was never served — which says nothing
     * about slot exclusivity. The exclusivity claim is carried by `created.length` and by the stored
     * count below, both of which must be exactly 1 however the other seven were turned away.
     */
    for (const r of refused) {
      expect(["OVERLAPPING_BOOKING", "PROVIDER_UNAVAILABLE", "POOL_BUSY"]).toContain((r as { error: string }).error);
    }

    const stored = await prisma.booking.count({
      where: {
        userId: ctx.customerA.id,
        scheduledDate: slot,
        status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
      },
    });
    expect(stored).toBe(1);
  }, 120_000);

  it("a coupon's redemption cap holds when redemptions race (the guarantee SSI used to give)", async () => {
    if (!reachable) return;
    const MAX = 3;
    const RACERS = 10;
    const coupon = await prisma.membershipCoupon.create({
      data: {
        code: `ISO${RUN.replace(/[^a-z0-9]/gi, "").slice(0, 12).toUpperCase()}`,
        name: `Isolation coupon ${RUN}`,
        status: MembershipCouponStatus.ACTIVE,
        discountPct: 10,
        perUserLimit: RACERS, // per-user limit is not what this test is about
        maxRedemptions: MAX,
      },
    });
    couponId = coupon.id;

    // Real bookings: `membership_coupon_redemptions.booking_id` is a foreign key, so the race has to
    // be run against rows that exist. Distinct slots, so the user slot exclusion constraint (tested
    // above) does not refuse them.
    const bookings = await Promise.all(
      Array.from({ length: RACERS }, async (_, i) => {
        const b = await prisma.booking.create({
          data: {
            bookingNumber: `ISO-${RUN}-${i}`,
            userId: ctx.customerA.id,
            serviceId: ctx.serviceId,
            addressId: ctx.addressAId,
            status: "PENDING",
            scheduledDate: futureSlot(400 + i * 3),
            baseAmount: 100,
            finalAmount: 90,
            totalAmount: 90,
            taxes: 0,
          },
        });
        return b.id;
      }),
    );

    // Ten separate transactions redeem the same coupon at once, each for a different booking so the
    // idempotency key cannot collapse them. Only MAX may succeed.
    const outcomes = await Promise.all(
      bookings.map((bookingId) =>
        prisma
          .$transaction(
            (tx) =>
              membershipCouponService.consumeInTransaction(tx, coupon.id, ctx.customerA.id, bookingId, 10, 100, 90),
            // Booking create itself uses this budget (booking.service.ts, maxWait 30s / timeout 45s).
            // Prisma's 5s default expired in the full suite while later racers were still queued on
            // the coupon row lock: 3 commits succeeded (the cap), and 3 waiters aborted with
            // "Transaction already closed" instead of MAX_REDEMPTIONS. Those aborts do not redeem.
            // Matching the production budget lets every waiter reach the cap check.
            { maxWait: 30_000, timeout: 45_000 },
          )
          .then(() => "ok" as const)
          .catch((e: unknown) => (e instanceof Error ? e.message : String(e))),
      ),
    );

    const ok = outcomes.filter((o) => o === "ok").length;
    const capped = outcomes.filter((o) => o === "MAX_REDEMPTIONS").length;
    expect(ok).toBe(MAX);
    expect(capped).toBe(RACERS - MAX);

    const after = await prisma.membershipCoupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(after.redemptionCount).toBe(MAX);
    const rows = await prisma.membershipCouponRedemption.count({ where: { couponId: coupon.id } });
    expect(rows).toBe(MAX);
  }, 120_000);
});
