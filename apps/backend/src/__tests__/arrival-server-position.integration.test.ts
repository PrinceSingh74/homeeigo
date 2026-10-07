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
import { trackingService } from "../services/tracking.service";
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
  hours += 4; // a new slot each time, all well inside the 30-day booking horizon
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

describe.serial("the server's clock and the second stream", () => {
  test("a fix the device dated ahead does not stay fresh: the server's receive time is its age", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await prisma.partnerPresence.update({
      where: { providerId: ctx.providerId },
      data: { lastLocationLat: JOB.latitude, lastLocationLng: JOB.longitude, lastLocationAt: new Date(Date.now() + 25_000), lastLocationReceivedAt: new Date(Date.now() - 200_000) },
    });
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
  });

  /**
   * The second stream is this booking's own tracking pings (`location_history`), which only the
   * tracking channel writes. The `locations` row is not one: the heartbeat writes it together with
   * the presence fix, so it always agrees with the fix and can contradict nothing.
   */
  test("this booking's tracking pings elsewhere contradict a presence fix at the job, even when the heartbeat's own copy agrees with it", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB);
    await prisma.location.upsert({ where: { providerId: ctx.providerId }, create: { providerId: ctx.providerId, ...JOB }, update: { ...JOB } });
    const tracking = await prisma.tracking.create({ data: { bookingId: id, status: "ON_THE_WAY" } });
    await prisma.locationHistory.create({ data: { trackingId: tracking.id, providerId: ctx.providerId, ...FAR } });
    try {
      const r = await post(`/api/bookings/${id}/arrived`, partner(), JOB);
      expect({ status: r.status, code: r.json.code }).toEqual({ status: 409, code: "LOCATION_MISMATCH" });
      expect(await arrivedAt(id)).toBeNull();
    } finally {
      await prisma.location.deleteMany({ where: { providerId: ctx.providerId } });
    }
  });

  test("control: tracking pings at the job agree, another booking's pings are not this booking's, and an old ping says nothing about now", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    const other = await acceptedBooking();
    await serverFix(JOB);
    const mine = await prisma.tracking.create({ data: { bookingId: id, status: "ON_THE_WAY" } });
    const theirs = await prisma.tracking.create({ data: { bookingId: other, status: "ON_THE_WAY" } });
    await prisma.locationHistory.createMany({
      data: [
        { trackingId: mine.id, providerId: ctx.providerId, ...FAR, timestamp: new Date(Date.now() - 30 * 60_000) },
        { trackingId: mine.id, providerId: ctx.providerId, ...JOB },
        { trackingId: theirs.id, providerId: ctx.providerId, ...FAR },
      ],
    });
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).status).toBe(200);
  });
});

describe.serial("what is written down is the position the server held, not the one the request carried", () => {
  test("the arrival stamp carries the server-held fix; under an exception it carries no position at all", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    const held = { latitude: JOB.latitude + 0.0003, longitude: JOB.longitude };
    await serverFix(held);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).status).toBe(200);
    const stamp = await prisma.jobEvidence.findFirst({ where: { bookingId: id, stage: "ARRIVAL" }, select: { latitude: true, longitude: true } });
    expect(stamp?.latitude).toBeCloseTo(held.latitude, 6);

    const vouched = await acceptedBooking();
    await serverFix(null);
    await post(`/api/bookings/${vouched}/confirm-arrival`, bearer(ctx.customerA), {});
    expect((await post(`/api/bookings/${vouched}/arrived`, partner(), JOB)).status).toBe(200);
    const none = await prisma.jobEvidence.findFirst({ where: { bookingId: vouched, stage: "ARRIVAL" }, select: { latitude: true, longitude: true } });
    expect(none).toEqual({ latitude: null, longitude: null });
  });
});

describe.serial("a photo's position is the server's, not the upload's", () => {
  test("an evidence upload is stamped with the position the server holds; the coordinates in the request are not written", async () => {
    expect(dbOk).toBe(true);
    const { pngDataUrl } = await import("./helpers/evidence-photo");
    const id = await acceptedBooking();
    await serverFix(JOB);
    const sent = await post(`/api/bookings/${id}/evidence`, partner(), { stage: "ARRIVAL", mediaUrl: pngDataUrl(`${RUN}-door-1`), clientUploadId: `${RUN}-door-1`, ...FAR });
    expect(sent.status).toBe(200);
    const held = await prisma.jobEvidence.findFirstOrThrow({ where: { bookingId: id, clientUploadId: `${RUN}-door-1` }, select: { latitude: true, longitude: true } });
    expect(held.latitude).toBeCloseTo(JOB.latitude, 6);

    await serverFix(null);
    const blind = await post(`/api/bookings/${id}/evidence`, partner(), { stage: "START", mediaUrl: pngDataUrl(`${RUN}-door-2`), clientUploadId: `${RUN}-door-2`, ...JOB });
    expect(blind.status).toBe(200);
    const none = await prisma.jobEvidence.findFirstOrThrow({ where: { bookingId: id, clientUploadId: `${RUN}-door-2` }, select: { latitude: true, longitude: true } });
    expect(none).toEqual({ latitude: null, longitude: null });
  });
});

describe.serial("the exception is for a device that has no position to send", () => {
  test("the on-site check route itself takes a request with no coordinates", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(null);
    await post(`/api/bookings/${id}/confirm-arrival`, bearer(ctx.customerA), {});
    const r = await post(`/api/bookings/${id}/requirements/no-such-requirement/check`, partner(), { outcome: "SATISFIED", latitude: null, longitude: null });
    // Refused for the requirement it names, not for the shape of the request (422) or the missing position.
    expect(r.status).not.toBe(422);
    expect(r.json.code).not.toBe("LOCATION_REQUIRED");
  });

  test("without an exception, a request with no coordinates is refused", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB);
    const r = await post(`/api/bookings/${id}/arrived`, partner(), { latitude: null, longitude: null });
    expect({ status: r.status, code: r.json.code }).toEqual({ status: 400, code: "LOCATION_REQUIRED" });
  });

  test("after the customer confirms, a device with no position at all arrives, checks a requirement and starts", async () => {
    expect(dbOk).toBe(true);
    const { bookingRequirementService } = await import("../services/booking-requirement.service");
    const id = await acceptedBooking();
    await serverFix(null);
    expect((await post(`/api/bookings/${id}/confirm-arrival`, bearer(ctx.customerA), {})).status).toBe(200);
    const arrived = await post(`/api/bookings/${id}/arrived`, partner(), { latitude: null, longitude: null });
    expect(arrived.status).toBe(200);
    expect(await arrivedAt(id)).not.toBeNull();
    const check = await bookingRequirementService.partnerCheck({ bookingId: id, providerId: ctx.providerId, userId: ctx.vendorUserId, code: "no-such-requirement", outcome: "SATISFIED", latitude: null, longitude: null });
    expect((check as { error?: string }).error).not.toBe("LOCATION_REQUIRED");
    const started = await post(`/api/bookings/${id}/start`, partner(), { latitude: null, longitude: null });
    expect(started.status).toBe(200);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("IN_PROGRESS");
  });

  test("an exception does not last: an old confirmation or waiver no longer vouches, and the customer can confirm again", async () => {
    expect(dbOk).toBe(true);
    const { POSITION_EXCEPTION_MAX_AGE_SEC } = await import("../lib/partner-presence.config");
    const id = await acceptedBooking();
    await serverFix(null);
    await post(`/api/bookings/${id}/confirm-arrival`, bearer(ctx.customerA), {});
    await post(`/api/admin/bookings/${id}/position-waiver`, bearer(ctx.superAdmin), { reason: "Partner's phone GPS failed; customer confirmed by phone" });
    const longAgo = (sec: number) => new Date(Date.now() - (sec + 60) * 1000);
    await prisma.activityLog.updateMany({ where: { bookingId: id, action: "CUSTOMER_CONFIRMED_PROFESSIONAL_ARRIVAL" }, data: { createdAt: longAgo(POSITION_EXCEPTION_MAX_AGE_SEC.customer) } });
    await prisma.activityLog.updateMany({ where: { bookingId: id, action: "ADMIN_BOOKING_POSITION_CHECK_WAIVED" }, data: { createdAt: longAgo(POSITION_EXCEPTION_MAX_AGE_SEC.admin) } });
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
    const again = await post(`/api/bookings/${id}/confirm-arrival`, bearer(ctx.customerA), {});
    expect(again.status).toBe(200);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).status).toBe(200);
  });
});

describe.serial("GPS-geofence arrival answers to the same check", () => {
  const ping = (id: string, dLat: number) => trackingService.updateLocation(ctx.providerId, { bookingId: id, latitude: JOB.latitude + dLat, longitude: JOB.longitude } as never);
  const travelling = async () => {
    const id = await acceptedBooking();
    await prisma.booking.update({ where: { id }, data: { status: "EN_ROUTE", enRouteAt: new Date() } });
    await prisma.location.deleteMany({ where: { providerId: ctx.providerId } });
    return id;
  };

  test("tracking pings that carry the job's coordinates do not record arrival while the presence fix is elsewhere", async () => {
    expect(dbOk).toBe(true);
    const id = await travelling();
    await serverFix(FAR);
    await ping(id, 0);
    await ping(id, 0.0002);
    await ping(id, 0.0004);
    expect(await arrivedAt(id)).toBeNull();
  });

  test("control: with the presence fix at the job too, the geofence records arrival", async () => {
    expect(dbOk).toBe(true);
    const id = await travelling();
    await serverFix(JOB);
    await ping(id, 0);
    await ping(id, 0.0002);
    await ping(id, 0.0004);
    expect(await arrivedAt(id)).not.toBeNull();
  });
});

describe.serial("the customer can confirm the professional is there: the recorded exception", () => {
  test("only the booking's customer can, and only while a professional holds the job", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    expect((await post(`/api/bookings/${id}/confirm-arrival`, bearer(ctx.customerB), {})).status).toBeGreaterThanOrEqual(403);
    expect((await post(`/api/bookings/${id}/confirm-arrival`, partner(), {})).status).toBeGreaterThanOrEqual(403);
    await prisma.booking.update({ where: { id }, data: { providerId: null, status: "PENDING" } });
    const noPro = await post(`/api/bookings/${id}/confirm-arrival`, bearer(ctx.customerA), {});
    expect({ status: noPro.status, code: noPro.json.code }).toEqual({ status: 409, code: "INVALID_STATUS" });
  });

  test("after the customer confirms, the professional arrives without a position on record, and it is logged as the customer's confirmation", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(null);
    await prisma.location.deleteMany({ where: { providerId: ctx.providerId } });
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
    const confirmed = await post(`/api/bookings/${id}/confirm-arrival`, bearer(ctx.customerA), {});
    expect(confirmed.status).toBe(200);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).status).toBe(200);
    const log = await prisma.activityLog.findFirst({ where: { bookingId: id, action: "CUSTOMER_CONFIRMED_PROFESSIONAL_ARRIVAL" } });
    expect({ by: log?.userId, forPartner: log?.providerId }).toEqual({ by: ctx.customerA.id, forPartner: ctx.providerId });
    // The request's own coordinates are still checked: the confirmation vouches for presence, not for a claim made from elsewhere.
    const other = await acceptedBooking();
    await post(`/api/bookings/${other}/confirm-arrival`, bearer(ctx.customerA), {});
    expect((await post(`/api/bookings/${other}/arrived`, partner(), FAR)).json.code).toBe("OUTSIDE_SERVICE_AREA");
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

  test("a reason of spaces is no reason", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    const r = await post(`/api/admin/bookings/${id}/position-waiver`, bearer(ctx.superAdmin), { reason: "            " });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await prisma.activityLog.count({ where: { bookingId: id, action: "ADMIN_BOOKING_POSITION_CHECK_WAIVED" } })).toBe(0);
  });

  test("the waiver vouches for the partner it was given for: a partner who takes the job over is checked again", async () => {
    expect(dbOk).toBe(true);
    const next = await seedAdversarialFixtures(`${RUN}-b`);
    try {
      const id = await acceptedBooking();
      await serverFix(null);
      expect((await post(`/api/admin/bookings/${id}/position-waiver`, bearer(ctx.superAdmin), { reason: "First partner's phone GPS failed; customer confirmed by phone" })).status).toBe(200);
      await prisma.booking.update({ where: { id }, data: { providerId: next.providerId, status: "ASSIGNED", assignedAt: new Date() } });
      await prisma.partnerPresence.updateMany({ where: { providerId: next.providerId }, data: { lastLocationLat: null, lastLocationLng: null, lastLocationAt: null } });
      const r = await post(`/api/bookings/${id}/arrived`, bearer({ id: next.vendorUserId, email: `${RUN}-b@partner.test` }), JOB);
      expect(r.json.code).toBe("LOCATION_UNCONFIRMED");
    } finally {
      await cleanupAdversarialFixtures(`${RUN}-b`);
    }
  }, 120_000);
});

describe.serial("an on-site requirement check follows the same rule", () => {
  test("a check claimed from the job while the server places the partner elsewhere is refused", async () => {
    expect(dbOk).toBe(true);
    const { bookingRequirementService } = await import("../services/booking-requirement.service");
    const id = await acceptedBooking();
    await serverFix(FAR);
    const r = await bookingRequirementService.partnerCheck({ bookingId: id, providerId: ctx.providerId, userId: ctx.vendorUserId, code: "anything", outcome: "SATISFIED", latitude: JOB.latitude, longitude: JOB.longitude });
    expect(r).toMatchObject({ ok: false, error: "LOCATION_MISMATCH" });
  });
});
