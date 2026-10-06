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

async function bookingAtDoor(opts: { arrivedMinutesAgo?: number | null; paid?: boolean } = {}) {
  await keepPresenceFresh(ctx);
  const result = await createBookingWithQuote(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
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
  created.push(id);
  return { id, amount: result.booking.finalAmount };
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
