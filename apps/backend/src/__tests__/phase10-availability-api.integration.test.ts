/**
 * Wave 4 — the availability projection, over HTTP against the isolated test database.
 *
 * The property that matters: **the list never offers a slot booking create would refuse, and never
 * hides one it would accept.** Each test therefore checks the projection against the authority by
 * actually attempting the booking.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { bookingService } from "../services/booking.service";
import { civilDate } from "../lib/service-availability";

const RUN = `p10avail-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 4;

const dayAhead = (n: number) => civilDate(new Date(Date.now() + n * 86_400_000));
const istTime = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

async function availability(date: string, extra: Record<string, string> = {}) {
  const qs = new URLSearchParams({ serviceId: ctx.serviceId, date, ...extra });
  const res = await app.handle(
    new Request(`http://localhost/api/bookings/availability?${qs}`, {
      headers: { Authorization: `Bearer ${bearer(ctx.customerA)}` },
    }),
  );
  return { status: res.status, json: (await res.json()) as any };
}

/** Put the fixture service's availability config into a known state. */
async function setAvailability(availabilityCfg: Record<string, unknown> | null) {
  const svc = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { catalogConfig: true } });
  const cfg = { ...((svc.catalogConfig as Record<string, unknown>) ?? {}) };
  if (availabilityCfg) cfg.availability = availabilityCfg;
  else delete cfg.availability;
  await prisma.service.update({ where: { id: ctx.serviceId }, data: { catalogConfig: cfg as Prisma.InputJsonValue } });
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
  // A partner who works the whole customer window, so the window itself is what shapes the grid.
  await prisma.provider.update({
    where: { id: ctx.providerId },
    data: { workingHoursStart: "07:00", workingHoursEnd: "22:00", timezone: "Asia/Kolkata",
      workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] },
  });
}, 120_000);

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("the grid the customer sees", () => {
  test("a future day returns the 30-minute grid in Asia/Kolkata with the owner's window", async () => {
    if (!dbOk) return;
    await setAvailability(null);
    const r = await availability(dayAhead((day += 1)), { providerId: ctx.providerId });
    expect(r.status).toBe(200);
    expect(r.json.data.timeZone).toBe("Asia/Kolkata");
    expect(r.json.data.slotMinutes).toBe(30);
    expect(r.json.data.operatingWindow).toEqual({ start: "07:00", end: "22:00" });
    expect(istTime(new Date(r.json.data.slots[0].start))).toBe("07:00");
    expect(r.json.data.availableCount).toBeGreaterThan(0);
  });

  test("every unavailable slot says WHY — the UI can explain instead of hiding", async () => {
    if (!dbOk) return;
    await setAvailability({ minimumLeadTimeMinutes: 60 * 24 * 3 }); // 3 days' notice
    const r = await availability(dayAhead(1), { providerId: ctx.providerId });
    expect(r.status).toBe(200);
    expect(r.json.data.availableCount).toBe(0);
    for (const s of r.json.data.slots) {
      expect(s.available).toBe(false);
      expect(s.reason).toBe("LEAD_TIME_NOT_MET");
    }
    await setAvailability(null);
  });

  test("today's grid marks the hours that have already passed, not the whole day", async () => {
    if (!dbOk) return;
    await setAvailability(null);
    const r = await availability(dayAhead(0), { providerId: ctx.providerId });
    expect(r.status).toBe(200);
    const past = r.json.data.slots.filter((s: any) => new Date(s.start).getTime() < Date.now());
    for (const s of past) expect(s.reason).toBe("SLOT_IN_PAST");
  });
});

describe.serial("the projection agrees with booking create", () => {
  test("a slot it offers is genuinely bookable", async () => {
    if (!dbOk) return;
    await setAvailability(null);
    const date = dayAhead((day += 1));
    const r = await availability(date, { providerId: ctx.providerId });
    const offered = r.json.data.slots.find((s: any) => s.available);
    expect(offered).toBeTruthy();

    const created = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressAId,
      scheduledDate: offered.start,
    });
    expect("booking" in created).toBe(true);
  });

  test("once booked, that slot and its buffer stop being offered", async () => {
    if (!dbOk) return;
    const date = dayAhead((day += 1));
    const before = await availability(date, { providerId: ctx.providerId });
    const target = before.json.data.slots.find((s: any) => s.available && istTime(new Date(s.start)) === "12:00")
      ?? before.json.data.slots.find((s: any) => s.available);
    const created = await bookingService.create(ctx.customerB.id, {
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressBId,
      scheduledDate: target.start,
    });
    expect("booking" in created).toBe(true);

    const after = await availability(date, { providerId: ctx.providerId });
    const sameSlot = after.json.data.slots.find((s: any) => s.start === target.start);
    expect(sameSlot.available).toBe(false);
    expect(sameSlot.reason).toBe("PROVIDER_BUSY");
    expect(after.json.data.availableCount).toBeLessThan(before.json.data.availableCount);
  });

  test("a slot it refuses for capacity is genuinely refused by create", async () => {
    if (!dbOk) return;
    const date = dayAhead((day += 1));
    const r1 = await availability(date, { providerId: ctx.providerId });
    const target = r1.json.data.slots.find((s: any) => s.available);
    await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId, providerId: ctx.providerId, addressId: ctx.addressAId, scheduledDate: target.start,
    });

    const r2 = await availability(date, { providerId: ctx.providerId });
    const busy = r2.json.data.slots.find((s: any) => s.start === target.start);
    expect(busy.available).toBe(false);

    const second = await bookingService.create(ctx.customerB.id, {
      serviceId: ctx.serviceId, providerId: ctx.providerId, addressId: ctx.addressBId, scheduledDate: target.start,
    });
    expect("error" in second).toBe(true);
  });

  test("outside the partner's hours the reason distinguishes 'nobody works then' from 'all busy'", async () => {
    if (!dbOk) return;
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { workingHoursStart: "10:00", workingHoursEnd: "14:00" },
    });
    const r = await availability(dayAhead((day += 1)), { providerId: ctx.providerId });
    const early = r.json.data.slots.find((s: any) => istTime(new Date(s.start)) === "08:00");
    expect(early.available).toBe(false);
    expect(early.reason).toBe("OUTSIDE_WORKING_HOURS");
    const inside = r.json.data.slots.find((s: any) => istTime(new Date(s.start)) === "11:00");
    expect(inside.available).toBe(true);
    await prisma.provider.update({
      where: { id: ctx.providerId },
      data: { workingHoursStart: "07:00", workingHoursEnd: "22:00" },
    });
  });
});

describe.serial("refusals", () => {
  test("a malformed date is refused, not guessed", async () => {
    if (!dbOk) return;
    const r = await availability("24-12-2026");
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("INVALID_DATE");
  });

  test("an unknown service is 404", async () => {
    if (!dbOk) return;
    const res = await app.handle(
      new Request(`http://localhost/api/bookings/availability?serviceId=does-not-exist&date=${dayAhead(3)}`, {
        headers: { Authorization: `Bearer ${bearer(ctx.customerA)}` },
      }),
    );
    expect(res.status).toBe(404);
  });

  test("an address outside coverage is refused rather than returning an empty grid", async () => {
    if (!dbOk) return;
    const before = await prisma.service.findUniqueOrThrow({ where: { id: ctx.serviceId }, select: { availableCities: true } });
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { availableCities: ["Chennai"] } });
    const r = await availability(dayAhead(3), { addressId: ctx.addressAId });
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("SERVICE_NOT_AVAILABLE");
    await prisma.service.update({ where: { id: ctx.serviceId }, data: { availableCities: before.availableCities } });
  });

  test("it requires a caller — an anonymous capacity scan is refused", async () => {
    if (!dbOk) return;
    const res = await app.handle(
      new Request(`http://localhost/api/bookings/availability?serviceId=${ctx.serviceId}&date=${dayAhead(3)}`),
    );
    expect([401, 403]).toContain(res.status);
  });
});
