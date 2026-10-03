/**
 * Pass 12 — one real correlated journey Customer → Partner → Admin.
 *
 * Same booking IDs are asserted in customer, partner, and admin views and in PostgreSQL.
 * Job FSM uses bookingService + assignmentEngine (no duplicate matching/earnings engines).
 *
 * Run alone (do not overlap writers on homigo_test):
 *   docker run --rm --network homigo-cert4 -v D:/homigo/apps/backend:/app -w /app \
 *     -e NODE_ENV=test \
 *     -e HOMIGO_TEST_DATABASE_URL="postgresql://postgres:homigo_dev@homigo-ci-pg:5432/homigo_test?connection_limit=8" \
 *     oven/bun:1.3 bun test src/__tests__/customer-partner-admin-correlated-e2e.test.ts --max-concurrency 1
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AssignmentAttemptStatus, BookingStatus, PaymentStatus } from "@prisma/client";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { partnerOperationsService } from "../services/partner-operations.service";
import { matchingService } from "../services/matching.service";
import { assignmentEngine } from "../services/assignment-engine.service";
import { bookingService } from "../services/booking.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import { financialLedgerService } from "../services/financial-ledger.service";

const RUN_ID = `p12-${Date.now().toString(36)}`;
const JOB_LAT = 28.62;
const JOB_LNG = 77.37;

let ctx: AdvCtx;
let dbOk = false;

function skipIfNoDb() {
  if (!dbOk) {
    console.warn("SKIP: PostgreSQL unreachable — Pass 12 correlated e2e not executed");
    return true;
  }
  return false;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function assertMoneyInvariant(opts: { opening: number; credits: number; debits: number; closing: number }) {
  const expected = round2(opts.opening + opts.credits - opts.debits);
  const closing = round2(opts.closing);
  const drift = round2(closing - expected);
  expect(closing).toBe(expected);
  expect(drift).toBe(0);
  return { expected, drift };
}

function asStatus(value: unknown): string {
  return String(value ?? "").toUpperCase().replace(/-/g, "_");
}

async function walletSnap(providerId: string) {
  const p = await prisma.provider.findUniqueOrThrow({
    where: { id: providerId },
    select: { walletBalance: true, reservedBalance: true, walletBalancePaise: true },
  });
  return {
    balance: round2(p.walletBalance),
    reserved: round2(p.reservedBalance),
    paise: Number(p.walletBalancePaise ?? 0n),
  };
}

async function settleBookingPayment(bookingId: string, userId: string, amount: number) {
  await prisma.booking.update({
    where: { id: bookingId },
    data: { paymentStatus: PaymentStatus.SUCCESS, paymentMethod: "test" },
  });
  const existing = await prisma.payment.findUnique({ where: { bookingId } });
  if (existing) {
    await prisma.payment.update({
      where: { bookingId },
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
      bookingId,
      userId,
      amount,
      amountPaid: amount,
      amountPaise: BigInt(Math.round(amount * 100)),
      paymentMethod: "test",
      razorpayOrderId: `order_p12_${RUN_ID}`,
      idempotencyKey: `p12_${RUN_ID}_${bookingId}`,
      status: PaymentStatus.SUCCESS,
      settledAt: new Date(),
      completedAt: new Date(),
    },
  });
}

function metaString(metadata: unknown, key: "correlationId" | "requestId" | "traceId"): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const v = (metadata as Record<string, unknown>)[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  await financialLedgerService.ensureAccountsSeeded();
  ctx = await seedAdversarialFixtures(RUN_ID);
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
      baseLatitude: JOB_LAT,
      baseLongitude: JOB_LNG,
      city: "Noida",
      serviceRegions: ["Noida"],
      pausedAt: null,
      pauseReason: null,
      isBanned: false,
      walletBalance: 0,
      walletBalancePaise: 0n,
      reservedBalance: 0,
    },
  });
  const ready = await partnerOperationsService.snapshot(ctx.providerId);
  expect(ready.readiness.ready).toBe(true);
  const on = await partnerOperationsService.setOnline(ctx.providerId, true);
  expect(on.isOnline).toBe(true);

  const presenceNow = new Date();
  await prisma.partnerPresence.upsert({
    where: { providerId: ctx.providerId },
    create: {
      providerId: ctx.providerId,
      lastHeartbeatAt: presenceNow,
      lastSeenAt: presenceNow,
      lastLocationAt: presenceNow,
      lastLocationLat: JOB_LAT,
      lastLocationLng: JOB_LNG,
    },
    update: {
      lastHeartbeatAt: presenceNow,
      lastSeenAt: presenceNow,
      lastLocationAt: presenceNow,
      lastLocationLat: JOB_LAT,
      lastLocationLng: JOB_LNG,
    },
  });
}, 120_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN_ID);
}, 60_000);

describe.serial("Pass 12 Customer → Partner → Admin correlated journey", () => {
  test(
    "one booking: offer→complete, earning+wallet, identical COMPLETED across surfaces",
    async () => {
      if (skipIfNoDb()) return;

      const scheduled = futureSlot(36);
      const matches = await matchingService.findBestProviders({
        // W2-D4: matching is scoped to the customer's population; a customer-less query is
        // a business query and the harness's partner is classified at creation. Ask within
        // the fixture world by naming the fixture customer.
        customerId: ctx.customerA.id,
        serviceId: ctx.serviceId,
        latitude: JOB_LAT,
        longitude: JOB_LNG,
        scheduledDate: scheduled,
      });
      expect(matches.some((m) => m.providerId === ctx.providerId)).toBe(true);

      const opening = await walletSnap(ctx.providerId);

      const created = await bookingService.create(ctx.customerA.id, {
        serviceId: ctx.serviceId,
        scheduledDate: scheduled.toISOString(),
        addressId: ctx.addressAId,
        description: `Pass 12 correlated ${RUN_ID}`,
      });
      if (!("booking" in created) || !created.booking) {
        throw new Error(`bookingService.create failed: ${JSON.stringify(created)}`);
      }
      const bookingId = created.booking.id;
      const unassigned = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(unassigned.providerId).toBeNull();
      expect(unassigned.userId).toBe(ctx.customerA.id);

      const amount = created.booking.finalAmount;
      await settleBookingPayment(bookingId, ctx.customerA.id, amount);

      await assignmentEngine.createJob(bookingId);
      await assignmentEngine.dispatchBookingNow(bookingId);

      const offered = await prisma.assignmentAttempt.findFirst({
        where: { providerId: ctx.providerId, status: AssignmentAttemptStatus.SENT, job: { bookingId } },
      });
      expect(offered).toBeTruthy();
      expect(offered!.providerId).toBe(ctx.providerId);

      const pendingDb = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(pendingDb.status).toBe(BookingStatus.PENDING);
      expect(pendingDb.userId).toBe(ctx.customerA.id);

      const accept = await bookingService.accept(ctx.providerId, bookingId);
      expect(accept.ok).toBe(true);
      if (!accept.ok) throw new Error(accept.error);
      expect(accept.newlyAccepted).toBe(true);
      await assignmentEngine.onProviderAccepted(bookingId, ctx.providerId);

      const acceptedDb = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(acceptedDb.status).toBe(BookingStatus.ACCEPTED);
      expect(acceptedDb.providerId).toBe(ctx.providerId);

      const enRoute = await bookingService.markEnRoute(ctx.providerId, bookingId, JOB_LAT, JOB_LNG);
      expect(enRoute.ok).toBe(true);
      if (!enRoute.ok) throw new Error(enRoute.error);
      expect(enRoute.newlyTransitioned).toBe(true);
      const enRouteDb = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(enRouteDb.status).toBe(BookingStatus.EN_ROUTE);
      expect(enRouteDb.enRouteAt).toBeTruthy();

      const arrived = await bookingService.markArrived(ctx.providerId, bookingId, JOB_LAT, JOB_LNG);
      expect(arrived.ok).toBe(true);
      if (!arrived.ok) throw new Error(arrived.error);
      expect(arrived.newlyTransitioned).toBe(true);
      const arrivedDb = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(arrivedDb.arrivedAt).toBeTruthy();
      expect(arrivedDb.status).toBe(BookingStatus.EN_ROUTE);

      const started = await bookingService.start(ctx.providerId, bookingId, JOB_LAT, JOB_LNG);
      expect(started.status).toBe(BookingStatus.IN_PROGRESS);
      expect(started.startedAt).toBeTruthy();
      const inProgressDb = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(inProgressDb.status).toBe(BookingStatus.IN_PROGRESS);

      const complete = await bookingService.complete(
        ctx.providerId,
        bookingId,
        JOB_LAT,
        JOB_LNG,
        `pass12-complete-${RUN_ID}`,
      );
      expect(complete.newlyCompleted).toBe(true);
      expect(complete.booking.status).toBe(BookingStatus.COMPLETED);

      const dbBooking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
      expect(dbBooking.status).toBe(BookingStatus.COMPLETED);
      expect(dbBooking.userId).toBe(ctx.customerA.id);
      expect(dbBooking.providerId).toBe(ctx.providerId);

      const earning = await prisma.earning.findUnique({ where: { bookingId } });
      expect(earning).toBeTruthy();
      expect(earning!.providerId).toBe(ctx.providerId);
      expect(earning!.netEarning).toBeGreaterThan(0);

      const journals = await prisma.journalEntry.count({
        where: { idempotencyKey: `provider_earning:${bookingId}` },
      });
      expect(journals).toBe(1);

      const closing = await walletSnap(ctx.providerId);
      const inv = assertMoneyInvariant({
        opening: opening.balance,
        credits: round2(earning!.netEarning),
        debits: 0,
        closing: closing.balance,
      });
      expect(inv.drift).toBe(0);

      const customerView = await bookingService.getForUser(ctx.customerA.id, bookingId);
      expect(customerView).toBeTruthy();
      const partnerView = await bookingService.getById(bookingId, undefined, ctx.providerId);
      expect(partnerView).toBeTruthy();
      const adminView = await adminBookingOperationsService.getDetail(bookingId, {
        adminId: ctx.superAdmin.id,
      });
      expect(adminView).toBeTruthy();
      expect(adminView!.booking.id).toBe(bookingId);
      expect(adminView!.booking.provider?.id).toBe(ctx.providerId);
      expect(adminView!.booking.user.id).toBe(ctx.customerA.id);

      expect(asStatus(customerView!.status)).toBe("COMPLETED");
      expect(asStatus(partnerView!.status)).toBe("COMPLETED");
      expect(asStatus(adminView!.booking.status)).toBe("COMPLETED");
      expect(asStatus(dbBooking.status)).toBe(asStatus(customerView!.status));
      expect(asStatus(partnerView!.status)).toBe(asStatus(adminView!.booking.status));

      const outbox = await prisma.eventOutbox.findMany({
        where: {
          OR: [{ aggregateId: bookingId }, { aggregateId: earning!.id }],
        },
        orderBy: { createdAt: "asc" },
      });
      expect(outbox.length).toBeGreaterThan(0);
      const eventId = outbox[0]!.eventId;
      const correlationId =
        metaString(outbox[0]!.metadata, "correlationId") ??
        outbox
          .map((row) => metaString(row.metadata, "correlationId"))
          .find((id) => typeof id === "string" && id.length > 0) ??
        null;
      const requestId = outbox.map((row) => metaString(row.metadata, "requestId")).find(Boolean) ?? null;
      expect(eventId.length).toBeGreaterThan(0);
      expect(Boolean(eventId) || Boolean(correlationId) || Boolean(requestId)).toBe(true);
      expect(correlationId ?? eventId).toBeTruthy();

      const customerId = ctx.customerA.id;
      const partnerId = ctx.providerId;
      const earningId = earning!.id;

      console.log(
        JSON.stringify({
          PASS: 12,
          RUN_ID,
          customerId,
          partnerId,
          bookingId,
          earningId,
          eventId,
          correlationId,
          requestId,
          MONEY_DRIFT: inv.drift,
          customerStatus: customerView!.status,
          partnerStatus: partnerView!.status,
          adminStatus: adminView!.booking.status,
          dbStatus: dbBooking.status,
        }),
      );

      expect(customerId).toBe(dbBooking.userId);
      // `providerId` is nullable on Booking; the assignment assertions above are what guarantee it
      // is set by this point, so the non-null assertion states that rather than widening the type.
      expect(partnerId).toBe(dbBooking.providerId!);
      expect(bookingId).toBe(dbBooking.id);
      expect(earningId).toBe(earning!.id);
    },
    120_000,
  );
});
