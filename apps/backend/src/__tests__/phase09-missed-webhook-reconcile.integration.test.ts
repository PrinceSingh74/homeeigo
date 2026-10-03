/**
 * Phase 09 — a booking payment whose `payment.captured` webhook never arrived.
 *
 * Gift cards and subscriptions were already reconciled from pending orders; booking payments were
 * not, so a lost webhook left the customer charged and the booking unpaid. The sweep asks the
 * gateway what it holds and hands any capture to the SAME path the webhook uses.
 *
 * The gateway is stubbed: these tests must never reach Razorpay, and what is under test is what the
 * platform does with the gateway's answer, not the gateway.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { PaymentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { bookingService } from "../services/booking.service";
import { paymentService } from "../services/payment.service";
import { razorpayService } from "../services/razorpay.service";

const RUN = `p09recon-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 3;
const restores: Array<() => void> = [];

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

/** A booking with an open gateway order, aged past the sweep's threshold. */
async function bookingAwaitingCapture(orderId: string) {
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in created) || !created.booking) throw new Error(`create failed: ${JSON.stringify(created)}`);
  const bookingId = created.booking.id;
  const amount = created.booking.finalAmount;
  const payment = await prisma.payment.create({
    data: {
      bookingId,
      userId: ctx.customerA.id,
      amount,
      amountPaise: BigInt(Math.round(amount * 100)),
      currency: "INR",
      status: PaymentStatus.PENDING,
      paymentMethod: "razorpay",
      razorpayOrderId: orderId,
      // Required and unique on the model: the platform's own guard against a duplicate payment row.
      idempotencyKey: paymentService.buildOrderIdempotencyKey(bookingId),
    },
  });
  // Older than the sweep's minimum age: a capture seconds old is the webhook's job, not the sweep's.
  await prisma.$executeRaw`UPDATE payments SET updated_at = NOW() - INTERVAL '30 minutes' WHERE id = ${payment.id}`;
  return { bookingId, paymentId: payment.id, amount };
}

/**
 * `isConfigured` is a prototype getter, which bun's spyOn cannot stub; an own property on the
 * instance shadows it and is removed again on restore.
 */
function stubConfigured(value: boolean) {
  Object.defineProperty(razorpayService, "isConfigured", { value, configurable: true });
  restores.push(() => { delete (razorpayService as unknown as Record<string, unknown>).isConfigured; });
}

/** Stub the gateway's answer for this run. */
function stubOrderPayments(map: Record<string, Array<{ id: string; status: string; amount?: number }>>) {
  const spy = spyOn(razorpayService, "fetchOrderPayments").mockImplementation(async (orderId: string) => map[orderId] ?? []);
  restores.push(() => spy.mockRestore());
  stubConfigured(true);
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
}, 120_000);

afterEach(() => {
  while (restores.length) restores.pop()!();
});

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("missed capture webhook", () => {
  test("a capture the gateway reports is settled through the webhook path", async () => {
    if (!dbOk) return;
    const orderId = `order_${RUN}_a`;
    const { paymentId, bookingId, amount } = await bookingAwaitingCapture(orderId);
    stubOrderPayments({ [orderId]: [{ id: `pay_${RUN}_a`, status: "captured", amount: Math.round(amount * 100) }] });

    const out = await paymentService.reconcilePendingBookingPayments(50, { paymentId });
    expect(out.settled).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.SUCCESS);
    expect(payment.razorpayPaymentId).toBe(`pay_${RUN}_a`);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.paymentStatus).toBe(PaymentStatus.SUCCESS);

    // Settled through the ledger, exactly as a webhook would — not a bare status flip.
    const journal = await prisma.journalEntry.findUnique({ where: { idempotencyKey: `booking_payment:${paymentId}` } });
    expect(journal).not.toBeNull();
  });

  test("running it again changes nothing — the second pass is ALREADY_RECONCILED", async () => {
    if (!dbOk) return;
    const orderId = `order_${RUN}_b`;
    const { paymentId, amount } = await bookingAwaitingCapture(orderId);
    stubOrderPayments({ [orderId]: [{ id: `pay_${RUN}_b`, status: "captured", amount: Math.round(amount * 100) }] });

    await paymentService.reconcilePendingBookingPayments(50, { paymentId });
    const afterFirst = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const journalsAfterFirst = await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${paymentId}` } });

    await prisma.$executeRaw`UPDATE payments SET updated_at = NOW() - INTERVAL '30 minutes' WHERE id = ${paymentId}`;
    await paymentService.reconcilePendingBookingPayments(50, { paymentId });

    const afterSecond = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(afterSecond.status).toBe(afterFirst.status);
    expect(afterSecond.razorpayPaymentId).toBe(afterFirst.razorpayPaymentId);
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${paymentId}` } })).toBe(journalsAfterFirst);
  });

  test("an order the gateway shows as UNPAID is left alone — expiry is an owner decision, not an inference", async () => {
    if (!dbOk) return;
    const orderId = `order_${RUN}_c`;
    const { paymentId, bookingId } = await bookingAwaitingCapture(orderId);
    stubOrderPayments({ [orderId]: [{ id: `pay_${RUN}_c`, status: "created" }] });

    const out = await paymentService.reconcilePendingBookingPayments(50, { paymentId });
    expect(out.unpaid).toBeGreaterThanOrEqual(1);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.PENDING);
    const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
    expect(booking.paymentStatus).not.toBe(PaymentStatus.SUCCESS);
  });

  test("a payment younger than the threshold is left to the webhook", async () => {
    if (!dbOk) return;
    const orderId = `order_${RUN}_d`;
    const { paymentId, amount } = await bookingAwaitingCapture(orderId);
    await prisma.$executeRaw`UPDATE payments SET updated_at = NOW() WHERE id = ${paymentId}`;
    stubOrderPayments({ [orderId]: [{ id: `pay_${RUN}_d`, status: "captured", amount: Math.round(amount * 100) }] });

    await paymentService.reconcilePendingBookingPayments(50, { paymentId });
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.status).toBe(PaymentStatus.PENDING);
  });

  test("with no gateway configured the sweep does nothing rather than guessing", async () => {
    if (!dbOk) return;
    const orderId = `order_${RUN}_e`;
    const { paymentId } = await bookingAwaitingCapture(orderId);
    stubConfigured(false);

    const out = await paymentService.reconcilePendingBookingPayments(50, { paymentId });
    expect(out).toEqual({ scanned: 0, settled: 0, unpaid: 0, errors: 0 });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(PaymentStatus.PENDING);
  });

  test("a gateway error is counted and logged, never treated as 'unpaid' or as settled", async () => {
    if (!dbOk) return;
    const orderId = `order_${RUN}_f`;
    const { paymentId } = await bookingAwaitingCapture(orderId);
    const spy = spyOn(razorpayService, "fetchOrderPayments").mockImplementation(async () => {
      throw new Error("gateway unreachable");
    });
    restores.push(() => spy.mockRestore());
    stubConfigured(true);

    const out = await paymentService.reconcilePendingBookingPayments(50, { paymentId });
    expect(out.errors).toBeGreaterThanOrEqual(1);
    expect(out.settled).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe(PaymentStatus.PENDING);
  });
});

describe.serial("the sweep is actually wired into the scheduled reconciliation", () => {
  test("reconcilePendingOrders calls the booking sweep and reports its result", async () => {
    if (!dbOk) return;
    stubConfigured(true);
    /**
     * The wiring itself is the subject. A sweep that exists but is never called from the scheduled
     * path recovers nothing in production while passing every test that calls it directly — so this
     * asserts the CALL, and does not depend on which rows the unscoped scan happens to reach in a
     * shared database.
     */
    const spy = spyOn(paymentService, "reconcilePendingBookingPayments").mockImplementation(async () => ({
      scanned: 3, settled: 2, unpaid: 1, errors: 0,
    }));
    restores.push(() => spy.mockRestore());

    const out = await paymentService.reconcilePendingOrders();
    expect(spy).toHaveBeenCalled();
    expect(out.bookings).toBe(2);
  });
});
