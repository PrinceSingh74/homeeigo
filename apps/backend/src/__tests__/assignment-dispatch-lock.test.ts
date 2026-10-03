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
import { provenanceForNewUser } from "../lib/data-provenance";
import { describe, test, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { Prisma, AssignmentJobStatus, AssignmentAttemptStatus, UserRole } from "@prisma/client";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  fixturePhone,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { redisClient, resetMemoryLocksForTests } from "../lib/redis";
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
      ...provenanceForNewUser(`${TAG}-vendor2@adv.test`),
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
  const LOCK_KEY = "assignment:processor";

  beforeEach(() => {
    resetMemoryLocksForTests();
  });

  afterEach(() => {
    resetMemoryLocksForTests();
  });

  test("held lock: processQueue does not steal work while another owner holds the key", async () => {
    if (skipIfNoDb()) return;
    const held = await redisClient.acquireLock(LOCK_KEY, "external-holder", 30);
    expect(held).toBe(true);

    const [r1, r2] = await Promise.all([assignmentEngine.processQueue(), assignmentEngine.processQueue()]);
    expect(r1).toEqual({ processed: 0, dispatched: 0 });
    expect(r2).toEqual({ processed: 0, dispatched: 0 });

    await redisClient.releaseLock(LOCK_KEY, "external-holder");
  });

  test("leader failover: lock is released after completion, a subsequent call can acquire it", async () => {
    if (skipIfNoDb()) return;
    const first = await assignmentEngine.processQueue();
    expect(first).toBeDefined();
    const second = await assignmentEngine.processQueue();
    expect(second).toBeDefined();
    // If either run leaked the lock, this probe fails. Tick deadline ensures finally{release} runs.
    const after = await redisClient.acquireLock(LOCK_KEY, "post-run", 5);
    expect(after).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, "post-run");
  }, 90_000);

  test("refreshLock extends same-token TTL and never re-acquires a missing lock", async () => {
    if (skipIfNoDb()) return;
    const key = `refresh-probe-${RUN_ID}`;
    expect(await redisClient.refreshLock(key, "ghost", 5)).toBe(false);
    expect(await redisClient.acquireLock(key, "owner", 5)).toBe(true);
    expect(await redisClient.refreshLock(key, "owner", 5)).toBe(true);
    expect(await redisClient.refreshLock(key, "other", 5)).toBe(false);
    await redisClient.releaseLock(key, "owner");
    expect(await redisClient.refreshLock(key, "owner", 5)).toBe(false);
    const stolen = await redisClient.acquireLock(key, "next", 5);
    expect(stolen).toBe(true);
    await redisClient.releaseLock(key, "next");
  });

  test("graceful degradation: Redis is unavailable in this test env — lock still enforces exclusivity via in-memory fallback", async () => {
    if (skipIfNoDb()) return;
    expect(redisClient.isAvailable).toBe(false);

    const a = await redisClient.acquireLock(LOCK_KEY, "mem-a", 10);
    const b = await redisClient.acquireLock(LOCK_KEY, "mem-b", 10);
    expect(a).toBe(true);
    expect(b).toBe(false); // in-memory fallback is exclusive, not a second independent lock
    await redisClient.releaseLock(LOCK_KEY, "mem-a");
    const c = await redisClient.acquireLock(LOCK_KEY, "mem-b", 10);
    expect(c).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, "mem-b");
  });

  test("a lock held by a crashed leader blocks new acquisition until its TTL expires, then recovers", async () => {
    if (skipIfNoDb()) return;
    const crashedToken = "crashed-leader-simulated";
    const held = await redisClient.acquireLock(LOCK_KEY, crashedToken, 1);
    expect(held).toBe(true);

    const blocked = await assignmentEngine.processQueue();
    expect(blocked).toEqual({ processed: 0, dispatched: 0 });

    await new Promise((r) => setTimeout(r, 1100));

    const recovered = await assignmentEngine.processQueue();
    expect(recovered).toBeDefined();
    const probe = await redisClient.acquireLock(LOCK_KEY, "after-ttl", 5);
    expect(probe).toBe(true);
    await redisClient.releaseLock(LOCK_KEY, "after-ttl");
  }, 10_000);
});
