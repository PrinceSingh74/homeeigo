/**
 * Booking ↔ payment integrity — runs against the ISOLATED homigo_test DB (offline dev gateway).
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/booking-payment-integrity.integration.test.ts
 *
 * Payment is its own axis. Nothing that settles money may move the work lifecycle:
 *   - a cancelled booking stays cancelled when its money arrives late, and the money goes back;
 *   - paying a direct-provider booking does not accept it on the partner's behalf;
 *   - a split order's webhook settles BOTH legs, and a wallet shortfall returns the captured leg;
 *   - unpaid bookings never occupy the dispatcher's queue.
 * Every booking is paid through the real checkouts; nothing is written into `payments` by hand.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { provenanceForNewUser } from "../lib/data-provenance";
import "../load-env";
import prisma from "../lib/prisma";
import { razorpayService } from "../services/razorpay.service";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { paymentService } from "../services/payment.service";
import { bookingService } from "../services/booking.service";
import { bookingPriorityService } from "../services/booking-priority.service";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  seedAdversarialFixtures,
  type AdvCtx,
  deleteBookingsForUsers,
  purgeFixtureJournals,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `bpi-${Date.now().toString(36)}`;
let seq = 0;
let dbOk = false;
let ctx: AdvCtx;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 90_000);

/** Users this file creates itself, outside the adversarial fixture tag — cleaned up below. */
const ownUserIds: string[] = [];

afterAll(async () => {
  if (!dbOk) return;
  /**
   * `cleanupAdversarialFixtures` only removes the `adv-<run>` fixtures; the customers this file
   * creates directly were never cleaned, so every run left its bookings behind. 533 of them had
   * accumulated with `priorityScore: 1e9`, which eventually pushed a fresh run's own rows out of the
   * admin queue's top 50 and failed the assertion below against correct code.
   */
  // Their wallet/booking journals first, while the rows those journals reference still exist.
  await purgeFixtureJournals(ownUserIds).catch(() => {});
  await deleteBookingsForUsers(ownUserIds).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: ownUserIds } } }).catch(() => {});
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

async function customer(walletFunding = 0, opts: { providerId?: string; hoursAhead?: number } = {}) {
  seq++;
  const u = await prisma.user.create({
    data: {
      ...provenanceForNewUser(`${RUN}-${seq}@test.test`),
      email: `${RUN}-${seq}@test.test`,
      phoneNumber: `+9177${Math.floor(1e7 + Math.random() * 8.9e7)}`,
      firstName: "Bpi",
      lastName: `T${seq}`,
      password: "x".repeat(20),
      role: "CUSTOMER",
      walletBalance: 0,
    },
  });
  ownUserIds.push(u.id);
  if (walletFunding > 0) await fund(u.id, walletFunding);
  const s = await prisma.service.create({
    data: { name: `${RUN}-${seq}`, slug: `${RUN}-${seq}`, description: "x", category: "cleaning", basePrice: 1000, estimatedDuration: 60 },
  });
  const a = await prisma.address.create({
    data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
  });
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `BPI-${RUN}-${seq}`,
      userId: u.id,
      serviceId: s.id,
      addressId: a.id,
      providerId: opts.providerId ?? null,
      status: "PENDING",
      scheduledDate: new Date(Date.now() + (opts.hoursAhead ?? 72) * 3_600_000),
      baseAmount: 1000,
      finalAmount: 1000,
      totalAmount: 1000,
      paymentStatus: "PENDING",
    },
  });
  return { userId: u.id, bookingId: b.id };
}

async function fund(userId: string, amount: number) {
  const t = await walletService.addMoney(userId, amount);
  if ("error" in t) throw new Error(t.error);
  await walletService.verifyTopUp(userId, {
    razorpayOrderId: t.razorpayOrderId,
    razorpayPaymentId: `pay_${RUN}_topup_${userId.slice(-6)}_${seq}`,
    razorpaySignature: "sig",
  });
}

async function order(c: { userId: string; bookingId: string }) {
  const o = await paymentService.createOrder(c.userId, c.bookingId);
  if (!o || "error" in o) throw new Error(`createOrder: ${JSON.stringify(o)}`);
  return o.razorpayOrderId;
}

const pid = (tag: string) => `pay_${RUN}_${seq}_${tag}`;

function verify(c: { userId: string }, orderId: string, paymentId: string) {
  return paymentService.verify(c.userId, {
    razorpayOrderId: orderId,
    razorpayPaymentId: paymentId,
    razorpaySignature: razorpayService.computePaymentSignature(orderId, paymentId),
  });
}

const captured = (orderId: string, paymentId: string) =>
  paymentService.reconcileFromWebhook({ event: "payment.captured", payload: { payment: { entity: { id: paymentId, order_id: orderId } } } });

async function settled(bookingId: string) {
  for (let i = 0; i < 80; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") return;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Every rupee returned for a booking, across the gateway and the wallet. */
async function returned(bookingId: string, userId: string) {
  const payment = await prisma.payment.findUnique({ where: { bookingId } });
  const gateway = payment
    ? await prisma.refundRequest.findMany({ where: { paymentId: payment.id, status: "COMPLETED" } })
    : [];
  const wallet = await prisma.walletTransaction.findMany({ where: { referenceId: bookingId, userId, type: "REFUND", status: "COMPLETED" } });
  return {
    gateway: gateway.reduce((s, r) => s + r.amount, 0),
    wallet: wallet.reduce((s, t) => s + t.amount, 0),
    gatewayRequests: gateway.length,
  };
}

async function offersFor(bookingId: string) {
  return prisma.assignmentAttempt.count({ where: { job: { bookingId } } });
}

describe.serial("Phase 2 — a cancelled booking never resurrects on payment", () => {
  test("cancel → late client verify: stays CANCELLED, full refund, no dispatch", async () => {
    if (!dbOk) return;
    const c = await customer();
    const orderId = await order(c);
    const cancel = await bookingService.cancel({ userId: c.userId }, c.bookingId, "changed my mind");
    expect("error" in cancel).toBe(false);

    const v = await verify(c, orderId, pid("late"));
    expect("error" in v).toBe(false);
    await settled(c.bookingId);

    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(b.status).toBe("CANCELLED_BY_USER");
    expect(b.acceptedAt).toBeNull();
    expect(b.paymentStatus).toBe("SUCCESS");
    expect(["processing", "processed"].includes(b.refundStatus ?? "")).toBe(true);
    expect(await returned(c.bookingId, c.userId)).toMatchObject({ gateway: 1000, wallet: 0, gatewayRequests: 1 });
    expect(await offersFor(c.bookingId)).toBe(0);
  });

  test("cancel → late webhook, then a duplicate webhook: one refund, still CANCELLED", async () => {
    if (!dbOk) return;
    const c = await customer();
    const orderId = await order(c);
    await bookingService.cancel({ userId: c.userId }, c.bookingId, "cancel first");
    const p = pid("hook");
    expect((await captured(orderId, p)).handled).toBe(true);
    await settled(c.bookingId);
    expect(await captured(orderId, p)).toEqual({ handled: true, reason: "ALREADY_RECONCILED" });
    // The client's verify arriving after the webhook is the same payment, not a second one.
    expect("error" in (await verify(c, orderId, p))).toBe(false);

    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(b.status).toBe("CANCELLED_BY_USER");
    expect(await returned(c.bookingId, c.userId)).toMatchObject({ gateway: 1000, gatewayRequests: 1 });
    expect(await offersFor(c.bookingId)).toBe(0);
  });

  test("out-of-order payment.failed after capture never overwrites SUCCESS", async () => {
    if (!dbOk) return;
    const c = await customer();
    const orderId = await order(c);
    await verify(c, orderId, pid("ok"));
    const r = await paymentService.reconcileFromWebhook({ event: "payment.failed", payload: { payment: { entity: { id: pid("old"), order_id: orderId } } } });
    expect(r.handled).toBe(true);
    const p = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(p.status).toBe("SUCCESS");
    expect(b.paymentStatus).toBe("SUCCESS");
  });

  test("checkout cannot open for a cancelled booking (gateway, wallet, split, multi-source)", async () => {
    if (!dbOk) return;
    const c = await customer(2000);
    await bookingService.cancel({ userId: c.userId }, c.bookingId, "cancel");
    const before = (await prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).walletBalance;

    expect(await paymentService.createOrder(c.userId, c.bookingId)).toEqual({ error: "BOOKING_NOT_PAYABLE" });
    expect(await walletCheckoutService.payBookingFromWallet(c.userId, c.bookingId)).toEqual({ error: "BOOKING_NOT_PAYABLE" });
    expect(await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 400)).toEqual({ error: "BOOKING_NOT_PAYABLE" });
    expect(await walletCheckoutService.payMultiSource(c.userId, c.bookingId, {})).toEqual({ error: "BOOKING_NOT_PAYABLE" });

    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).walletBalance).toBe(before);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } })).status).toBe("CANCELLED_BY_USER");
  });

  test("split: initiated, then cancelled, then the gateway leg is verified → wallet untouched, gateway refunded", async () => {
    if (!dbOk) return;
    const c = await customer(400);
    const init = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 400);
    if (!("mode" in init) || init.mode !== "split") throw new Error(JSON.stringify(init));
    await bookingService.cancel({ userId: c.userId }, c.bookingId, "cancel mid-checkout");

    const p = pid("split");
    const v = await walletCheckoutService.verifySplit(c.userId, {
      razorpayOrderId: init.razorpayOrderId,
      razorpayPaymentId: p,
      razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, p),
    });
    expect("ok" in v && v.walletApplied).toBe(0);
    await settled(c.bookingId);

    const u = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    expect(u.walletBalance).toBe(400);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(b.status).toBe("CANCELLED_BY_USER");
    expect(await returned(c.bookingId, c.userId)).toMatchObject({ gateway: 600, wallet: 0 });
  });

  test("split order settled through the GENERIC verify still charges the wallet leg (no ₹1-for-₹1000 bypass)", async () => {
    if (!dbOk) return;
    // Customer holds ₹999, splits a ₹1000 booking: gateway order is only the ₹1 remainder.
    const c = await customer(999);
    const init = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 999);
    if (!("mode" in init) || init.mode !== "split") throw new Error(JSON.stringify(init));
    const p = pid("split-generic");
    // The client calls /api/payments/verify (paymentService.verify), not the split verify.
    const v = await paymentService.verify(c.userId, {
      razorpayOrderId: init.razorpayOrderId,
      razorpayPaymentId: p,
      razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, p),
    });
    expect("error" in v).toBe(false);
    await settled(c.bookingId);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    // The split settlement ran: wallet leg debited, booking paid in full (₹999 wallet + ₹1 gateway).
    expect(b.paymentStatus).toBe("SUCCESS");
    expect(u.walletBalance).toBe(0);
    expect(await returned(c.bookingId, c.userId)).toMatchObject({ gateway: 0, wallet: 0 });
  });

  test("concurrent cancel + verify (×6): always CANCELLED, always exactly one full refund", async () => {
    if (!dbOk) return;
    for (let i = 0; i < 6; i++) {
      const c = await customer();
      const orderId = await order(c);
      const p = pid(`race${i}`);
      const [cancel, pay] = await Promise.all([
        bookingService.cancel({ userId: c.userId }, c.bookingId, "race"),
        verify(c, orderId, p),
      ]);
      expect("error" in cancel).toBe(false);
      expect("error" in pay).toBe(false);
      await settled(c.bookingId);
      const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
      expect(b.status).toBe("CANCELLED_BY_USER");
      expect(b.paymentStatus).toBe("SUCCESS");
      expect(await returned(c.bookingId, c.userId)).toMatchObject({ gateway: 1000, gatewayRequests: 1 });
      expect(await offersFor(c.bookingId)).toBe(0);
    }
  }, 120_000);
});

describe.serial("split settlement through the webhook", () => {
  test("webhook-first capture debits the wallet leg too (was: booking paid with the wallet share never charged)", async () => {
    if (!dbOk) return;
    const c = await customer(400);
    const init = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 400);
    if (!("mode" in init) || init.mode !== "split") throw new Error(JSON.stringify(init));
    const p = pid("splithook");
    expect(await captured(init.razorpayOrderId, p)).toEqual({ handled: true, reason: "RECONCILED" });

    const u = await prisma.user.findUniqueOrThrow({ where: { id: c.userId } });
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(u.walletBalance).toBe(0);
    expect(b.paymentStatus).toBe("SUCCESS");
    expect(b.paymentMethod).toBe("wallet_razorpay_split");
    // The client's verify afterwards is idempotent, not a second debit.
    const v = await walletCheckoutService.verifySplit(c.userId, {
      razorpayOrderId: init.razorpayOrderId,
      razorpayPaymentId: p,
      razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, p),
    });
    expect("ok" in v).toBe(true);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).walletBalance).toBe(0);
    const debits = await prisma.walletTransaction.count({ where: { referenceId: c.bookingId, type: "DEBIT", status: "COMPLETED" } });
    expect(debits).toBe(1);
  });

  test("wallet shortfall at settlement: booking stays unpaid, captured gateway leg is returned in full", async () => {
    if (!dbOk) return;
    const c = await customer(400);
    const init = await walletCheckoutService.initiateSplit(c.userId, c.bookingId, 400);
    if (!("mode" in init) || init.mode !== "split") throw new Error(JSON.stringify(init));
    // The wallet is spent elsewhere between initiate and the gateway callback — through the real
    // wallet checkout (a direct balance write would break the wallet ledger chain it is testing around).
    const other = await prisma.booking.create({
      data: {
        bookingNumber: `BPI-${RUN}-${seq}-other`, userId: c.userId,
        serviceId: (await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } })).serviceId,
        addressId: (await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } })).addressId,
        status: "PENDING", scheduledDate: new Date(Date.now() + 150 * 3_600_000),
        baseAmount: 300, finalAmount: 300, totalAmount: 300, paymentStatus: "PENDING",
      },
    });
    expect("ok" in (await walletCheckoutService.payBookingFromWallet(c.userId, other.id))).toBe(true);

    const p = pid("short");
    const v = await walletCheckoutService.verifySplit(c.userId, {
      razorpayOrderId: init.razorpayOrderId,
      razorpayPaymentId: p,
      razorpaySignature: razorpayService.computePaymentSignature(init.razorpayOrderId, p),
    });
    expect(v).toEqual({ error: "WALLET_DEBIT_FAILED" });
    for (let i = 0; i < 50; i++) {
      if ((await returned(c.bookingId, c.userId)).gateway > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(b.paymentStatus).toBe("FAILED");
    expect(b.status).toBe("PENDING");
    expect((await prisma.user.findUniqueOrThrow({ where: { id: c.userId } })).walletBalance).toBe(100);
    expect(await returned(c.bookingId, c.userId)).toMatchObject({ gateway: 600, wallet: 0 });
    // Nothing is left for the backstop sweep.
    expect((await walletCheckoutService.recoverSplitShortfallRefunds()).started).toBe(0);
  });
});

describe.serial("Phase 4 — paying is not accepting", () => {
  test("direct-provider booking: payment settles money only; the partner still has to accept", async () => {
    if (!dbOk) return;
    const c = await customer(0, { providerId: ctx.providerId, hoursAhead: 200 + Math.floor(Math.random() * 100) });
    const orderId = await order(c);
    await verify(c, orderId, pid("direct"));
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(b.paymentStatus).toBe("SUCCESS");
    expect(b.status).toBe("PENDING");
    expect(b.acceptedAt).toBeNull();
  });

  test("wallet-paid direct-provider booking: same", async () => {
    if (!dbOk) return;
    const c = await customer(1000, { providerId: ctx.providerId, hoursAhead: 320 + Math.floor(Math.random() * 100) });
    const r = await walletCheckoutService.payBookingFromWallet(c.userId, c.bookingId);
    expect("ok" in r).toBe(true);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
    expect(b.status).toBe("PENDING");
    expect(b.acceptedAt).toBeNull();
  });
});

describe.serial("Phase 5 — unpaid bookings never occupy the dispatcher queue", () => {
  test("12 old unpaid bookings ahead of one paid booking: the dispatcher sees only the paid one", async () => {
    if (!dbOk) return;
    const unpaid: string[] = [];
    for (let i = 0; i < 12; i++) {
      const c = await customer(0, { hoursAhead: 500 + i });
      await prisma.booking.update({
        where: { id: c.bookingId },
        data: { priorityScore: 1e9, queuedAt: new Date(Date.now() - 86_400_000 * (30 - i)) },
      });
      unpaid.push(c.bookingId);
    }
    const paid = await customer(1000, { hoursAhead: 600 });
    await walletCheckoutService.payBookingFromWallet(paid.userId, paid.bookingId);
    await prisma.booking.update({ where: { id: paid.bookingId }, data: { priorityScore: 1e9, queuedAt: new Date() } });

    const queue = await bookingPriorityService.getAssignmentQueue(10, { dispatchableOnly: true });
    const ids = queue.map((q) => q.bookingId);
    expect(ids).toContain(paid.bookingId);
    for (const u of unpaid) expect(ids).not.toContain(u);
    // The admin view still lists unpaid work.
    const all = (await bookingPriorityService.getAssignmentQueue(50)).map((q) => q.bookingId);
    expect(unpaid.some((u) => all.includes(u))).toBe(true);
  });
});
