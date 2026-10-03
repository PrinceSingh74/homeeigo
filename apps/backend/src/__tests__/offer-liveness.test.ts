import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  PaymentStatus,
} from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { providerService } from "../services/provider.service";

/**
 * An offer a partner cannot win must never look like one they can.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 *
 * `myBookings(status="pending")` listed every AssignmentAttempt in SENT. Nothing checked whether the
 * offer was still open, and two separate paths stop closing an attempt row:
 *
 *   1. A job that exhausts its dispatch attempts went straight to EXHAUSTED and abandoned its open
 *      offers. Nothing else in the engine touches an attempt once its job has left the dispatch
 *      states, so those rows stayed SENT permanently.
 *   2. `timeoutAt` is cleared on the way out of the dispatch states, so the timeout sweeper — the
 *      only thing that closes attempts — can no longer see the job either.
 *
 * On live data one partner's "New requests" tab held four such cards, dispatched 24 to 41 days
 * earlier, against a FIVE-MINUTE offer window. The partner taps Accept, the server refuses, and the
 * only feedback is a red toast. That is the reported "accept doesn't work": the Accept button was
 * real, the card behind it was not.
 *
 * These cases pin both halves — the engine now closes what it abandons, and the read path refuses to
 * show an offer that cannot be acted on even if a sweep is lagging. Defence in depth on purpose: a
 * write-side fix alone leaves a window every time the sweeper is late.
 */
const RUN = `offer-liveness-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

async function seedOffer(opts: {
  index: number;
  jobStatus: AssignmentJobStatus;
  attemptStatus?: AssignmentAttemptStatus;
  /** Relative to now; null writes SQL NULL, which is what an exhausted job is left holding. */
  timeoutAtMs: number | null;
  bookingStatus?: BookingStatus;
  /**
   * `getAssignmentQueue` selects only bookings with `providerId: null`, so anything meant to be
   * picked up by a real tick must be seeded unassigned. The first version of these cases pinned the
   * fixture partner onto the booking and then asserted the tick had processed it — it never could.
   */
  queueable?: boolean;
}): Promise<{ bookingId: string; jobId: string }> {
  const bookingId = `${RUN}-b-${opts.index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO bookings (id, booking_number, user_id, provider_id, service_id, address_id, scheduled_date,
                           base_amount, final_amount, total_amount, status, payment_status,
                           priority_score, queued_at, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' hours')::interval, 500, 500, 500,
             $8::"BookingStatus", 'SUCCESS'::"PaymentStatus", $9, NOW(), NOW(), NOW())`,
    bookingId,
    `${bookingId}-BN`,
    ctx.customerA.id,
    opts.queueable ? null : ctx.providerId,
    ctx.serviceId,
    ctx.addressAId,
    String(700 + opts.index * 5),
    opts.bookingStatus ?? BookingStatus.PENDING,
    // Pinned to the front of a FIFO shared with every other suite's leftovers, so one tick reaches it.
    opts.queueable ? 9_000_000 : 10,
  );
  const job = await prisma.assignmentJob.create({
    data: {
      bookingId,
      status: opts.jobStatus,
      currentProviderId: ctx.providerId,
      timeoutAt: opts.timeoutAtMs == null ? null : new Date(Date.now() + opts.timeoutAtMs),
    },
  });
  await prisma.assignmentAttempt.create({
    data: {
      jobId: job.id,
      providerId: ctx.providerId,
      status: opts.attemptStatus ?? AssignmentAttemptStatus.SENT,
    },
  });
  return { bookingId, jobId: job.id };
}

async function pendingFeed() {
  const res = await providerService.myBookings(ctx.providerId, { status: "pending", limit: 50 });
  return res.bookings;
}

async function clearAll() {
  await prisma.assignmentAttempt.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.assignmentJob.deleteMany({
    where: { booking: { id: { startsWith: `${RUN}-b-` } } },
  });
  await prisma.booking.deleteMany({ where: { id: { startsWith: `${RUN}-b-` } } });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await clearAll();
}, 60_000);

beforeEach(async () => {
  if (dbOk) await clearAll();
});

afterAll(async () => {
  if (!dbOk) return;
  await clearAll();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("the pending feed shows only offers that can still be accepted", () => {
  test("a live offer appears, and carries the deadline it is counting down to", async () => {
    if (!dbOk) return;
    const { bookingId } = await seedOffer({
      index: 0,
      jobStatus: AssignmentJobStatus.DISPATCHED,
      timeoutAtMs: 4 * 60_000,
    });

    const feed = await pendingFeed();
    const row = feed.find((b) => b.id === bookingId);

    expect(row).toBeDefined();
    /**
     * The deadline is the whole point. Before this, nothing in the response mentioned that an offer
     * expires at all — which is precisely why the card could not show a clock.
     */
    expect(row!.offer).not.toBeNull();
    expect(row!.offer!.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row!.offer!.dispatchedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("an offer whose window has lapsed is gone, even though the attempt is still SENT", async () => {
    if (!dbOk) return;
    const { bookingId, jobId } = await seedOffer({
      index: 1,
      jobStatus: AssignmentJobStatus.DISPATCHED,
      timeoutAtMs: -60_000,
    });

    // The sweeper has not run — this is exactly the state a lagging sweep leaves behind.
    const attempt = await prisma.assignmentAttempt.findFirst({ where: { jobId } });
    expect(attempt?.status).toBe(AssignmentAttemptStatus.SENT);

    expect((await pendingFeed()).some((b) => b.id === bookingId)).toBe(false);
  });

  test("an abandoned offer on an EXHAUSTED job is gone — the live-data case", async () => {
    if (!dbOk) return;
    /**
     * `timeoutAt: null` reproduces the four real rows exactly: the job gave up, the deadline was
     * cleared, and the attempt was left in SENT with nothing able to close it.
     */
    const { bookingId } = await seedOffer({
      index: 2,
      jobStatus: AssignmentJobStatus.EXHAUSTED,
      timeoutAtMs: null,
    });

    expect((await pendingFeed()).some((b) => b.id === bookingId)).toBe(false);
  });

  test("an offer whose booking was claimed elsewhere is gone", async () => {
    if (!dbOk) return;
    const { bookingId } = await seedOffer({
      index: 3,
      jobStatus: AssignmentJobStatus.DISPATCHED,
      timeoutAtMs: 4 * 60_000,
      bookingStatus: BookingStatus.ACCEPTED,
    });

    expect((await pendingFeed()).some((b) => b.id === bookingId)).toBe(false);
  });

  test("an answered offer is gone", async () => {
    if (!dbOk) return;
    const { bookingId } = await seedOffer({
      index: 4,
      jobStatus: AssignmentJobStatus.DISPATCHED,
      attemptStatus: AssignmentAttemptStatus.TIMEOUT,
      timeoutAtMs: 4 * 60_000,
    });

    expect((await pendingFeed()).some((b) => b.id === bookingId)).toBe(false);
  });

  test("the live offer survives alongside all four dead ones", async () => {
    if (!dbOk) return;
    /**
     * A filter that returns nothing also passes every case above. This is the positive control: the
     * feed must still deliver real work while rejecting the rest.
     */
    const live = await seedOffer({
      index: 5,
      jobStatus: AssignmentJobStatus.DISPATCHED,
      timeoutAtMs: 4 * 60_000,
    });
    await seedOffer({ index: 6, jobStatus: AssignmentJobStatus.DISPATCHED, timeoutAtMs: -60_000 });
    await seedOffer({ index: 7, jobStatus: AssignmentJobStatus.EXHAUSTED, timeoutAtMs: null });
    await seedOffer({
      index: 8,
      jobStatus: AssignmentJobStatus.DISPATCHED,
      timeoutAtMs: 4 * 60_000,
      bookingStatus: BookingStatus.ACCEPTED,
    });

    const feed = await pendingFeed();
    const mine = feed.filter((b) => b.id.startsWith(`${RUN}-b-`));
    expect(mine.map((b) => b.id)).toEqual([live.bookingId]);
  });
});

describe("a row that is not an offer carries no deadline", () => {
  test("an accepted job reports offer = null rather than a stale window", async () => {
    if (!dbOk) return;
    const { bookingId } = await seedOffer({
      index: 9,
      jobStatus: AssignmentJobStatus.ACCEPTED,
      attemptStatus: AssignmentAttemptStatus.ACCEPTED,
      timeoutAtMs: 4 * 60_000,
      bookingStatus: BookingStatus.ACCEPTED,
    });

    const res = await providerService.myBookings(ctx.providerId, { status: "active", limit: 50 });
    const row = res.bookings.find((b) => b.id === bookingId);

    expect(row).toBeDefined();
    // null means "not an offer", never "an offer with no deadline" — the card must not draw a clock.
    expect(row!.offer).toBeNull();
  });
});

describe("giving up on a job closes the offers it still has open", () => {
  test("EXHAUSTED marks every open attempt TIMEOUT instead of abandoning it", async () => {
    if (!dbOk) return;
    const { jobId } = await seedOffer({
      index: 10,
      jobStatus: AssignmentJobStatus.PENDING,
      timeoutAtMs: 2 * 60_000,
      queueable: true,
    });
    await prisma.assignmentJob.update({
      where: { id: jobId },
      data: { dispatchAttempts: 99, maxAttempts: 3 },
    });

    const { assignmentEngine } = await import("../services/assignment-engine.service");
    // exhaustJob is private by design — reached the way production reaches it, through the tick.
    await assignmentEngine.processQueue();

    const job = await prisma.assignmentJob.findUnique({ where: { id: jobId } });
    const attempts = await prisma.assignmentAttempt.findMany({ where: { jobId } });

    expect(job?.status).toBe(AssignmentJobStatus.EXHAUSTED);
    /**
     * TIMEOUT rather than a new status: the attempt IS an offer whose window closed unanswered, and
     * that word already carries that meaning in the acceptance rate, the dispatch metrics and the
     * partner's own history. A second word for it would split all three readings in two.
     */
    expect(attempts.every((a) => a.status === AssignmentAttemptStatus.TIMEOUT)).toBe(true);
    expect(attempts.every((a) => a.respondedAt != null)).toBe(true);
    // The deadline is cleared too, so nothing downstream reads a window that no longer applies.
    expect(job?.timeoutAt).toBeNull();
  }, 60_000);

  test("the old predicate would still return these rows — the filter is what removes them", async () => {
    if (!dbOk) return;
    /**
     * The discriminating control for the whole file.
     *
     * Every "is gone" case above passes just as well against a feed that returns nothing at all, so
     * on its own none of them proves the filter is doing the work. This one seeds the two dead
     * shapes, runs the ORIGINAL predicate — `status: SENT` and a PENDING booking, which is exactly
     * what the code said before — and shows it hands back both rows while the feed hands back none.
     *
     * If someone widens the filter back out, this fails with a count instead of going quietly green.
     */
    await seedOffer({ index: 11, jobStatus: AssignmentJobStatus.EXHAUSTED, timeoutAtMs: null });
    await seedOffer({ index: 12, jobStatus: AssignmentJobStatus.DISPATCHED, timeoutAtMs: -60_000 });

    const oldPredicate = await prisma.assignmentAttempt.findMany({
      where: {
        providerId: ctx.providerId,
        status: AssignmentAttemptStatus.SENT,
        job: { booking: { status: BookingStatus.PENDING } },
      },
      select: { job: { select: { bookingId: true } } },
    });
    const wouldHaveShown = oldPredicate
      .map((a) => a.job.bookingId)
      .filter((id) => id.startsWith(`${RUN}-b-`));

    expect(wouldHaveShown.length).toBe(2);
    expect((await pendingFeed()).filter((b) => b.id.startsWith(`${RUN}-b-`)).length).toBe(0);
  }, 60_000);
});

describe("payment state is still independent of offer liveness", () => {
  test("a live offer on an unsettled booking is still listed, and accept is what refuses it", async () => {
    if (!dbOk) return;
    const { bookingId } = await seedOffer({
      index: 13,
      jobStatus: AssignmentJobStatus.DISPATCHED,
      timeoutAtMs: 4 * 60_000,
    });
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: PaymentStatus.PENDING },
    });

    /**
     * Deliberately NOT filtered here. This change is about whether an offer is still open, and
     * folding the payment gate into the read path would put the same rule in two places that can
     * drift — which is how admin assignment once came to bypass a rule partner accept enforced.
     * OWNER DECISION #1 means dispatch does not send these in the first place; if one is somehow
     * live, `accept()` refuses it under the row lock, which is the authority that counts.
     */
    expect((await pendingFeed()).some((b) => b.id === bookingId)).toBe(true);

    const { bookingService } = await import("../services/booking.service");
    const result = await bookingService.accept(ctx.providerId, bookingId);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("PAYMENT_NOT_SETTLED");
  }, 60_000);
});
