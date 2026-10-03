/**
 * W2-D4 behaviourally: the two populations are disjoint at every place a partner is chosen.
 *
 * One fixture set, with provenance flipped per case exactly as `matching-population` does. Each case
 * is a leak that was open before this change.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus, type DataOrigin } from "@prisma/client";
import prisma from "../lib/prisma";
import { matchingService } from "../services/matching.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import { bookingService } from "../services/booking.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import { ratingService } from "../services/rating.service";
import { cleanupAdversarialFixtures, dbReachable, keepPresenceFresh, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `w2d4-${Date.now().toString(36)}`;
const LAT = 28.62;
const LNG = 77.37;
let ctx: AdvCtx;
let dbOk = false;
let day = 6;
const created: string[] = [];

const setOrigin = (userId: string, origin: DataOrigin | null) =>
  prisma.user.update({ where: { id: userId }, data: { dataOrigin: origin } });

const inPool = async (customerId: string | undefined) =>
  (
    await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      customerId,
      latitude: LAT,
      longitude: LNG,
      scheduledDate: new Date(Date.now() + 36 * 3_600_000),
    })
  ).some((m) => m.providerId === ctx.providerId);

function istSlot(daysAhead: number): string {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T10:00:00+05:30`).toISOString();
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
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      maxConcurrentJobs: 4,
      maxJobsPerDay: 20,
      serviceRadiusKm: 8,
      baseLatitude: LAT,
      baseLongitude: LNG,
      serviceRegions: [],
      pausedAt: null,
    },
  });
  await partnerOperationsService.setOnline(ctx.providerId, true);
  const now = new Date();
  await prisma.partnerPresence.upsert({
    where: { providerId: ctx.providerId },
    create: { providerId: ctx.providerId, lastHeartbeatAt: now, lastSeenAt: now, lastLocationAt: now, lastLocationLat: LAT, lastLocationLng: LNG },
    update: { lastHeartbeatAt: now, lastSeenAt: now, lastLocationAt: now, lastLocationLat: LAT, lastLocationLng: LNG },
  });
}, 120_000);

afterEach(async () => {
  if (!dbOk || created.length === 0) return;
  await prisma.$executeRaw`UPDATE bookings SET status = 'CANCELLED_BY_USER', cancelled_at = NOW() WHERE id = ANY(${created})`;
  created.length = 0;
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("fixtures are born classified", () => {
  test("the harness's users carry provenance from creation — no backfill needed", async () => {
    if (!dbOk) return;
    const rows = await prisma.user.findMany({
      where: { id: { in: [ctx.customerA.id, ctx.customerB.id, ctx.vendorUserId] } },
      select: { dataOrigin: true },
    });
    for (const r of rows) expect(r.dataOrigin).toBe("INFERRED_SYNTHETIC");
  });
});

describe.serial("matching: the populations are disjoint", () => {
  test("a query with NO customer is a business query — the fixture partner is absent", async () => {
    if (!dbOk) return;
    expect(await inPool(undefined)).toBe(false);
  });

  test("a REAL customer is never matched to a fixture partner", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.customerB.id, "REAL");
    expect(await inPool(ctx.customerB.id)).toBe(false);
    await setOrigin(ctx.customerB.id, "INFERRED_SYNTHETIC");
  });

  test("a fixture customer IS matched to a fixture partner — the suites keep working", async () => {
    if (!dbOk) return;
    expect(await inPool(ctx.customerA.id)).toBe(true);
  });

  test("a fixture customer is NOT matched to a REAL partner — the leak that used to be open", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.vendorUserId, "REAL");
    expect(await inPool(ctx.customerA.id)).toBe(false);
    await setOrigin(ctx.vendorUserId, "INFERRED_SYNTHETIC");
  });
});

describe.serial("direct selection cannot cross populations either", () => {
  test("a real customer cannot book a fixture partner by naming its id", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.customerB.id, "REAL");
    await keepPresenceFresh(ctx);
    const r = await bookingService.create(ctx.customerB.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressBId,
      scheduledDate: istSlot((day += 1)),
    });
    expect("booking" in r && r.booking).toBeFalsy();
    await setOrigin(ctx.customerB.id, "INFERRED_SYNTHETIC");
  });

  test("the same fixture partner is bookable by a fixture customer", async () => {
    if (!dbOk) return;
    await keepPresenceFresh(ctx);
    const r = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressAId,
      scheduledDate: istSlot((day += 1)),
    });
    expect("booking" in r && r.booking).toBeTruthy();
    if ("booking" in r && r.booking) created.push(r.booking.id);
  });
});

describe.serial("support cannot cross populations", () => {
  test("an admin cannot hand a REAL customer's booking to a fixture partner", async () => {
    if (!dbOk) return;
    await keepPresenceFresh(ctx);
    // Create the booking while both are fixtures, then reclassify the customer as REAL — the state
    // an admin reassignment would meet in production.
    const r = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: istSlot((day += 1)),
    });
    if (!("booking" in r) || !r.booking) throw new Error(`create failed: ${JSON.stringify(r)}`);
    created.push(r.booking.id);
    await setOrigin(ctx.customerA.id, "REAL");
    await expect(
      adminBookingOperationsService.reassignProvider(r.booking.id, ctx.superAdmin.id, ctx.providerId, "test", undefined, true),
    ).rejects.toThrow("REASSIGN_BLOCKED:POPULATION_MISMATCH");
    await setOrigin(ctx.customerA.id, "INFERRED_SYNTHETIC");
  });
});

describe.serial("a partner's rating is computed over its own population", () => {
  test("a certification rating does not move a REAL partner's rating", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.vendorUserId, "REAL");
    // A completed booking by a FIXTURE customer on the (now real) partner, rated 1 star.
    const b = await prisma.booking.create({
      data: {
        bookingNumber: `${RUN}-RATE`,
        // Exactly what bookingService.create writes for a non-business customer: the booking
        // inherits the customer's origin, and the rating inherits it from the booking.
        dataOrigin: "INFERRED_SYNTHETIC",
        userId: ctx.customerA.id,
        serviceId: ctx.serviceId,
        providerId: ctx.providerId,
        addressId: ctx.addressAId,
        status: BookingStatus.COMPLETED,
        scheduledDate: new Date(Date.now() - 86_400_000),
        completedAt: new Date(Date.now() - 86_400_000),
        baseAmount: 500,
        finalAmount: 500,
        totalAmount: 500,
      } as never,
    });
    await prisma.rating.create({ data: { bookingId: b.id, userId: ctx.customerA.id, providerId: ctx.providerId, stars: 1 } as never });

    const rating = await ratingService.calculateProviderRating(ctx.providerId);
    // The only rating is from the other population, so the real partner has no rating at all.
    expect(rating).toBe(0);
    await setOrigin(ctx.vendorUserId, "INFERRED_SYNTHETIC");
  });

  test("the same rating DOES count for a fixture partner — its own world", async () => {
    if (!dbOk) return;
    const rating = await ratingService.calculateProviderRating(ctx.providerId);
    expect(rating).toBe(1);
  });
});
