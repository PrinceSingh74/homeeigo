/**
 * Fixtures for the Phase 15 admin and partner browser proofs — ISOLATED TEST DATABASE ONLY.
 *
 *   cd apps/backend
 *   NODE_ENV=test bun --env-file=.env.test run scripts/e2e-phase15-console-seed.ts <runId> <out.json>
 *   NODE_ENV=test bun --env-file=.env.test run scripts/e2e-phase15-console-seed.ts <runId> --cleanup
 *
 * Seeds the adversarial fixture (super admin, partner, service) plus one IST day of bookings on
 * that partner, so the admin metric tiles have a known non-empty window to render:
 *
 *   m1  business, 2 COMPLETED (gateway 400 + 0)       → repeat customer
 *   m2  business, 1 COMPLETED (gateway 300), 1 CANCELLED_BY_USER
 *   m3  business, quoted only
 *   mt  TEST,     1 COMPLETED (gateway 999), quoted   → must be excluded from every business KPI
 *
 * Expected business KPIs for DAY: completion 75.0 %, cancellation 25.0 %, repeat 50.0 %,
 * quote-to-booking 66.7 %, captured GMV ₹700. Ratings are written through ratingService.create
 * (the real customer path), which also recomputes the partner's stored rating.
 */
import "../src/load-env";
import { writeFileSync } from "node:fs";
import { UserRole, type DataOrigin } from "@prisma/client";
import prisma from "../src/lib/prisma";
import { provenanceForNewUser } from "../src/lib/data-provenance";
import { nextBookingNumber } from "../src/lib/booking-number";
import { ratingService } from "../src/services/rating.service";
import { userPiiService } from "../src/services/user-pii.service";
import { cleanupAdversarialFixtures, fixturePhone, seedAdversarialFixtures } from "../src/__tests__/helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "../src/__tests__/helpers/isolated-test-db";

const [runId, out] = process.argv.slice(2);
if (!runId || !out) {
  console.error("usage: e2e-phase15-console-seed.ts <runId> <out.json | --cleanup>");
  process.exit(2);
}

const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
refuseIfNotIsolatedTestDb(db);

const DAY = "2020-05-20";
const AT = new Date(`${DAY}T08:00:00+05:30`);
const tag = `adv-${runId}`;
const SLOTS = ["m1", "m2", "m3", "mt"] as const;
const emailOf = (slot: string) => `${tag}-${slot}@adv.test`;

if (out === "--cleanup") {
  const users = await prisma.user.findMany({
    where: { emailHash: { in: SLOTS.map((s) => userPiiService.hashEmail(emailOf(s))) } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  if (ids.length > 0) {
    const bookings = await prisma.booking.findMany({ where: { userId: { in: ids } }, select: { id: true } });
    const bookingIds = bookings.map((b) => b.id);
    await prisma.analyticsEvent.deleteMany({ where: { eventId: { startsWith: `${tag}-q-` } } });
    await prisma.rating.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.payment.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.activityLog.deleteMany({ where: { bookingId: { in: bookingIds } } });
    await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
    await prisma.address.deleteMany({ where: { userId: { in: ids } } });
    for (const table of ["hcoin_transactions", "hcoin_wallets", "activity_logs"]) {
      await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "user_id" = ANY($1)`, ids).catch(() => undefined);
    }
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  }
  await cleanupAdversarialFixtures(runId);
  console.log(`cleaned ${runId} on ${db} (${ids.length} metric customers)`);
  process.exit(0);
}

const ctx = await seedAdversarialFixtures(runId);

async function customer(slot: (typeof SLOTS)[number], origin: DataOrigin | null) {
  const email = emailOf(slot);
  const user = await prisma.user.create({
    data: {
      ...provenanceForNewUser(email),
      email,
      phoneNumber: fixturePhone(runId, slot),
      firstName: "Metric",
      lastName: slot.toUpperCase(),
      password: await Bun.password.hash("AdvTest@123", { algorithm: "bcrypt", cost: 4 }),
      role: UserRole.CUSTOMER,
      isEmailVerified: true,
      isPhoneVerified: true,
      walletBalance: 0,
      dataOrigin: origin,
    },
  });
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
  return { id: user.id, addressId: address.id, origin };
}

let minute = 0;
async function booking(c: { id: string; addressId: string; origin: DataOrigin | null }, status: "COMPLETED" | "CANCELLED_BY_USER", paid?: number) {
  const row = await prisma.booking.create({
    data: {
      bookingNumber: await nextBookingNumber(),
      userId: c.id,
      providerId: ctx.providerId,
      serviceId: ctx.serviceId,
      addressId: c.addressId,
      scheduledDate: new Date(AT.getTime() + (minute += 1) * 60_000),
      createdAt: AT,
      status,
      completedAt: status === "COMPLETED" ? AT : null,
      cancelledBy: status === "CANCELLED_BY_USER" ? "user" : undefined,
      baseAmount: paid ?? 400,
      finalAmount: paid ?? 400,
      totalAmount: paid ?? 400,
      taxes: 0,
      paymentStatus: paid ? "SUCCESS" : "PENDING",
      dataOrigin: c.origin,
    },
  });
  if (paid) {
    await prisma.payment.create({
      data: {
        bookingId: row.id,
        userId: c.id,
        amount: paid,
        amountPaid: paid,
        paymentMethod: "razorpay",
        status: "SUCCESS",
        completedAt: AT,
        razorpayOrderId: `order_${tag}_${row.id}`,
        idempotencyKey: `${tag}-pay-${row.id}`,
      },
    });
  }
  return row;
}

let q = 0;
const quote = (c: { id: string; origin: DataOrigin | null }) =>
  prisma.analyticsEvent.create({
    data: {
      eventId: `${tag}-q-${(q += 1)}`,
      eventName: "QUOTE_GENERATED",
      occurredAt: AT,
      actorUserId: c.id,
      source: "BACKEND",
      platform: "SERVER",
      environment: "test",
      dataOrigin: c.origin,
    },
  });

const m1 = await customer("m1", null);
const m2 = await customer("m2", null);
const m3 = await customer("m3", null);
const mt = await customer("mt", "TEST");

const m1a = await booking(m1, "COMPLETED", 400);
const m1b = await booking(m1, "COMPLETED");
const m2a = await booking(m2, "COMPLETED", 300);
await booking(m2, "CANCELLED_BY_USER");
const mta = await booking(mt, "COMPLETED", 999);
for (const c of [m1, m2, m3, mt]) await quote(c);

const reviews: Array<[string, string, number, string]> = [
  [m1.id, m1a.id, 5, "Thorough and on time."],
  [m1.id, m1b.id, 4, "Good work, slightly late."],
  [m2.id, m2a.id, 5, "Excellent."],
  [mt.id, mta.id, 1, "Test-population review."],
];
for (const [userId, bookingId, rating, reviewText] of reviews) {
  const r = await ratingService.create(userId, { bookingId, rating, reviewText });
  if ("error" in r) throw new Error(`rating ${bookingId}: ${r.error}`);
}

writeFileSync(
  out,
  JSON.stringify(
    {
      runId,
      database: db,
      day: DAY,
      password: "AdvTest@123",
      superAdmin: { email: `${tag}-super-admin@adv.test`, id: ctx.superAdmin.id },
      partner: { email: `${tag}-vendor@adv.test`, userId: ctx.vendorUserId, providerId: ctx.providerId },
      expected: { completionPct: 75, cancellationPct: 25, repeatPct: 50, quoteToBookingPct: 66.7, capturedGmv: 700, ownerReviews: 4 },
    },
    null,
    2,
  ),
);
console.log(`seeded ${runId} on ${db}`);
process.exit(0);
