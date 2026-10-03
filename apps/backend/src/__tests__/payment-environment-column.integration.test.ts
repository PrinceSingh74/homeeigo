/**
 * §27 / mandate M — durable per-payment environment truth, against the ISOLATED test database.
 *
 * Proves, with real rows and the real HTTP surface:
 *   1. the migration is live on the test db (probe sees the column);
 *   2. a payment created under the dev-mock gateway is stamped 'TEST' at creation;
 *   3. a refund whose stored environment disagrees with the executing credential is REFUSED
 *      (409 PAYMENT_ENV_MISMATCH at the admin route, FAILED refund-request row as evidence);
 *   4. the matching environment refunds fine (control — the guard can fail, and only fires
 *      when it should);
 *   5. UNKNOWN (NULL) keeps the historical behaviour: allowed, but counted;
 *   6. a webhook aimed at a payment from the other world may not flip its state.
 */
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { BookingStatus, PaymentStatus, RefundRequestStatus } from "@prisma/client";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import app from "../index";
import { paymentService } from "../services/payment.service";
import { refundOrchestratorService } from "../services/refund-orchestrator.service";
import {
  paymentEnvironmentColumnPresent,
} from "../lib/payment-environment-column";
import { sumCounter } from "../lib/metrics";

const RUN = `penv-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let reachable = false;

async function makeBooking(slot: number) {
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `PENV-${RUN}-${slot}`,
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      status: BookingStatus.PENDING,
      scheduledDate: new Date(Date.now() + (3 + slot) * 86_400_000),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      paymentStatus: PaymentStatus.PENDING,
    },
  });
  return booking.id;
}

async function makeSettledPayment(slot: number) {
  const bookingId = await makeBooking(slot);
  const payment = await prisma.payment.create({
    data: {
      bookingId,
      idempotencyKey: `booking_order:${bookingId}`,
      userId: ctx.customerA.id,
      amount: 500,
      amountPaid: 500,
      paymentMethod: "razorpay",
      razorpayOrderId: `order_${RUN}x${slot}`,
      razorpayPaymentId: `pay_${RUN}x${slot}`,
      status: PaymentStatus.SUCCESS,
      completedAt: new Date(),
    },
  });
  return payment;
}

const setEnv = (paymentId: string, env: "LIVE" | "TEST") =>
  prisma.$executeRaw`UPDATE payments SET environment = ${env} WHERE id = ${paymentId}`;

const rawEnv = async (paymentId: string) => {
  const rows = await prisma.$queryRaw<{ environment: string | null }[]>`
    SELECT environment FROM payments WHERE id = ${paymentId}`;
  return rows[0]?.environment ?? null;
};

beforeAll(async () => {
  reachable = await dbReachable();
  if (!reachable) return;
  ctx = await seedAdversarialFixtures(RUN);
}, 60_000);

afterAll(async () => {
  if (!reachable) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("§27 environment column is deployed on the isolated test db", () => {
  it("the probe sees both columns", async () => {
    if (!reachable) return;
    expect(await paymentEnvironmentColumnPresent(prisma, "payments")).toBe(true);
    expect(await paymentEnvironmentColumnPresent(prisma, "refund_requests")).toBe(true);
  });
});

describe("§27 creation stamps the environment", () => {
  it("a payment created under the dev-mock gateway is TEST from birth", async () => {
    if (!reachable) return;
    const bookingId = await makeBooking(0);
    const order = await paymentService.createOrder(ctx.customerA.id, bookingId);
    if (!order || "error" in order) throw new Error(`createOrder failed: ${JSON.stringify(order)}`);
    expect(order.razorpayOrderId.startsWith("order_dev_")).toBe(true);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
    expect(await rawEnv(payment.id)).toBe("TEST");
  });

  it("a historical row is never guessed at — writers only fill NULL at their own write points", async () => {
    if (!reachable) return;
    const payment = await makeSettledPayment(1);
    expect(await rawEnv(payment.id)).toBeNull(); // direct insert = historical shape: stays UNKNOWN
  });
});

describe("§27 refunds must leave through the world the money arrived in", () => {
  it("stored LIVE vs test-process executor: 409 PAYMENT_ENV_MISMATCH, FAILED row, nothing refunded", async () => {
    if (!reachable) return;
    const payment = await makeSettledPayment(2);
    await setEnv(payment.id, "LIVE");

    const before = sumCounter("refund_env_mismatch_total");
    const res = await app.handle(
      new Request(`http://localhost/api/payments/${payment.id}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer(ctx.financeAdmin)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "env mismatch attempt", amount: 50 }),
      }),
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { success: boolean; code?: string };
    expect(body.success).toBe(false);
    expect(body.code).toBe("PAYMENT_ENV_MISMATCH");
    expect(sumCounter("refund_env_mismatch_total")).toBeGreaterThan(before);

    // Nothing moved, and the refusal left durable evidence.
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe(PaymentStatus.SUCCESS);
    expect(after.refundedAmount).toBe(0);
    const req = await prisma.refundRequest.findUnique({
      where: {
        idempotencyKey: refundOrchestratorService.buildIdempotencyKey(payment.id, 50, "admin", ctx.financeAdmin.id),
      },
      include: { audits: true },
    });
    expect(req?.status).toBe(RefundRequestStatus.FAILED);
    expect(req?.audits.some((a) => a.details === "PAYMENT_ENV_MISMATCH")).toBe(true);
  });

  it("control — the matching environment refunds fine, and the refund request is stamped", async () => {
    if (!reachable) return;
    const payment = await makeSettledPayment(3);
    await setEnv(payment.id, "TEST");

    const res = await app.handle(
      new Request(`http://localhost/api/payments/${payment.id}/refund`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer(ctx.financeAdmin)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "matching env control", amount: 60 }),
      }),
    );
    expect(res.status).toBe(200);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.refundedAmount).toBe(60);
    expect(after.status).toBe(PaymentStatus.PARTIALLY_REFUNDED);

    const key = refundOrchestratorService.buildIdempotencyKey(payment.id, 60, "admin", ctx.financeAdmin.id);
    const req = await prisma.refundRequest.findUniqueOrThrow({ where: { idempotencyKey: key } });
    expect(req.status).toBe(RefundRequestStatus.COMPLETED);
    const rows = await prisma.$queryRaw<{ environment: string | null }[]>`
      SELECT environment FROM refund_requests WHERE id = ${req.id}`;
    expect(rows[0]?.environment).toBe("TEST");
  });

  it("UNKNOWN (NULL) keeps the historical behaviour: allowed, but counted", async () => {
    if (!reachable) return;
    const payment = await makeSettledPayment(4);
    expect(await rawEnv(payment.id)).toBeNull();

    const before = sumCounter("refund_env_unknown_total");
    const result = await refundOrchestratorService.executeRefund({
      paymentId: payment.id,
      amount: 40,
      reason: "unknown env refund",
      actorUserId: ctx.financeAdmin.id,
      isAdmin: true,
      source: "admin",
    });
    expect("error" in result).toBe(false);
    expect(sumCounter("refund_env_unknown_total")).toBeGreaterThan(before);
    // The refund never guessed the payment's environment into existence.
    expect(await rawEnv(payment.id)).toBeNull();
  });
});

describe("§27 a webhook may not flip a payment that belongs to the other world", () => {
  it("payment.captured against a LIVE-stamped payment in a test process is refused", async () => {
    if (!reachable) return;
    const bookingId = await makeBooking(5);
    const payment = await prisma.payment.create({
      data: {
        bookingId,
        idempotencyKey: `booking_order:${bookingId}`,
        userId: ctx.customerA.id,
        amount: 500,
        paymentMethod: "razorpay",
        razorpayOrderId: `order_${RUN}w5`,
        status: PaymentStatus.INITIATED,
      },
    });
    await setEnv(payment.id, "LIVE");

    const before = sumCounter("webhook_env_mismatch_total");
    const r = await paymentService.reconcileFromWebhook({
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_${RUN}w5`, order_id: `order_${RUN}w5`, status: "captured", amount: 50_000 } } },
    });
    expect(r).toEqual({ handled: false, reason: "PAYMENT_ENV_MISMATCH" });
    expect(sumCounter("webhook_env_mismatch_total")).toBeGreaterThan(before);
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe(PaymentStatus.INITIATED); // state never flipped
  });

  it("control — the same webhook reconciles once the environments agree", async () => {
    if (!reachable) return;
    const payment = await prisma.payment.findFirstOrThrow({ where: { razorpayOrderId: `order_${RUN}w5` } });
    await setEnv(payment.id, "TEST");
    const r = await paymentService.reconcileFromWebhook({
      event: "payment.captured",
      payload: { payment: { entity: { id: `pay_${RUN}w5`, order_id: `order_${RUN}w5`, status: "captured", amount: 50_000 } } },
    });
    expect(r).toEqual({ handled: true, reason: "RECONCILED" });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe(PaymentStatus.SUCCESS);
  });

  it("payment.failed against a LIVE-stamped payment is refused the same way", async () => {
    if (!reachable) return;
    const bookingId = await makeBooking(6);
    const payment = await prisma.payment.create({
      data: {
        bookingId,
        idempotencyKey: `booking_order:${bookingId}`,
        userId: ctx.customerA.id,
        amount: 500,
        paymentMethod: "razorpay",
        razorpayOrderId: `order_${RUN}w6`,
        status: PaymentStatus.INITIATED,
      },
    });
    await setEnv(payment.id, "LIVE");
    const r = await paymentService.reconcileFromWebhook({
      event: "payment.failed",
      payload: { payment: { entity: { order_id: `order_${RUN}w6` } } },
    });
    expect(r).toEqual({ handled: false, reason: "PAYMENT_ENV_MISMATCH" });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.status).toBe(PaymentStatus.INITIATED);
  });

  it("an explicit payload livemode marker wins over the process credential", async () => {
    if (!reachable) return;
    const payment = await prisma.payment.findFirstOrThrow({ where: { razorpayOrderId: `order_${RUN}w6` } });
    expect(payment.status).toBe(PaymentStatus.INITIATED);
    // Stored LIVE + payload livemode:true (LIVE) agree — no refusal from the guard; the event
    // proceeds into normal reconciliation.
    const r = await paymentService.reconcileFromWebhook({
      event: "payment.failed",
      livemode: true,
      payload: { payment: { entity: { order_id: `order_${RUN}w6` } } },
    });
    expect(r.reason).not.toBe("PAYMENT_ENV_MISMATCH");
  });
});
