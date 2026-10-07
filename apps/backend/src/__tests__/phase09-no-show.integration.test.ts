/**
 * §52 / §53 — recording a no-show, end to end against the isolated test database.
 *
 * The negative assertions carry the weight:
 *   * a customer is not a no-show because the appointment time passed — the partner must have
 *     arrived and waited;
 *   * a partner cannot report their own absence away, and cannot turn it into the customer's;
 *   * a customer cannot declare themselves a no-show, nor a partner absent on the partner's behalf;
 *   * a provider no-show never charges the customer, whatever was captured.
 */
import "../load-env";
import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  keepPresenceFresh,
  payWithRealWallet,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { createBookingWithQuote } from "./helpers/quote-token";
import { bookingNoShowService } from "../services/booking-no-show.service";
import { NO_SHOW_POLICY } from "../lib/no-show-policy";
import { roomManager } from "../lib/websocket";
import { storedEvidenceKey } from "./helpers/evidence-photo";

const RUN = `p09ns-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 4;

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

/** A paid booking with a partner assigned, optionally already arrived N minutes ago. */
/** Where the fixture job is: what a door photo's server-held position has to agree with. */
const jobPosition = async () => {
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  return { latitude: a.latitude, longitude: a.longitude };
};
async function bookingAtDoor(opts: { arrivedMinutesAgo?: number | null; paid?: boolean; status?: BookingStatus; doorPhoto?: boolean } = {}) {
  // Wallet payments are slow enough that the fixture partner's presence goes stale between tests,
  // and a stale partner is refused with PROVIDER_UNAVAILABLE — a real rule, but not this subject.
  // `keepPresenceFresh` beats only when the last one is old: beating every time trips the product's
  // own heartbeat rate limit, which is what the first version of this helper did.
  await keepPresenceFresh(ctx);
  const created = await createBookingWithQuote(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in created) || !created.booking) throw new Error(`create failed: ${JSON.stringify(created)}`);
  const id = created.booking.id;
  const amount = created.booking.finalAmount;
  if (opts.paid !== false) await payWithRealWallet(id, ctx.customerA.id);
  await prisma.booking.update({
    where: { id },
    data: {
      status: opts.status ?? BookingStatus.EN_ROUTE,
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

  created_ids.push(id);
  return { id, amount };
}

/** Bookings this file created, released after each test (see the afterEach below). */
const created_ids: string[] = [];

/** Resolved lazily: `ctx` does not exist until beforeAll has run. */
const partner = () => ({ userId: ctx.vendorUserId, providerId: ctx.providerId });
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
}, 120_000);

/**
 * Release this test's bookings before the next one.
 *
 * The refusal tests deliberately leave their booking live (EN_ROUTE), and the fixture partner is the
 * same one every time — so by the eighth test the partner was at capacity and `create` started
 * answering PROVIDER_UNAVAILABLE. That is the product being right about a partner who already has
 * eight jobs; the fixtures were wrong to keep them.
 */
afterEach(async () => {
  if (!dbOk || created_ids.length === 0) return;
  await prisma.$executeRaw`
    UPDATE bookings SET status = 'CANCELLED_BY_USER', cancelled_at = NOW()
    WHERE id = ANY(${created_ids}) AND status NOT IN ('CUSTOMER_NO_SHOW', 'PROVIDER_NO_SHOW')
  `;
  created_ids.length = 0;
});

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("a customer no-show needs evidence, not a clock", () => {
  test("no arrival recorded: refused, and the booking is untouched", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r = await bookingNoShowService.reportCustomerNoShow(id, partner());
    expect("error" in r && r.error).toBe("NOT_ELIGIBLE");
    if ("reason" in r) expect(r.reason).toBe("NO_ARRIVAL_EVIDENCE");
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("arrived but still inside the grace period: refused", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: NO_SHOW_POLICY.graceMinutes - 5 });
    const r = await bookingNoShowService.reportCustomerNoShow(id, partner());
    expect("error" in r && r.error).toBe("NOT_ELIGIBLE");
    if ("reason" in r) expect(r.reason).toBe("GRACE_NOT_ELAPSED");
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("arrived and waited the grace period: recorded, with the capped fee retained", async () => {
    if (!dbOk) return;
    const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: NO_SHOW_POLICY.graceMinutes + 5 });
    const r = await bookingNoShowService.reportCustomerNoShow(id, partner());
    expect("ok" in r).toBe(true);
    if ("ok" in r) {
      expect(r.status).toBe(BookingStatus.CUSTOMER_NO_SHOW);
      // 50% of the amount, and fee + refund never exceeds what was captured.
      expect(r.feeAmount).toBe(Math.round(amount * 0.5 * 100) / 100);
      expect(r.feeAmount + r.refundAmount).toBeLessThanOrEqual(amount + 0.01);
    }
    expect(await statusOf(id)).toBe("CUSTOMER_NO_SHOW");
  });

  test("the slot is released — capacity comes back through the trigger", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    await bookingNoShowService.reportCustomerNoShow(id, partner());
    const slots = await prisma.$queryRaw<Array<{ ps: Date | null; us: Date | null }>>`
      SELECT provider_slot_start ps, user_slot_start us FROM bookings WHERE id = ${id}
    `;
    expect(slots[0]!.ps).toBeNull();
    expect(slots[0]!.us).toBeNull();
  });

  test("a customer who paid nothing owes nothing", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 30, paid: false });
    const r = await bookingNoShowService.reportCustomerNoShow(id, partner());
    expect("ok" in r).toBe(true);
    if ("ok" in r) {
      expect(r.feeAmount).toBe(0);
      expect(r.refundAmount).toBe(0);
    }
  });
});

describe.serial("who may say it", () => {
  test("the customer cannot declare their own no-show", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    const r = await bookingNoShowService.reportCustomerNoShow(id, { userId: ctx.customerA.id });
    expect("error" in r && r.error).toBe("FORBIDDEN");
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });

  test("an unrelated partner cannot report someone else's booking", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    const r = await bookingNoShowService.reportCustomerNoShow(id, { userId: "someone", providerId: "another-provider" });
    expect("error" in r && r.error).toBe("FORBIDDEN");
  });

  test("the partner cannot report a PROVIDER no-show — they cannot absolve themselves", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r = await bookingNoShowService.reportProviderNoShow(id, partner());
    expect("error" in r && r.error).toBe("FORBIDDEN");
    expect(await statusOf(id)).toBe("EN_ROUTE");
  });
});

describe.serial("a partner's absence is never the customer's fault", () => {
  test("the customer reports it and is made whole", async () => {
    if (!dbOk) return;
    const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: null });
    const r = await bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
    expect("ok" in r).toBe(true);
    if ("ok" in r) {
      expect(r.status).toBe(BookingStatus.PROVIDER_NO_SHOW);
      expect(r.feeAmount).toBe(0);
      expect(r.refundAmount).toBe(amount);
    }
    expect(await statusOf(id)).toBe("PROVIDER_NO_SHOW");
  });

  test("a provider no-show cannot then be turned into a customer no-show", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    await bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
    const r = await bookingNoShowService.reportCustomerNoShow(id, partner());
    expect("error" in r && r.error).toBe("INVALID_STATUS");
    expect(await statusOf(id)).toBe("PROVIDER_NO_SHOW");
  });

  test("and the reverse is equally impossible", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    await bookingNoShowService.reportCustomerNoShow(id, partner());
    const r = await bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
    expect("error" in r && r.error).toBe("INVALID_STATUS");
    expect(await statusOf(id)).toBe("CUSTOMER_NO_SHOW");
  });

  test("a job already in progress is not a no-show at all", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40, status: BookingStatus.IN_PROGRESS });
    const customer = await bookingNoShowService.reportCustomerNoShow(id, partner());
    expect("error" in customer && customer.error).toBe("INVALID_STATUS");
    const provider = await bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
    expect("error" in provider && provider.error).toBe("INVALID_STATUS");
    expect(await statusOf(id)).toBe("IN_PROGRESS");
  });
});

/**
 * The transition has to reach an app that is already open.
 *
 * Without this the no-show was silent on the wire: a customer watching their booking would have
 * kept seeing EN_ROUTE on a booking that was already closed and refunded. Same failure as showing
 * EXPIRED as "confirmed", one layer down.
 */
describe.serial("both parties are told, over the socket", () => {
  /**
   * `publishBookingStatusBackground` is fire-and-forget AND resolves the partner user id from the
   * database first, so a fixed sleep is a coin flip under load. Poll for the call instead.
   */
  async function awaitBroadcast(spy: { mock: { calls: any[][] } }, room: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const call = spy.mock.calls.find((c) => c[0] === room);
      if (call) return call;
      if (Date.now() > deadline) return undefined;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  test("a customer no-show is broadcast to the booking room with its own status", async () => {
    if (!dbOk) return;
    const broadcast = spyOn(roomManager, "broadcast");
    try {
      const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
      broadcast.mockClear();
      const reported = await bookingNoShowService.reportCustomerNoShow(id, partner());
      // Assert the report itself first: otherwise a refused report shows up as a mysterious
      // "no broadcast within 5s" instead of naming the reason.
      expect(reported).toMatchObject({ ok: true });
      const call = await awaitBroadcast(broadcast, `booking:${id}`);
      expect(call).toBeDefined();
      expect((call![1] as any).data.status).toBe("customer_no_show");
      expect((call![1] as any).data.feeAmount).toBeGreaterThan(0);
    } finally {
      broadcast.mockRestore();
    }
  });

  test("a provider no-show says refunded, and never carries a fee", async () => {
    if (!dbOk) return;
    const broadcast = spyOn(roomManager, "broadcast");
    try {
      const { id, amount } = await bookingAtDoor({ arrivedMinutesAgo: null });
      broadcast.mockClear();
      const reported = await bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
      expect(reported).toMatchObject({ ok: true });
      const call = await awaitBroadcast(broadcast, `booking:${id}`);
      expect(call).toBeDefined();
      expect((call![1] as any).data.status).toBe("provider_no_show");
      expect((call![1] as any).data.feeAmount).toBe(0);
      expect((call![1] as any).data.refundAmount).toBe(amount);
    } finally {
      broadcast.mockRestore();
    }
  });
});

/**
 * Being charged half the price and told only "Refund processed" is not being told.
 */
describe.serial("the customer is told WHY, not just that money moved", () => {
  async function awaitNotification(userId: string, bookingId: string, timeoutMs = 5_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const n = await prisma.notification.findFirst({
        where: { userId, referenceId: bookingId, type: "booking_no_show" },
        select: { title: true, message: true },
      });
      if (n) return n;
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  test("a customer no-show explains the wait and names the fee", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: 40 });
    const r = await bookingNoShowService.reportCustomerNoShow(id, partner());
    expect("ok" in r).toBe(true);
    const n = await awaitNotification(ctx.customerA.id, id);
    expect(n).not.toBeNull();
    expect(n!.message).toContain("40 minutes");
    expect(n!.message).toContain(String(NO_SHOW_POLICY.customerNoShowFeePercent));
    // and it never calls it a cancellation, which it is not
    expect(n!.title.toLowerCase()).not.toContain("cancel");
    expect(n!.message.toLowerCase()).not.toContain("cancel");
  });

  test("a provider no-show says plainly that nothing was charged", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    await bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
    const n = await awaitNotification(ctx.customerA.id, id);
    expect(n).not.toBeNull();
    expect(n!.title.toLowerCase()).toContain("not been charged");
    expect(n!.message.toLowerCase()).toContain("no fee");
  });

  test("the partner is told too — an absence they did not report is still theirs to know about", async () => {
    if (!dbOk) return;
    const { id } = await bookingAtDoor({ arrivedMinutesAgo: null });
    await bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
    const n = await awaitNotification(ctx.vendorUserId, id);
    expect(n).not.toBeNull();
    expect(n!.message.toLowerCase()).toContain("did not arrive");
  });
});
