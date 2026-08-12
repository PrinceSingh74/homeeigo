/**
 * Release blocker wave 2 — execution-driven adversarial integration tests.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  BookingStatus,
  GiftCardStatus,
  WalletTxnStatus,
  SubscriptionInterval,
} from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  deleteBookingsForUsers,
  fixturePhone,
  bearer,
  futureSlot,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import {
  walletService,
  MAX_PENDING_WALLET_TOPUPS,
} from "../services/wallet.service";
import { observabilityService } from "../services/observability.service";
import app from "../index";

const RUN_ID = `w2-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
});

afterAll(
  async () => {
    if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
    await prisma.$disconnect();
  },
  60_000,
);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

async function seedPendingBooking(slotOffset = 200) {
  const slot = futureSlot(slotOffset);
  await prisma.booking.deleteMany({
    where: { providerId: ctx.providerId, scheduledDate: slot },
  });
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    scheduledDate: slot.toISOString(),
    addressId: ctx.addressAId,
  });
  expect("booking" in created).toBe(true);
  return { bookingId: created.booking!.id, slot };
}

describe.serial("Release blocker wave 2", () => {
  test("booking 50 concurrent accept — exactly 1 succeeds", async () => {
    if (skipIfNoDb()) return;
    const { bookingId } = await seedPendingBooking(200);

    const results = await Promise.all(
      Array.from({ length: 50 }, () => bookingService.accept(ctx.providerId, bookingId)),
    );

    const successes = results.filter((r) => r.ok);
    const failures = results.filter((r) => !r.ok);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(49);
    expect(results.filter((r) => r instanceof Error)).toHaveLength(0);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.status).toBe(BookingStatus.ACCEPTED);

    const notices = await prisma.notification.count({
      where: { userId: ctx.customerA.id, type: "booking_accepted", referenceId: bookingId },
    });
    expect(notices).toBe(1);

    await deleteBookingsForUsers([ctx.customerA.id]);
  }, 60_000);

  test("booking 100 concurrent accept — exactly 1 succeeds", async () => {
    if (skipIfNoDb()) return;
    const { bookingId } = await seedPendingBooking(210);

    const results = await Promise.all(
      Array.from({ length: 100 }, () => bookingService.accept(ctx.providerId, bookingId)),
    );

    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok).length).toBe(99);

    const active = await prisma.booking.count({
      where: { id: bookingId, status: BookingStatus.ACCEPTED },
    });
    expect(active).toBe(1);

    await deleteBookingsForUsers([ctx.customerA.id]);
  }, 90_000);

  test("booking accept vs cancel race — single terminal state", async () => {
    if (skipIfNoDb()) return;
    const { bookingId } = await seedPendingBooking(220);

    const [acceptResult, cancelResult] = await Promise.all([
      bookingService.accept(ctx.providerId, bookingId),
      bookingService.cancel({ userId: ctx.customerA.id }, bookingId, "Changed plans"),
    ]);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(row.status).not.toBe(BookingStatus.PENDING);
    const terminal: BookingStatus[] = [BookingStatus.ACCEPTED, BookingStatus.CANCELLED_BY_USER];
    expect(terminal.includes(row.status)).toBe(true);
    expect(acceptResult.ok || !("error" in cancelResult)).toBe(true);

    await deleteBookingsForUsers([ctx.customerA.id]);
  }, 60_000);

  test("booking accept vs reschedule race — no duplicate accepted slot", async () => {
    if (skipIfNoDb()) return;
    const { bookingId, slot } = await seedPendingBooking(230);
    const newSlot = new Date(slot.getTime() + 4 * 3_600_000);

    const [acceptResult, updateResult] = await Promise.all([
      bookingService.accept(ctx.providerId, bookingId),
      bookingService.update(ctx.customerA.id, bookingId, {
        scheduledDate: newSlot.toISOString(),
      }),
    ]);

    const row = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    if (acceptResult.ok) {
      expect(row.status).toBe(BookingStatus.ACCEPTED);
    } else if ("ok" in updateResult && updateResult.ok) {
      expect(row.scheduledDate.getTime()).toBe(newSlot.getTime());
    } else {
      expect(row.status).toBe(BookingStatus.PENDING);
    }

    await deleteBookingsForUsers([ctx.customerA.id]);
  }, 60_000);

  test("wallet idempotent payment intent replay", async () => {
    if (skipIfNoDb()) return;

    const user = await prisma.user.create({
      data: {
        email: `${RUN_ID}-wallet-idem@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "idem"),
        firstName: "Idem",
        lastName: "User",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
      },
    });

    try {
      const key = `idem-${RUN_ID}`;
      const first = await walletService.addMoney(user.id, 250, { idempotencyKey: key });
      const second = await walletService.addMoney(user.id, 250, { idempotencyKey: key });
      expect("razorpayOrderId" in first).toBe(true);
      expect("razorpayOrderId" in second).toBe(true);
      if ("razorpayOrderId" in first && "razorpayOrderId" in second) {
        expect(second.razorpayOrderId).toBe(first.razorpayOrderId);
      }
      expect(
        await prisma.walletTransaction.count({ where: { userId: user.id, idempotencyKey: key } }),
      ).toBe(1);
    } finally {
      await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("wallet blocks beyond max pending top-ups", async () => {
    if (skipIfNoDb()) return;

    const user = await prisma.user.create({
      data: {
        email: `${RUN_ID}-wallet-pending@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "pending-cap"),
        firstName: "Pending",
        lastName: "Cap",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
      },
    });

    try {
      for (let i = 0; i < MAX_PENDING_WALLET_TOPUPS; i++) {
        const r = await walletService.addMoney(user.id, 100);
        expect("razorpayOrderId" in r).toBe(true);
      }
      expect(await walletService.addMoney(user.id, 100)).toEqual({ error: "TOO_MANY_PENDING" });
      expect(await walletService.countActivePendingTopUps(user.id)).toBe(MAX_PENDING_WALLET_TOPUPS);
    } finally {
      await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }, 120_000);

  test("wallet expired pending cannot settle", async () => {
    if (skipIfNoDb()) return;

    const user = await prisma.user.create({
      data: {
        email: `${RUN_ID}-wallet-expired@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "wallet-exp"),
        firstName: "Expired",
        lastName: "Txn",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
      },
    });

    const txn = await prisma.walletTransaction.create({
      data: {
        transactionNumber: `WTX-${RUN_ID}-exp`,
        userId: user.id,
        amount: 400,
        walletBalanceBefore: 0,
        walletBalanceAfter: 0,
        type: "CREDIT",
        description: "Expired top-up",
        referenceId: `order_${RUN_ID}_exp`,
        referenceType: "razorpay_order",
        status: WalletTxnStatus.EXPIRED,
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const verify = await walletService.verifyTopUp(user.id, {
      razorpayOrderId: txn.referenceId!,
      razorpayPaymentId: `pay_${RUN_ID}`,
      razorpaySignature: "sig",
    });
    expect(verify).toEqual({ error: "EXPIRED" });

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(after.walletBalance).toBe(0);

    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test("wallet cleanup worker expires stale pending rows", async () => {
    if (skipIfNoDb()) return;

    const user = await prisma.user.create({
      data: {
        email: `${RUN_ID}-wallet-clean@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "wallet-clean"),
        firstName: "Clean",
        lastName: "Worker",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
      },
    });

    await prisma.walletTransaction.create({
      data: {
        transactionNumber: `WTX-${RUN_ID}-stale`,
        userId: user.id,
        amount: 50,
        walletBalanceBefore: 0,
        walletBalanceAfter: 0,
        type: "CREDIT",
        description: "Stale",
        referenceId: `order_${RUN_ID}_stale`,
        referenceType: "razorpay_order",
        status: WalletTxnStatus.PENDING,
        expiresAt: new Date(Date.now() - 120_000),
      },
    });

    const expired = await walletService.expireStalePendingTopUps();
    expect(expired).toBeGreaterThanOrEqual(1);

    const dash = await observabilityService.getHealthDashboard();
    expect(dash.serviceHealth.wallet).toBeDefined();
    expect(typeof dash.serviceHealth.wallet.pendingTopups).toBe("number");

    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test("HTTP subscription blocked for unverified email", async () => {
    if (skipIfNoDb()) return;

    const plan = await prisma.membershipPlan.create({
      data: {
        name: `Wave2 Plan ${RUN_ID}`,
        price: 999,
        interval: SubscriptionInterval.MONTHLY,
        isActive: true,
        sortOrder: 99,
      },
    });

    const unverified = await prisma.user.create({
      data: {
        email: `${RUN_ID}-unverified@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "unverified"),
        firstName: "Unverified",
        lastName: "User",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: false,
      },
    });

    const token = bearer(unverified);
    const orderRes = await app.handle(
      new Request("http://localhost/api/subscriptions/order", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      }),
    );
    expect(orderRes.status).toBe(403);

    const verifyRes = await app.handle(
      new Request("http://localhost/api/subscriptions/verify", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          razorpayOrderId: "order_x",
          razorpayPaymentId: "pay_x",
          razorpaySignature: "sig",
        }),
      }),
    );
    expect(verifyRes.status).toBe(403);

    await prisma.user.delete({ where: { id: unverified.id } });
    await prisma.membershipPlan.delete({ where: { id: plan.id } });
  });

  test("HTTP subscription succeeds for verified email", async () => {
    if (skipIfNoDb()) return;

    const plan = await prisma.membershipPlan.create({
      data: {
        name: `Wave2 Verified ${RUN_ID}`,
        price: 499,
        interval: SubscriptionInterval.MONTHLY,
        isActive: true,
        sortOrder: 98,
      },
    });

    const orderRes = await app.handle(
      new Request("http://localhost/api/subscriptions/order", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer(ctx.customerA)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ planId: plan.id }),
      }),
    );
    expect(orderRes.status).toBe(200);

    await prisma.userSubscription.deleteMany({ where: { userId: ctx.customerA.id, planId: plan.id } });
    await prisma.membershipPlan.delete({ where: { id: plan.id } });
  });

  test("HTTP gift card auth parity — unauthenticated blocked", async () => {
    if (skipIfNoDb()) return;

    const anon = await app.handle(
      new Request("http://localhost/api/giftcards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "HG-AAAA-BBBB-CCCC" }),
      }),
    );
    expect(anon.status).toBe(401);

    const verifyAnon = await app.handle(
      new Request("http://localhost/api/giftcards/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          razorpayOrderId: "o",
          razorpayPaymentId: "p",
          razorpaySignature: "s",
        }),
      }),
    );
    expect(verifyAnon.status).toBe(401);
  });

  test("HTTP gift card void is IDOR-safe and verify requires verified email", async () => {
    if (skipIfNoDb()) return;

    const card = await prisma.giftCard.create({
      data: {
        code: `HG-${RUN_ID.slice(-4).toUpperCase()}-TEST-CARD`,
        purchaserId: ctx.customerB.id,
        amount: 500,
        balance: 500,
        status: GiftCardStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const idorVoid = await app.handle(
      new Request(`http://localhost/api/giftcards/${card.id}/void`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer(ctx.customerA)}` },
      }),
    );
    expect(idorVoid.status).toBe(404);

    const unverified = await prisma.user.create({
      data: {
        email: `${RUN_ID}-gc-unverified@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "gc-unv"),
        firstName: "GC",
        lastName: "Unverified",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: false,
      },
    });

    const verifyBlocked = await app.handle(
      new Request("http://localhost/api/giftcards/verify", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer(unverified)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          razorpayOrderId: "order_x",
          razorpayPaymentId: "pay_x",
          razorpaySignature: "sig",
        }),
      }),
    );
    expect(verifyBlocked.status).toBe(403);

    await prisma.user.delete({ where: { id: unverified.id } });
    await prisma.giftCard.delete({ where: { id: card.id } });
  });

  test("gift card concurrent redemption — single debit", async () => {
    if (skipIfNoDb()) return;

    const card = await prisma.giftCard.create({
      data: {
        code: `HG-${RUN_ID.slice(-4).toUpperCase()}-RACE-CARD`,
        purchaserId: ctx.customerB.id,
        amount: 300,
        balance: 300,
        status: GiftCardStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });

    const { giftCardService } = await import("../services/gift-card.service");
    const results = await Promise.all(
      Array.from({ length: 10 }, () => giftCardService.redeem(ctx.customerA.id, card.code)),
    );

    const successes = results.filter((r) => "ok" in r && r.ok);
    const failures = results.filter((r) => "error" in r);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(9);

    const after = await prisma.giftCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(after.balance).toBe(0);
    expect(after.status).toBe(GiftCardStatus.REDEEMED);

    await prisma.giftCardTransaction.deleteMany({ where: { giftCardId: card.id } });
    await prisma.walletTransaction.deleteMany({ where: { referenceId: card.id } });
    await prisma.giftCard.delete({ where: { id: card.id } });
  }, 60_000);
});
