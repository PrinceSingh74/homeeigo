import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AssignmentAttemptStatus, BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { assignmentEngine } from "../services/assignment-engine.service";
import { resetRateLimitSmart } from "../middleware/rate-limit.middleware";

/**
 * `presence:hb:<providerId>` is a real anti-abuse rate limit — a partner app heartbeats every 25
 * SECONDS, and this file heartbeats once per case. Reset it first rather than hammering it.
 */
async function readyPartner() {
  await resetRateLimitSmart(`presence:hb:${ctx.providerId}`);
  await heartbeatFresh(ctx);
}

/**
 * OWNER DECISION #1 — an unpaid booking is not offered to anyone.
 *
 * ── The harm ────────────────────────────────────────────────────────────────
 *
 * Accept is payment-gated, so a partner offered an unsettled booking is offered work they will be
 * refused if they take it. Measured when this was decided: 2,566 of 3,451 assignment jobs — 74% —
 * were for bookings that had not settled.
 *
 * It was not merely noise. An unanswered offer holds a place against the partner's concurrency
 * budget until it times out, and a timed-out offer counts as a REFUSAL in the acceptance rate the
 * platform ranks partners by. Partners were being measured on, and throttled by, offers they were
 * never permitted to accept — because of the customer's payment, not their own behaviour.
 *
 * ── Why withhold rather than compensate ─────────────────────────────────────
 *
 * The alternative was to keep dispatching and exclude unpaid offers from the acceptance rate. That
 * treats the symptom, leaves the partner with offers they cannot take, and still consumes their
 * capacity. Withholding costs matching latency only for the window before payment, and the platform
 * already re-dispatches on settlement and re-sweeps PENDING jobs every 30 seconds.
 *
 * The cases below pin both halves: nothing goes out unpaid, and everything goes out once paid.
 */
const RUN = `dispatch-gate-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

async function seedBooking(index: number, paymentStatus: PaymentStatus) {
  const id = `${RUN}-b-${index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO bookings (id, booking_number, user_id, service_id, address_id, scheduled_date,
                           base_amount, final_amount, total_amount, status, payment_status, updated_at, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW() + ($6 || ' hours')::interval, 500, 500, 500,
             'PENDING'::"BookingStatus", $7::"PaymentStatus", NOW(), NOW())`,
    id,
    `${id}-BN`,
    ctx.customerA.id,
    ctx.serviceId,
    ctx.addressAId,
    String(200 + index * 3),
    paymentStatus,
  );
  await assignmentEngine.createJob(id);
  return id;
}

async function offersFor(bookingId: string): Promise<number> {
  const job = await prisma.assignmentJob.findUnique({ where: { bookingId }, select: { id: true } });
  if (!job) return 0;
  return prisma.assignmentAttempt.count({ where: { jobId: job.id } });
}

async function clearAll() {
  await prisma.assignmentAttempt.deleteMany({ where: { providerId: ctx.providerId } });
  await prisma.assignmentJob.deleteMany({ where: { booking: { id: { startsWith: `${RUN}-b-` } } } });
  await prisma.booking.deleteMany({ where: { id: { startsWith: `${RUN}-b-` } } });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      maxConcurrentJobs: 20,
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      workingDays: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
      isOnline: true,
      serviceRegions: [],
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

describe("nothing is offered before the money arrives", () => {
  test("a PENDING-payment booking produces no offers", async () => {
    if (!dbOk) return;
    await clearAll();
    await readyPartner();
    const bookingId = await seedBooking(0, PaymentStatus.PENDING);

    const dispatched = await assignmentEngine.dispatchBookingNow(bookingId);

    expect(dispatched).toBe(false);
    expect(await offersFor(bookingId)).toBe(0);
  });

  test("INITIATED and PROCESSING are not settled either", async () => {
    if (!dbOk) return;
    for (const [i, status] of [PaymentStatus.INITIATED, PaymentStatus.PROCESSING].entries()) {
      await clearAll();
      await readyPartner();
      const bookingId = await seedBooking(10 + i, status);

      // Only SUCCESS counts as settled; anything mid-flight is still money that has not arrived.
      expect(await assignmentEngine.dispatchBookingNow(bookingId)).toBe(false);
      expect(await offersFor(bookingId)).toBe(0);
    }
  });

  test("a failed payment never produces offers", async () => {
    if (!dbOk) return;
    await clearAll();
    await readyPartner();
    const bookingId = await seedBooking(20, PaymentStatus.FAILED);

    expect(await assignmentEngine.dispatchBookingNow(bookingId)).toBe(false);
    expect(await offersFor(bookingId)).toBe(0);
  });

  test("the job still exists, so it can be dispatched the moment payment lands", async () => {
    if (!dbOk) return;
    await clearAll();
    await readyPartner();
    const bookingId = await seedBooking(30, PaymentStatus.PENDING);
    await assignmentEngine.dispatchBookingNow(bookingId);

    /**
     * Withholding the fan-out must not throw the job away — `onBookingPaymentSettled` and the
     * assignment cron both act on an existing PENDING job.
     */
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    expect(job).not.toBeNull();
    expect(job?.status).toBe("PENDING");
  });

  test("an unpaid booking consumes none of the partner's offer capacity", async () => {
    if (!dbOk) return;
    await clearAll();
    await readyPartner();
    for (let i = 0; i < 3; i++) await seedBooking(40 + i, PaymentStatus.PENDING);
    for (let i = 0; i < 3; i++) await assignmentEngine.dispatchBookingNow(`${RUN}-b-${40 + i}`);

    /**
     * The second harm. Reserved offers count toward `maxConcurrentJobs`, so unpaid bookings used to
     * throttle a partner out of work they could actually have done.
     */
    const reserved = await prisma.assignmentAttempt.count({
      where: { providerId: ctx.providerId, status: AssignmentAttemptStatus.SENT },
    });
    expect(reserved).toBe(0);
  });
});

describe("a settled booking is offered normally", () => {
  test("a SUCCESS booking dispatches and reaches a partner", async () => {
    if (!dbOk) return;
    await clearAll();
    await readyPartner();
    const bookingId = await seedBooking(50, PaymentStatus.SUCCESS);

    const dispatched = await assignmentEngine.dispatchBookingNow(bookingId);

    expect(dispatched).toBe(true);
    expect(await offersFor(bookingId)).toBeGreaterThan(0);
  });

  test("a booking that settles after being withheld dispatches on the retry", async () => {
    if (!dbOk) return;
    await clearAll();
    await readyPartner();
    const bookingId = await seedBooking(60, PaymentStatus.PENDING);

    // Withheld while unpaid …
    expect(await assignmentEngine.dispatchBookingNow(bookingId)).toBe(false);
    expect(await offersFor(bookingId)).toBe(0);

    // … and dispatched the moment the money arrives, with no new machinery.
    await prisma.booking.update({
      where: { id: bookingId },
      data: { paymentStatus: PaymentStatus.SUCCESS },
    });
    await readyPartner();

    expect(await assignmentEngine.dispatchBookingNow(bookingId)).toBe(true);
    expect(await offersFor(bookingId)).toBeGreaterThan(0);
  });

  test("the gate is decided in one place, so no caller can bypass it", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(import.meta.dir, "..", "services", "assignment-engine.service.ts"), "utf8");

    /**
     * Structural on purpose. Three paths reach dispatch — the inline call at creation, the cron, and
     * the settlement hook — and a rule placed at any one of them is a rule the other two bypass.
     */
    const fn = src.slice(src.indexOf("private async dispatchToNextProvider"));
    expect(fn.slice(0, 4000)).toContain("isSettled(booking.paymentStatus)");
  });
});

describe("booking status still governs independently", () => {
  test("a settled booking that is no longer PENDING is not dispatched", async () => {
    if (!dbOk) return;
    await clearAll();
    await readyPartner();
    const bookingId = await seedBooking(70, PaymentStatus.SUCCESS);
    await prisma.booking.update({
      where: { id: bookingId },
      data: { status: BookingStatus.CANCELLED_BY_USER },
    });

    // The payment gate is an additional condition, not a replacement for the status check.
    expect(await assignmentEngine.dispatchBookingNow(bookingId)).toBe(false);
  });
});
