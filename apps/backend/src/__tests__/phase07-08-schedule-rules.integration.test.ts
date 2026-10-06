/**
 * Phase 07/08 — schedule and serviceability rules over the real HTTP surface.
 *
 * What this pins, and why each one is here:
 *  - a refused booking says WHICH rule refused it (it used to answer "Invalid service or address.
 *    Add a saved address and try again." for a lead-time or blackout refusal);
 *  - blackout and same-day are the BUSINESS calendar's days, so a 00:30 IST slot on a blacked-out
 *    date is refused (UTC called it the previous day and let it through);
 *  - a service configured for a longer booking horizon gets it (a hard 30-day cap overrode it);
 *  - the partner's working window covers the WHOLE appointment, not just its first minute;
 *  - RESCHEDULE runs those same rules. It previously ran conflict detection only, so a confirmed
 *    booking could be moved into the past, onto a blackout date, or outside the partner's hours;
 *  - a booking that is finished, cancelled or REJECTED cannot be moved at all, by customer or admin.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma, BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { withQuoteToken } from "./helpers/quote-token";
import { civilDate } from "../lib/service-availability";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";

const RUN = `sched78-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;

/** The service's own config is the authority for these rules, so each test sets exactly what it tests. */
async function setAvailability(availability: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const svc = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { catalogConfig: true } });
  const cfg = { ...((svc.catalogConfig as Record<string, unknown>) ?? {}) };
  if (availability) cfg.availability = availability;
  else delete cfg.availability;
  await prisma.service.update({
    where: { id: ctx.serviceId },
    data: { catalogConfig: { ...cfg, ...extra } as Prisma.InputJsonValue },
  });
}

async function setProviderHours(start: string | null, end: string | null, days?: string[]) {
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: {
      workingHoursStart: start,
      workingHoursEnd: end,
      timezone: "Asia/Kolkata",
      ...(days ? { workingDays: days } : {}),
    },
  });
}

async function book(at: Date, extra: Record<string, unknown> = {}) {
  // Booking create requires a price quote (QUOTE_REQUIRED otherwise) — quote first, as a client does.
  const body = await withQuoteToken(app, bearer(ctx.customerA), {
    serviceId: ctx.serviceId,
    addressId: ctx.addressAId,
    providerId: ctx.providerId,
    scheduledDate: at.toISOString(),
    ...extra,
  });
  const res = await app.handle(
    new Request("http://localhost/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

async function reschedule(bookingId: string, at: Date) {
  const res = await app.handle(
    new Request(`http://localhost/api/bookings/${bookingId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
      body: JSON.stringify({ scheduledDate: at.toISOString() }),
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

/**
 * A booking created through the API, with the rules relaxed so creation itself is not the subject.
 * Each one lands on its OWN day: the fixture customer and partner are shared, so reusing a day made
 * the second booking collide with the first and fail for a reason the test was not about.
 */
let dayCursor = 19;
async function seedBooking(): Promise<{ id: string; at: Date }> {
  await setAvailability(null);
  await setProviderHours("00:00", "23:59", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  const at = istSlot((dayCursor += 1));
  const created = await book(at);
  expect([200, 201]).toContain(created.status);
  return { id: (created.json.data.booking?.id ?? created.json.data.id) as string, at };
}

/** A slot at a FIXED hour of the business day N days out. `futureSlot` inherits the current hour,
 *  so a run late in the IST evening produced appointments that overran the partner's closing time —
 *  a real refusal, but not the one the test is about. */
function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = civilDate(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

/** An IST instant that UTC would place on the PREVIOUS calendar day. */
function earlyIstMorning(daysAhead: number): Date {
  const base = new Date(Date.now() + daysAhead * 86_400_000);
  const ymd = civilDate(base);
  return new Date(`${ymd}T00:30:00+05:30`);
}

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("create — the refusal names the rule", () => {
  test("lead time: refused with SCHEDULE_NOT_ALLOWED / LEAD_TIME_NOT_MET and copy about notice", async () => {
    if (!dbOk) return;
    await setProviderHours("00:00", "23:59", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    await setAvailability({ minimumLeadTimeMinutes: 2880 }); // 48 hours
    const res = await book(futureSlot(6));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("SCHEDULE_NOT_ALLOWED");
    expect(res.json.reason).toBe("LEAD_TIME_NOT_MET");
    expect(res.json.error).toContain("notice");
    // The defect this replaces: an address the customer never needed to touch.
    expect(res.json.error).not.toContain("saved address");
  });

  test("the same booking outside the lead window is accepted", async () => {
    if (!dbOk) return;
    await setAvailability({ minimumLeadTimeMinutes: 2880 });
    const res = await book(istSlot(4));
    expect([200, 201]).toContain(res.status);
  });

  test("blackout is the IST calendar day: 00:30 IST on a blacked-out date is refused", async () => {
    if (!dbOk) return;
    const slot = earlyIstMorning(9);
    // Sanity: UTC really does disagree — this is what let the old check through.
    expect(slot.toISOString().slice(0, 10)).not.toBe(civilDate(slot));
    await setAvailability({ blackoutDates: [civilDate(slot)] });
    const res = await book(slot);
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("SCHEDULE_NOT_ALLOWED");
    expect(res.json.reason).toBe("BLACKOUT_DATE");
  });

  test("a service configured for a 60-day horizon can be booked 45 days out", async () => {
    if (!dbOk) return;
    await setAvailability({ maximumAdvanceDays: 60 });
    const ok = await book(istSlot(45));
    expect([200, 201]).toContain(ok.status);
    // and its own limit still binds
    const tooFar = await book(istSlot(70));
    expect(tooFar.status).toBe(400);
    expect(tooFar.json.reason).toBe("BEYOND_ADVANCE_WINDOW");
  });

  test("with no configuration the default horizon still applies", async () => {
    if (!dbOk) return;
    await setAvailability(null);
    const res = await book(istSlot(46));
    expect(res.status).toBe(400);
    expect(res.json.reason).toBe("BEYOND_ADVANCE_WINDOW");
  });
});

describe.serial("create — the partner's working window covers the whole appointment", () => {
  test("a start outside the window is PROVIDER_UNAVAILABLE / OUTSIDE_WORKING_HOURS", async () => {
    if (!dbOk) return;
    await setAvailability(null);
    await setProviderHours("09:00", "18:00", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    const ymd = civilDate(new Date(Date.now() + 5 * 86_400_000));
    const res = await book(new Date(`${ymd}T03:00:00+05:30`));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("PROVIDER_UNAVAILABLE");
    expect(res.json.reason).toBe("OUTSIDE_WORKING_HOURS");
  });

  test("a 3-hour job starting 17:00 is refused although 17:00 is inside 09:00–18:00", async () => {
    if (!dbOk) return;
    await prisma.service.update({
      where: { id: ctx.serviceId },
      data: {
        partnerSlotPolicy: "DURATION",
        pricingModel: "hourly",
        catalogConfig: {
          bookingMode: "HOURLY",
          quantity: { type: "HOUR", unitLabel: "hour", min: 1, max: 4, step: 1, unitPrice: 200 },
        } as Prisma.InputJsonValue,
      },
    });
    const ymd = civilDate(new Date(Date.now() + 6 * 86_400_000));
    const overruns = await book(new Date(`${ymd}T17:00:00+05:30`), { quantity: 3 });
    expect(overruns.status).toBe(400);
    expect(overruns.json.reason).toBe("OUTSIDE_WORKING_HOURS");
    // The same job that finishes before closing is accepted.
    const fits = await book(new Date(`${ymd}T10:00:00+05:30`), { quantity: 3 });
    expect([200, 201]).toContain(fits.status);
  });
});

describe.serial("reschedule runs the same rules", () => {
  test("a confirmed booking can no longer be moved into the past", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking();
    const res = await reschedule(id, new Date(Date.now() - 3 * 86_400_000));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("SCHEDULE_NOT_ALLOWED");
    expect(res.json.reason).toBe("SLOT_IN_PAST");
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } });
    expect(row.scheduledDate.getTime()).toBeGreaterThan(Date.now());
  });

  test("a reschedule onto a blackout date is refused; a legal one still succeeds", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking();
    const slot = earlyIstMorning(10);
    await setAvailability({ blackoutDates: [civilDate(slot)] });
    const blocked = await reschedule(id, slot);
    expect(blocked.status).toBe(400);
    expect(blocked.json.reason).toBe("BLACKOUT_DATE");

    await setAvailability(null);
    const target = istSlot(7);
    const ok = await reschedule(id, target);
    expect(ok.status).toBe(200);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } });
    expect(row.scheduledDate.toISOString()).toBe(target.toISOString());
  });

  test("a reschedule outside the partner's hours is refused", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking();
    await setProviderHours("09:00", "18:00", ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    const ymd = civilDate(new Date(Date.now() + 8 * 86_400_000));
    const res = await reschedule(id, new Date(`${ymd}T04:00:00+05:30`));
    expect(res.status).toBe(400);
    expect(res.json.reason).toBe("OUTSIDE_WORKING_HOURS");
  });

  test("a REJECTED booking cannot be rescheduled by the customer", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking();
    await prisma.booking.update({ where: { id }, data: { status: BookingStatus.REJECTED } });
    const res = await reschedule(id, istSlot(6));
    expect(res.status).toBe(400);
    expect(res.json.code).toBe("INVALID_STATUS");
  });

  test("an admin cannot reschedule a COMPLETED booking, and its date is untouched", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking();
    const before = (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } })).scheduledDate;
    // `booking_completed_requires_timestamp` is a real constraint: a COMPLETED row must carry one.
    await prisma.booking.update({ where: { id }, data: { status: BookingStatus.COMPLETED, completedAt: new Date() } });
    await expect(
      adminBookingOperationsService.rescheduleBooking(id, ctx.superAdmin.id, istSlot(9).toISOString(), "ops test"),
    ).rejects.toThrow("BOOKING_NOT_RESCHEDULABLE");
    const after = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } });
    expect(after.scheduledDate.toISOString()).toBe(before.toISOString());
  });

  test("an admin reschedule of a live booking is recorded with the admin as the actor", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking();
    const target = istSlot(11);
    await adminBookingOperationsService.rescheduleBooking(id, ctx.superAdmin.id, target.toISOString(), "ops test");
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } });
    expect(row.scheduledDate.toISOString()).toBe(target.toISOString());
    const history = await prisma.bookingStatusHistory.findMany({
      where: { bookingId: id, oldScheduledDate: { not: null } },
      orderBy: { id: "desc" },
      take: 1,
    });
    expect(history[0]?.actorType).toBe("admin");
    expect(history[0]?.actorId).toBe(ctx.superAdmin.id);
  });
});

describe.serial("quote — serviceability is answered when the price is asked", () => {
  test("a quote for an address outside the service's cities is refused, not priced", async () => {
    if (!dbOk) return;
    await setAvailability(null);
    // The fixture address is in Noida; restrict the service to a city it is not in.
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { availableCities: ["Chennai"] } });
    const res = await app.handle(
      new Request("http://localhost/api/bookings/price-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
        body: JSON.stringify({ serviceId: ctx.serviceId, addressId: ctx.addressAId }),
      }),
    );
    const json = (await res.json()) as any;
    expect(res.status).toBe(400);
    expect(json.code).toBe("SERVICE_NOT_AVAILABLE");
    // Nothing priced: no quote token can exist for a booking that could never be placed.
    expect(json.data?.quote).toBeUndefined();
  });

  test("the same quote without an address is still priced (location-agnostic)", async () => {
    if (!dbOk) return;
    const res = await app.handle(
      new Request("http://localhost/api/bookings/price-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
        body: JSON.stringify({ serviceId: ctx.serviceId }),
      }),
    );
    expect(res.status).toBe(200);
  });

  test("restoring coverage prices the same address again", async () => {
    if (!dbOk) return;
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { availableCities: ["Noida"] } });
    const res = await app.handle(
      new Request("http://localhost/api/bookings/price-quote", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${bearer(ctx.customerA)}` },
        body: JSON.stringify({ serviceId: ctx.serviceId, addressId: ctx.addressAId }),
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).data.quote.quoteToken).toBeTruthy();
  });
});

describe.serial("a booking already placed stays movable", () => {
  test("a service that stops being bookable does not trap its existing bookings", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking();
    // Retire the service: no new bookings, but the appointment already sold must still be movable —
    // otherwise the customer's only remaining option is to cancel.
    const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { isActive: true } });
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { isActive: false } });
    try {
      const target = istSlot(14);
      const moved = await reschedule(id, target);
      expect(moved.status).toBe(200);
      const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { scheduledDate: true } });
      expect(row.scheduledDate.toISOString()).toBe(target.toISOString());

      // ...while a NEW booking of the same service is refused. The code is the quote layer's
      // SERVICE_UNAVAILABLE (customer-sellability), which fires before the booking validator's
      // SERVICE_NOT_AVAILABLE (bookability) — two pre-existing codes for two different gates.
      const created = await book(istSlot(15));
      expect(created.status).toBe(400);
      expect(["SERVICE_UNAVAILABLE", "SERVICE_NOT_AVAILABLE"]).toContain(created.json.code);
    } finally {
      await prisma.service.update({ where: { id: ctx.serviceId }, data: { isActive: before.isActive } });
    }
  });
});
