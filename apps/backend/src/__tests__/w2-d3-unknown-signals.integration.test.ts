/**
 * W2-D3 end to end: real matching, real bookings table, real evidence counting.
 *
 * The fixture partner starts with NO history — zero reviews, zero bookings — which is exactly the
 * case the old scorer filled with invented values. This file asserts what ranking now says about
 * them, then gives them real history and asserts the signals switch on from real evidence.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { matchingService } from "../services/matching.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `w2d3-${Date.now().toString(36)}`;
// The fixture partner's heartbeat upserts its `locations` row at these coordinates, and distance is
// measured from that row first. A customer point elsewhere put the partner outside its own 8 km
// radius — which is correct behaviour, and not what this file is testing.
const LAT = 28.62;
const LNG = 77.37;
let ctx: AdvCtx;
let dbOk = false;

async function freshPresence(withCoords = true) {
  const now = new Date();
  const loc = withCoords ? { lastLocationAt: now, lastLocationLat: LAT, lastLocationLng: LNG } : {};
  await prisma.partnerPresence.upsert({
    where: { providerId: ctx.providerId },
    create: { providerId: ctx.providerId, lastHeartbeatAt: now, lastSeenAt: now, ...loc },
    update: { lastHeartbeatAt: now, lastSeenAt: now, ...loc },
  });
}

const match = async () =>
  (
    await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      customerId: ctx.customerA.id,
      latitude: LAT,
      longitude: LNG,
      scheduledDate: new Date(Date.now() + 36 * 3_600_000),
    })
  ).find((m) => m.providerId === ctx.providerId);

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
      pausedAt: null,
      isBanned: false,
      // The columns the old scorer read as if measured. Zero history, stored defaults.
      rating: 0,
      totalReviews: 0,
      completionRate: 0,
      responseRate: 100, // what rating.service used to WRITE for "no recent bookings"
    },
  });
  await partnerOperationsService.setOnline(ctx.providerId, true);
  await freshPresence();
}, 120_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("a provider with no history", () => {
  test("is matchable — missing history is not a punishment", async () => {
    if (!dbOk) return;
    expect(await match()).toBeDefined();
  });

  test("has NO rating, completion or response signal — not 15, not 1, not a stored 100%", async () => {
    if (!dbOk) return;
    const m = (await match())!;
    expect(m.scoreBreakdown.ratingScore).toBeNull();
    expect(m.scoreBreakdown.completionScore).toBeNull();
    // The stored responseRate is 100. Without evidence it must not be read.
    expect(m.scoreBreakdown.responseScore).toBeNull();
    expect(m.unknownSignals).toEqual(expect.arrayContaining(["rating", "completion", "response"]));
  });

  test("is still scored on what IS known — distance and availability are real", async () => {
    if (!dbOk) return;
    const m = (await match())!;
    expect(m.scoreBreakdown.distanceScore).not.toBeNull();
    expect(m.scoreBreakdown.availabilityScore).toBeGreaterThan(0);
    expect(typeof m.distance).toBe("number");
    expect(typeof m.eta).toBe("number");
    expect(m.totalScore).toBeGreaterThan(0);
  });
});

describe.serial("a provider whose position is unknown", () => {
  test("gets no invented distance and no ETA — and is not dispatched", async () => {
    if (!dbOk) return;
    // Remove every source of position: base coords, the Location row, the presence coordinates.
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { baseLatitude: null, baseLongitude: null, serviceRadiusKm: null } });
    await prisma.location.deleteMany({ where: { providerId: ctx.providerId } });
    await freshPresence(false);
    await prisma.partnerPresence.update({
      where: { providerId: ctx.providerId },
      data: { lastLocationAt: null, lastLocationLat: null, lastLocationLng: null },
    });
    // The old scorer would have given this provider a 15 km distance and a real-looking ETA.
    expect(await match()).toBeUndefined();

    // restore for the next block
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { baseLatitude: LAT, baseLongitude: LNG, serviceRadiusKm: 8 } });
    await freshPresence();
  });
});

describe.serial("real history switches the signals on — from counted evidence", () => {
  test("enough terminal and recent bookings make completion and response known", async () => {
    if (!dbOk) return;
    // Real booking rows, attributed to the fixture partner. Evidence is COUNTED from these, not read
    // from the stored rate columns.
    const base = {
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressAId,
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
    } as const;
    for (let i = 0; i < 4; i++) {
      await prisma.booking.create({
        data: {
          ...base,
          bookingNumber: `${RUN}-HIST-${i}`,
          status: BookingStatus.COMPLETED,
          scheduledDate: new Date(Date.now() - (i + 2) * 86_400_000),
          completedAt: new Date(Date.now() - (i + 2) * 86_400_000),
        } as never,
      });
    }
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { completionRate: 100, responseRate: 100 } });

    const m = (await match())!;
    expect(m.scoreBreakdown.completionScore).toBe(10);
    expect(m.scoreBreakdown.responseScore).not.toBeNull();
    expect(m.unknownSignals).not.toContain("completion");
    expect(m.unknownSignals).not.toContain("response");
  });

  test("the rating stays unknown until there are enough reviews behind it", async () => {
    if (!dbOk) return;
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { rating: 5, totalReviews: 2 } });
    expect((await match())!.scoreBreakdown.ratingScore).toBeNull();
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { rating: 4.9, totalReviews: 12 } });
    expect((await match())!.scoreBreakdown.ratingScore).toBe(30);
  });
});
