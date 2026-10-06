/**
 * Arrival and start through the real routes and service: the position the SERVER holds for the
 * partner decides, whatever coordinates the request carries; an admin can waive the check for one
 * booking with a reason.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { createBookingWithQuote } from "./helpers/quote-token";

const RUN = `arrpos-${Date.now().toString(36)}`;
const JOB = { latitude: 28.62, longitude: 77.37 };
const FAR = { latitude: 28.7, longitude: 77.37 };
let ctx: AdvCtx;
let dbOk = false;
let hours = 300;

const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });
async function post(path: string, token: string, body: unknown) {
  const res = await app.handle(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json().catch(() => ({}))) as { code?: string; error?: string; data?: any } };
}
/** What the server holds as the partner's position, written the way a heartbeat leaves it. */
const serverFix = (at: { latitude: number; longitude: number } | null, secondsAgo = 5) =>
  prisma.partnerPresence.update({
    where: { providerId: ctx.providerId },
    data: at
      ? { lastLocationLat: at.latitude, lastLocationLng: at.longitude, lastLocationAt: new Date(Date.now() - secondsAgo * 1000), lastLocationReceivedAt: new Date() }
      : { lastLocationLat: null, lastLocationLng: null, lastLocationAt: null, lastLocationReceivedAt: null },
  });
async function acceptedBooking(): Promise<string> {
  hours += 24;
  const booked = await createBookingWithQuote(ctx.customerA.id, { serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(hours).toISOString() });
  if (!("booking" in booked) || !booked.booking) throw new Error(`booking: ${JSON.stringify(booked)}`);
  await prisma.booking.update({ where: { id: booked.booking.id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: new Date() } });
  return booked.booking.id;
}
const arrivedAt = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { arrivedAt: true } })).arrivedAt;

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

describe.serial("arrival is confirmed against the position the server holds", () => {
  test("sending the job's own coordinates from somewhere else is refused, and nothing is recorded", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(FAR);
    const r = await post(`/api/bookings/${id}/arrived`, partner(), JOB);
    expect({ status: r.status, code: r.json.code }).toEqual({ status: 409, code: "LOCATION_MISMATCH" });
    expect(await arrivedAt(id)).toBeNull();
  });

  test("with no position on record, or only an old one, the arrival is not confirmed", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(null);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
    await serverFix(JOB, 600);
    const old = await post(`/api/bookings/${id}/arrived`, partner(), JOB);
    expect({ status: old.status, code: old.json.code }).toEqual({ status: 409, code: "LOCATION_UNCONFIRMED" });
    expect(await arrivedAt(id)).toBeNull();
  });

  test("control: a partner whose device has just reported from the job arrives", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB);
    const r = await post(`/api/bookings/${id}/arrived`, partner(), JOB);
    expect(r.status).toBe(200);
    expect(await arrivedAt(id)).not.toBeNull();
  });

  test("the request's own coordinates are still checked: a claim away from the job is refused as before", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), FAR)).json.code).toBe("OUTSIDE_SERVICE_AREA");
  });
});

describe.serial("start follows the same rule", () => {
  test("a job cannot be started from a position the server places elsewhere; from the job it can", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(FAR);
    await expect(bookingService.start(ctx.providerId, id, JOB.latitude, JOB.longitude)).rejects.toThrow("LOCATION_MISMATCH");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    await serverFix(JOB);
    await bookingService.start(ctx.providerId, id, JOB.latitude, JOB.longitude);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("IN_PROGRESS");
  });
});

describe.serial("an admin can waive the position check for one booking, with a reason", () => {
  test("no reason, or a caller who is not an admin, is refused", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    expect((await post(`/api/admin/bookings/${id}/position-waiver`, bearer(ctx.superAdmin), {})).status).toBeGreaterThanOrEqual(400);
    expect((await post(`/api/admin/bookings/${id}/position-waiver`, bearer(ctx.customerA), { reason: "Please let me in without the check" })).status).toBe(403);
    expect((await post(`/api/admin/bookings/${id}/position-waiver`, partner(), { reason: "Please let me in without the check" })).status).toBe(403);
  });

  test("after the waiver the partner can arrive and start without a position on record; the waiver is on the booking's record", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    const other = await acceptedBooking();
    await serverFix(null);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
    const waived = await post(`/api/admin/bookings/${id}/position-waiver`, bearer(ctx.superAdmin), { reason: "Partner's phone GPS failed; customer confirmed on a call that the partner is at the door" });
    expect(waived.status).toBe(200);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).status).toBe(200);
    await bookingService.start(ctx.providerId, id, JOB.latitude, JOB.longitude);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("IN_PROGRESS");
    const log = await prisma.activityLog.findFirst({ where: { bookingId: id, action: "ADMIN_BOOKING_POSITION_CHECK_WAIVED" } });
    expect(log?.userId).toBe(ctx.superAdmin.id);
    expect(log?.description).toContain("customer confirmed on a call");
    // The waiver is for that booking only.
    expect((await post(`/api/bookings/${other}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
  });
});
