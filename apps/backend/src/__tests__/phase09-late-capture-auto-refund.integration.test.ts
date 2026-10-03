/**
 * O10 — GUARDED auto-refund for a capture that lands after PAYMENT_PENDING_TTL closed the window
 * (owner policy 2026-09-23).
 *
 * Razorpay is in TEST MODE here and the gateway call is stubbed, so nothing below is a real-money
 * refund. What is proven is the DECISION and the code path: the same guards, the same single refund
 * authority, the same idempotency and the same invariants Live Mode would use.
 *
 * The refund fires only when every question has one unambiguous answer. Every other case must be
 * RECONCILIATION_REQUIRED — refunding an ambiguous financial event automatically is how money goes
 * back twice.
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
import {
  bookingPaymentExpiryService,
  PAYMENT_PENDING_TTL_MINUTES,
} from "../services/booking-payment-expiry.service";

const RUN = `p09late-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 4;
const restores: Array<() => void> = [];
let gatewayRefunds: Array<{ paymentId: string; amountInr: number; operationKey?: string }> = [];

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

/** Stub the gateway refund. Records every call so "exactly one refund" can be asserted. */
function stubGatewayRefund(outcome: "SUCCESS" | "INDETERMINATE" = "SUCCESS") {
  gatewayRefunds = [];
  const spy = spyOn(razorpayService, "executeGatewayRefund").mockImplementation(async (opts: any) => {
    gatewayRefunds.push({ paymentId: opts.paymentId, amountInr: opts.amountInr, operationKey: opts.operationKey });
    return outcome === "SUCCESS"
      // `refund_requests.gateway_refund_id` is UNIQUE, so the stub must not repeat an id across
      // tests — the per-test counter did, and the collision surfaced as LEDGER_UPDATE_FAILED.
      ? ({ kind: "SUCCESS", refundId: `rfnd_${crypto.randomUUID()}`, status: "processed" } as any)
      : ({ kind: "INDETERMINATE", reason: "timeout" } as any);
  });
  restores.push(() => spy.mockRestore());
}

/** An expired booking with one unsettled gateway payment row. */
async function expiredBookingWithOrder(suffix: string) {
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in created) || !created.booking) throw new Error(`create failed: ${JSON.stringify(created)}`);
  const bookingId = created.booking.id;
  const amount = created.booking.finalAmount;
  const orderId = `order_${RUN}_${suffix}`;
  const payment = await prisma.payment.create({
    data: {
      bookingId,
      userId: ctx.customerA.id,
      amount,
      amountPaise: BigInt(Math.round(amount * 100)),
      status: PaymentStatus.PENDING,
      paymentMethod: "razorpay",
      razorpayOrderId: orderId,
      idempotencyKey: paymentService.buildOrderIdempotencyKey(bookingId),
    },
  });
  await prisma.$executeRawUnsafe(
    `UPDATE bookings SET created_at = NOW() - INTERVAL '${PAYMENT_PENDING_TTL_MINUTES + 5} minutes' WHERE id = $1`,
    bookingId,
  );
  const swept = await bookingPaymentExpiryService.expireStalePendingPayments(50, PAYMENT_PENDING_TTL_MINUTES, { bookingId });
  expect(swept.expired).toBe(1);
  return { bookingId, paymentId: payment.id, orderId, amount };
}

const capture = (orderId: string, id: string, amountPaise: number) => ({
  event: "payment.captured",
  payload: { payment: { entity: { id, order_id: orderId, status: "captured", amount: amountPaise } } },
});

const statusOf = (bookingId: string) =>
  prisma.$queryRaw<Array<{ status: string; payment_status: string }>>`
    SELECT status, payment_status FROM bookings WHERE id = ${bookingId}
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

afterEach(() => {
  while (restores.length) restores.pop()!();
});

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("the unambiguous case refunds itself", () => {
  test("exact amount, right order, still expired, nothing refunded → one Test Mode refund", async () => {
    if (!dbOk) return;
    stubGatewayRefund("SUCCESS");
    const { bookingId, paymentId, orderId, amount } = await expiredBookingWithOrder("ok");

    const res = await paymentService.reconcileFromWebhook(capture(orderId, `pay_${RUN}_ok`, Math.round(amount * 100)));
    expect(res.reason).toBe("LATE_CAPTURE_AUTO_REFUNDED");

    // Exactly one gateway refund, for exactly the captured amount.
    expect(gatewayRefunds.length).toBe(1);
    expect(gatewayRefunds[0]!.amountInr).toBe(amount);

    // The booking is NOT confirmed — the slot was released and may belong to someone else.
    const [row] = await statusOf(bookingId);
    expect(row!.status).toBe("EXPIRED");
    expect(row!.payment_status).not.toBe(PaymentStatus.SUCCESS);

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.razorpayPaymentId).toBe(`pay_${RUN}_ok`);
    // refund_total <= captured_total, with equality here.
    expect(payment.refundedAmount ?? 0).toBeLessThanOrEqual(amount);
    expect(payment.refundedAmount ?? 0).toBe(amount);
  });

  test("the same capture delivered twice refunds once — one authorisation, one refund", async () => {
    if (!dbOk) return;
    stubGatewayRefund("SUCCESS");
    const { paymentId, orderId, amount } = await expiredBookingWithOrder("twice");
    const evt = capture(orderId, `pay_${RUN}_twice`, Math.round(amount * 100));

    const first = await paymentService.reconcileFromWebhook(evt);
    const second = await paymentService.reconcileFromWebhook(evt);
    expect(first.reason).toBe("LATE_CAPTURE_AUTO_REFUNDED");
    expect(second.handled).toBe(true);

    expect(gatewayRefunds.length).toBe(1);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(payment.refundedAmount ?? 0).toBe(amount);
    expect(await prisma.refundRequest.count({ where: { paymentId, status: "COMPLETED" } })).toBe(1);
  });
});

describe.serial("every ambiguity refuses to refund", () => {
  test("amount mismatch", async () => {
    if (!dbOk) return;
    stubGatewayRefund("SUCCESS");
    const { paymentId, orderId, amount } = await expiredBookingWithOrder("amt");
    const res = await paymentService.reconcileFromWebhook(capture(orderId, `pay_${RUN}_amt`, Math.round(amount * 100) - 1));
    expect(res.reason).toBe("RECONCILIATION_REQUIRED:AMOUNT_MISMATCH");
    expect(gatewayRefunds.length).toBe(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).refundedAmount ?? 0).toBe(0);
  });

  test("a partial capture is an amount mismatch, not a partial refund", async () => {
    if (!dbOk) return;
    stubGatewayRefund("SUCCESS");
    const { orderId, amount } = await expiredBookingWithOrder("partial");
    const res = await paymentService.reconcileFromWebhook(capture(orderId, `pay_${RUN}_partial`, Math.round(amount * 50)));
    expect(res.reason).toBe("RECONCILIATION_REQUIRED:AMOUNT_MISMATCH");
    expect(gatewayRefunds.length).toBe(0);
  });

  test("a booking cannot be recovered after expiry — the database forbids it", async () => {
    if (!dbOk) return;
    stubGatewayRefund("SUCCESS");
    const { bookingId } = await expiredBookingWithOrder("recovered");
    /**
     * This test used to *create* a recovered booking with a raw UPDATE and assert the resolver's
     * BOOKING_RECOVERED guard. No product path recovers an expired booking (EXPIRED is terminal in
     * lib/booking-state-machine), and since Phase 10 §5 the terminal-status trigger refuses the
     * UPDATE itself — the same honest shape as the MULTIPLE_PAYMENTS case below. The resolver guard
     * stays as defence in depth; the state it defends against is now unreachable.
     */
    let refused = false;
    try {
      await prisma.$executeRaw`UPDATE bookings SET status = 'PENDING' WHERE id = ${bookingId}`;
    } catch (e) {
      refused = /BOOKING_TERMINAL_STATUS/.test(String(e));
    }
    expect(refused).toBe(true);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true } })).status).toBe("EXPIRED");
    expect(gatewayRefunds.length).toBe(0);
  });

  test("a booking cannot even HAVE a second payment row — the database forbids it", async () => {
    if (!dbOk) return;
    const { bookingId, amount } = await expiredBookingWithOrder("multi");
    /**
     * The MULTIPLE_PAYMENTS guard in the resolver is defence in depth: `payments.booking_id` is
     * UNIQUE, so the ambiguity it protects against cannot be reached from a booking. Asserting the
     * constraint is the honest test — writing one that pretends a second row exists would prove
     * nothing about the real system.
     */
    let refused = false;
    try {
      await prisma.payment.create({
        data: {
          bookingId, userId: ctx.customerA.id, amount, amountPaise: BigInt(Math.round(amount * 100)),
          status: PaymentStatus.PENDING, paymentMethod: "razorpay",
          razorpayOrderId: `order_${RUN}_multi_second`, idempotencyKey: `dup:${bookingId}`,
        },
      });
    } catch {
      refused = true;
    }
    expect(refused).toBe(true);
    expect(await prisma.payment.count({ where: { bookingId } })).toBe(1);
  });

  test("an already-refunded payment is not refunded again", async () => {
    if (!dbOk) return;
    stubGatewayRefund("SUCCESS");
    const { paymentId, orderId, amount } = await expiredBookingWithOrder("already");
    // A realistic prior refund: money was captured (amountPaid) and then returned. A refunded
    // amount with nothing captured cannot exist, and seeding it would trip the integrity detector.
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        amountPaid: amount, amountPaidPaise: BigInt(Math.round(amount * 100)),
        refundedAmount: amount, refundedAmountPaise: BigInt(Math.round(amount * 100)),
      },
    });

    const res = await paymentService.reconcileFromWebhook(capture(orderId, `pay_${RUN}_already`, Math.round(amount * 100)));
    expect(res.reason).toBe("RECONCILIATION_REQUIRED:REFUND_ALREADY_EXISTS");
    expect(gatewayRefunds.length).toBe(0);
  });

  test("an indeterminate gateway outcome is reconciliation, never a retry", async () => {
    if (!dbOk) return;
    stubGatewayRefund("INDETERMINATE");
    const { paymentId, orderId, amount } = await expiredBookingWithOrder("indet");

    const res = await paymentService.reconcileFromWebhook(capture(orderId, `pay_${RUN}_indet`, Math.round(amount * 100)));
    expect(res.reason).toContain("RECONCILIATION_REQUIRED:REFUND_");
    // One attempt reached the gateway and its outcome is unknown: it must NOT be tried again.
    expect(gatewayRefunds.length).toBe(1);

    // Whatever the second delivery is classified as, the invariant is that the gateway is NOT asked
    // to refund again — retrying an unknown refund is how one becomes two.
    const again = await paymentService.reconcileFromWebhook(capture(orderId, `pay_${RUN}_indet`, Math.round(amount * 100)));
    expect(again.handled).toBe(true);
    expect(gatewayRefunds.length).toBe(1);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).refundedAmount ?? 0).toBe(0);
  });

  test("every refusal raises a CRITICAL alert naming the capture", async () => {
    if (!dbOk) return;
    stubGatewayRefund("SUCCESS");
    await prisma.opsAlert.updateMany({ where: { alertType: "payment_captured_after_expiry", resolved: false }, data: { resolved: true } });
    const { paymentId, orderId, amount } = await expiredBookingWithOrder("alert");
    await paymentService.reconcileFromWebhook(capture(orderId, `pay_${RUN}_alert`, Math.round(amount * 100) + 7));

    const alert = await prisma.opsAlert.findFirst({
      where: { alertType: "payment_captured_after_expiry", metadata: { contains: paymentId } },
      orderBy: { createdAt: "desc" },
    });
    expect(alert).not.toBeNull();
    expect(alert!.severity).toBe("CRITICAL");
    expect(JSON.stringify(alert!.metadata)).toContain("AMOUNT_MISMATCH");
  });
});
