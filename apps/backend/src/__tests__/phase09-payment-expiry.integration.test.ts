/**
 * Phase 09 — PAYMENT_PENDING_TTL (owner decision 2026-09-23: 15 minutes).
 *
 * An unpaid booking used to hold a partner's slot for ever. Now the window closes, the booking
 * becomes EXPIRED and the capacity is released — and the things that must NOT happen are asserted as
 * hard as the things that must:
 *
 *   * a booking that has been PAID is never expired, even if it is old;
 *   * a booking a partner already ACCEPTED is not expired by this sweep (that is a different
 *     business event, and an owner decision);
 *   * a capture arriving AFTER expiry does not confirm the booking — it is alerted for refund;
 *   * no duplicate capture, no duplicate booking, no journal implying an expired booking was paid.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PaymentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { createBookingWithQuote } from "./helpers/quote-token";
import { paymentService } from "../services/payment.service";
import {
  bookingPaymentExpiryService,
  PAYMENT_PENDING_TTL_MINUTES,
} from "../services/booking-payment-expiry.service";

const RUN = `p09ttl-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 3;

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function createBooking(slot = istSlot((day += 1))) {
  const created = await createBookingWithQuote(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: slot.toISOString(),
  });
  if (!("booking" in created) || !created.booking) throw new Error(`create failed: ${JSON.stringify(created)}`);
  return { id: created.booking.id as string, slot };
}

/** Make the booking older than the TTL without touching anything else about it. */
async function age(bookingId: string, minutes = PAYMENT_PENDING_TTL_MINUTES + 5) {
  await prisma.$executeRawUnsafe(
    `UPDATE bookings SET created_at = NOW() - INTERVAL '${minutes} minutes' WHERE id = $1`,
    bookingId,
  );
}

const slotsOf = (id: string) =>
  prisma.$queryRaw<Array<{ ps: Date | null; pe: Date | null; us: Date | null; ue: Date | null }>>`
    SELECT provider_slot_start ps, provider_slot_end pe, user_slot_start us, user_slot_end ue FROM bookings WHERE id = ${id}
  `;

const statusOf = (id: string) =>
  prisma.$queryRaw<Array<{ status: string; payment_status: string }>>`
    SELECT status, payment_status FROM bookings WHERE id = ${id}
  `;

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

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("the window closes and the slot comes back", () => {
  test("an unpaid PENDING booking older than the TTL expires, and its slot columns are cleared", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    const before = (await slotsOf(id))[0]!;
    expect(before.ps).not.toBeNull();
    expect(before.us).not.toBeNull();

    await age(id);
    const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
    expect(out.expired).toBe(1);

    const [row] = await statusOf(id);
    expect(row!.status).toBe("EXPIRED");
    expect(row!.payment_status).toBe("EXPIRED");

    // Capacity released by the trigger that owns slots — no second implementation.
    const after = (await slotsOf(id))[0]!;
    expect(after.ps).toBeNull();
    expect(after.pe).toBeNull();
    expect(after.us).toBeNull();
    expect(after.ue).toBeNull();
  });

  test("the freed slot can immediately be booked by someone else", async () => {
    if (!dbOk) return;
    const { id, slot } = await createBooking();
    await age(id);
    await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });

    const second = await createBookingWithQuote(ctx.customerB.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressBId,
      scheduledDate: slot.toISOString(),
    });
    expect("booking" in second).toBe(true);
  });

  test("it emits the expiry event in the same transaction as the release", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    await age(id);
    await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });

    const events = await prisma.$queryRaw<Array<{ payload: any; actor_type: string | null }>>`
      SELECT payload, actor_type FROM event_outbox
      WHERE event_type = 'homigo.booking.payment_expired' AND aggregate_id = ${id}
    `;
    expect(events.length).toBe(1);
    expect(events[0]!.payload.data.ttlMinutes).toBe(PAYMENT_PENDING_TTL_MINUTES);
    expect(events[0]!.payload.data.previousPaymentStatus).toBe("PENDING");
    expect(events[0]!.actor_type).toBe("system");
  });
});

describe.serial("what it must never expire", () => {
  test("a PAID booking is never expired, however old", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    await payWithRealWallet(id, ctx.customerA.id);
    await age(id, 600);

    const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
    expect(out.expired).toBe(0);
    const [row] = await statusOf(id);
    expect(row!.payment_status).toBe(PaymentStatus.SUCCESS);
    expect(row!.status).not.toBe("EXPIRED");
  });

  test("a booking a partner already ACCEPTED is out of scope for this sweep", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    await prisma.$executeRaw`UPDATE bookings SET status = 'ACCEPTED' WHERE id = ${id}`;
    await age(id);

    const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
    expect(out.scanned).toBe(0);
    expect((await statusOf(id))[0]!.status).toBe("ACCEPTED");
  });

  test("a booking younger than the TTL is left alone", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    await age(id, PAYMENT_PENDING_TTL_MINUTES - 5);
    const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
    expect(out.scanned).toBe(0);
    expect((await statusOf(id))[0]!.status).toBe("PENDING");
  });

  test("a past-dated unpaid booking is reported as backlog, not rewritten", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    await prisma.$executeRaw`UPDATE bookings SET scheduled_date = NOW() - INTERVAL '2 days' WHERE id = ${id}`;
    await age(id);

    const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
    expect(out.expired).toBe(0);
    expect(out.pastDatedBacklog).toBeGreaterThanOrEqual(1);
    expect((await statusOf(id))[0]!.status).toBe("PENDING");
  });

  test("a booking settled before the sweep runs is filtered out by the candidate query", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    await age(id);
    await payWithRealWallet(id, ctx.customerA.id);

    const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
    expect(out.scanned).toBe(0);
    expect((await statusOf(id))[0]!.payment_status).toBe(PaymentStatus.SUCCESS);
  });

  test("a capture that lands BETWEEN the scan and the lock still wins — the in-transaction re-check", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    await age(id);

    /**
     * The interleaving that the in-transaction re-check exists for, made deterministic.
     *
     * Settling before the sweep is filtered out by the candidate query, so it never exercises the
     * re-check — the sweep passed that test with the re-check deleted. Here the payment settles
     * after the candidate has been chosen and before its transaction opens, which is exactly the
     * race a real capture can win.
     */
    /**
     * `$transaction` lives on the Prisma client's prototype, so `spyOn` does not intercept it (the
     * first attempt silently never fired, and the test then "failed" against correct code). An own
     * property on the instance shadows it, and is deleted again afterwards.
     */
    const realTransaction = prisma.$transaction.bind(prisma);
    let hookFired = false;
    Object.defineProperty(prisma, "$transaction", {
      configurable: true,
      writable: true,
      value: async (...args: unknown[]) => {
        if (!hookFired) {
          hookFired = true;
          // The capture itself, applied as the gateway path would leave it. One statement rather
          // than the whole wallet checkout, which opens transactions of its own and would interleave
          // something no real capture does.
          await realTransaction(async (tx: { $executeRaw: typeof prisma.$executeRaw }) => {
            await tx.$executeRaw`UPDATE bookings SET payment_status = 'SUCCESS' WHERE id = ${id}`;
          });
        }
        return (realTransaction as (...a: unknown[]) => unknown)(...args);
      },
    });

    try {
      const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
      expect(out.scanned).toBe(1); // it WAS a candidate
      expect(out.expired).toBe(0); // and the re-check refused it
      expect(out.skipped).toBe(1);
    } finally {
      delete (prisma as unknown as Record<string, unknown>).$transaction;
    }
    // If the hook never ran, the test proved nothing about the re-check.
    expect(hookFired).toBe(true);

    const [row] = await statusOf(id);
    expect(row!.payment_status).toBe(PaymentStatus.SUCCESS);
    expect(row!.status).not.toBe("EXPIRED");
  });
});

describe.serial("a payment that arrives after the window closed", () => {
  /**
   * O10 (owner policy 2026-09-23): an UNAMBIGUOUS late capture is auto-refunded — proven in
   * phase09-late-capture-auto-refund.integration.test.ts. Here the capture is deliberately
   * ambiguous (the amount is off by a paisa), so what is proven is the other half of the policy:
   * an ambiguous capture is never confirmed, never refunded on a guess, and is alerted for review.
   */
  test("an AMBIGUOUS late capture does NOT confirm the booking; it is recorded and alerted for review", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    const amount = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { finalAmount: true } })).finalAmount;
    const orderId = `order_${RUN}_late`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: id,
        userId: ctx.customerA.id,
        amount,
        amountPaise: BigInt(Math.round(amount * 100)),
        status: PaymentStatus.PENDING,
        paymentMethod: "razorpay",
        razorpayOrderId: orderId,
        idempotencyKey: paymentService.buildOrderIdempotencyKey(id),
      },
    });
    await age(id);
    const out = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });
    expect(out.expired).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe("EXPIRED" as PaymentStatus);

    /**
     * `opsAlertService.raise` suppresses an alert type once five of them are unresolved within an
     * hour — correct in production, and in a shared test database it would silently swallow the
     * alert this test is about. Clear the type first so the assertion measures this run.
     */
    await prisma.opsAlert.updateMany({
      where: { alertType: "payment_captured_after_expiry", resolved: false },
      data: { resolved: true },
    });
    const gatewayPaymentId = `pay_${RUN}_late`;
    const result = await paymentService.reconcileFromWebhook({
      event: "payment.captured",
      payload: { payment: { entity: { id: gatewayPaymentId, order_id: orderId, status: "captured", amount: Math.round(amount * 100) + 1 } } },
    });

    // Handled (so the gateway stops retrying) but explicitly NOT a confirmation, and NOT a refund.
    expect(result.handled).toBe(true);
    expect(result.reason).toBe("RECONCILIATION_REQUIRED:AMOUNT_MISMATCH");

    const [row] = await statusOf(id);
    expect(row!.status).toBe("EXPIRED");
    expect(row!.payment_status).toBe("EXPIRED");

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe("EXPIRED" as PaymentStatus);
    // Nothing refunded on a guess.
    expect(after.refundedAmount ?? 0).toBe(0);

    // No journal claiming this booking was paid, and the slot stays released.
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${payment.id}` } })).toBe(0);
    const slots = (await slotsOf(id))[0]!;
    expect(slots.ps).toBeNull();

    // An ops alert names it for a human to refund, carrying every identifier needed.
    // Scoped to THIS payment: an alert left by an earlier run must not be mistaken for this one.
    const alert = await prisma.opsAlert.findFirst({
      where: { alertType: "payment_captured_after_expiry", metadata: { contains: payment.id } },
      orderBy: { createdAt: "desc" },
    });
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("CRITICAL");
    expect(JSON.stringify(alert!.metadata)).toContain(gatewayPaymentId);
  });

  test("delivering the same late capture twice changes nothing further", async () => {
    if (!dbOk) return;
    const { id } = await createBooking();
    const amount = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { finalAmount: true } })).finalAmount;
    const orderId = `order_${RUN}_late2`;
    const payment = await prisma.payment.create({
      data: {
        bookingId: id, userId: ctx.customerA.id, amount, amountPaise: BigInt(Math.round(amount * 100)),
        status: PaymentStatus.PENDING, paymentMethod: "razorpay", razorpayOrderId: orderId,
        idempotencyKey: paymentService.buildOrderIdempotencyKey(id),
      },
    });
    await age(id);
    await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId: id });

    const evt = {
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_${RUN}_late2`, order_id: orderId, status: "captured", amount: Math.round(amount * 100) + 1 } } },
    };
    const first = await paymentService.reconcileFromWebhook(evt);
    const second = await paymentService.reconcileFromWebhook(evt);
    expect(first.reason).toBe("RECONCILIATION_REQUIRED:AMOUNT_MISMATCH");
    expect(second.reason).toBe("RECONCILIATION_REQUIRED:AMOUNT_MISMATCH");

    expect((await statusOf(id))[0]!.status).toBe("EXPIRED");
    expect(await prisma.journalEntry.count({ where: { idempotencyKey: `booking_payment:${payment.id}` } })).toBe(0);
    // Exactly one payment row for this booking: no duplicate capture created a second one.
    expect(await prisma.payment.count({ where: { bookingId: id } })).toBe(1);
  });
});
