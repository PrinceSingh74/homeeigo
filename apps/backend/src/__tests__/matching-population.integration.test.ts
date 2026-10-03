/**
 * A business customer must never be matched to a fixture partner.
 *
 * Measured on the live database on 2026-09-21: 20 of the 57 partners a customer could be dispatched
 * to were certification/test accounts, and 9 bookings by non-fixture customers had been assigned to
 * one — four still ASSIGNED/ACCEPTED/EN_ROUTE with a partner who does not exist.
 * `matchingService.loadCandidates` now restricts a business customer's pool to business partners;
 * a fixture customer stays unrestricted so certification suites that pair fixtures keep working.
 *
 * Drives real matching end-to-end (the same online/presence setup the correlated e2e suite uses) and
 * changes only `users.data_origin` between cases, so each assertion isolates the population rule.
 *
 * Runs against `homigo_test`.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import { matchingService } from "../services/matching.service";
import { bookingService } from "../services/booking.service";
import { partnerOperationsService } from "../services/partner-operations.service";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `mpop-${Date.now().toString(36)}`;
const LAT = 28.62;
const LNG = 77.37;
let ctx: AdvCtx;
let dbOk = false;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      isOnline: false,
      currentStatus: "offline",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      maxConcurrentJobs: 4,
      maxJobsPerDay: 20,
      serviceRadiusKm: 8,
      baseLatitude: LAT,
      baseLongitude: LNG,
      city: "Noida",
      serviceRegions: ["Noida"],
      pausedAt: null,
      pauseReason: null,
      isBanned: false,
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

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

const inPool = async (customerId: string) =>
  (
    await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      customerId,
      latitude: LAT,
      longitude: LNG,
      scheduledDate: new Date(Date.now() + 36 * 3_600_000),
    })
  ).some((m) => m.providerId === ctx.providerId);

const setOrigin = (userId: string, origin: "REAL" | "CERTIFICATION" | null) =>
  prisma.user.update({ where: { id: userId }, data: { dataOrigin: origin } });

describe.serial("matching — candidate population follows the customer's", () => {
  test("before any backfill (all UNKNOWN) the partner is matchable — the rule is inert", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.vendorUserId, null);
    await setOrigin(ctx.customerA.id, null);
    expect(await inPool(ctx.customerA.id)).toBe(true);
  });

  test("a business customer is NOT matched to a certification partner", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.vendorUserId, "CERTIFICATION");
    await setOrigin(ctx.customerA.id, "REAL");
    expect(await inPool(ctx.customerA.id)).toBe(false);
  });

  test("an UNKNOWN customer counts as business and is also kept away from it", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.customerA.id, null);
    expect(await inPool(ctx.customerA.id)).toBe(false);
  });

  test("a certification customer can still be matched to it, so suites keep working", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.customerA.id, "CERTIFICATION");
    expect(await inPool(ctx.customerA.id)).toBe(true);
  });

  test("a business partner stays matchable for a business customer", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.vendorUserId, "REAL");
    await setOrigin(ctx.customerA.id, "REAL");
    expect(await inPool(ctx.customerA.id)).toBe(true);
  });
});

describe.serial("booking provenance — inherited from a non-business customer", () => {
  const book = async (customerId: string, addressId: string, hoursAhead: number) => {
    const r = await bookingService.create(customerId, {
      serviceId: ctx.serviceId,
      scheduledDate: new Date(Date.now() + hoursAhead * 3_600_000).toISOString(),
      addressId,
      description: `population ${RUN}`,
    });
    if (!("booking" in r) || !r.booking) throw new Error(`create failed: ${JSON.stringify(r)}`);
    return prisma.booking.findUniqueOrThrow({ where: { id: r.booking.id }, select: { dataOrigin: true } });
  };

  test("a CERTIFICATION customer's booking is CERTIFICATION", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.customerA.id, "CERTIFICATION");
    expect((await book(ctx.customerA.id, ctx.addressAId, 60)).dataOrigin).toBe("CERTIFICATION");
  });

  test("a business customer's booking is left UNKNOWN — real bookings are untouched", async () => {
    if (!dbOk) return;
    await setOrigin(ctx.customerB.id, null);
    expect((await book(ctx.customerB.id, ctx.addressBId, 84)).dataOrigin).toBeNull();
  });
});
