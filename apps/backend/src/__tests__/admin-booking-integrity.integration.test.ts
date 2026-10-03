/**
 * Admin cancellation + reassignment integrity — ISOLATED homigo_test DB.
 *   cd apps/backend && bun test D:/homigo/apps/backend/src/__tests__/admin-booking-integrity.integration.test.ts
 *
 * Phase 3: an admin cancel is the canonical cancellation (status guard, refund, offers closed,
 *          outbox event), never a bare status write — and a terminal booking is refused.
 * Phase 9: an admin reassignment supersedes every open offer atomically; a stale offer cannot be
 *          accepted; a terminal booking cannot be reassigned; accept ⟂ reassign resolves to one
 *          consistent owner.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "../load-env";
import prisma from "../lib/prisma";
import { bookingService } from "../services/booking.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import { jobEvidenceService } from "../services/job-evidence.service";
import { trackingService } from "../services/tracking.service";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  heartbeatFresh,
  keepPresenceFresh,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `abi-${Date.now().toString(36)}`;
let dbOk = false;
let A: AdvCtx; // partner A + customers + admins
let B: AdvCtx; // partner B
let seq = 0;

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  A = await seedAdversarialFixtures(RUN);
  B = await seedAdversarialFixtures(`${RUN}b`);
  // B must offer A's service for dispatch eligibility.
  await prisma.provider.update({ where: { id: B.providerId }, data: { serviceCategories: { set: ["cleaning"] } } }).catch(() => undefined);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
  await cleanupAdversarialFixtures(`${RUN}b`);
}, 60_000);

/** A booking for customer A at a unique hour, optionally paid through the real wallet checkout. */
async function booking(opts: { status?: "PENDING" | "ACCEPTED" | "IN_PROGRESS" | "COMPLETED"; paid?: boolean; hoursAhead?: number; providerId?: string } = {}) {
  seq++;
  const scheduledDate = new Date(Date.now() + (opts.hoursAhead ?? 72 + seq * 3) * 3_600_000);
  scheduledDate.setMinutes(0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `ABI-${RUN}-${seq}`,
      userId: A.customerA.id,
      serviceId: A.serviceId,
      addressId: A.addressAId,
      providerId: opts.providerId ?? null,
      status: opts.status ?? "PENDING",
      // `booking_completed_requires_timestamp`: a COMPLETED booking must carry a completion time.
      // This factory left it NULL and passed only because the test database lacked the CHECK.
      completedAt: opts.status === "COMPLETED" ? new Date() : null,
      scheduledDate,
      baseAmount: 1000,
      finalAmount: 1000,
      totalAmount: 1000,
      paymentStatus: "PENDING",
    },
  });
  if (opts.paid) {
    await payWithRealWallet(b.id, A.customerA.id);
    if (!opts.providerId && (opts.status ?? "PENDING") === "PENDING") await quiesceDispatch(b.id);
  }
  return b.id;
}

/**
 * Paying an unclaimed PENDING booking starts a real background dispatch (onBookingPaymentSettled).
 * These tests stage their own offers, so let that dispatch finish and clear what it created —
 * otherwise it races the scenario under test and the outcome depends on who else was online.
 */
async function quiesceDispatch(bookingId: string) {
  await new Promise((r) => setTimeout(r, 400));
  const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
  if (!job) return;
  await prisma.assignmentAttempt.deleteMany({ where: { jobId: job.id } });
  await prisma.assignmentAudit.deleteMany({ where: { jobId: job.id } });
  await prisma.assignmentJob.delete({ where: { id: job.id } });
  await prisma.booking.update({ where: { id: bookingId }, data: { providerId: null } }).catch(() => undefined);
}

/** A dispatched job with an open (SENT) offer to `providerId`. */
async function openOffer(bookingId: string, providerId: string) {
  const job = await prisma.assignmentJob.upsert({
    where: { bookingId },
    create: { bookingId, status: "DISPATCHED", currentProviderId: providerId, dispatchAttempts: 1, timeoutAt: new Date(Date.now() + 300_000) },
    update: {},
  });
  await prisma.assignmentAttempt.create({ data: { jobId: job.id, providerId, status: "SENT", dispatchedAt: new Date() } });
  return job.id;
}

async function walletRefunded(bookingId: string) {
  for (let i = 0; i < 50; i++) {
    const b = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { refundStatus: true } });
    if (b.refundStatus !== "pending") break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const rows = await prisma.walletTransaction.findMany({ where: { referenceId: bookingId, type: "REFUND", status: "COMPLETED" } });
  return rows.reduce((s, r) => s + r.amount, 0);
}

const cancelEvents = (bookingId: string) =>
  prisma.eventOutbox.count({ where: { eventType: "homigo.booking.cancelled", aggregateId: bookingId } });

describe.serial("Phase 3 — admin cancellation is the canonical cancellation", () => {
  test("PENDING unpaid: cancelled, cancelledBy=admin, open offers closed, event written, no refund", async () => {
    if (!dbOk) return;
    const id = await booking();
    await openOffer(id, A.providerId);
    const r = await adminBookingOperationsService.cancelBooking(id, A.superAdmin.id, "customer called support");
    expect(r.refundAmount).toBeGreaterThanOrEqual(0);
    const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(b.status).toBe("CANCELLED_BY_USER");
    expect(b.cancelledBy).toBe("admin");
    expect(b.refundStatus).toBe("none");
    expect(await prisma.assignmentAttempt.count({ where: { job: { bookingId: id }, status: "SENT" } })).toBe(0);
    expect((await prisma.assignmentJob.findUniqueOrThrow({ where: { bookingId: id } })).status).toBe("CANCELLED");
    expect(await cancelEvents(id)).toBe(1);
  });

  test("PAID, refundPolicy=full: whole amount returned to the wallet", async () => {
    if (!dbOk) return;
    const id = await booking({ paid: true, hoursAhead: 1 + (seq % 1) });
    await adminBookingOperationsService.cancelBooking(id, A.superAdmin.id, "no partner available", undefined, "full");
    expect(await walletRefunded(id)).toBe(1000);
  });

  test("PAID, customer_policy inside 2 h: the published 25% fee applies (not a free refund, not ₹0)", async () => {
    if (!dbOk) return;
    const id = await booking({ paid: true, hoursAhead: 1 });
    const r = await adminBookingOperationsService.cancelBooking(id, A.superAdmin.id, "customer asked");
    expect(r.refundAmount).toBe(750);
    expect(await walletRefunded(id)).toBe(750);
  });

  test("IN_PROGRESS with customer_policy: the 50% in-progress tier", async () => {
    if (!dbOk) return;
    const id = await booking({ paid: true, status: "IN_PROGRESS", providerId: A.providerId });
    const r = await adminBookingOperationsService.cancelBooking(id, A.superAdmin.id, "dispute on site");
    expect(r.refundAmount).toBe(500);
  });

  test("COMPLETED and already-CANCELLED bookings are refused and untouched", async () => {
    if (!dbOk) return;
    const done = await booking({ paid: true, status: "COMPLETED", providerId: A.providerId });
    await expect(adminBookingOperationsService.cancelBooking(done, A.superAdmin.id, "oops")).rejects.toThrow("BOOKING_NOT_CANCELLABLE");
    const d = await prisma.booking.findUniqueOrThrow({ where: { id: done } });
    expect(d.status).toBe("COMPLETED");
    expect(d.cancelledAt).toBeNull();

    const gone = await booking();
    await adminBookingOperationsService.cancelBooking(gone, A.superAdmin.id, "first");
    await expect(adminBookingOperationsService.cancelBooking(gone, A.superAdmin.id, "second")).rejects.toThrow("BOOKING_NOT_CANCELLABLE");
    expect(await cancelEvents(gone)).toBe(1);
  });

  test("admin cancel ⟂ customer cancel: exactly one cancellation, one event", async () => {
    if (!dbOk) return;
    const id = await booking({ paid: true });
    const results = await Promise.allSettled([
      adminBookingOperationsService.cancelBooking(id, A.superAdmin.id, "admin", undefined, "full"),
      bookingService.cancel({ userId: A.customerA.id }, id, "customer"),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled" && !("error" in (r.value as object)));
    expect(ok.length).toBe(1);
    expect(await cancelEvents(id)).toBe(1);
    const refunds = await prisma.walletTransaction.count({ where: { referenceId: id, type: "REFUND", status: "COMPLETED" } });
    await walletRefunded(id);
    expect(refunds).toBeLessThanOrEqual(1);
  });
});

describe.serial("Phase 9 — admin reassignment", () => {
  test("A offered → admin reassigns to B → A's offer superseded; A's accept fails; B owns the job", async () => {
    if (!dbOk) return;
    const id = await booking({ paid: true });
    await openOffer(id, A.providerId);
    await heartbeatFresh(B);
    await adminBookingOperationsService.reassignProvider(id, A.superAdmin.id, B.providerId, "ops reassignment");

    const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
    expect(b.status).toBe("ASSIGNED");
    expect(b.providerId).toBe(B.providerId);
    const attempts = await prisma.assignmentAttempt.findMany({ where: { job: { bookingId: id } } });
    expect(attempts.every((a) => a.status !== "SENT")).toBe(true);
    expect(attempts.find((a) => a.providerId === A.providerId)?.status).toBe("SUPERSEDED");
    const job = await prisma.assignmentJob.findUniqueOrThrow({ where: { bookingId: id } });
    expect(job.currentProviderId).toBe(B.providerId);
    // The assignment is an event like a partner accept (consumers used to never see admin assigns).
    expect(await prisma.eventOutbox.count({ where: { eventType: "homigo.booking.assigned", aggregateId: id } })).toBe(1);

    await heartbeatFresh(A);
    const stale = await bookingService.accept(A.providerId, id);
    expect(stale.ok).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).providerId).toBe(B.providerId);
  });

  test("A ACCEPTED → admin reassigns to B → A can no longer read the booking or B's evidence; B can", async () => {
    if (!dbOk) return;
    const id = await booking({ paid: true });
    await openOffer(id, A.providerId);
    await heartbeatFresh(A);
    const accepted = await bookingService.accept(A.providerId, id);
    expect(accepted.ok).toBe(true);
    await heartbeatFresh(B);
    await adminBookingOperationsService.reassignProvider(id, A.superAdmin.id, B.providerId, "partner displaced by ops");
    // A's accepted attempt survives as history — that must not keep a door open.
    expect((await prisma.assignmentAttempt.findFirst({ where: { job: { bookingId: id }, providerId: A.providerId } }))?.status).toBe("ACCEPTED");

    expect(await bookingService.getById(id, undefined, A.providerId)).toBeNull();
    let evidenceError: unknown = null;
    try {
      await jobEvidenceService.listForBooking(id, { userId: A.vendorUserId, providerId: A.providerId });
    } catch (e) {
      evidenceError = e;
    }
    expect(evidenceError instanceof Error ? evidenceError.message : String(evidenceError)).toBe("FORBIDDEN");

    expect(await bookingService.getById(id, undefined, B.providerId)).not.toBeNull();
    const forB = await jobEvidenceService.listForBooking(id, { userId: B.vendorUserId, providerId: B.providerId });
    expect(Array.isArray(forB) || typeof forB === "object").toBe(true);
  });

  test("a partner's tracking read carries the customer's home coordinates only while the job is active", async () => {
    if (!dbOk) return;
    const id = await booking({ status: "ACCEPTED", providerId: A.providerId });
    await heartbeatFresh(A); // gives the partner a last-known location, so the read returns a body
    const active = await trackingService.get(id, undefined, A.providerId);
    expect(active).not.toBeNull();
    expect(active!.destinationLatitude).not.toBeNull();
    await prisma.booking.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const done = await trackingService.get(id, undefined, A.providerId);
    expect(done?.destinationLatitude ?? null).toBeNull();
    expect(done?.destinationLongitude ?? null).toBeNull();
    // The customer and the admin view of a finished job are unchanged.
    const asCustomer = await trackingService.get(id, A.customerA.id, undefined);
    expect(asCustomer?.destinationLatitude).not.toBeNull();
  });

  test("terminal bookings cannot be reassigned (was: COMPLETED/CANCELLED → ASSIGNED)", async () => {
    if (!dbOk) return;
    for (const status of ["COMPLETED", "IN_PROGRESS"] as const) {
      const id = await booking({ paid: true, status, providerId: A.providerId });
      await expect(adminBookingOperationsService.reassignProvider(id, A.superAdmin.id, B.providerId, "x")).rejects.toThrow("BOOKING_NOT_REASSIGNABLE");
      expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe(status);
    }
    const cancelled = await booking();
    await bookingService.cancel({ userId: A.customerA.id }, cancelled, "gone");
    await expect(adminBookingOperationsService.reassignProvider(cancelled, A.superAdmin.id, B.providerId, "x")).rejects.toThrow("BOOKING_NOT_REASSIGNABLE");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id: cancelled } })).status).toBe("CANCELLED_BY_USER");
  });

  test("A accepts ⟂ admin reassigns to B (×4): one owner, no open offers, job agrees with booking", async () => {
    if (!dbOk) return;
    for (let i = 0; i < 4; i++) {
      const id = await booking({ paid: true });
      await openOffer(id, A.providerId);
      // A beat per iteration (plus the tracking test's beat just before) exceeded the product's
      // heartbeat rate limit, so the loop failed on a 429 before reaching the race. Presence stays
      // fresh for 30 s; beat only when the last one is older than 10 s, as the app does.
      await keepPresenceFresh(A);
      await keepPresenceFresh(B);
      await Promise.allSettled([
        bookingService.accept(A.providerId, id),
        adminBookingOperationsService.reassignProvider(id, A.superAdmin.id, B.providerId, "race"),
      ]);
      await new Promise((r) => setTimeout(r, 300)); // let any detached post-accept pass run
      const b = await prisma.booking.findUniqueOrThrow({ where: { id } });
      const job = await prisma.assignmentJob.findUniqueOrThrow({ where: { bookingId: id } });
      const open = await prisma.assignmentAttempt.count({ where: { jobId: job.id, status: "SENT" } });
      expect(["ACCEPTED", "ASSIGNED"]).toContain(b.status);
      expect(open).toBe(0);
      expect(job.currentProviderId).toBe(b.providerId);
      if (b.status === "ASSIGNED") expect(b.providerId).toBe(B.providerId);
      if (b.status === "ACCEPTED") expect(b.providerId).toBe(A.providerId);
    }
  }, 120_000);
});
