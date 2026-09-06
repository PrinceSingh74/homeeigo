/**
 * Pass 13 Phase 8 - dedicated FOUR-AXIS state orthogonality certification.
 *
 * HOMEEIGO keeps four independent state axes for a partner:
 *   LIFECYCLE     provider.lifecycleState (PartnerLifecycleState) — not online, not job, not money
 *   AVAILABILITY  provider.currentStatus / isOnline / pausedAt / pauseReason — not SUSPENDED
 *   JOB           booking.status + timestamps (OFFERED…COMPLETED) — not EARNING_POSTED
 *   FINANCE       earning / wallet / withdrawal machine — not job COMPLETED
 *
 * This harness proves, against real PostgreSQL and the real certified services, that a
 * mutation on one axis never silently overwrites another axis, and that the four value
 * domains are disjoint (no shared vocabulary that could collapse them).
 *
 * The only cross-axis write allowed is the documented dispatch-eligibility gate
 * (lifecycle PAUSED/SUSPENDED clears `isOnline`). It is asserted explicitly below and
 * proven to leave the availability pause record, job state and money untouched.
 *
 * Run alone (do not overlap writers on homigo_test):
 *   docker run --rm --network homigo-cert4 -v D:/homigo/apps/backend:/app -w /app \
 *     -e NODE_ENV=test \
 *     -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
 *     oven/bun:1.3 bun test src/__tests__/partner-four-axis-orthogonality.test.ts --max-concurrency 1
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus, PaymentStatus, WalletReservationStatus } from "@prisma/client";
import { OPERATIONAL_STATES } from "../lib/partner-availability-fsm";
import { LIFECYCLE_STATES } from "../lib/partner-lifecycle-fsm";
import { DISPATCH_LIFECYCLE_WHERE } from "../lib/partner-four-axis";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerOperationsService } from "../services/partner-operations.service";
import { partnerLifecycleService } from "../services/partner-lifecycle.service";
import { assignmentEngine } from "../services/assignment-engine.service";
import { bookingService } from "../services/booking.service";
import { financialLedgerService } from "../services/financial-ledger.service";
import { providerWalletReservationService } from "../services/provider-wallet-reservation.service";

const RUN_ID = `p13ax-${Date.now().toString(36)}`;
const JOB_LAT = 28.62;
const JOB_LNG = 77.37;

const BOOKING_STATES: readonly string[] = [
  "PENDING",
  "ACCEPTED",
  "REJECTED",
  "ASSIGNED",
  "EN_ROUTE",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED_BY_USER",
  "CANCELLED_BY_PROVIDER",
];

let ctx: AdvCtx;
let dbOk = false;
let bookingId = "";

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable - Pass 13 four-axis orthogonality not executed");
    return true;
  }
  return false;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

type AxisSnapshot = {
  lifecycle: string;
  availability: {
    currentStatus: string;
    isOnline: boolean;
    pausedAt: string | null;
    pauseReason: string | null;
  };
  job: { bookingId: string; status: string } | null;
  finance: {
    walletBalance: number;
    walletBalancePaise: string;
    reservedBalance: number;
    earningCount: number;
  };
};

async function snapshotAxes(providerId: string, trackedBookingId: string | null): Promise<AxisSnapshot> {
  const p = await prisma.provider.findUniqueOrThrow({
    where: { id: providerId },
    select: {
      lifecycleState: true,
      currentStatus: true,
      isOnline: true,
      pausedAt: true,
      pauseReason: true,
      walletBalance: true,
      walletBalancePaise: true,
      reservedBalance: true,
    },
  });
  const booking = trackedBookingId
    ? await prisma.booking.findUniqueOrThrow({
        where: { id: trackedBookingId },
        select: { id: true, status: true },
      })
    : null;
  const earningCount = await prisma.earning.count({ where: { providerId } });
  return {
    lifecycle: String(p.lifecycleState),
    availability: {
      currentStatus: p.currentStatus,
      isOnline: p.isOnline,
      pausedAt: p.pausedAt ? p.pausedAt.toISOString() : null,
      pauseReason: p.pauseReason ?? null,
    },
    job: booking ? { bookingId: booking.id, status: String(booking.status) } : null,
    finance: {
      walletBalance: round2(p.walletBalance),
      walletBalancePaise: String(p.walletBalancePaise ?? 0n),
      reservedBalance: round2(p.reservedBalance),
      earningCount,
    },
  };
}

async function settleBookingPayment(id: string, userId: string, amount: number) {
  await prisma.booking.update({
    where: { id },
    data: { paymentStatus: PaymentStatus.SUCCESS, paymentMethod: "test" },
  });
  const existing = await prisma.payment.findUnique({ where: { bookingId: id } });
  if (existing) {
    await prisma.payment.update({
      where: { bookingId: id },
      data: {
        status: PaymentStatus.SUCCESS,
        amount,
        amountPaid: amount,
        amountPaise: BigInt(Math.round(amount * 100)),
        settledAt: new Date(),
        completedAt: new Date(),
      },
    });
    return;
  }
  await prisma.payment.create({
    data: {
      bookingId: id,
      userId,
      amount,
      amountPaid: amount,
      amountPaise: BigInt(Math.round(amount * 100)),
      paymentMethod: "test",
      razorpayOrderId: `order_${RUN_ID}`,
      idempotencyKey: `${RUN_ID}_${id}`,
      status: PaymentStatus.SUCCESS,
      settledAt: new Date(),
      completedAt: new Date(),
    },
  });
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  await financialLedgerService.ensureAccountsSeeded();
  ctx = await seedAdversarialFixtures(RUN_ID);
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      lifecycleState: "ACTIVE",
      isOnline: false,
      currentStatus: "offline",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      workingHoursStart: "00:00",
      workingHoursEnd: "23:59",
      maxConcurrentJobs: 4,
      maxJobsPerDay: 20,
      serviceRadiusKm: 8,
      baseLatitude: JOB_LAT,
      baseLongitude: JOB_LNG,
      city: "Noida",
      serviceRegions: ["Noida"],
      pausedAt: null,
      pauseReason: null,
      isBanned: false,
      isActive: true,
      isApproved: true,
      complianceRestricted: false,
      walletBalance: 5000,
      walletBalancePaise: 500000n,
      reservedBalance: 0,
    },
  });
  const online = await partnerOperationsService.setOnline(ctx.providerId, true);
  expect(online.isOnline).toBe(true);

  // One real ACCEPTED job so the JOB axis holds a live, non-terminal value.
  const scheduled = futureSlot(40);
  const created = await bookingService.create(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    scheduledDate: scheduled.toISOString(),
    addressId: ctx.addressAId,
    description: `Pass 13 four-axis ${RUN_ID}`,
  });
  if (!("booking" in created) || !created.booking) {
    throw new Error(`bookingService.create failed: ${JSON.stringify(created)}`);
  }
  bookingId = created.booking.id;
  await settleBookingPayment(bookingId, ctx.customerA.id, created.booking.finalAmount);
  await assignmentEngine.createJob(bookingId);
  await assignmentEngine.dispatchBookingNow(bookingId);
  const accept = await bookingService.accept(ctx.providerId, bookingId);
  expect(accept.ok).toBe(true);
  await assignmentEngine.onProviderAccepted(bookingId, ctx.providerId);
  const acceptedDb = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  expect(acceptedDb.status).toBe(BookingStatus.ACCEPTED);
}, 180_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

describe("Pass 13 four-axis domain disjointness", () => {
  test("lifecycle values never appear in the AVAILABILITY domain (ACTIVE != available)", () => {
    const availability = new Set<string>(OPERATIONAL_STATES);
    // Availability is lowercase snake; lifecycle is UPPER_SNAKE. No exact-value overlap.
    for (const state of LIFECYCLE_STATES) {
      expect(availability.has(state)).toBe(false);
    }
    expect(availability.has("ACTIVE")).toBe(false);
    expect(availability.has("active")).toBe(false);
    // ACTIVE (lifecycle) is not, and cannot be read as, available (availability).
    expect(availability.has("available")).toBe(true);
    expect(availability.has("suspended")).toBe(false);
    expect(LIFECYCLE_STATES).not.toContain("available");
    expect(LIFECYCLE_STATES).not.toContain("AVAILABLE");
    // PAUSED is a homonym: lifecycle PAUSED ≠ availability paused. Never compared cross-axis.
    expect(LIFECYCLE_STATES).toContain("PAUSED");
    expect(LIFECYCLE_STATES).toContain("SUSPENDED");
    expect(LIFECYCLE_STATES).toContain("VERIFIED");
    expect(availability.has("paused")).toBe(true);
    expect(availability.has("PAUSED")).toBe(false);
  });

  test("availability values never appear in the JOB domain (available != ACCEPTED)", () => {
    const job = new Set<string>(BOOKING_STATES);
    expect(job.has("AVAILABLE")).toBe(false);
    expect(job.has("available")).toBe(false);
    expect(job.has("ACCEPTED")).toBe(true);
    expect(OPERATIONAL_STATES).toContain("available");
    expect(OPERATIONAL_STATES).toContain("accepting");
    expect(OPERATIONAL_STATES).not.toContain("accepting_job");
    expect(OPERATIONAL_STATES).not.toContain("ACCEPTED");
    // No availability literal is ever a valid BookingStatus value.
    for (const state of OPERATIONAL_STATES) {
      expect(job.has(state)).toBe(false);
    }
    // `en_route` is derived FROM the job axis and never written back into it.
    expect(OPERATIONAL_STATES).toContain("en_route");
    expect(job.has("en_route")).toBe(false);
    expect(job.has("EN_ROUTE")).toBe(true);
  });

  test("COMPLETED (job) is not money, and available money is numeric, not a state", async () => {
    if (skipIfNoDb()) return;
    const p = await prisma.provider.findUniqueOrThrow({
      where: { id: ctx.providerId },
      select: { walletBalance: true, reservedBalance: true },
    });
    const available = providerWalletReservationService.availableBalance(p.walletBalance, p.reservedBalance);
    expect(typeof available).toBe("number");
    expect(Number.isFinite(available)).toBe(true);
    // No status enum carries an "available money" member, and money carries no status.
    expect(BOOKING_STATES).not.toContain("AVAILABLE_BALANCE");
    expect(LIFECYCLE_STATES).not.toContain("AVAILABLE_BALANCE");
    expect(String(available)).not.toBe("available");
    expect(String(available)).not.toBe("ACTIVE");
    expect(String(available)).not.toBe("COMPLETED");
  });
});

describe.serial("Pass 13 four-axis non-overwrite proofs (real DB, real services)", () => {
  test(
    "LIFECYCLE mutation does not silently overwrite availability, job or finance",
    async () => {
      if (skipIfNoDb()) return;

      // Put availability into an explicit PAUSED record first so we can prove the
      // lifecycle write does not erase it.
      await partnerOperationsService.pause(ctx.providerId, "break");
      const before = await snapshotAxes(ctx.providerId, bookingId);
      expect(before.lifecycle).toBe("ACTIVE");
      expect(before.availability.currentStatus).toBe("paused");
      expect(before.availability.pausedAt).not.toBeNull();
      expect(before.availability.pauseReason).toBe("break");
      expect(before.job?.status).toBe("ACCEPTED");

      const moved = await partnerLifecycleService.transition({
        providerId: ctx.providerId,
        to: "UNDER_REVIEW",
        actorType: "ADMIN",
        actorId: ctx.superAdmin.id,
        reasonCode: "RISK_POLICY",
        reasonText: `four-axis ${RUN_ID}`,
      });
      expect("error" in moved ? moved.error : null).toBeNull();

      const after = await snapshotAxes(ctx.providerId, bookingId);
      expect(after.lifecycle).toBe("UNDER_REVIEW");
      // UNDER_REVIEW has no documented availability side effect: byte-identical.
      expect(after.availability).toEqual(before.availability);
      expect(after.job).toEqual(before.job);
      expect(after.finance).toEqual(before.finance);

      // Audit: previous state -> new state, admin actor, timestamp.
      const history = await prisma.partnerStatusHistory.findFirst({
        where: { providerId: ctx.providerId, newState: "UNDER_REVIEW" },
        orderBy: { createdAt: "desc" },
      });
      expect(history).toBeTruthy();
      expect(history!.previousState).toBe("ACTIVE");
      expect(history!.newState).toBe("UNDER_REVIEW");
      expect(history!.actorType).toBe("ADMIN");
      expect(history!.actorId).toBe(ctx.superAdmin.id);
      expect(history!.createdAt).toBeInstanceOf(Date);
    },
    180_000,
  );

  test(
    "documented dispatch gate: lifecycle SUSPENDED clears isOnline only",
    async () => {
      if (skipIfNoDb()) return;
      const before = await snapshotAxes(ctx.providerId, bookingId);
      const suspended = await partnerLifecycleService.transition({
        providerId: ctx.providerId,
        to: "SUSPENDED",
        actorType: "ADMIN",
        actorId: ctx.superAdmin.id,
        reasonCode: "RISK_POLICY",
      });
      expect("error" in suspended ? suspended.error : null).toBeNull();

      const after = await snapshotAxes(ctx.providerId, bookingId);
      expect(after.lifecycle).toBe("SUSPENDED");
      // Only the eligibility flag moves; the availability PAUSE RECORD is preserved.
      expect(after.availability.isOnline).toBe(false);
      expect(after.availability.pausedAt).toBe(before.availability.pausedAt);
      expect(after.availability.pauseReason).toBe(before.availability.pauseReason);
      // JOB and FINANCE fully untouched: an in-flight accepted job is not cancelled
      // and money is not clawed back by a lifecycle write.
      expect(after.job).toEqual(before.job);
      expect(after.finance).toEqual(before.finance);

      // Restore via the legal hops SUSPENDED -> REACTIVATED -> ACTIVE.
      const reactivated = await partnerLifecycleService.transition({
        providerId: ctx.providerId,
        to: "REACTIVATED",
        actorType: "ADMIN",
        actorId: ctx.superAdmin.id,
        reasonCode: "REACTIVATION",
      });
      expect("error" in reactivated ? reactivated.error : null).toBeNull();
      const active = await partnerLifecycleService.transition({
        providerId: ctx.providerId,
        to: "ACTIVE",
        actorType: "ADMIN",
        actorId: ctx.superAdmin.id,
        reasonCode: "REACTIVATION",
      });
      expect("error" in active ? active.error : null).toBeNull();
      const restored = await snapshotAxes(ctx.providerId, bookingId);
      expect(restored.lifecycle).toBe("ACTIVE");
      expect(restored.job).toEqual(before.job);
      expect(restored.finance).toEqual(before.finance);
    },
    180_000,
  );

  test(
    "AVAILABILITY mutation does not silently overwrite lifecycle, job or finance",
    async () => {
      if (skipIfNoDb()) return;
      const before = await snapshotAxes(ctx.providerId, bookingId);
      expect(before.lifecycle).toBe("ACTIVE");
      expect(before.job?.status).toBe("ACCEPTED");

      const resumed = await partnerOperationsService.resume(ctx.providerId);
      expect(resumed.isOnline).toBe(true);
      const afterResume = await snapshotAxes(ctx.providerId, bookingId);
      expect(afterResume.availability.pausedAt).toBeNull();
      expect(afterResume.lifecycle).toBe(before.lifecycle);
      expect(afterResume.job).toEqual(before.job);
      expect(afterResume.finance).toEqual(before.finance);

      await partnerOperationsService.pause(ctx.providerId, "travel");
      const afterPause = await snapshotAxes(ctx.providerId, bookingId);
      expect(afterPause.availability.currentStatus).toBe("paused");
      expect(afterPause.availability.pauseReason).toBe("travel");
      expect(afterPause.lifecycle).toBe(before.lifecycle);
      expect(afterPause.job).toEqual(before.job);
      expect(afterPause.finance).toEqual(before.finance);

      await partnerOperationsService.setOnline(ctx.providerId, false);
      const afterOffline = await snapshotAxes(ctx.providerId, bookingId);
      expect(afterOffline.availability.isOnline).toBe(false);
      expect(afterOffline.availability.currentStatus).toBe("offline");
      expect(afterOffline.lifecycle).toBe(before.lifecycle);
      // Going offline never cancels or mutates an in-flight accepted job.
      expect(afterOffline.job).toEqual(before.job);
      expect(afterOffline.finance).toEqual(before.finance);

      await partnerOperationsService.setOnline(ctx.providerId, true);
      const back = await snapshotAxes(ctx.providerId, bookingId);
      expect(back.availability.isOnline).toBe(true);
      expect(back.lifecycle).toBe(before.lifecycle);
      expect(back.job).toEqual(before.job);
      expect(back.finance).toEqual(before.finance);
    },
    180_000,
  );

  test(
    "JOB mutation (non-terminal) does not silently overwrite lifecycle, availability or finance",
    async () => {
      if (skipIfNoDb()) return;
      const before = await snapshotAxes(ctx.providerId, bookingId);
      expect(before.job?.status).toBe("ACCEPTED");

      const enRoute = await bookingService.markEnRoute(ctx.providerId, bookingId, JOB_LAT, JOB_LNG);
      expect(enRoute.ok).toBe(true);
      const afterEnRoute = await snapshotAxes(ctx.providerId, bookingId);
      expect(afterEnRoute.job?.status).toBe("EN_ROUTE");
      expect(afterEnRoute.lifecycle).toBe(before.lifecycle);
      expect(afterEnRoute.finance).toEqual(before.finance);
      // Stored availability facts (not the derived cache) are never rewritten by a job move.
      expect(afterEnRoute.availability.isOnline).toBe(before.availability.isOnline);
      expect(afterEnRoute.availability.pausedAt).toBe(before.availability.pausedAt);
      expect(afterEnRoute.availability.pauseReason).toBe(before.availability.pauseReason);

      const arrived = await bookingService.markArrived(ctx.providerId, bookingId, JOB_LAT, JOB_LNG);
      expect(arrived.ok).toBe(true);
      const started = await bookingService.start(ctx.providerId, bookingId, JOB_LAT, JOB_LNG);
      expect(started.status).toBe(BookingStatus.IN_PROGRESS);
      const afterStart = await snapshotAxes(ctx.providerId, bookingId);
      expect(afterStart.job?.status).toBe("IN_PROGRESS");
      expect(afterStart.lifecycle).toBe(before.lifecycle);
      // No money moves before completion.
      expect(afterStart.finance).toEqual(before.finance);
      expect(afterStart.availability.isOnline).toBe(before.availability.isOnline);
      expect(afterStart.availability.pausedAt).toBe(before.availability.pausedAt);

      const life = await partnerLifecycleService.getCurrent(ctx.providerId);
      const ops = await partnerOperationsService.snapshot(ctx.providerId);
      const { earningsService } = await import("../services/earnings.service");
      const finance = await earningsService.getPartnerFinanceCenter(ctx.providerId);
      expect(life?.axis).toBe("LIFECYCLE");
      expect(life?.lifecycleState).toBe("ACTIVE");
      expect(ops.axis).toBe("AVAILABILITY");
      expect(ops.operationalStatus).not.toBe("suspended");
      expect(ops.operationalStatus).not.toBe("accepting_job");
      expect(afterStart.job?.status).toBe("IN_PROGRESS");
      expect(finance.axis).toBe("FINANCE");
      console.log(
        JSON.stringify({
          PHASE: "FOUR_AXIS_INDEPENDENT_SNAPSHOT",
          RUN_ID,
          partnerId: ctx.providerId,
          bookingId,
          partner: life?.lifecycleState,
          availability: ops.availabilityState,
          job: afterStart.job?.status,
          money: finance.financeState,
        }),
      );
    },
    180_000,
  );

  test(
    "FINANCIAL mutation does not overwrite lifecycle, availability or job",
    async () => {
      if (skipIfNoDb()) return;
      const before = await snapshotAxes(ctx.providerId, bookingId);
      expect(before.lifecycle).toBe("ACTIVE");
      expect(before.job?.status).toBe("IN_PROGRESS");
      expect(before.finance.reservedBalance).toBe(0);

      const idempotencyKey = `p13ax-wd-${RUN_ID}`;
      const created = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
        amount: 1000,
        bankAccountNumber: "000111222333",
        ifscCode: "HDFC0000001",
        accountHolder: "Four Axis Test",
        idempotencyKey,
      });
      if ("error" in created) throw new Error(`withdrawal failed: ${created.error}`);
      const withdrawalId = created.withdrawal.id;

      const after = await snapshotAxes(ctx.providerId, bookingId);
      expect(after.finance.reservedBalance).toBe(1000);
      expect(after.lifecycle).toBe(before.lifecycle);
      expect(after.availability).toEqual(before.availability);
      expect(after.job).toEqual(before.job);

      // Idempotency: replay creates no second withdrawal and no second reservation.
      const replay = await providerWalletReservationService.reserveAndCreateWithdrawal(ctx.providerId, {
        amount: 1000,
        bankAccountNumber: "000111222333",
        ifscCode: "HDFC0000001",
        accountHolder: "Four Axis Test",
        idempotencyKey,
      });
      if ("error" in replay) throw new Error(`withdrawal replay failed: ${replay.error}`);
      expect(replay.withdrawal.id).toBe(withdrawalId);
      const withdrawalCount = await prisma.withdrawal.count({
        where: { providerId: ctx.providerId, idempotencyKey },
      });
      expect(withdrawalCount).toBe(1);
      const reservationCount = await prisma.providerWalletReservation.count({ where: { withdrawalId } });
      expect(reservationCount).toBe(1);
      const replayed = await snapshotAxes(ctx.providerId, bookingId);
      expect(replayed.finance.reservedBalance).toBe(1000);
      expect(replayed.lifecycle).toBe(before.lifecycle);
      expect(replayed.availability).toEqual(before.availability);
      expect(replayed.job).toEqual(before.job);

      // Release restores available money without touching the other three axes.
      await providerWalletReservationService.releaseReservation(withdrawalId, ctx.superAdmin.id, "four-axis cleanup");
      const released = await snapshotAxes(ctx.providerId, bookingId);
      expect(released.finance.reservedBalance).toBe(0);
      expect(released.finance.walletBalance).toBe(before.finance.walletBalance);
      expect(released.lifecycle).toBe(before.lifecycle);
      expect(released.availability).toEqual(before.availability);
      expect(released.job).toEqual(before.job);
      const reservation = await prisma.providerWalletReservation.findFirstOrThrow({ where: { withdrawalId } });
      expect(reservation.status).toBe(WalletReservationStatus.RELEASED);
    },
    180_000,
  );

  test("wrong partner cannot complete; Job.COMPLETED never becomes EARNINGS_POSTED", async () => {
    if (skipIfNoDb()) return;
    await expect(
      bookingService.complete(ctx.customerB.id, bookingId, JOB_LAT, JOB_LNG, `steal-${RUN_ID}`),
    ).rejects.toThrow(/FORBIDDEN/);
    const still = await snapshotAxes(ctx.providerId, bookingId);
    expect(still.job?.status).toBe("IN_PROGRESS");
    expect(still.lifecycle).toBe("ACTIVE");
  });

  test(
    "COMPLETION is the only path that moves money, and it moves only money + job",
    async () => {
      if (skipIfNoDb()) return;
      const before = await snapshotAxes(ctx.providerId, bookingId);
      expect(before.job?.status).toBe("IN_PROGRESS");

      const complete = await bookingService.complete(
        ctx.providerId,
        bookingId,
        JOB_LAT,
        JOB_LNG,
        `p13ax-complete-${RUN_ID}`,
      );
      expect(complete.booking.status).toBe(BookingStatus.COMPLETED);

      const earning = await prisma.earning.findUniqueOrThrow({ where: { bookingId } });
      expect(earning.providerId).toBe(ctx.providerId);
      expect(earning.netEarning).toBeGreaterThan(0);

      const after = await snapshotAxes(ctx.providerId, bookingId);
      expect(after.job?.status).toBe("COMPLETED");
      expect(after.job?.status).not.toBe("EARNINGS_POSTED");
      expect(after.finance.walletBalance).toBe(round2(before.finance.walletBalance + earning.netEarning));
      expect(after.finance.earningCount).toBe(before.finance.earningCount + 1);
      // MONEY DRIFT = 0. Coerce -0 from IEEE remainder so Object.is does not fail the gate.
      const drift = round2(after.finance.walletBalance - before.finance.walletBalance - earning.netEarning);
      expect(drift === 0).toBe(true);
      // Completing a job never advances/regresses lifecycle and never rewrites the
      // stored availability facts.
      expect(after.lifecycle).toBe(before.lifecycle);
      expect(after.availability.isOnline).toBe(before.availability.isOnline);
      expect(after.availability.pausedAt).toBe(before.availability.pausedAt);
      expect(after.availability.pauseReason).toBe(before.availability.pauseReason);

      // Single ledger journal for the earning: no duplicate financial engine.
      const journals = await prisma.journalEntry.count({
        where: { idempotencyKey: `provider_earning:${bookingId}` },
      });
      expect(journals).toBe(1);

      const { adminBookingOperationsService } = await import("../services/admin-booking-operations.service");
      const customerView = await bookingService.getForUser(ctx.customerA.id, bookingId);
      const partnerView = await bookingService.getById(bookingId, undefined, ctx.providerId);
      const adminView = await adminBookingOperationsService.getDetail(bookingId, {
        adminId: ctx.superAdmin.id,
      });
      expect(String(customerView?.status).toUpperCase()).toBe("COMPLETED");
      expect(String(partnerView?.status).toUpperCase()).toBe("COMPLETED");
      expect(String(adminView?.booking.status).toUpperCase()).toBe("COMPLETED");
      expect(adminView?.booking.id).toBe(bookingId);

      console.log(
        JSON.stringify({
          PASS: 13,
          PHASE: "FOUR_AXIS_ORTHOGONALITY",
          RUN_ID,
          providerId: ctx.providerId,
          bookingId,
          earningId: earning.id,
          lifecycle: after.lifecycle,
          availability: after.availability.currentStatus,
          job: after.job?.status,
          walletBalance: after.finance.walletBalance,
          MONEY_DRIFT: 0,
        }),
      );
    },
    180_000,
  );
});

describe.serial("Pass 13 four-axis product-surface negatives (real DB, real services)", () => {
  test("illegal alias and foreign-axis writes are rejected by the lifecycle service", async () => {
    if (skipIfNoDb()) return;
    const before = await partnerLifecycleService.getCurrent(ctx.providerId);
    expect(before?.axis).toBe("LIFECYCLE");
    expect(before?.lifecycleState).toBe("ACTIVE");
    for (const to of ["KYC_PENDING", "VERIFICATION", "APPROVED", "COMPLETED", "EARNINGS_POSTED", "AVAILABLE"] as const) {
      const moved = await partnerLifecycleService.transition({
        providerId: ctx.providerId,
        to: to as never,
        actorType: "ADMIN",
        actorId: ctx.superAdmin.id,
        reasonCode: "ADMIN_ACTION",
      });
      expect("error" in moved && moved.error).toBe("INVALID_TRANSITION");
    }
    const still = await partnerLifecycleService.getCurrent(ctx.providerId);
    expect(still?.axis).toBe("LIFECYCLE");
    expect(still?.lifecycleState).toBe("ACTIVE");
  });

  test("APPLIED + isApproved is not dispatch-eligible", async () => {
    if (skipIfNoDb()) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { lifecycleState: "APPLIED", isApproved: true, isActive: true, isOnline: true, pausedAt: null },
    });
    const candidateWhere = {
      id: ctx.providerId,
      isActive: true,
      isApproved: true,
      isBanned: false,
      complianceRestricted: false,
      pausedAt: null,
      isOnline: true,
      ...DISPATCH_LIFECYCLE_WHERE,
    };
    expect(await prisma.provider.count({ where: candidateWhere })).toBe(0);
    const slot = futureSlot(48);
    const { matchingService } = await import("../services/matching.service");
    const matches = await matchingService.findBestProviders({
      serviceId: ctx.serviceId,
      latitude: JOB_LAT,
      longitude: JOB_LNG,
      scheduledDate: slot,
      maxResults: 20,
    });
    expect(matches.some((m) => m.providerId === ctx.providerId)).toBe(false);
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { lifecycleState: "ACTIVE", isApproved: true, isActive: true, isOnline: true, pausedAt: null },
    });
    expect(await prisma.provider.count({ where: candidateWhere })).toBe(1);
  });
});
