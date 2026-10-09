/**
 * FinOps unit-cost denominators — owner decision: all-traffic operational allocation.
 *
 * External API spend is incurred by every request, so `cost_per_customer` / `cost_per_order`
 * divide by every user and every successful payment. The business KPIs over the same rows must
 * still exclude the non-business ones. The shared test database also holds other suites' rows, so
 * every assertion is on the delta this file adds, never on an absolute count.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { UserRole, type DataOrigin } from "@prisma/client";
import prisma from "../lib/prisma";
import { provenanceForNewUser } from "../lib/data-provenance";
import { nextBookingNumber } from "../lib/booking-number";
import { analyticsWhere, analyticsWhereVia } from "../lib/analytics-scope";
import { finOpsDenominators, unitCost } from "../lib/finops-metrics";
import { marketplaceMetrics, metricInstant } from "../services/marketplace-metrics.service";
import { fixturePhone, cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `fo-${Date.now().toString(36)}`;
const DAY = "2020-04-22";
const AT = new Date(`${DAY}T08:00:00+05:30`);
const ORIGINS: Array<DataOrigin | null> = [null, "REAL", "TEST", "FIXTURE", "SYNTHETIC", "CERTIFICATION"];
let ctx: AdvCtx;
let dbOk = false;
const userIds: string[] = [];
const bookingIds: string[] = [];

async function paidBooking(slot: number, origin: DataOrigin | null) {
  const email = `${RUN}-${slot}@adv.test`;
  const user = await prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: fixturePhone(RUN, String(slot)),
      firstName: "FinOps",
      lastName: String(slot),
      password: await Bun.password.hash("finops", { algorithm: "bcrypt", cost: 4 }),
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      walletBalance: 0,
      dataOrigin: origin,
    },
  });
  userIds.push(user.id);
  const address = await prisma.address.create({
    data: {
      userId: user.id,
      label: "Home",
      addressLine1: "1 FinOps Street",
      city: "Noida",
      state: "UP",
      zipCode: "201301",
      fullAddress: "1 FinOps Street, Noida",
      latitude: 28.62,
      longitude: 77.37,
      isDefault: true,
    },
  });
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: await nextBookingNumber(),
      userId: user.id,
      serviceId: ctx.serviceId,
      addressId: address.id,
      scheduledDate: new Date(AT.getTime() + slot * 60_000),
      createdAt: AT,
      status: "COMPLETED",
      completedAt: AT,
      baseAmount: 100,
      finalAmount: 100,
      totalAmount: 100,
      taxes: 0,
      paymentStatus: "SUCCESS",
      dataOrigin: origin,
    },
  });
  bookingIds.push(booking.id);
  await prisma.payment.create({
    data: {
      bookingId: booking.id,
      userId: user.id,
      amount: 100,
      amountPaid: 100,
      paymentMethod: "razorpay",
      status: "SUCCESS",
      completedAt: AT,
      razorpayOrderId: `order_${RUN}_${slot}`,
      idempotencyKey: `${RUN}-${slot}`,
    },
  });
}

const businessUsers = () => prisma.user.count({ where: { ...analyticsWhere() } });
const businessPayments = () => prisma.payment.count({ where: { status: "SUCCESS", ...analyticsWhereVia("payment") } });

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
  await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("FinOps unitCost", () => {
  test("divides and rounds to 4 dp", () => {
    expect(unitCost(1, 4)).toBe(0.25);
    expect(unitCost(1, 3)).toBe(0.3333);
  });

  test("a zero, negative or non-finite denominator is 0 — never NaN or Infinity", () => {
    for (const [total, units] of [[5, 0], [0, 0], [5, -1], [5, Number.NaN], [Number.NaN, 3], [Number.POSITIVE_INFINITY, 3], [5, Number.POSITIVE_INFINITY]]) {
      const v = unitCost(total, units);
      expect(v).toBe(0);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe.serial("FinOps denominators are all-traffic; business KPIs stay scoped", () => {
  test("every origin enters the FinOps denominators; only business origins enter the business KPIs", async () => {
    expect(dbOk).toBe(true);
    const before = await finOpsDenominators();
    const bizUsersBefore = await businessUsers();
    const bizPaymentsBefore = await businessPayments();

    let slot = 0;
    for (const origin of ORIGINS) await paidBooking((slot += 1), origin);

    const after = await finOpsDenominators();
    // Real (REAL + unclassified), test, fixture, synthetic and certification traffic all count.
    expect(after.users - before.users).toBe(ORIGINS.length);
    expect(after.successfulPayments - before.successfulPayments).toBe(ORIGINS.length);

    // The same rows under the business population: only null and REAL.
    expect((await businessUsers()) - bizUsersBefore).toBe(2);
    expect((await businessPayments()) - bizPaymentsBefore).toBe(2);

    // Business marketplace KPIs over this file's day see only the two business bookings.
    const m = await marketplaceMetrics(metricInstant(DAY, "start", new Date(0)), metricInstant(DAY, "end", new Date(0)));
    expect(m.completed).toBe(2);
    expect(m.gatewayCaptured).toBe(200);
    expect(m.capturedGmv).toBe(200);
    expect(m.customersInWindow).toBe(2);

    // Removing the test rows from the business KPIs does not remove them from FinOps: a fixed spend
    // is spread over all six orders, not the two business ones.
    const spend = 6;
    const allTraffic = unitCost(spend, after.successfulPayments);
    expect(allTraffic).toBe(unitCost(spend, before.successfulPayments + ORIGINS.length));
    expect(allTraffic).not.toBe(unitCost(spend, before.successfulPayments + 2));
  }, 120_000);
});
