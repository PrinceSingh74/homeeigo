import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerOperationsService } from "../services/partner-operations.service";
import { computeCapacity, MAX_CONCURRENT_JOBS } from "../lib/partner-capacity";

/**
 * OWNER DECISION #10/#11 — `maxConcurrentJobs` is a WORKLOAD cap, and stays one.
 *
 * ── The question ────────────────────────────────────────────────────────────
 *
 * `currentJobs` counts every booking in a concurrent status with no time bound, and `reservedOffers`
 * counts every unanswered offer the same way. A partner holding four accepted bookings across next
 * month is therefore at capacity. Read against the field's name that looks like a bug, and the first
 * answer — taken, implemented, and then reversed — was to scope both to the booking's own time slot.
 *
 * ── Why that answer was wrong ───────────────────────────────────────────────
 *
 * `bookings_provider_slot_excl` is an EXCLUDE constraint over (provider_id, slot range) with no
 * status filter, so the database already refuses to let one partner hold two bookings whose slots
 * overlap. Under a time-scoped reading `currentJobs` could never exceed 1 and a limit defaulting to 4
 * would be dead code. The first version of this file proved it by accident: seeding two accepted
 * bookings twenty minutes apart for one partner is rejected with 23P01, so the "two concurrent
 * bookings fill the budget" case could not even be set up.
 *
 * Simultaneity is enforced a layer down. This limit is the only thing capping how much unfinished
 * work a partner holds, which is a coherent rule and the behaviour the platform has always had.
 *
 * These cases pin the semantics that were kept, and the constraint that decided it — because the next
 * person to read the field name will have the same instinct.
 */
const RUN = `capacity-decision-${Date.now().toString(36)}`;
const HOUR = 3_600_000;
let ctx: AdvCtx;
let dbOk = false;

async function seedBooking(index: number, at: Date, status: BookingStatus) {
  const id = `${RUN}-b-${index}`;
  await prisma.$executeRawUnsafe(
    // `booking_completed_requires_timestamp`: a COMPLETED row must carry a completion time. This
    // seeder omitted it and passed only while the test database lacked the CHECK.
    `INSERT INTO bookings (id, booking_number, user_id, provider_id, service_id, address_id, scheduled_date,
                           base_amount, final_amount, total_amount, status, completed_at, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 100, 100, 100, $8::"BookingStatus",
             CASE WHEN $8::text = 'COMPLETED' THEN NOW() ELSE NULL END, NOW(), NOW())`,
    id,
    `${id}-BN`,
    ctx.customerA.id,
    ctx.providerId,
    ctx.serviceId,
    ctx.addressAId,
    at,
    status,
  );
  return id;
}

async function clearAll() {
  await prisma.assignmentAttempt.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.booking.deleteMany({ where: { providerId: ctx.providerId } });
}

async function offerBlockedAt(at: Date): Promise<string | null> {
  await heartbeatFresh(ctx);
  return prisma.$transaction((tx) =>
    partnerOperationsService.assertOfferEligible(tx, ctx.providerId, {
      latitude: 28.62,
      longitude: 77.37,
      scheduledDate: at,
    }),
  );
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      maxConcurrentJobs: 2,
      maxJobsPerDay: null,
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      workingDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      isOnline: true,
      serviceRegions: [],
      baseLatitude: 28.62,
      baseLongitude: 77.37,
      serviceRadiusKm: 50,
    },
  });
  await clearAll();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearAll();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("the database already prevents true simultaneity", () => {
  test("one partner cannot hold two bookings whose slots overlap, whatever the capacity limit says", async () => {
    if (!dbOk) return;
    await clearAll();
    const at = new Date(Date.now() + 500 * HOUR);

    await seedBooking(0, at, BookingStatus.ACCEPTED);

    /**
     * This is the fact that decided the semantics. If the capacity rule were scoped to the slot, it
     * would be counting something the database already caps at one — a limit of 4 could never bind.
     */
    await expect(
      (async () => {
        await seedBooking(1, new Date(at.getTime() + 20 * 60_000), BookingStatus.ACCEPTED);
      })(),
    ).rejects.toThrow();
  });

  test("bookings far enough apart are allowed, so a forward book is normal", async () => {
    if (!dbOk) return;
    await clearAll();
    const at = new Date(Date.now() + 600 * HOUR);

    await seedBooking(0, at, BookingStatus.ACCEPTED);
    await seedBooking(1, new Date(at.getTime() + 2 * HOUR), BookingStatus.ACCEPTED);

    expect(await prisma.booking.count({ where: { providerId: ctx.providerId } })).toBe(2);
  });
});

describe("the limit caps unfinished work, not simultaneous work", () => {
  test("a partner at their limit on future bookings is not offered more", async () => {
    if (!dbOk) return;
    await clearAll();
    // Two accepted bookings on different days, against a cap of 2.
    await seedBooking(0, new Date(Date.now() + 200 * HOUR), BookingStatus.ACCEPTED);
    await seedBooking(1, new Date(Date.now() + 300 * HOUR), BookingStatus.ACCEPTED);

    /**
     * Kept deliberately. A partner who has taken on as much unfinished work as they said they can
     * handle is not sent more, and the alternative reading would have removed that protection
     * entirely rather than refining it.
     */
    expect(await offerBlockedAt(new Date(Date.now() + 400 * HOUR))).toBe("CAPACITY_LIMIT");
  });

  test("below the limit the partner is still offered work", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedBooking(0, new Date(Date.now() + 200 * HOUR), BookingStatus.ACCEPTED);

    expect(await offerBlockedAt(new Date(Date.now() + 400 * HOUR))).toBeNull();
  });

  test("finished work releases the budget", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedBooking(0, new Date(Date.now() + 200 * HOUR), BookingStatus.COMPLETED);
    await seedBooking(1, new Date(Date.now() + 300 * HOUR), BookingStatus.COMPLETED);

    // COMPLETED is not a concurrent status, so a partner's history never accumulates against them.
    expect(await offerBlockedAt(new Date(Date.now() + 400 * HOUR))).toBeNull();
  });

  test("a partner can raise the cap themselves, up to the platform ceiling", async () => {
    if (!dbOk) return;
    await clearAll();
    await seedBooking(0, new Date(Date.now() + 200 * HOUR), BookingStatus.ACCEPTED);
    await seedBooking(1, new Date(Date.now() + 300 * HOUR), BookingStatus.ACCEPTED);
    expect(await offerBlockedAt(new Date(Date.now() + 400 * HOUR))).toBe("CAPACITY_LIMIT");

    // The cap is the partner's own declared workload, not a platform judgement about them.
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { maxConcurrentJobs: 5 } });
    expect(await offerBlockedAt(new Date(Date.now() + 400 * HOUR))).toBeNull();

    await prisma.provider.update({ where: { id: ctx.providerId }, data: { maxConcurrentJobs: 2 } });
  });
});

describe("reserved offers hold a place — decision #11", () => {
  test("an unanswered offer counts toward the budget", () => {
    /**
     * Kept for the same reason. Between dispatching an offer and the partner answering it, the work
     * is provisionally theirs; if offers did not reserve capacity a partner could be sent more work
     * than their limit and accept all of it.
     */
    const withOffers = computeCapacity({
      currentJobs: 1,
      reservedOffers: 1,
      jobsToday: 0,
      maxConcurrentJobs: 2,
      maxJobsPerDay: null,
    });
    expect(withOffers.capacityFull).toBe(true);
    expect(withOffers.availableSlots).toBe(0);
  });

  test("an answered offer stops holding it", () => {
    const afterAnswer = computeCapacity({
      currentJobs: 1,
      reservedOffers: 0,
      jobsToday: 0,
      maxConcurrentJobs: 2,
      maxJobsPerDay: null,
    });
    expect(afterAnswer.capacityFull).toBe(false);
    expect(afterAnswer.availableSlots).toBe(1);
  });

  test("the ceiling a partner may set is bounded", () => {
    // The database CHECK and the library agree, so settings cannot exceed what capacity math expects.
    expect(MAX_CONCURRENT_JOBS).toBe(20);
  });
});
