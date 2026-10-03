/**
 * Payment order creation: typed gateway failures + state consistency (2026-10-01).
 *
 * A failed Razorpay order call used to escape as a plain Error → UNKNOWN 500, a 2xx that was not an
 * order was trusted, and the `pending:` reservation it left made the next attempt poll out a 10 s
 * window. Pinned here:
 *   - every gateway failure class maps to a stable PaymentGatewayError code/status;
 *   - a reply that is not the requested order is refused before anything is committed;
 *   - a failed call never marks anything paid, never touches the booking, and frees the reservation so
 *     an immediate retry creates the order at once;
 *   - concurrent retries still commit exactly one gateway order.
 * Runs on the isolated test DB with the offline dev gateway; the gateway call is stubbed only to fail.
 */
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { isAppError } from "../lib/app-error";
import { CircuitOpenError } from "../lib/circuit-breaker";
import {
  PaymentGatewayError,
  classifyGatewayOrderFailure,
  gatewayHttpFailure,
  razorpayService,
  validateGatewayOrder,
} from "../services/razorpay.service";
import { paymentService } from "../services/payment.service";
import { dbReachable } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

describe("classifyGatewayOrderFailure", () => {
  const code = (e: unknown) => classifyGatewayOrderFailure(e).code;
  test("network, timeout, egress refusal, open circuit, 429 and 5xx are retryable UNAVAILABLE", () => {
    expect(code(new TypeError("fetch failed"))).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
    expect(code(new TypeError("CERT isolation: outbound request to api.razorpay.com refused"))).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
    expect(code(Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }))).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
    expect(code(new CircuitOpenError("razorpay"))).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
    expect(code(gatewayHttpFailure(429))).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
    expect(code(gatewayHttpFailure(502))).toBe("PAYMENT_GATEWAY_UNAVAILABLE");
    expect(classifyGatewayOrderFailure(gatewayHttpFailure(503)).retryable).toBe(true);
  });

  test("a 4xx answer is REJECTED and not retryable", () => {
    for (const s of [400, 401, 403, 422]) {
      const e = classifyGatewayOrderFailure(gatewayHttpFailure(s));
      expect([e.code, e.retryable, e.httpStatus]).toEqual(["PAYMENT_GATEWAY_REJECTED", false, s]);
    }
  });

  test("renders through the AppError envelope; the client message carries no gateway detail", () => {
    const e = classifyGatewayOrderFailure(gatewayHttpFailure(401));
    expect(isAppError(e)).toBe(true);
    expect(e.status).toBe(502);
    expect(e.meta).toEqual({ retryable: false });
    expect(e.message).not.toMatch(/razorpay|401|key|secret/i);
    expect(new PaymentGatewayError("PAYMENT_GATEWAY_UNAVAILABLE").status).toBe(503);
    expect(new PaymentGatewayError("PAYMENT_GATEWAY_NOT_CONFIGURED").status).toBe(503);
  });
});

describe("validateGatewayOrder", () => {
  test("accepts only the order that was requested", () => {
    expect(validateGatewayOrder({ id: "order_Abc123", amount: 50000, currency: "INR" }, 50000)).toEqual({
      id: "order_Abc123",
      amount: 50000,
      currency: "INR",
    });
    for (const bad of [
      null,
      "",
      {},
      { amount: 50000, currency: "INR" },
      { id: "", amount: 50000, currency: "INR" },
      { id: "pay_Abc", amount: 50000, currency: "INR" },
      { id: "order_Abc123", amount: 49900, currency: "INR" },
      { id: "order_Abc123", amount: "50000", currency: "INR" },
      { id: "order_Abc123", amount: 50000, currency: "USD" },
      { error: { code: "BAD_REQUEST_ERROR" } },
    ]) {
      expect(() => validateGatewayOrder(bad, 50000)).toThrow(PaymentGatewayError);
    }
  });
});

const RUN = `pge-${Date.now().toString(36)}`;
let seq = 0;
let dbOk = false;
const made = { users: [] as string[], services: [] as string[], addresses: [] as string[], bookings: [] as string[] };

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.payment.deleteMany({ where: { bookingId: { in: made.bookings } } }).catch(() => {});
  await prisma.booking.deleteMany({ where: { id: { in: made.bookings } } }).catch(() => {});
  await prisma.address.deleteMany({ where: { id: { in: made.addresses } } }).catch(() => {});
  await prisma.service.deleteMany({ where: { id: { in: made.services } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: made.users } } }).catch(() => {});
  const left = await prisma.booking.count({ where: { id: { in: made.bookings } } });
  if (left > 0) console.warn(`[${RUN}] ${left} fixture booking(s) could not be removed`);
}, 60_000);

async function payableBooking() {
  seq++;
  const u = await prisma.user.create({
    data: {
      email: `${RUN}-${seq}@test.test`,
      phoneNumber: `+9177${Math.floor(1e7 + Math.random() * 8.9e7)}`,
      firstName: "Pge",
      lastName: `T${seq}`,
      password: "x".repeat(20),
      role: "CUSTOMER",
      walletBalance: 0,
    },
  });
  made.users.push(u.id);
  const s = await prisma.service.create({
    data: { name: `${RUN}-${seq}`, slug: `${RUN}-${seq}`, description: "x", category: "cleaning", basePrice: 1000, estimatedDuration: 60 },
  });
  made.services.push(s.id);
  const a = await prisma.address.create({
    data: { userId: u.id, label: "H", addressLine1: "1 St", city: "Mumbai", state: "MH", zipCode: "400001", latitude: 19.076, longitude: 72.8777 },
  });
  made.addresses.push(a.id);
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `PGE-${RUN}-${seq}`,
      userId: u.id,
      serviceId: s.id,
      addressId: a.id,
      status: "PENDING",
      scheduledDate: new Date(Date.now() + 72 * 3_600_000),
      baseAmount: 1000,
      finalAmount: 1000,
      totalAmount: 1000,
      paymentStatus: "PENDING",
    },
  });
  made.bookings.push(b.id);
  return { userId: u.id, bookingId: b.id };
}

describe.serial("paymentService.createOrder when the gateway fails", () => {
  test("typed failure → nothing paid, booking untouched, reservation released; an immediate retry creates the order", async () => {
    if (!dbOk) return;
    const c = await payableBooking();
    const stub = spyOn(razorpayService, "createOrder").mockRejectedValueOnce(new PaymentGatewayError("PAYMENT_GATEWAY_UNAVAILABLE"));
    try {
      const err = await paymentService.createOrder(c.userId, c.bookingId).then(() => null, (e: unknown) => e);
      expect(err).toBeInstanceOf(PaymentGatewayError);
      expect((err as PaymentGatewayError).code).toBe("PAYMENT_GATEWAY_UNAVAILABLE");

      const row = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
      expect(row.status).toBe("INITIATED");
      expect(row.razorpayOrderId.startsWith("pending:released:")).toBe(true);
      const booking = await prisma.booking.findUniqueOrThrow({ where: { id: c.bookingId } });
      expect([booking.status, booking.paymentStatus]).toEqual(["PENDING", "PENDING"]);

      // Retry: the released reservation is reclaimed at once (the old path polled 10 s first).
      const t0 = performance.now();
      const order = await paymentService.createOrder(c.userId, c.bookingId);
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(5_000);
      const id = (order as { razorpayOrderId?: string })?.razorpayOrderId ?? "";
      expect(id.startsWith("order_")).toBe(true);
      const committed = await prisma.payment.findUniqueOrThrow({ where: { bookingId: c.bookingId } });
      expect([committed.razorpayOrderId, committed.status]).toEqual([id, "INITIATED"]);
      expect(stub).toHaveBeenCalledTimes(2);
    } finally {
      stub.mockRestore();
    }
  });

  test("concurrent retries after a failure commit exactly one gateway order", async () => {
    if (!dbOk) return;
    const c = await payableBooking();
    const stub = spyOn(razorpayService, "createOrder").mockRejectedValueOnce(new PaymentGatewayError("PAYMENT_GATEWAY_REJECTED", 401));
    try {
      const err = await paymentService.createOrder(c.userId, c.bookingId).then(() => null, (e: unknown) => e);
      expect((err as PaymentGatewayError).code).toBe("PAYMENT_GATEWAY_REJECTED");
      const results = await Promise.all(Array.from({ length: 5 }, () => paymentService.createOrder(c.userId, c.bookingId)));
      const ids = new Set(results.map((r) => (r as { razorpayOrderId?: string })?.razorpayOrderId));
      expect(ids.size).toBe(1);
      expect([...ids][0]?.startsWith("order_")).toBe(true);
      // 1 failed call + exactly 1 successful gateway order for 5 concurrent retries.
      expect(stub).toHaveBeenCalledTimes(2);
    } finally {
      stub.mockRestore();
    }
  });
});
