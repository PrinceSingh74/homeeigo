/**
 * Phase 10 §5 behaviourally, against the isolated test database.
 *
 * Section exit: valid transitions work, invalid ones fail, concurrent transitions are deterministic,
 * terminal states are immutable, and nothing outside the service commands can move a booking.
 * Each case below was open before this change, or is the control that proves a refusal is the
 * rule under test and not a broken fixture.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus, PaymentStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { runWithEventContext } from "../events/core/event-context";
import { bookingService } from "../services/booking.service";
import { bookingNoShowService } from "../services/booking-no-show.service";
import { trackingService } from "../services/tracking.service";
import { PAYMENT_GATE_OVERRIDE_ACTION, PAYMENT_GATE_REASON } from "../services/booking-payment-gate";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { placeAtDoor } from "./helpers/no-show-fixture";

const RUN = `p10s5-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let seq = 0;
let addr: { latitude: number; longitude: number };
const bookingIds: string[] = [];

type Seed = {
  status: BookingStatus;
  paymentStatus?: PaymentStatus;
  arrivedMinutesAgo?: number | null;
  providerId?: string | null;
};

async function seedBooking(s: Seed): Promise<string> {
  seq += 1;
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `${RUN}-${seq}`,
      dataOrigin: "INFERRED_SYNTHETIC",
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      providerId: s.providerId === undefined ? ctx.providerId : s.providerId,
      addressId: ctx.addressAId,
      status: s.status,
      paymentStatus: s.paymentStatus ?? PaymentStatus.SUCCESS,
      // Spread over distinct days so the partner-slot exclusion never couples two cases.
      scheduledDate: new Date(Date.now() + (10 + seq) * 86_400_000),
      arrivedAt: s.arrivedMinutesAgo == null ? null : new Date(Date.now() - s.arrivedMinutesAgo * 60_000),
      // The timestamps production writes with these statuses (a CHECK requires completedAt).
      ...(s.status === BookingStatus.COMPLETED ? { completedAt: new Date() } : {}),
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
    } as never,
  });
  bookingIds.push(b.id);
  return b.id;
}

const statusOf = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;

type HistoryRow = { new_status: string; actor_type: string | null; actor_id: string | null; reason: string | null; request_id: string | null; trace_id: string | null };
const historyOf = (id: string) =>
  prisma.$queryRaw<HistoryRow[]>`
    SELECT new_status, actor_type, actor_id, reason, request_id, trace_id
    FROM booking_status_history WHERE booking_id = ${id} ORDER BY id`;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await prisma.activityLog.deleteMany({ where: { bookingId: { in: bookingIds } } });
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("terminal states are immutable — below the application", () => {
  test("a raw UPDATE cannot move any terminal booking", async () => {
    if (!dbOk) return;
    for (const terminal of [
      BookingStatus.COMPLETED,
      BookingStatus.CANCELLED_BY_USER,
      BookingStatus.CANCELLED_BY_PROVIDER,
      BookingStatus.EXPIRED,
      BookingStatus.CUSTOMER_NO_SHOW,
      BookingStatus.PROVIDER_NO_SHOW,
      BookingStatus.REJECTED,
    ]) {
      const id = await seedBooking({ status: terminal, paymentStatus: PaymentStatus.PENDING });
      await expect(Promise.resolve(prisma.$executeRaw`UPDATE bookings SET status = 'IN_PROGRESS'::"BookingStatus" WHERE id = ${id}`)).rejects.toThrow(
        /BOOKING_TERMINAL_STATUS/,
      );
      expect(await statusOf(id)).toBe(terminal);
    }
  });

  test("the ORM is refused the same way — there is no path around it", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.COMPLETED });
    // Promise.resolve: bun's expect().rejects does not recognise a PrismaPromise as a promise.
    await expect(Promise.resolve(prisma.booking.update({ where: { id }, data: { status: BookingStatus.PENDING } }))).rejects.toThrow(/BOOKING_TERMINAL_STATUS/);
    expect(await statusOf(id)).toBe(BookingStatus.COMPLETED);
  });

  test("control: a terminal row's non-status fields still update (refund bookkeeping must work)", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.CANCELLED_BY_USER });
    await prisma.booking.update({ where: { id }, data: { refundStatus: "processed", refundAmount: 500 } });
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { refundStatus: true, status: true } });
    expect(row).toEqual({ refundStatus: "processed", status: BookingStatus.CANCELLED_BY_USER });
  });

  test("control: an active booking still moves — the guard is not a blanket freeze", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.ACCEPTED });
    await prisma.$executeRaw`UPDATE bookings SET status = 'EN_ROUTE'::"BookingStatus" WHERE id = ${id}`;
    expect(await statusOf(id)).toBe(BookingStatus.EN_ROUTE);
  });
});

describe.serial("the forbidden transitions fail through the real commands", () => {
  test("expired → accept is refused and the booking stays expired", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.EXPIRED, paymentStatus: PaymentStatus.EXPIRED, providerId: null });
    const r = await bookingService.accept(ctx.providerId, id);
    expect(r.ok).toBe(false);
    expect(await statusOf(id)).toBe(BookingStatus.EXPIRED);
  });

  test("no-show → start and cancelled → start are refused", async () => {
    if (!dbOk) return;
    for (const s of [BookingStatus.CUSTOMER_NO_SHOW, BookingStatus.PROVIDER_NO_SHOW, BookingStatus.CANCELLED_BY_USER]) {
      const id = await seedBooking({ status: s });
      await expect(bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude)).rejects.toThrow("FORBIDDEN");
      expect(await statusOf(id)).toBe(s);
    }
  });

  test("refunded → start is refused even with an admin override on record", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.ACCEPTED, paymentStatus: PaymentStatus.REFUNDED });
    // The override an admin gave while the booking was merely unpaid.
    await prisma.activityLog.create({
      data: { bookingId: id, userId: ctx.superAdmin.id, action: PAYMENT_GATE_OVERRIDE_ACTION, description: "cash on site" },
    });
    await expect(bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude)).rejects.toThrow(PAYMENT_GATE_REASON.NOT_SETTLED);
    expect(await statusOf(id)).toBe(BookingStatus.ACCEPTED);
  });

  test("control: the same override DOES carry an unpaid booking into work", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.ACCEPTED, paymentStatus: PaymentStatus.PENDING });
    await prisma.activityLog.create({
      data: { bookingId: id, userId: ctx.superAdmin.id, action: PAYMENT_GATE_OVERRIDE_ACTION, description: "cash on site" },
    });
    await bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude);
    expect(await statusOf(id)).toBe(BookingStatus.IN_PROGRESS);
  });
});

describe.serial("writers are conditional on the state they checked", () => {
  test("a no-show decided on a stale read does not overwrite the job that moved on", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.EN_ROUTE, arrivedMinutesAgo: 30 });
    // The partner started work after the no-show check read EN_ROUTE. (Not terminal, so this
    // proves the application guard on its own, without the trigger.)
    await prisma.booking.update({ where: { id }, data: { status: BookingStatus.IN_PROGRESS } });
    const close = (bookingNoShowService as unknown as {
      close: (seen: object, status: BookingStatus, actor: object, reason: string) => Promise<boolean>;
    }).close.bind(bookingNoShowService);
    const won = await close(
      { id, status: BookingStatus.EN_ROUTE, providerId: ctx.providerId, requireArrival: true },
      BookingStatus.CUSTOMER_NO_SHOW,
      { userId: ctx.vendorUserId, providerId: ctx.providerId },
      "stale",
    );
    expect(won).toBe(false);
    expect(await statusOf(id)).toBe(BookingStatus.IN_PROGRESS);
  });

  test("arrival is not stamped on a booking that was cancelled", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.CANCELLED_BY_USER });
    const applied = await trackingService.recordArrival({
      bookingId: id, providerId: ctx.providerId, enRouteAt: null, assignedAt: null,
      city: null, serviceCategory: null, distanceKm: null, googleEtaMin: null, source: "explicit_partner_action",
    } as never);
    expect(applied).toBe(false);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { arrivedAt: true } })).arrivedAt).toBeNull();
  });

  test("a partner who no longer holds the job cannot arrive at it or move it en route", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.ACCEPTED });
    const stranger = "prov_not_the_holder";
    expect(await trackingService.commitEnRoute({ bookingId: id, providerId: stranger, distanceKm: null, googleEtaMin: null, source: "explicit_partner_action" } as never)).toBe(false);
    expect(await trackingService.recordArrival({
      bookingId: id, providerId: stranger, enRouteAt: null, assignedAt: null,
      city: null, serviceCategory: null, distanceKm: null, googleEtaMin: null, source: "explicit_partner_action",
    } as never)).toBe(false);
    expect(await statusOf(id)).toBe(BookingStatus.ACCEPTED);
  });

  test("control: the holder moves it en route, and the history names them", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.ACCEPTED });
    expect(await trackingService.commitEnRoute({ bookingId: id, providerId: ctx.providerId, distanceKm: null, googleEtaMin: null, source: "explicit_partner_action" } as never)).toBe(true);
    expect(await statusOf(id)).toBe(BookingStatus.EN_ROUTE);
    const last = (await historyOf(id)).at(-1)!;
    expect(last).toMatchObject({ new_status: "EN_ROUTE", actor_type: "partner", actor_id: ctx.providerId });
    expect(last.reason).toContain("en route");
  });
});

describe.serial("concurrent transitions are deterministic", () => {
  test("ten simultaneous no-show reports from both sides: exactly one wins, once", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.EN_ROUTE, arrivedMinutesAgo: 30 });
    // A no-show is counted from the booked time: the appointment has begun.
    await placeAtDoor(id, ctx.providerId);
    // The arrival was vouched for (not confirmed from a position), so the customer's own report is
    // still open to them — against a position-confirmed arrival it would go to support instead.
    await prisma.activityLog.create({ data: { bookingId: id, providerId: ctx.providerId, action: "PARTNER_ARRIVAL_VOUCHED", description: "Arrival recorded on the customer's confirmation: no position was confirmed" } });
    const partner = { userId: ctx.vendorUserId, providerId: ctx.providerId };
    const customer = { userId: ctx.customerA.id };
    const results = await Promise.all([
      ...Array.from({ length: 5 }, () => bookingNoShowService.reportCustomerNoShow(id, partner)),
      ...Array.from({ length: 5 }, () => bookingNoShowService.reportProviderNoShow(id, customer)),
    ]);
    const winners = results.filter((r) => "ok" in r && r.ok);
    expect(winners.length).toBe(1);
    const final = await statusOf(id);
    expect(final).toBe((winners[0] as { status: BookingStatus }).status);
    // Every loser was told the booking moved — none was reported as a second success.
    for (const r of results) if (!("ok" in r)) expect(r.error).toBe("INVALID_STATUS");
    const terminalRows = (await historyOf(id)).filter((h) => h.new_status === final);
    expect(terminalRows.length).toBe(1);
  });
});

describe.serial("every transition is attributed: actor, reason, request id, trace id", () => {
  test("an admin no-show records the admin, their reason, and the request's ids", async () => {
    if (!dbOk) return;
    const id = await seedBooking({ status: BookingStatus.ACCEPTED });
    const r = await runWithEventContext({ traceId: `${RUN}-trace`, requestId: `${RUN}-req` }, () =>
      bookingNoShowService.reportProviderNoShow(id, { userId: ctx.superAdmin.id, isAdmin: true, reason: "customer called support twice" }),
    );
    expect("ok" in r && r.ok).toBe(true);
    const last = (await historyOf(id)).at(-1)!;
    expect(last).toMatchObject({
      new_status: "PROVIDER_NO_SHOW",
      actor_type: "admin",
      actor_id: ctx.superAdmin.id,
      request_id: `${RUN}-req`,
      trace_id: `${RUN}-trace`,
    });
    expect(last.reason).toContain("customer called support twice");
  });
});
