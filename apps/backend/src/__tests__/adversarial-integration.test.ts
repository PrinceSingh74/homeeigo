/**
 * Adversarial integration verification — real PostgreSQL, production services, HTTP routes.
 * Rejects simulation: every test mutates/queries the database and calls service or app.handle().
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import {
  PaymentStatus,
  WalletTxnStatus,
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
import { walletService } from "../services/wallet.service";
import { bookingService } from "../services/booking.service";
import { paymentService } from "../services/payment.service";
import {
  razorpayService,
  getRazorpayCreateOrderInvocationCount,
  resetRazorpayCreateOrderInvocationCount,
} from "../services/razorpay.service";
import { rbacService } from "../services/rbac.service";
import app from "../index";

const RUN_ID = `run-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  process.env.NODE_ENV = "development";
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY =
    process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");

  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();
});

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable — set DATABASE_URL in apps/backend/.env");
    return true;
  }
  return false;
}

describe.serial("Adversarial integration — PostgreSQL + services + HTTP", () => {
  test("A1 concurrent wallet webhook + client verify does not double-credit", async () => {
    if (skipIfNoDb()) return;

    const user = await prisma.user.create({
      data: {
        email: `adv-${RUN_ID}-wallet@adv.test`,
        phoneNumber: fixturePhone(RUN_ID, "wallet-race"),
        firstName: "Wallet",
        lastName: "Race",
        password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
        role: "CUSTOMER",
        isEmailVerified: true,
        walletBalance: 0,
      },
    });

    const topUp = await walletService.addMoney(user.id, 1000);
    if (!topUp || "error" in topUp) throw new Error(`addMoney failed: ${JSON.stringify(topUp)}`);
    expect(topUp.razorpayOrderId).toBeTruthy();

    const txn = await prisma.walletTransaction.findFirstOrThrow({
      where: { userId: user.id, referenceId: topUp.razorpayOrderId },
    });
    expect(txn.status).toBe(WalletTxnStatus.PENDING);

    const paymentId = `pay_adv_${RUN_ID}`;
    const body = {
      razorpayOrderId: topUp.razorpayOrderId,
      razorpayPaymentId: paymentId,
      razorpaySignature: "adv-sig",
    };

    const [webhook, verify] = await Promise.all([
      walletService.reconcileTopUpFromWebhook(body.razorpayOrderId, body.razorpayPaymentId),
      walletService.verifyTopUp(user.id, body),
    ]);

    expect(webhook.handled).toBe(true);
    expect(verify).not.toHaveProperty("error");

    const after = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    const completed = await prisma.walletTransaction.count({
      where: { userId: user.id, status: WalletTxnStatus.COMPLETED },
    });

    expect(after.walletBalance).toBe(1000);
    expect(completed).toBe(1);

    await prisma.walletTransaction.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  test("B1 50 concurrent booking create — one success, rest PROVIDER_UNAVAILABLE, no throw", async () => {
    if (skipIfNoDb()) return;

    const slot = futureSlot(72);
    const concurrency = 50;
    const customers = await Promise.all(
      Array.from({ length: concurrency }, async (_, i) => {
        const user = await prisma.user.create({
          data: {
            email: `adv-${RUN_ID}-b1-${i}@adv.test`,
            phoneNumber: fixturePhone(RUN_ID, `booking-race-${i}`),
            firstName: "Race",
            lastName: `U${i}`,
            password: await Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }),
            role: "CUSTOMER",
            isEmailVerified: true,
          },
        });
        const address = await prisma.address.create({
          data: {
            userId: user.id,
            label: "Home",
            addressLine1: `${i} Race St`,
            city: "Noida",
            state: "UP",
            zipCode: "201301",
            fullAddress: `${i} Race St`,
            latitude: 28.62,
            longitude: 77.37,
          },
        });
        return { userId: user.id, addressId: address.id };
      }),
    );

    const results = await Promise.all(
      customers.map((c) =>
        bookingService.create(c.userId, {
          serviceId: ctx.serviceId,
          providerId: ctx.providerId,
          scheduledDate: slot.toISOString(),
          addressId: c.addressId,
        }),
      ),
    );

    const successes = results.filter((r) => "booking" in r);
    const failures = results.filter((r) => "error" in r);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(concurrency - 1);
    for (const f of failures) {
      expect(f).toEqual({ error: "PROVIDER_UNAVAILABLE" });
    }

    const active = await prisma.booking.count({
      where: {
        providerId: ctx.providerId,
        scheduledDate: slot,
        status: { in: ["PENDING", "ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] },
      },
    });
    expect(active).toBe(1);

    const userIds = customers.map((c) => c.userId);
    await deleteBookingsForUsers(userIds);
    await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  async function assertSingleGatewayCreateOrder(concurrency: number, slotOffset: number) {
    resetRazorpayCreateOrderInvocationCount();
    const createOrderSpy = spyOn(razorpayService, "createOrder");

    const slot = futureSlot(slotOffset);
    const created = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: slot.toISOString(),
      addressId: ctx.addressAId,
    });
    expect("booking" in created).toBe(true);
    const bookingId = created.booking!.id;

    await prisma.payment.deleteMany({ where: { bookingId } });

    const orders = await Promise.all(
      Array.from({ length: concurrency }, () =>
        paymentService.createOrder(ctx.customerA.id, bookingId),
      ),
    );

    const serviceInvocationCount = getRazorpayCreateOrderInvocationCount();
    const spyInvocationCount = createOrderSpy.mock.calls.length;
    createOrderSpy.mockRestore();

    expect(serviceInvocationCount).toBe(1);
    expect(spyInvocationCount).toBe(1);
    expect(orders.every((o) => o !== null)).toBe(true);

    const paymentRows = await prisma.payment.count({ where: { bookingId } });
    expect(paymentRows).toBe(1);

    const first = orders[0];
    if (!first || first.razorpayOrderId == null) throw new Error("no orders created");
    const orderIds = new Set(orders.map((o) => o!.razorpayOrderId));
    expect(orderIds.size).toBe(1);
    expect(first.razorpayOrderId.startsWith("pending:")).toBe(false);

    const expectedOrderId = first.razorpayOrderId;
    const expectedKey = first.idempotencyKey;
    for (const o of orders) {
      expect(o!.razorpayOrderId).toBe(expectedOrderId);
      expect(o!.idempotencyKey).toBe(expectedKey);
      expect(o!.amount).toBe(first.amount);
    }

    const row = await prisma.payment.findFirstOrThrow({ where: { bookingId } });
    expect(row.razorpayOrderId).toBe(first.razorpayOrderId);

    return { serviceInvocationCount, spyInvocationCount, concurrency, gatewayOrderId: expectedOrderId };
  }

  test("C1 50 concurrent createOrder — exactly 1 razorpayService.createOrder invocation", async () => {
    if (skipIfNoDb()) return;
    const evidence = await assertSingleGatewayCreateOrder(50, 200);
    expect(evidence.serviceInvocationCount).toBe(1);
    expect(evidence.spyInvocationCount).toBe(1);
  });

  test("C1b 200 concurrent createOrder — exactly 1 razorpayService.createOrder invocation", async () => {
    if (skipIfNoDb()) return;
    const evidence = await assertSingleGatewayCreateOrder(200, 240);
    expect(evidence.serviceInvocationCount).toBe(1);
    expect(evidence.spyInvocationCount).toBe(1);
  });

  test("C2 FAILED retry preserves history in metadata and issues new gateway order", async () => {
    if (skipIfNoDb()) return;

    const slot = futureSlot(220);
    const created = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      scheduledDate: slot.toISOString(),
      addressId: ctx.addressAId,
    });
    const bookingId = created.booking!.id;

    const first = await paymentService.createOrder(ctx.customerA.id, bookingId);
    const oldOrderId = first!.razorpayOrderId;

    await prisma.payment.update({
      where: { bookingId },
      data: { status: PaymentStatus.FAILED, failedAt: new Date() },
    });

    const retry = await paymentService.createOrder(ctx.customerA.id, bookingId);
    const row = await prisma.payment.findUniqueOrThrow({ where: { bookingId } });
    const metadata = JSON.parse(row.metadata ?? "{}") as {
      previousRazorpayOrderIds?: string[];
    };

    expect(row.razorpayOrderId).not.toBe(oldOrderId);
    expect(retry!.razorpayOrderId).toBe(row.razorpayOrderId);
    expect(metadata.previousRazorpayOrderIds).toContain(oldOrderId);
    expect(row.status).toBe(PaymentStatus.INITIATED);
  });

  test("D1 HTTP RBAC — support admin blocked from payment refund (403)", async () => {
    if (skipIfNoDb()) return;

    const res = await app.handle(
      new Request(`http://localhost/api/payments/${ctx.paymentForRefundId}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer(ctx.supportAdmin)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "adv rbac test", amount: 1 }),
      }),
    );

    expect(res.status).toBe(403);
  });

  test("D2 HTTP RBAC — finance admin allowed past RBAC (not 403)", async () => {
    if (skipIfNoDb()) return;

    const res = await app.handle(
      new Request(`http://localhost/api/payments/${ctx.paymentForRefundId}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer(ctx.financeAdmin)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "adv rbac test", amount: 1 }),
      }),
    );

    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  test("D3 HTTP RBAC — unauthenticated refund blocked (401)", async () => {
    if (skipIfNoDb()) return;

    const res = await app.handle(
      new Request(`http://localhost/api/payments/${ctx.paymentForRefundId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "unauth test", amount: 1 }),
      }),
    );

    expect(res.status).toBe(401);
  });

  test("D4 HTTP RBAC — unauthenticated ws stats blocked", async () => {
    if (skipIfNoDb()) return;

    const res = await app.handle(new Request("http://localhost/api/v1/ws/stats"));
    expect([401, 403]).toContain(res.status);
  });

  test("D5 HTTP RBAC — finance admin can read ws stats", async () => {
    if (skipIfNoDb()) return;

    const res = await app.handle(
      new Request("http://localhost/api/v1/ws/stats", {
        headers: { Authorization: `Bearer ${bearer(ctx.financeAdmin)}` },
      }),
    );

    expect(res.status).toBe(200);
  });

  test("E1 legacy ADMIN without AdminUser row is denied (403)", async () => {
    if (skipIfNoDb()) return;

    const adminCtx = await rbacService.resolveAdminContext(ctx.legacyAdmin.id);
    expect(adminCtx).toBeNull();

    const res = await app.handle(
      new Request(`http://localhost/api/payments/${ctx.paymentForRefundId}/refund`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bearer(ctx.legacyAdmin)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ reason: "legacy denied test", amount: 1 }),
      }),
    );

    expect(res.status).toBe(403);
  });
});
