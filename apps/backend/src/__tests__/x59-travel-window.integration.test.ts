/**
 * X-59 through the real tracking service on the isolated test DB. Before the window a GPS ping on an
 * ACCEPTED job changes nothing a customer can see (no EN_ROUTE, no "on the way" tracking row, no location
 * history); inside it the existing geofence transition runs once; ownership, reassignment and terminal
 * status still refuse; the explicit "On my way" action is unaffected.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { trackingService } from "../services/tracking.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";

const RUN = `x59-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let hoursAhead = 200;
const FAR = { latitude: 28.9, longitude: 77.9 }; // ~50 km from the fixture address: never an arrival

async function call(method: string, path: string, body?: unknown, token?: string | null) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}
/** An ACCEPTED booking of the fixture partner whose slot starts `minutesFromNow` from now. */
async function accepted(minutesFromNow: number, status = "ACCEPTED", providerId: string | null = ctx.providerId): Promise<string> {
  hoursAhead += 24;
  // Slots near "now" overlap; the DB's slot exclusion constraints refuse a second live booking in the
  // same range. Each test asserts before it creates the next, so earlier fixtures are closed first.
  await prisma.booking.updateMany({ where: { userId: ctx.customerA.id, status: { notIn: ["COMPLETED", "CANCELLED_BY_USER", "CANCELLED_BY_PROVIDER", "EXPIRED", "REJECTED", "CUSTOMER_NO_SHOW", "PROVIDER_NO_SHOW"] } }, data: { status: "CANCELLED_BY_USER" } });
  const r = await call("POST", "/api/bookings", { serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(hoursAhead).toISOString() }, bearer(ctx.customerA));
  if (r.status !== 201) throw new Error(`book: ${r.status} ${JSON.stringify(r.json)}`);
  const id: string = r.json.data.booking?.id ?? r.json.data.id;
  await prisma.booking.update({ where: { id }, data: { providerId, status: status as never, paymentStatus: "SUCCESS", scheduledDate: new Date(Date.now() + minutesFromNow * 60_000) } });
  return id;
}
const state = (id: string) => prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true, enRouteAt: true } });
const trackingOf = (id: string) => prisma.tracking.findUnique({ where: { bookingId: id }, select: { status: true, id: true } });
const history = async (id: string) => { const t = await trackingOf(id); return t ? prisma.locationHistory.count({ where: { trackingId: t.id } }) : 0; };
const ping = (id: string, providerId = ctx.providerId) => trackingService.updateLocation(providerId, { bookingId: id, ...FAR });

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
afterEach(() => { delete process.env.GPS_TRAVEL_WINDOW_MINUTES; });
afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("X-59: GPS travel window (60 minutes before the slot)", () => {
  test("2 days early: the ping changes nothing a customer sees", async () => {
    if (!dbOk) return;
    const id = await accepted(2 * 24 * 60);
    const r = await ping(id);
    expect((r as { outsideTravelWindow?: boolean })?.outsideTravelWindow).toBe(true);
    expect(await state(id)).toEqual({ status: "ACCEPTED", enRouteAt: null });
    expect((await trackingOf(id))?.status ?? null).not.toBe("ON_THE_WAY");
    expect(await history(id)).toBe(0);
  });

  test("2 hours early: still closed", async () => {
    if (!dbOk) return;
    const id = await accepted(120);
    expect((await ping(id) as { outsideTravelWindow?: boolean })?.outsideTravelWindow).toBe(true);
    expect((await state(id)).status).toBe("ACCEPTED");
  });

  test("59 minutes early: the existing geofence transition runs — once", async () => {
    if (!dbOk) return;
    const id = await accepted(59);
    await ping(id);
    const s1 = await state(id);
    expect(s1.status).toBe("EN_ROUTE");
    expect(s1.enRouteAt).not.toBeNull();
    expect((await trackingOf(id))?.status).toBe("ON_THE_WAY");
    await ping(id); // idempotent: a second ping does not move the anchor
    expect((await state(id)).enRouteAt?.getTime()).toBe(s1.enRouteAt!.getTime());
  });

  test("exact start and after the start: open", async () => {
    if (!dbOk) return;
    const a = await accepted(0);
    await ping(a);
    expect((await state(a)).status).toBe("EN_ROUTE");
    const b = await accepted(-30);
    await ping(b);
    expect((await state(b)).status).toBe("EN_ROUTE");
  });

  test("terminal, reassigned, never-owned and unassigned bookings are refused as before", async () => {
    if (!dbOk) return;
    const terminal = await accepted(10, "CANCELLED_BY_USER");
    expect(await ping(terminal)).toBeNull();
    expect((await state(terminal)).status).toBe("CANCELLED_BY_USER");
    const other = await prisma.provider.findFirst({ where: { id: { not: ctx.providerId } }, select: { id: true } });
    const reassigned = await accepted(10, "ACCEPTED", other!.id);
    expect(await ping(reassigned)).toBeNull();
    expect((await state(reassigned)).status).toBe("ACCEPTED");
    const mine = await accepted(10);
    expect(await ping(mine, other!.id)).toBeNull();
    expect((await state(mine)).status).toBe("ACCEPTED");
    const unassigned = await accepted(10, "PENDING", null);
    expect(await ping(unassigned)).toBeNull();
  });

  test("unset / invalid configuration fails closed: GPS never changes travel state", async () => {
    if (!dbOk) return;
    process.env.GPS_TRAVEL_WINDOW_MINUTES = "off";
    const id = await accepted(10);
    expect((await ping(id) as { outsideTravelWindow?: boolean })?.outsideTravelWindow).toBe(true);
    expect(await state(id)).toEqual({ status: "ACCEPTED", enRouteAt: null });
  });

  test("the explicit 'On my way' action is not affected by the window", async () => {
    if (!dbOk) return;
    const id = await accepted(2 * 24 * 60);
    const r = await call("POST", `/api/bookings/${id}/en-route`, {}, bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` }));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await state(id)).status).toBe("EN_ROUTE");
  });
});
