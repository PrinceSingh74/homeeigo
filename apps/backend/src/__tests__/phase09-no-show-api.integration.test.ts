/**
 * §52 / §53 over HTTP.
 *
 * The service is already covered by `phase09-no-show.integration.test.ts`; this file exists because
 * a correct engine behind a wrong door is still a defect. What it pins down is the door:
 *
 *   * the partner endpoint refuses without arrival evidence, and says so with a code a client can
 *     act on rather than a generic 400;
 *   * a customer cannot reach the partner endpoint at all, and a partner cannot reach the customer
 *     one — the two are not the same permission wearing different names;
 *   * the provider-no-show response tells the customer, in words, that they were not charged.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import app from "../index";
import {
  bearer,
  cleanupAdversarialFixtures,
  dbReachable,
  keepPresenceFresh,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { createBookingWithQuote } from "./helpers/quote-token";
import { NO_SHOW_POLICY } from "../lib/no-show-policy";
import { storedEvidenceKey } from "./helpers/evidence-photo";
import { bookingNoShowService } from "../services/booking-no-show.service";
import { placeAtDoor } from "./helpers/no-show-fixture";

const RUN = `p09nsapi-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let partnerToken = "";
let dbOk = false;
let day = 4;

const created: string[] = [];

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function post(path: string, token: string) {
  const res = await app.handle(
    new Request(`http://localhost/api/bookings/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: "{}",
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

/** Where the fixture job is: what a door photo's server-held position has to agree with. */
const jobPosition = async () => {
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  return { latitude: a.latitude, longitude: a.longitude };
};
async function bookingAtDoor(opts: { arrivedMinutesAgo?: number | null; paid?: boolean; doorPhoto?: boolean; appointmentStarted?: boolean; partnerAtAddress?: boolean } = {}) {
  await keepPresenceFresh(ctx);
  const result = await createBookingWithQuote(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    // One slot per booking inside the 30-day horizon: 22 days, then the same days at a second
    // and a third hour (the suite makes more bookings than there are days to put them on).
    scheduledDate: (() => {
      const n = (day += 1) - 5;
      return istSlot(5 + (n % 22), ["10:00", "13:00", "16:00"][Math.floor(n / 22) % 3]);
    })().toISOString(),
  });
  if (!("booking" in result) || !result.booking) throw new Error(`create failed: ${JSON.stringify(result)}`);
  const id = result.booking.id;
  if (opts.paid !== false) await payWithRealWallet(id, ctx.customerA.id);
  await prisma.booking.update({
    where: { id },
    data: {
      status: BookingStatus.EN_ROUTE,
      arrivedAt: opts.arrivedMinutesAgo == null ? null : new Date(Date.now() - opts.arrivedMinutesAgo * 60_000),
    },
  });
  // A photo at the door, stored by the server after the arrival: what makes the partner's own report
  // chargeable. Pass `doorPhoto: false` for a report with nothing but the arrival time behind it.
  if (opts.arrivedMinutesAgo != null && opts.doorPhoto !== false) {
    await prisma.jobEvidence.create({
      // The position on the row is the one the server held for the partner when the photo arrived: at the job.
      data: { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", mediaStorageKey: storedEvidenceKey(id, ctx.providerId, "ARRIVAL"), mediaMimeType: "image/png", capturedAt: new Date(Date.now() - Math.max(0, opts.arrivedMinutesAgo - 1) * 60_000), ...(await jobPosition()) },
    });
  }

  // The appointment has begun and the server holds the partner at the address (see the helper).
  await placeAtDoor(id, ctx.providerId, { appointmentStarted: opts.appointmentStarted, partnerAtAddress: opts.partnerAtAddress });
  created.push(id);
  return { id, amount: result.booking.finalAmount };
}

/** GET /:id/actions — carries the partner's no-show preview (`data.noShow`). */
async function actionsFor(id: string, token: string) {
  const res = await app.handle(new Request(`http://localhost/api/bookings/${id}/actions`, { headers: { Authorization: `Bearer ${token}` } }));
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
}

const statusOf = async (id: string) =>
  (await prisma.$queryRaw<Array<{ status: string }>>`SELECT status FROM bookings WHERE id = ${id}`)[0]!.status;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? "a".repeat(64);
  process.env.HASH_HMAC_KEY = process.env.HASH_HMAC_KEY ?? "test-hmac-pepper";
  process.env.MASTER_ENCRYPTION_KEY = process.env.MASTER_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString("base64");
  dbOk = await dbReachable();
  if (!dbOk) return;
  const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  refuseIfNotIsolatedTestDb(db);
  ctx = await seedAdversarialFixtures(RUN);
  const vendor = await prisma.user.findUniqueOrThrow({ where: { id: ctx.vendorUserId }, select: { id: true, email: true } });
  partnerToken = bearer(vendor as any);
}, 120_000);

/** Same reason as the service suite: the fixture partner fills up otherwise. */
afterEach(async () => {
  if (!dbOk || created.length === 0) return;
  await prisma.$executeRaw`
    UPDATE bookings SET status = 'CANCELLED_BY_USER', cancelled_at = NOW()
    WHERE id = ANY(${created}) AND status NOT IN ('CUSTOMER_NO_SHOW', 'PROVIDER_NO_SHOW')
  `;
  created.length = 0;
});

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("POST /:id/no-show — the partner's door", () => {
  test("without arrival evidence it refuses with a code, not a shrug", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r = await post(`${id}/no-show`, partnerToken);
    expect(r.status).toBe(400);
    expect(r.json.success).toBe(false);
    expect(r.json.code).toBe("NO_ARRIVAL_EVIDENCE");
    // and the message tells the partner what to do instead of restating the failure
    expect(String(r.json.error).toLowerCase()).toContain("arrival");
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("inside the grace period it says how long is left, and the grace it is counting", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: NO_SHOW_POLICY.graceMinutes - 5 });
    const r = await post(`${id}/no-show`, partnerToken);
    expect(r.status).toBe(400);
    expect(r.json.code).toBe("GRACE_NOT_ELAPSED");
    expect(r.json.data.graceMinutes).toBe(NO_SHOW_POLICY.graceMinutes);
    expect(r.json.data.waitedMinutes).toBe(NO_SHOW_POLICY.graceMinutes - 5);
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  /**
   * 2026-10-07: an arrival time is something the partner's device reported. A fee taken from the
   * customer on the partner's own word needs something a person can look at afterwards: a photo at
   * the door, received and stored by the server after the arrival. Without one the no-show is still
   * recorded and the customer is refunded in full; an admin who reviews it can apply the fee.
   */
  test("the partner's own report with nothing but an arrival time records the no-show and charges nothing", async () => {
    if (!dbOk) return;
    const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: NO_SHOW_POLICY.graceMinutes + 10, doorPhoto: false });
    const walletOf = async () => Number((await prisma.user.findUniqueOrThrow({ where: { id: ctx.customerA.id }, select: { walletBalance: true } })).walletBalance);
    const before = await walletOf();
    const r = await post(`${id}/no-show`, partnerToken);
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe("customer_no_show");
    expect(r.json.data.feeAmount).toBe(0);
    expect(r.json.data.feeWithheld).toBe("NO_DOOR_PHOTO");
    // The whole price is back in the wallet it was paid from: nothing was kept.
    expect((await walletOf()) - before).toBeCloseTo(amount, 2);
    expect(await statusOf(id)).toBe("CUSTOMER_NO_SHOW");
  });

  test("a photo taken before the arrival, a link, or another stage's photo is not a photo at the door", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, doorPhoto: false });
    await prisma.jobEvidence.createMany({
      data: [
        { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", mediaStorageKey: storedEvidenceKey(id, ctx.providerId, "ARRIVAL"), capturedAt: new Date(Date.now() - 90 * 60_000), clientUploadId: `${RUN}-early` },
        { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", mediaUrl: "https://example.test/door.jpg", clientUploadId: `${RUN}-link` },
        { bookingId: id, providerId: ctx.providerId, stage: "START", mediaStorageKey: storedEvidenceKey(id, ctx.providerId, "START"), clientUploadId: `${RUN}-start` },
      ],
    });
    const r = await post(`${id}/no-show`, partnerToken);
    expect({ fee: r.json.data.feeAmount, withheld: r.json.data.feeWithheld }).toEqual({ fee: 0, withheld: "NO_DOOR_PHOTO" });
  });

  /**
   * Re-audit, 2026-10-07: "a photo" was any image, sent from anywhere. A door photo now has to have
   * arrived while the server held the partner's position at the job — the position is the server's,
   * written on the row by the server, never the upload's own coordinates.
   */
  test("a photo the server received while it did not hold the partner at the job is not a door photo", async () => {
    if (!dbOk) return;
    const job = await jobPosition();
    for (const position of [{ latitude: null, longitude: null }, { latitude: job.latitude + 0.08, longitude: job.longitude }]) {
      const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, doorPhoto: false });
      await prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", mediaStorageKey: storedEvidenceKey(id, ctx.providerId, "ARRIVAL"), ...position } });
      const r = await post(`${id}/no-show`, partnerToken);
      expect({ fee: r.json.data.feeAmount, withheld: r.json.data.feeWithheld }).toEqual({ fee: 0, withheld: "NO_DOOR_PHOTO" });
    }
  });

  test("an arrival nobody's position confirmed (the customer or an admin vouched for it) does not charge on the partner's word", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    await prisma.activityLog.create({ data: { bookingId: id, userId: ctx.customerA.id, providerId: ctx.providerId, action: "PARTNER_ARRIVAL_VOUCHED", description: "Arrival recorded on the customer's confirmation: no position was confirmed" } });
    const r = await post(`${id}/no-show`, partnerToken);
    expect(r.status).toBe(200);
    expect({ fee: r.json.data.feeAmount, withheld: r.json.data.feeWithheld }).toEqual({ fee: 0, withheld: "ARRIVAL_VOUCHED" });
  });

  /**
   * Fifth re-audit, 2026-10-07. Each of these took (or voided) the fee around the door-photo rule.
   */
  test("a customer cannot void the fee by tapping 'confirm arrival' when the arrival was confirmed from a position", async () => {
    if (!dbOk) return;
    const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    // The customer's confirmation exists, but the arrival did not use it.
    await prisma.activityLog.create({ data: { bookingId: id, userId: ctx.customerA.id, providerId: ctx.providerId, action: "CUSTOMER_CONFIRMED_PROFESSIONAL_ARRIVAL", description: "Customer confirmed the professional is at the service address" } });
    const r = await post(`${id}/no-show`, partnerToken);
    expect({ fee: r.json.data.feeAmount, withheld: r.json.data.feeWithheld ?? null }).toEqual({ fee: Math.round(amount * 0.5 * 100) / 100, withheld: null });
  });

  test("a no-show cannot be reported before the appointment has begun, however long ago the partner arrived", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, appointmentStarted: false });
    const r = await post(`${id}/no-show`, partnerToken);
    expect({ status: r.status, code: r.json.code }).toEqual({ status: 400, code: "BEFORE_APPOINTMENT" });
    expect(String(r.json.error).toLowerCase()).toContain("booked time");
    expect(await statusOf(id)).toBe("EN_ROUTE");
    // The preview says the same thing, and does not offer the report.
    const preview = (await actionsFor(id, partnerToken)).json.data.noShow;
    expect(preview?.canReport ?? false).toBe(false);
  });

  test("the wait is counted from the booked time when the partner came early", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    // The appointment began five minutes ago: fifteen have not passed since, though forty have since the arrival.
    await prisma.booking.update({ where: { id }, data: { scheduledDate: new Date(Date.now() - 5 * 60_000) } });
    const r = await post(`${id}/no-show`, partnerToken);
    expect({ status: r.status, code: r.json.code }).toEqual({ status: 400, code: "GRACE_NOT_ELAPSED" });
  });

  test("a report made when the server does not hold the partner at the address is recorded without a fee", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, partnerAtAddress: false });
    const preview = (await actionsFor(id, partnerToken)).json.data.noShow;
    expect({ feeWillApply: preview.feeWillApply, reason: preview.reason }).toEqual({ feeWillApply: false, reason: "NOT_AT_ADDRESS" });
    const r = await post(`${id}/no-show`, partnerToken);
    expect({ fee: r.json.data.feeAmount, withheld: r.json.data.feeWithheld }).toEqual({ fee: 0, withheld: "NOT_AT_ADDRESS" });
  });

  test("a customer who gave the start PIN was there: no fee on the partner's word", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    await prisma.booking.update({ where: { id }, data: { startOtpVerifiedAt: new Date(Date.now() - 10 * 60_000) } });
    const r = await post(`${id}/no-show`, partnerToken);
    expect({ fee: r.json.data.feeAmount, withheld: r.json.data.feeWithheld }).toEqual({ fee: 0, withheld: "CUSTOMER_PRESENT" });
  });

  test("when no fee is taken the partner is told why, and is not promised a review that cannot happen", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, doorPhoto: false });
    const r = await post(`${id}/no-show`, partnerToken);
    expect(String(r.json.data.feeNote)).toContain("No fee was taken");
    expect(String(r.json.data.feeNote).toLowerCase()).not.toContain("review");
  });

  test("an admin who records the no-show decides the fee: it applies without the photo", async () => {
    if (!dbOk) return;
    const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: 40, doorPhoto: false });
    const r = await bookingNoShowService.reportCustomerNoShow(id, { userId: ctx.superAdmin.id, isAdmin: true, reason: "Reviewed the partner's call log" });
    expect("ok" in r && r.ok ? r.feeAmount : null).toBe(Math.round(amount * 0.5 * 100) / 100);
  });

  test("with evidence and the wait served it records the no-show and the settlement", async () => {
    if (!dbOk) return;
    const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: NO_SHOW_POLICY.graceMinutes + 10 });
    const r = await post(`${id}/no-show`, partnerToken);
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe("customer_no_show");
    expect(r.json.data.feeAmount).toBe(Math.round(amount * 0.5 * 100) / 100);
    // X-29: the reporting partner is not told the customer's refund; the settlement is checked on the row.
    expect("refundAmount" in r.json.data).toBe(false);
    expect("refundStatus" in r.json.data).toBe(false);
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { refundAmount: true } });
    expect(r.json.data.feeAmount + Number(row.refundAmount ?? 0)).toBeLessThanOrEqual(amount + 0.01);
    expect(await statusOf(id)).toBe("CUSTOMER_NO_SHOW");
  });

  test("the customer cannot reach this endpoint at all", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    const r = await post(`${id}/no-show`, bearer(ctx.customerA));
    expect(r.status).toBe(403);
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("no token, no no-show", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    const res = await app.handle(new Request(`http://localhost/api/bookings/${id}/no-show`, { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }));
    expect(res.status).toBe(401);
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });
});

/**
 * The partner is told BEFORE reporting what the report will do. The preview rides on the job-actions
 * answer the job page already asks for, and it is the same decision the report makes — one rule,
 * read twice — so the two cannot disagree.
 */
describe.serial("GET /:id/actions — the no-show preview", () => {
  async function actionsFor(id: string, token: string) {
    const res = await app.handle(new Request(`http://localhost/api/bookings/${id}/actions`, { headers: { Authorization: `Bearer ${token}` } }));
    return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
  }
  const doorPhotoRow = async (id: string) =>
    prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", mediaStorageKey: storedEvidenceKey(id, ctx.providerId, "ARRIVAL"), mediaMimeType: "image/png", ...(await jobPosition()) } });
  const vouch = (id: string) =>
    prisma.activityLog.create({ data: { bookingId: id, userId: ctx.customerA.id, providerId: ctx.providerId, action: "PARTNER_ARRIVAL_VOUCHED", description: "Arrival recorded on the customer's confirmation: no position was confirmed" } });

  test("without a door photo it says so; once an ARRIVAL photo at the job is on record the fee will apply", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, doorPhoto: false });
    const before = await actionsFor(id, partnerToken);
    expect(before.status).toBe(200);
    expect(before.json.data.availableActions).toContain("REPORT_NO_SHOW");
    expect(before.json.data.noShow).toEqual({
      canReport: true,
      waitedMinutes: 40,
      graceMinutes: NO_SHOW_POLICY.graceMinutes,
      minutesLeft: 0,
      feeWillApply: false,
      feePercent: NO_SHOW_POLICY.customerNoShowFeePercent,
      reason: "NO_DOOR_PHOTO",
      hasDoorPhoto: false,
      message: expect.any(String),
    });
    expect(String(before.json.data.noShow.message).toLowerCase()).toContain("photo at the door");
    expect(String(before.json.data.noShow.message).toLowerCase()).toContain("no fee");

    await doorPhotoRow(id);
    const after = await actionsFor(id, partnerToken);
    expect(after.json.data.noShow).toMatchObject({ canReport: true, feeWillApply: true, reason: null, hasDoorPhoto: true });
    expect(String(after.json.data.noShow.message)).toContain(`${NO_SHOW_POLICY.customerNoShowFeePercent}%`);
    // Reading the preview decides nothing.
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("inside the wait it cannot be reported yet, and says how many minutes are left", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: NO_SHOW_POLICY.graceMinutes - 5 });
    const r = await actionsFor(id, partnerToken);
    expect(r.json.data.noShow).toMatchObject({ canReport: false, waitedMinutes: NO_SHOW_POLICY.graceMinutes - 5, graceMinutes: NO_SHOW_POLICY.graceMinutes, minutesLeft: 5, feeWillApply: true, hasDoorPhoto: true });
  });

  test("an arrival vouched for by the customer is previewed as recorded without a fee, photo or not", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    await vouch(id);
    const r = await actionsFor(id, partnerToken);
    expect(r.json.data.noShow).toMatchObject({ canReport: true, feeWillApply: false, reason: "ARRIVAL_VOUCHED", hasDoorPhoto: true });
    expect(String(r.json.data.noShow.message).toLowerCase()).toContain("without a fee");
  });

  /** X-29: the partner hears whether the fee applies, never the customer's money. */
  /**
   * A photo that arrived while the server did not hold the partner at the address is not a door
   * photo — and the partner has to be told that, or they see "uploaded" and a request for a photo
   * side by side and cannot know what to do.
   */
  test("a photo received while the phone's location was not at the address is named for what it is, with what to do", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, doorPhoto: false });
    await prisma.jobEvidence.create({ data: { bookingId: id, providerId: ctx.providerId, stage: "ARRIVAL", mediaStorageKey: storedEvidenceKey(id, ctx.providerId, "ARRIVAL") } });
    const preview = (await actionsFor(id, partnerToken)).json.data.noShow;
    expect({ reason: preview.reason, hasDoorPhoto: preview.hasDoorPhoto, feeWillApply: preview.feeWillApply }).toEqual({ reason: "NO_DOOR_PHOTO", hasDoorPhoto: false, feeWillApply: false });
    expect(preview.message).toContain("photo was received");
    expect(preview.message.toLowerCase()).toContain("location");
  });

  /** The fee is capped at what was paid in advance. Where nothing was, "the fee applies" would be a promise of ₹0. */
  test("a booking not paid in advance is previewed as recorded with no fee to take, and the report takes none", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, paid: false });
    const preview = (await actionsFor(id, partnerToken)).json.data.noShow;
    expect({ feeWillApply: preview.feeWillApply, reason: preview.reason }).toEqual({ feeWillApply: false, reason: "NOT_PREPAID" });
    expect(preview.message).toContain("not paid in advance");
    const r = await post(`${id}/no-show`, partnerToken);
    expect({ status: r.status, fee: r.json.data.feeAmount }).toEqual({ status: 200, fee: 0 });
  });

  test("the preview carries no rupee amount and nothing about the customer's refund", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    const r = await actionsFor(id, partnerToken);
    expect(Object.keys(r.json.data.noShow).sort()).toEqual(["canReport", "feePercent", "feeWillApply", "graceMinutes", "hasDoorPhoto", "message", "minutesLeft", "reason", "waitedMinutes"]);
    expect(JSON.stringify(r.json.data.noShow)).not.toMatch(/₹|refund|amount/i);
  });

  for (const c of [
    { name: "a door photo at the job", doorPhoto: true, vouched: false },
    { name: "no door photo", doorPhoto: false, vouched: false },
    { name: "a vouched arrival", doorPhoto: true, vouched: true },
  ]) {
    test(`the preview and the report agree: ${c.name}`, async () => {
      if (!dbOk) return;
      const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, doorPhoto: c.doorPhoto });
      if (c.vouched) await vouch(id);
      const preview = (await actionsFor(id, partnerToken)).json.data.noShow;
      expect(preview).toBeDefined();
      const report = await post(`${id}/no-show`, partnerToken);
      expect(report.status).toBe(200);
      expect({ feeWillApply: preview.feeWillApply, reason: preview.reason }).toEqual({
        feeWillApply: report.json.data.feeAmount > 0,
        reason: report.json.data.feeWithheld ?? null,
      });
    });
  }

  test("before arrival, and once the report is in, there is no preview", async () => {
    if (!dbOk) return;
    const notArrived = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r1 = await actionsFor(notArrived.id, partnerToken);
    expect(r1.status).toBe(200);
    expect("noShow" in r1.json.data).toBe(false);

    const reported = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    expect((await post(`${reported.id}/no-show`, partnerToken)).status).toBe(200);
    const r2 = await actionsFor(reported.id, partnerToken);
    expect("noShow" in (r2.json.data ?? {})).toBe(false);
  });

  test("the customer, another customer and another partner read nothing of it", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    // The booking's own customer may read the job actions, but not the partner's fee preview.
    const owner = await actionsFor(id, bearer(ctx.customerA));
    expect(owner.status).toBe(200);
    expect("noShow" in owner.json.data).toBe(false);
    const stranger = await actionsFor(id, bearer(ctx.customerB));
    expect(stranger.status).toBe(404);
    expect(JSON.stringify(stranger.json)).not.toContain("feeWillApply");
    // The service itself answers only the partner holding the job (or an admin).
    expect(await bookingNoShowService.previewCustomerNoShow(id, { userId: ctx.customerA.id })).toBeNull();
    expect(await bookingNoShowService.previewCustomerNoShow(id, { userId: ctx.customerB.id, providerId: `${RUN}-other-partner` })).toBeNull();
    expect(await bookingNoShowService.previewCustomerNoShow(id, { userId: ctx.vendorUserId, providerId: ctx.providerId })).not.toBeNull();
    expect(await bookingNoShowService.previewCustomerNoShow(id, { userId: ctx.superAdmin.id, isAdmin: true })).not.toBeNull();
  });
});

describe.serial("POST /:id/provider-no-show — the customer's side", () => {
  test("the partner cannot report their own absence away", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r = await post(`${id}/provider-no-show`, partnerToken);
    expect(r.status).toBe(403);
    expect(r.json.code).toBe("FORBIDDEN");
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("another customer cannot report someone else's booking", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r = await post(`${id}/provider-no-show`, bearer(ctx.customerB));
    expect(r.status).toBe(403);
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("the customer reports it, is refunded in full, and is TOLD they were not charged", async () => {
    if (!dbOk) return;
    const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r = await post(`${id}/provider-no-show`, bearer(ctx.customerA));
    expect(r.status).toBe(200);
    expect(r.json.data.status).toBe("provider_no_show");
    expect(r.json.data.feeAmount).toBe(0);
    expect(r.json.data.refundAmount).toBe(amount);
    expect(String(r.json.message).toLowerCase()).toContain("not been charged");
    expect(await statusOf(id)).toBe("PROVIDER_NO_SHOW");
  });

  test("a booking that is already a provider no-show cannot be re-reported", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    expect((await post(`${id}/provider-no-show`, bearer(ctx.customerA))).status).toBe(200);
    const again = await post(`${id}/provider-no-show`, bearer(ctx.customerA));
    expect(again.status).toBe(400);
    expect(again.json.code).toBe("INVALID_STATUS");
    expect(await statusOf(id)).toBe("PROVIDER_NO_SHOW");
  });

  test("and the partner still cannot convert it into the customer's fault afterwards", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    expect((await post(`${id}/provider-no-show`, bearer(ctx.customerA))).status).toBe(200);
    const flip = await post(`${id}/no-show`, partnerToken);
    expect(flip.status).toBe(400);
    expect(flip.json.code).toBe("BOOKING_NOT_AWAITING_CUSTOMER");
    expect(await statusOf(id)).toBe("PROVIDER_NO_SHOW");
  });

  test("an unknown booking is a 404, not a leak about whose it is", async () => {
    if (!dbOk) return;
    const r = await post(`ckxxxxxxxxxxxxxxxxxxxxxxx/provider-no-show`, bearer(ctx.customerA));
    expect(r.status).toBe(404);
  });
});
