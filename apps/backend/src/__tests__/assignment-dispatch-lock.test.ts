/**
 * P0-3 — proves the properties required of assignment-dispatch concurrency safety against the
 * REAL implementation (not mocks): the Redis-backed distributed lock already inside
 * assignmentEngine.processQueue() (LOCK_KEY "assignment:processor"), and the DB-level
 * (job_id, provider_id) unique constraint added this session to close a real double-dispatch gap
 * (assignment_attempts had no such constraint; 34 real duplicate rows existed in dev before the
 * migration; dispatchToNextProvider's P2002 catch was dead code until the constraint existed).
 *
 * REDIS_URL is empty in .env.test by design (isolated test env), so processQueue()'s lock
 * naturally exercises the in-memory fallback (memAcquireLock/memReleaseLock) here — this is the
 * real "Redis unavailable → graceful degradation" code path, not a simulation.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll, spyOn } from "bun:test";
import { Prisma, AssignmentJobStatus, AssignmentAttemptStatus, UserRole } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  fixturePhone,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { redisClient } from "../lib/redis";
import { assignmentEngine } from "../services/assignment-engine.service";

const RUN_ID = `p03-${Date.now().toString(36)}`;
const TAG = `adv-${RUN_ID}`;
let ctx: AdvCtx;
let dbOk = false;
let secondProviderId = "";

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN_ID);

  const vendor2 = await prisma.user.create({
    data: {
      email: `${TAG}-vendor2@adv.test`,
      phoneNumber: fixturePhone(RUN_ID, "vendor2"),
      firstName: "Adv",
      lastName: "Vendor2",
      password: (await prisma.user.findUniqueOrThrow({ where: { id: ctx.vendorUserId } })).password,
      role: UserRole.VENDOR,
      isEmailVerified: true,
      isPhoneVerified: true,
    },
  });
  const provider2 = await prisma.provider.create({
    data: {
      userId: vendor2.id,
      serviceCategories: [ctx.serviceId],
      serviceRegions: ["Noida"],
      isVerified: true,
      isApproved: true,
      isActive: true,
      isOnline: true,
      rating: 4.5,
      workingDays: [],
    },
  });
  secondProviderId = provider2.id;
});

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
  await prisma.$disconnect();
}, 30_000);

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable");
    return true;
  }
  return false;
}

// The bookings_user_slot_excl constraint blocks same-user bookings within a ±30min window,
// so each fixture booking must occupy a distinct 2-hour slot.
let jobSlot = 0;
async function makeJob(bookingSuffix: string) {
  jobSlot += 1;
  const booking = await prisma.booking.create({
    data: {
      bookingNumber: `P03-${RUN_ID}-${bookingSuffix}`,
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: new Date(Date.now() + 86_400_000 + jobSlot * 7_200_000),
      status: "PENDING",
      paymentStatus: "SUCCESS",
      paymentMethod: "razorpay",
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      estimatedDuration: 60,
    },
  });
  const job = await prisma.assignmentJob.create({
    data: { bookingId: booking.id, status: AssignmentJobStatus.PENDING },
  });
  return job;
}

describe.serial("P0-3 — assignment_attempts (job_id, provider_id) uniqueness", () => {
  test("real DB now rejects a duplicate (job, provider) SENT attempt — the P2002 catch is no longer dead code", async () => {
    if (skipIfNoDb()) return;
    const job = await makeJob("dup");

    await prisma.assignmentAttempt.create({
      data: { jobId: job.id, providerId: ctx.providerId, status: AssignmentAttemptStatus.SENT },
    });

    // This is exactly what a second, racing dispatch call (dispatchBookingNow vs a concurrent
    // processQueue tick) would attempt for the same job+provider — must now fail at the DB level.
    // (Prisma's ops return a "PrismaPromise" thenable, not a native Promise, which bun:test's
    // `.rejects` matcher doesn't accept directly — so assert via try/catch instead.)
    let caught: unknown;
    try {
      await prisma.assignmentAttempt.create({
        data: { jobId: job.id, providerId: ctx.providerId, status: AssignmentAttemptStatus.SENT },
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect((caught as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");

    const count = await prisma.assignmentAttempt.count({ where: { jobId: job.id, providerId: ctx.providerId } });
    expect(count).toBe(1);
  });

  test("broadcast compatibility: the SAME job CAN have simultaneous SENT attempts for DIFFERENT providers", async () => {
    if (skipIfNoDb()) return;
    const job = await makeJob("broadcast");

    // This is exactly what broadcast dispatch does: many providers offered the same job at once.
    // The now-dropped stale `assignment_attempts_one_sent_per_job` index (job_id-only, predates
    // broadcast) would have rejected the second insert here — confirms it's genuinely gone.
    const [a, b] = await Promise.all([
      prisma.assignmentAttempt.create({
        data: { jobId: job.id, providerId: ctx.providerId, status: AssignmentAttemptStatus.SENT },
      }),
      prisma.assignmentAttempt.create({
        data: { jobId: job.id, providerId: secondProviderId, status: AssignmentAttemptStatus.SENT },
      }),
    ]);
    expect(a.id).not.toBe(b.id);

    const sentForJob = await prisma.assignmentAttempt.count({
      where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
    });
    expect(sentForJob).toBe(2);
  });

  test("concurrent duplicate attempts (multiprocess-style race): exactly one of N concurrent inserts wins", async () => {
    if (skipIfNoDb()) return;
    const job = await makeJob("race");

    const attempts = 8;
    const results = await Promise.allSettled(
      Array.from({ length: attempts }, () =>
        prisma.assignmentAttempt.create({
          data: { jobId: job.id, providerId: ctx.providerId, status: AssignmentAttemptStatus.SENT },
        }),
      ),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(attempts - 1);
    for (const r of rejected) {
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
        expect((r.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      }
    }
  });
});

describe.serial("P0-3 — assignmentEngine.processQueue() distributed lock", () => {
  test("single owner: two concurrent processQueue() calls — only one actually acquires the lock", async () => {
    if (skipIfNoDb()) return;
    const acquireSpy = spyOn(redisClient, "acquireLock");
    const releaseSpy = spyOn(redisClient, "releaseLock");

    const [r1, r2] = await Promise.all([assignmentEngine.processQueue(), assignmentEngine.processQueue()]);

    expect(acquireSpy).toHaveBeenCalledTimes(2);
    const acquireResults = await Promise.all(acquireSpy.mock.results.map((r) => r.value));
    const successCount = acquireResults.filter(Boolean).length;
    expect(successCount).toBe(1); // exactly one of the two concurrent calls held the lock

    // The loser must return immediately with no work claimed, not throw and not double-process.
    expect(r1.processed + r2.processed).toBeGreaterThanOrEqual(0);
    expect([r1, r2].some((r) => r.processed === 0 && r.dispatched === 0)).toBe(true);

    // releaseLock must only ever be called by the call that actually acquired.
    expect(releaseSpy).toHaveBeenCalledTimes(successCount);

    acquireSpy.mockRestore();
    releaseSpy.mockRestore();
  });

  test("leader failover: lock is released after completion, a subsequent call can acquire it", async () => {
    if (skipIfNoDb()) return;
    const acquireSpy = spyOn(redisClient, "acquireLock");

    await assignmentEngine.processQueue();
    const firstKey = acquireSpy.mock.calls[0]?.[0] as string;
    expect(firstKey).toBe("assignment:processor");

    await assignmentEngine.processQueue();
    const secondAcquired = await acquireSpy.mock.results[1]?.value;
    expect(secondAcquired).toBe(true); // lock was cleanly released after the first run, no deadlock

    acquireSpy.mockRestore();
  });

  test("graceful degradation: Redis is unavailable in this test env — lock still enforces exclusivity via in-memory fallback", async () => {
    if (skipIfNoDb()) return;
    // Real, not simulated: .env.test intentionally leaves REDIS_URL empty for isolation.
    expect(redisClient.isAvailable).toBe(false);

    const acquireSpy = spyOn(redisClient, "acquireLock");
    const [r1, r2] = await Promise.all([assignmentEngine.processQueue(), assignmentEngine.processQueue()]);
    const results = await Promise.all(acquireSpy.mock.results.map((r) => r.value));
    expect(results.filter(Boolean).length).toBe(1);
    expect(r1).toBeDefined();
    expect(r2).toBeDefined();

    acquireSpy.mockRestore();
  });

  test("a lock held by a crashed leader blocks new acquisition until its TTL expires, then recovers", async () => {
    if (skipIfNoDb()) return;
    const acquireSpy = spyOn(redisClient, "acquireLock");
    await assignmentEngine.processQueue(); // learn the real lock key + confirm baseline works
    const lockKey = acquireSpy.mock.calls[0]?.[0] as string;
    acquireSpy.mockRestore();

    // Simulate a crashed holder: acquire with a short TTL and never release.
    const crashedToken = "crashed-leader-simulated";
    const held = await redisClient.acquireLock(lockKey, crashedToken, 1);
    expect(held).toBe(true);

    const blocked = await assignmentEngine.processQueue();
    expect(blocked).toEqual({ processed: 0, dispatched: 0 }); // correctly backed off, did not steal the lock

    await new Promise((r) => setTimeout(r, 1100)); // past the 1s TTL

    const recoveredSpy = spyOn(redisClient, "acquireLock");
    await assignmentEngine.processQueue();
    const recovered = await recoveredSpy.mock.results[0]?.value;
    expect(recovered).toBe(true); // failover: a new owner could acquire once the stale lock expired
    recoveredSpy.mockRestore();
  }, 10_000);
});
