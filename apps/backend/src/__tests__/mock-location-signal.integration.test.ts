/**
 * The mock-location signal (device attestation, first half; 2026-10-08).
 *
 * Android marks every fix a mock-location app produced (`mocked: true`); iOS has no such flag and
 * older clients send nothing. The server keeps that word with each fix it stores, and a fix the
 * device itself says is mocked is not a position the server holds: arrival, start and the on-site
 * check answer LOCATION_UNCONFIRMED on it, a mocked tracking point is never evidence for the
 * partner, a customer no-show reported on it takes no fee, and the report is a risk signal once
 * per booking. `false` and absent behave exactly as before.
 *
 * Runs on the isolated test database only.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import prisma from "../lib/prisma";
import app from "../index";
import { bookingService } from "../services/booking.service";
import { trackingService } from "../services/tracking.service";
import { partnerPresenceService } from "../services/partner-presence.service";
import { bookingNoShowService } from "../services/booking-no-show.service";
import { bearer, cleanupAdversarialFixtures, dbReachable, futureSlot, payWithRealWallet, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { createBookingWithQuote } from "./helpers/quote-token";
import { storedEvidenceKey } from "./helpers/evidence-photo";
import { placeAtDoor } from "./helpers/no-show-fixture";

const RUN = `mockloc-${Date.now().toString(36)}`;
const JOB = { latitude: 28.62, longitude: 77.37 };
const FAR = { latitude: 28.7, longitude: 77.37 };
/** The risk signal a mocked fix leaves, once per booking (see services/arrival-position.service). */
const MOCK_SIGNAL_SOURCE = "device_mock_flag";
let ctx: AdvCtx;
let dbOk = false;
let hours = 300;

const partner = () => bearer({ id: ctx.vendorUserId, email: `${RUN}@partner.test` });
async function post(path: string, token: string, body: unknown) {
  const res = await app.handle(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json().catch(() => ({}))) as { code?: string; error?: string; data?: any } };
}
async function get(path: string, token: string) {
  const res = await app.handle(new Request(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } }));
  return { status: res.status, json: (await res.json().catch(() => ({}))) as { data?: any } };
}
/** What the server holds as the partner's position, written the way a heartbeat leaves it, with the device's word on it. */
const serverFix = (at: { latitude: number; longitude: number } | null, mocked: boolean | null = null, secondsAgo = 5) =>
  prisma.partnerPresence.update({
    where: { providerId: ctx.providerId },
    data: at
      ? { lastLocationLat: at.latitude, lastLocationLng: at.longitude, lastLocationAt: new Date(Date.now() - secondsAgo * 1000), lastLocationReceivedAt: new Date(), lastLocationMocked: mocked }
      : { lastLocationLat: null, lastLocationLng: null, lastLocationAt: null, lastLocationReceivedAt: null, lastLocationMocked: null },
  });
async function acceptedBooking(opts: { pinVerified?: boolean } = {}): Promise<string> {
  hours += 4; // a new slot each time, all well inside the 30-day booking horizon
  const booked = await createBookingWithQuote(ctx.customerA.id, { serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(hours).toISOString() });
  if (!("booking" in booked) || !booked.booking) throw new Error(`booking: ${JSON.stringify(booked)}`);
  await prisma.booking.update({ where: { id: booked.booking.id }, data: { providerId: ctx.providerId, status: "ACCEPTED", paymentStatus: "SUCCESS", startOtpVerifiedAt: opts.pinVerified === false ? null : new Date() } });
  return booked.booking.id;
}
const arrivedAt = async (id: string) => (await prisma.booking.findUniqueOrThrow({ where: { id }, select: { arrivedAt: true } })).arrivedAt;
/** The mock-location risk signals on a booking; the recorder is fire-and-forget, so wait for it briefly. */
async function mockSignals(bookingId: string, atLeast = 1) {
  const query = () => prisma.partnerRiskSignal.findMany({ where: { bookingId, source: MOCK_SIGNAL_SOURCE }, select: { type: true, fingerprint: true, evidence: true } });
  for (let i = 0; i < 40; i++) {
    const rows = await query();
    if (rows.length >= atLeast) return rows;
    await new Promise((r) => setTimeout(r, 100));
  }
  return query();
}
const nextSequence = async () => ((await prisma.partnerPresence.findUnique({ where: { providerId: ctx.providerId }, select: { lastLocationSeq: true } }))?.lastLocationSeq ?? 0) + 1;

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

describe.serial("the heartbeat keeps the device's own word about its fix", () => {
  test("a fix flagged mocked is stored with the flag and the snapshot says so; absent is unknown; false is false", async () => {
    expect(dbOk).toBe(true);
    const beat = (latitude: number, capturedAt: Date, sequence: number, mocked?: boolean | null) =>
      partnerPresenceService.heartbeat(
        { providerId: ctx.providerId, userId: ctx.vendorUserId },
        { sessionId: ctx.presenceSessionId, deviceId: ctx.presenceDeviceId, timestamp: new Date(), platform: "android", location: { latitude, longitude: JOB.longitude, accuracy: 12, capturedAt, sequence, ...(mocked === undefined ? {} : { mocked }) } } as never,
      );
    const row = () => prisma.partnerPresence.findUniqueOrThrow({ where: { providerId: ctx.providerId }, select: { lastLocationMocked: true, lastLocationLat: true } });

    // Three fixes a few metres apart, each captured ten seconds after the one before on the device
    // clock (ahead of the fixture's seed fix, within the server's future tolerance), so none is a
    // duplicate of the last stored fix or an impossible jump from it.
    const t0 = Date.now();
    const mocked = await beat(JOB.latitude + 0.0001, new Date(t0), await nextSequence(), true);
    expect({ stored: (await row()).lastLocationMocked, snapshot: mocked.snapshot.location?.mocked }).toEqual({ stored: true, snapshot: true });

    const unknown = await beat(JOB.latitude + 0.0002, new Date(t0 + 10_000), await nextSequence());
    expect({ stored: (await row()).lastLocationMocked, snapshot: unknown.snapshot.location?.mocked }).toEqual({ stored: null, snapshot: null });

    const honest = await beat(JOB.latitude + 0.0003, new Date(t0 + 20_000), await nextSequence(), false);
    expect({ stored: (await row()).lastLocationMocked, snapshot: honest.snapshot.location?.mocked }).toEqual({ stored: false, snapshot: false });
  });
});

describe.serial("the tracking stream keeps it too", () => {
  const travelling = async () => {
    const id = await acceptedBooking();
    await prisma.booking.update({ where: { id }, data: { status: "EN_ROUTE", enRouteAt: new Date() } });
    await prisma.location.deleteMany({ where: { providerId: ctx.providerId } });
    return id;
  };
  const lastPing = (id: string) => prisma.locationHistory.findFirst({ where: { providerId: ctx.providerId, tracking: { bookingId: id } }, orderBy: { timestamp: "desc" }, select: { mocked: true } });

  test("a tracking ping flagged mocked is stored with the flag; one that says nothing is unknown", async () => {
    expect(dbOk).toBe(true);
    await serverFix(JOB, false);
    const flagged = await travelling();
    await trackingService.updateLocation(ctx.providerId, { bookingId: flagged, ...JOB, mocked: true } as never);
    expect(await lastPing(flagged)).toEqual({ mocked: true });

    const silent = await travelling();
    await trackingService.updateLocation(ctx.providerId, { bookingId: silent, ...JOB } as never);
    expect(await lastPing(silent)).toEqual({ mocked: null });
  });

  test("mocked tracking pings at the job are no evidence for the partner: the geofence does not record arrival on them", async () => {
    expect(dbOk).toBe(true);
    const ping = (id: string, dLat: number, mocked: boolean) => trackingService.updateLocation(ctx.providerId, { bookingId: id, latitude: JOB.latitude + dLat, longitude: JOB.longitude, mocked } as never);
    await serverFix(JOB, false);
    const faked = await travelling();
    await ping(faked, 0, true);
    await ping(faked, 0.0002, true);
    await ping(faked, 0.0004, true);
    expect(await arrivedAt(faked)).toBeNull();
    // Positive control: the same pings with the OS saying they are not mocked do record arrival.
    const honest = await travelling();
    await ping(honest, 0, false);
    await ping(honest, 0.0002, false);
    await ping(honest, 0.0004, false);
    expect(await arrivedAt(honest)).not.toBeNull();
  });
});

describe.serial("a mocked presence fix is not a position the server holds", () => {
  test("/arrived answers LOCATION_UNCONFIRMED with the existing sentence, and nothing is recorded", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB, true);
    const r = await post(`/api/bookings/${id}/arrived`, partner(), JOB);
    expect({ status: r.status, code: r.json.code }).toEqual({ status: 409, code: "LOCATION_UNCONFIRMED" });
    expect(String(r.json.error)).toContain("could not confirm your position");
    expect(await arrivedAt(id)).toBeNull();
  });

  test("start and the on-site requirement check answer the same", async () => {
    expect(dbOk).toBe(true);
    const { bookingRequirementService } = await import("../services/booking-requirement.service");
    const id = await acceptedBooking();
    await serverFix(JOB, true);
    await expect(bookingService.start(ctx.providerId, id, JOB.latitude, JOB.longitude)).rejects.toThrow("LOCATION_UNCONFIRMED");
    expect((await prisma.booking.findUniqueOrThrow({ where: { id } })).status).toBe("ACCEPTED");
    const check = await bookingRequirementService.partnerCheck({ bookingId: id, providerId: ctx.providerId, userId: ctx.vendorUserId, code: "anything", outcome: "SATISFIED", latitude: JOB.latitude, longitude: JOB.longitude });
    expect(check).toMatchObject({ ok: false, error: "LOCATION_UNCONFIRMED" });
  });

  test("control: the same fix the OS says is not mocked, or says nothing about, arrives as before", async () => {
    expect(dbOk).toBe(true);
    const honest = await acceptedBooking();
    await serverFix(JOB, false);
    expect((await post(`/api/bookings/${honest}/arrived`, partner(), JOB)).status).toBe(200);
    const unknown = await acceptedBooking();
    await serverFix(JOB, null);
    expect((await post(`/api/bookings/${unknown}/arrived`, partner(), JOB)).status).toBe(200);
  });

  test("a mocked tracking point elsewhere still contradicts an honest fix at the job", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB, false);
    const tracking = await prisma.tracking.create({ data: { bookingId: id, status: "ON_THE_WAY" } });
    await prisma.locationHistory.create({ data: { trackingId: tracking.id, providerId: ctx.providerId, ...FAR, mocked: true } });
    const r = await post(`/api/bookings/${id}/arrived`, partner(), JOB);
    expect({ status: r.status, code: r.json.code }).toEqual({ status: 409, code: "LOCATION_MISMATCH" });
    expect(await arrivedAt(id)).toBeNull();
  });
});

describe.serial("a customer no-show reported on a mocked fix takes no fee", () => {
  /** A paid booking the partner arrived at 40 minutes ago, with a door photo on record, the appointment begun, and the server holding the partner at the address — honestly or not. */
  async function atTheDoor(mocked: boolean): Promise<string> {
    // Booked without naming the partner and handed to them afterwards, as `acceptedBooking` does: the
    // direct-assign gate (capacity, presence) is not what this test is about, and the fixture partner
    // already holds the jobs the tests above left travelling.
    hours += 4;
    const booked = await createBookingWithQuote(ctx.customerA.id, { serviceId: ctx.serviceId, addressId: ctx.addressAId, quantity: 1, scheduledDate: futureSlot(hours).toISOString() });
    if (!("booking" in booked) || !booked.booking) throw new Error(`booking: ${JSON.stringify(booked)}`);
    const id = booked.booking.id;
    // Really paid, through the wallet: the fee is taken from what is refundable, so a label would not do.
    await payWithRealWallet(id, ctx.customerA.id);
    await prisma.booking.update({ where: { id }, data: { providerId: ctx.providerId, status: "EN_ROUTE", arrivedAt: new Date(Date.now() - 40 * 60_000), startOtpVerifiedAt: null } });
    const address = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
    await prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", mediaStorageKey: storedEvidenceKey(id, ctx.providerId, "ARRIVAL"), mediaMimeType: "image/png", capturedAt: new Date(Date.now() - 39 * 60_000), latitude: address.latitude, longitude: address.longitude } });
    await placeAtDoor(id, ctx.providerId);
    await prisma.partnerPresence.update({ where: { providerId: ctx.providerId }, data: { lastLocationMocked: mocked } });
    return id;
  }

  test("the preview and the report both withhold the fee as NOT_AT_ADDRESS; the same report on an honest fix charges it", async () => {
    expect(dbOk).toBe(true);
    const faked = await atTheDoor(true);
    const preview = (await get(`/api/bookings/${faked}/actions`, partner())).json.data?.noShow;
    expect({ feeWillApply: preview?.feeWillApply, reason: preview?.reason }).toEqual({ feeWillApply: false, reason: "NOT_AT_ADDRESS" });
    const r = await bookingNoShowService.reportCustomerNoShow(faked, { userId: ctx.vendorUserId, providerId: ctx.providerId });
    expect(r).toMatchObject({ ok: true, feeAmount: 0, feeWithheld: "NOT_AT_ADDRESS" });

    // Positive control: with the OS saying the fix is not mocked, the fee applies.
    const honest = await atTheDoor(false);
    const charged = await bookingNoShowService.reportCustomerNoShow(honest, { userId: ctx.vendorUserId, providerId: ctx.providerId });
    expect("ok" in charged && charged.ok).toBe(true);
    if ("ok" in charged) {
      expect(charged.feeWithheld).toBeUndefined();
      expect(charged.feeAmount).toBeGreaterThan(0);
    }
  }, 60_000);
});

describe.serial("what is written down", () => {
  test("a mocked fix at arrival is a risk signal, recorded once per booking however often it is tried", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB, true);
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
    const first = await mockSignals(id);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ type: "GPS_SPOOF", fingerprint: `MOCK_LOCATION:${ctx.providerId}:${id}` });
    expect((await post(`/api/bookings/${id}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
    await new Promise((r) => setTimeout(r, 500));
    expect(await mockSignals(id)).toHaveLength(1);
    // An honest refusal is not one: no position on record at all leaves no mock signal.
    const blind = await acceptedBooking();
    await serverFix(null);
    expect((await post(`/api/bookings/${blind}/arrived`, partner(), JOB)).json.code).toBe("LOCATION_UNCONFIRMED");
    await new Promise((r) => setTimeout(r, 500));
    expect(await mockSignals(blind, 0)).toHaveLength(0);
  });

  test("the arrival stamp carries the device's word beside the position: a vouched arrival over a mocked fix says so, a confirmed one says the fix was not mocked", async () => {
    expect(dbOk).toBe(true);
    const stamp = (id: string) => prisma.jobEvidence.findFirst({ where: { bookingId: id, stage: "ARRIVAL" }, select: { latitude: true, metadata: true } });
    const vouched = await acceptedBooking();
    await serverFix(JOB, true);
    expect((await post(`/api/bookings/${vouched}/confirm-arrival`, bearer(ctx.customerA), {})).status).toBe(200);
    expect((await post(`/api/bookings/${vouched}/arrived`, partner(), JOB)).status).toBe(200);
    const over = await stamp(vouched);
    expect({ latitude: over?.latitude, locationMocked: (over?.metadata as { locationMocked?: unknown } | null)?.locationMocked }).toEqual({ latitude: null, locationMocked: true });

    const confirmed = await acceptedBooking();
    await serverFix(JOB, false);
    expect((await post(`/api/bookings/${confirmed}/arrived`, partner(), JOB)).status).toBe(200);
    const on = await stamp(confirmed);
    expect((on?.metadata as { locationMocked?: unknown } | null)?.locationMocked).toBe(false);
    expect(on?.latitude).toBeCloseTo(JOB.latitude, 6);
  });

  test("the lifecycle bodies take the device's flag: a request that declares its own position mocked is not refused for its shape, and is on record", async () => {
    expect(dbOk).toBe(true);
    const id = await acceptedBooking();
    await serverFix(JOB, false);
    // The request's coordinates never decide; the server-held fix does. The admission is kept as a signal.
    const arrived = await post(`/api/bookings/${id}/arrived`, partner(), { ...JOB, mocked: true });
    expect(arrived.status).toBe(200);
    expect(await mockSignals(id)).toHaveLength(1);
    const check = await post(`/api/bookings/${id}/requirements/no-such-requirement/check`, partner(), { outcome: "SATISFIED", ...JOB, mocked: false });
    expect(check.status).not.toBe(422);
    const started = await post(`/api/bookings/${id}/start`, partner(), { ...JOB, mocked: null });
    expect(started.status).toBe(200);
  });
});
