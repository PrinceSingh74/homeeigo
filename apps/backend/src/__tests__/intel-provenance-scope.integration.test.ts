/**
 * Mandate L behaviourally: two representative intelligence services exclude a fixture population
 * from their business figures, while a NON_BUSINESS query over the same rows still sees them.
 *
 * Representative on purpose:
 *   - customer-intelligence reads through BOTH channels — a Prisma relation
 *     (`analyticsWhereVia("rating")`) and hand-written SQL (`analyticsSqlPredicate("bookings")`);
 *   - revenue-anomaly's daily GMV series is the input every baseline is measured on, so one
 *     synthetic spike there would manufacture exactly the anomaly the module refuses to invent.
 *
 * Neither service exposes an ALL/NON_BUSINESS path of its own, so the contrast assertion — the row
 * exists and only scoping hides it — is made with the same predicates the services use, requested
 * by name as `NON_BUSINESS`. A predicate asserted only against rows it excludes passes just as well
 * when it excludes everything.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { analyticsWhereVia } from "../lib/analytics-scope";
import { customerIntelligenceService } from "../services/customer-intelligence.service";
import { revenueAnomalyService } from "../services/revenue-anomaly.service";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `intel-scope-${Date.now().toString(36)}`;
/** Absurd on purpose: no other suite writes a payment this size, so the series assertion cannot collide. */
const HUGE = 7_777_777;

let ctx: AdvCtx;
let dbOk = false;
const bookingIds: string[] = [];
let paymentId: string | null = null;

const yesterday = new Date(Date.now() - 86_400_000);
const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);

async function seedFixtureActivity(): Promise<void> {
  // Two COMPLETED bookings make the fixture customer a "repeater" for the repeat-rate SQL.
  for (const [i, when] of [yesterday, twoDaysAgo].entries()) {
    const b = await prisma.booking.create({
      data: {
        bookingNumber: `${RUN}-${i}`,
        // Exactly what bookingService.create writes for a non-business customer: the booking
        // inherits the customer's origin, and rating/payment inherit it from the booking.
        dataOrigin: "INFERRED_SYNTHETIC",
        userId: ctx.customerA.id,
        serviceId: ctx.serviceId,
        providerId: ctx.providerId,
        addressId: ctx.addressAId,
        status: BookingStatus.COMPLETED,
        scheduledDate: when,
        completedAt: when,
        createdAt: when,
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
      } as never,
    });
    bookingIds.push(b.id);
  }
  await prisma.rating.create({
    data: { bookingId: bookingIds[0]!, userId: ctx.customerA.id, providerId: ctx.providerId, stars: 1 } as never,
  });
  const p = await prisma.payment.create({
    data: {
      bookingId: bookingIds[0]!,
      userId: ctx.customerA.id,
      amount: HUGE,
      amountPaid: HUGE,
      currency: "INR",
      status: "SUCCESS",
      paymentMethod: "razorpay",
      razorpayOrderId: `${RUN}-order`,
      idempotencyKey: `${RUN}-idem`,
      completedAt: yesterday,
    },
    select: { id: true },
  });
  paymentId = p.id;
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

afterAll(async () => {
  if (!dbOk) return;
  if (paymentId) await prisma.payment.deleteMany({ where: { id: paymentId } });
  if (bookingIds.length) {
    await prisma.rating.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
  }
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("intelligence services exclude the fixture population from business figures", () => {
  let before: Awaited<ReturnType<typeof customerIntelligenceService.getIntelligence>>;

  test("baseline is read, then the fixture activity lands", async () => {
    if (!dbOk) return;
    before = await customerIntelligenceService.getIntelligence(30);
    await seedFixtureActivity();
    // The rows genuinely exist — everything after this is about scoping, not about a failed seed.
    expect(await prisma.booking.count({ where: { id: { in: bookingIds } } })).toBe(2);
  });

  test("customer-intelligence: the fixture rating and repeat bookings move nothing", async () => {
    if (!dbOk) return;
    const after = await customerIntelligenceService.getIntelligence(30);
    // The fixture rating is invisible to NPS/CSAT inputs…
    expect(after.components.ratingsCount).toBe(before.components.ratingsCount);
    // …and the two COMPLETED fixture bookings are invisible to the repeat-rate SQL.
    expect(after.components.repeatCustomerRatePct).toBe(before.components.repeatCustomerRatePct);
  });

  test("revenue-anomaly: the synthetic spike never enters the daily GMV series", async () => {
    if (!dbOk) return;
    const series = await revenueAnomalyService.dailySeries();
    for (const point of series) expect(point.value).toBeLessThan(HUGE);
  });

  test("the NON_BUSINESS population, asked for by name, still sees every excluded row", async () => {
    if (!dbOk) return;
    const [ratingBusiness, ratingNonBusiness, paymentBusiness, paymentNonBusiness] = await Promise.all([
      prisma.rating.count({ where: { bookingId: bookingIds[0]!, ...analyticsWhereVia("rating") } }),
      prisma.rating.count({ where: { bookingId: bookingIds[0]!, ...analyticsWhereVia("rating", "NON_BUSINESS") } }),
      prisma.payment.count({ where: { id: paymentId!, ...analyticsWhereVia("payment") } }),
      prisma.payment.count({ where: { id: paymentId!, ...analyticsWhereVia("payment", "NON_BUSINESS") } }),
    ]);
    expect(ratingBusiness).toBe(0);
    expect(ratingNonBusiness).toBe(1);
    expect(paymentBusiness).toBe(0);
    expect(paymentNonBusiness).toBe(1);
  });
});
