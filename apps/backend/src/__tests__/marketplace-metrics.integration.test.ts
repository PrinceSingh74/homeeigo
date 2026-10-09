/**
 * Phase 15.4 — the five marketplace metrics against the isolated test database.
 *
 * Every row is stamped onto one IST calendar day that no other suite uses, so the window
 * contains only this file's rows. Expected rates are the existing definitions
 * (fulfillment-rates, repeatCustomerRate), not numbers chosen for the test.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { UserRole } from "@prisma/client";
import prisma from "../lib/prisma";
import { provenanceForNewUser } from "../lib/data-provenance";
import { nextBookingNumber } from "../lib/booking-number";
import { marketplaceMetrics, metricInstant } from "../services/marketplace-metrics.service";
import { fixturePhone, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `mm-${Date.now().toString(36)}`;
const DAY = "2020-03-15";
const AT = new Date(`${DAY}T08:00:00+05:30`);
let ctx: AdvCtx;
let dbOk = false;
const userIds: string[] = [];
const bookingIds: string[] = [];

async function person(slot: string, origin: "BUSINESS" | "TEST") {
  const email = `${RUN}-${slot}@adv.test`;
  const user = await prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: fixturePhone(RUN, slot),
      firstName: "Metric",
      lastName: slot,
      password: await Bun.password.hash("metric", { algorithm: "bcrypt", cost: 4 }),
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      walletBalance: 0,
      dataOrigin: origin === "BUSINESS" ? null : "TEST",
    },
  });
  userIds.push(user.id);
  const address = await prisma.address.create({
    data: {
      userId: user.id,
      label: "Home",
      addressLine1: "1 Metric Street",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "1 Metric Street, Noida",
      latitude: 28.62,
      longitude: 77.37,
      isDefault: true,
    },
  });
  return { user, addressId: address.id };
}

let slotN = 0;
async function booking(userId: string, addressId: string, data: { status?: "COMPLETED" | "CANCELLED_BY_USER" | "CANCELLED_BY_PROVIDER"; cancelledBy?: string; origin?: "TEST" | null; amount?: number }) {
  const row = await prisma.booking.create({
    data: {
      bookingNumber: await nextBookingNumber(),
      userId,
      serviceId: ctx.serviceId,
      addressId,
      scheduledDate: new Date(AT.getTime() + (slotN += 1) * 60_000),
      createdAt: AT,
      status: data.status ?? "COMPLETED",
      completedAt: data.status === "COMPLETED" || !data.status ? AT : null,
      cancelledBy: data.cancelledBy,
      baseAmount: data.amount ?? 100,
      finalAmount: data.amount ?? 100,
      totalAmount: data.amount ?? 100,
      taxes: 0,
      paymentStatus: "SUCCESS",
      dataOrigin: data.origin === undefined ? null : data.origin,
    },
  });
  bookingIds.push(row.id);
  return row;
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
}, 180_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: RUN } } });
  await prisma.refundRequest.deleteMany({ where: { idempotencyKey: { startsWith: RUN } } });
  await prisma.walletTransaction.deleteMany({ where: { transactionNumber: { startsWith: RUN } } });
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("15.4 marketplace metrics", () => {
  test("a date-only bound is an IST day, and an empty day measures no rate", async () => {
    expect(dbOk).toBe(true);
    const start = metricInstant(DAY, "start", new Date(0));
    const end = metricInstant(DAY, "end", new Date(0));
    expect(start.toISOString()).toBe("2020-03-14T18:30:00.000Z");
    expect(end.toISOString()).toBe("2020-03-15T18:29:59.999Z");
    const empty = await marketplaceMetrics(metricInstant("1999-01-01", "start", new Date(0)), metricInstant("1999-01-01", "end", new Date(0)));
    expect(empty.completionRatePct).toBeNull();
    expect(empty.cancellationRatePct).toBeNull();
    expect(empty.repeatCustomerRatePct).toBeNull();
    expect(empty.quoteToBookingPct).toBeNull();
    expect(empty.capturedGmv).toBe(0);
  });

  test("completion, cancellation, repeat, quote-to-booking and captured money follow the locked definitions and exclude test rows", async () => {
    const repeat = await person("repeat", "BUSINESS");
    const once = await person("once", "BUSINESS");
    const byUser = await person("user", "BUSINESS");
    const byAdmin = await person("admin", "BUSINESS");
    const byPartner = await person("partner", "BUSINESS");
    const quotedOnly = await person("quoted", "BUSINESS");
    const fixture = await person("fixture", "TEST");

    await booking(repeat.user.id, repeat.addressId, {});
    await booking(repeat.user.id, repeat.addressId, {});
    const paid = await booking(once.user.id, once.addressId, { amount: 250 });
    await booking(byUser.user.id, byUser.addressId, { status: "CANCELLED_BY_USER", cancelledBy: "user" });
    await booking(byAdmin.user.id, byAdmin.addressId, { status: "CANCELLED_BY_USER", cancelledBy: "admin" });
    await booking(byPartner.user.id, byPartner.addressId, { status: "CANCELLED_BY_PROVIDER", cancelledBy: "provider" });
    const fixtureBooking = await booking(fixture.user.id, fixture.addressId, { origin: "TEST", amount: 999 });

    const okPayment = await prisma.payment.create({
      data: {
        bookingId: paid.id,
        userId: once.user.id,
        amount: 250,
        amountPaid: 250,
        paymentMethod: "razorpay",
        status: "SUCCESS",
        completedAt: AT,
        razorpayOrderId: `order_${RUN}_ok`,
        idempotencyKey: `${RUN}-ok`,
      },
    });
    const fxPayment = await prisma.payment.create({
      data: {
        bookingId: fixtureBooking.id,
        userId: fixture.user.id,
        amount: 999,
        amountPaid: 999,
        paymentMethod: "razorpay",
        status: "SUCCESS",
        completedAt: AT,
        razorpayOrderId: `order_${RUN}_fx`,
        idempotencyKey: `${RUN}-fx`,
      },
    });
    await prisma.refundRequest.create({
      data: {
        paymentId: okPayment.id,
        userId: once.user.id,
        amount: 25,
        reason: `${RUN} partial`,
        status: "COMPLETED",
        requestedBy: once.user.id,
        idempotencyKey: `${RUN}-refund`,
        processedAt: AT,
        dataOrigin: null,
      },
    });
    await prisma.refundRequest.create({
      data: {
        paymentId: fxPayment.id,
        userId: fixture.user.id,
        amount: 500,
        reason: `${RUN} fixture`,
        status: "COMPLETED",
        requestedBy: fixture.user.id,
        idempotencyKey: `${RUN}-refund-fx`,
        processedAt: AT,
        dataOrigin: "TEST",
      },
    });
    await prisma.walletTransaction.create({
      data: {
        transactionNumber: `${RUN}-wallet`,
        userId: repeat.user.id,
        amount: 40,
        walletBalanceBefore: 40,
        walletBalanceAfter: 0,
        type: "DEBIT",
        status: "COMPLETED",
        description: "wallet",
        referenceType: "booking_wallet_payment",
        referenceId: bookingIds[0],
        createdAt: AT,
      },
    });
    await prisma.walletTransaction.create({
      data: {
        transactionNumber: `${RUN}-wallet-fx`,
        userId: fixture.user.id,
        amount: 80,
        walletBalanceBefore: 80,
        walletBalanceAfter: 0,
        type: "DEBIT",
        status: "COMPLETED",
        description: "wallet fixture",
        referenceType: "booking_wallet_payment",
        referenceId: fixtureBooking.id,
        createdAt: AT,
      },
    });

    let qn = 0;
    const quote = async (userId: string, origin: "TEST" | null) =>
      prisma.analyticsEvent.create({
        data: {
          eventId: `${RUN}-q-${(qn += 1)}`,
          eventName: "QUOTE_GENERATED",
          occurredAt: AT,
          actorUserId: userId,
          source: "BACKEND",
          platform: "SERVER",
          environment: "test",
          dataOrigin: origin,
        },
      });
    await quote(repeat.user.id, null);
    await quote(once.user.id, null);
    await quote(quotedOnly.user.id, null);
    await quote(fixture.user.id, "TEST");

    const m = await marketplaceMetrics(metricInstant(DAY, "start", new Date(0)), metricInstant(DAY, "end", new Date(0)));
    expect(m.completed).toBe(3);
    expect(m.cancelled).toBe(3);
    expect(m.completionRatePct).toBe(50);
    expect(m.cancellationRatePct).toBe(50);
    expect(m.cancellationAttribution).toEqual({ customer: 1, admin: 1, partner: 1, unattributed: 0 });
    expect(m.customersInWindow).toBe(5);
    expect(m.repeatCustomers).toBe(1);
    expect(m.repeatCustomerRatePct).toBe(20);
    expect(m.quotedCustomers).toBe(3);
    expect(m.quotedCustomersWhoBooked).toBe(2);
    expect(m.quoteToBookingPct).toBe(66.7);
    expect(m.gatewayCaptured).toBe(250);
    expect(m.walletCaptured).toBe(40);
    expect(m.capturedGmv).toBe(290);
    expect(m.refunds).toBe(25);
    expect(m.netCaptured).toBe(265);
  }, 120_000);
});
