/**
 * O3b and O7, against the isolated test database.
 *
 *   O3b  a customer may not cancel a job that has already started — it routes to a controlled stop
 *   O7   a refund goes back the way the money came, never to a different tender
 *
 * Both are the kind of rule that looks fine in the happy path and is only visible when someone
 * tries the thing it forbids, so every test here does the forbidden thing and checks the booking
 * and the money afterwards — not just the response code.
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
import { bookingService } from "../services/booking.service";
import { createBookingWithQuote } from "./helpers/quote-token";

const RUN = `p09stop-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let day = 4;
const created: string[] = [];

function istSlot(daysAhead: number, hhmm = "10:00"): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${ymd}T${hhmm}:00+05:30`);
}

async function paidBooking(status: BookingStatus) {
  await keepPresenceFresh(ctx);
  const result = await createBookingWithQuote(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    providerId: ctx.providerId,
    addressId: ctx.addressAId,
    scheduledDate: istSlot((day += 1)).toISOString(),
  });
  if (!("booking" in result) || !result.booking) throw new Error(`create failed: ${JSON.stringify(result)}`);
  const id = result.booking.id;
  await payWithRealWallet(id, ctx.customerA.id);
  await prisma.booking.update({ where: { id }, data: { status, startedAt: status === BookingStatus.IN_PROGRESS ? new Date() : null } });
  created.push(id);
  return { id, amount: result.booking.finalAmount };
}

/** RefundRequest hangs off the PAYMENT, not the booking, so ask through the payment row. */
async function refundRequestCount(bookingId: string, extra: Record<string, unknown> = {}) {
  const payment = await prisma.payment.findUnique({ where: { bookingId }, select: { id: true } });
  if (!payment) return 0;
  return prisma.refundRequest.count({ where: { paymentId: payment.id, ...extra } });
}
/**
 * The refund is posted AFTER the cancel response returns — the handler answers the customer and
 * settles the money detached. Reading the balance straight after the 200 therefore reads it before
 * the credit lands, which is a race, not a missing refund. Poll instead.
 */
async function awaitWalletCredit(userId: string, baseline: number, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.user.findUnique({ where: { id: userId }, select: { walletBalance: true } });
    const now = Number(row?.walletBalance ?? 0);
    if (now > baseline) return now - baseline;
    if (Date.now() > deadline) return 0;
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function awaitWalletTxn(userId: string, bookingId: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const n = await prisma.walletTransaction.count({
      where: { userId, referenceId: bookingId, type: { in: ["REFUND", "CREDIT"] } },
    });
    if (n > 0) return n;
    if (Date.now() > deadline) return 0;
    await new Promise((r) => setTimeout(r, 100));
  }
}
const statusOf = async (id: string) =>
  (await prisma.$queryRaw<Array<{ status: string }>>`SELECT status FROM bookings WHERE id = ${id}`)[0]!.status;

async function cancelAsCustomer(id: string) {
  const res = await app.handle(
    new Request(`http://localhost/api/bookings/${id}/cancel`, {
      method: "POST",
      headers: { Authorization: `Bearer ${bearer(ctx.customerA)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "changed my mind", cancelledBy: "user" }),
    }),
  );
  return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
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

afterEach(async () => {
  if (!dbOk || created.length === 0) return;
  await prisma.$executeRaw`
    UPDATE bookings SET status = 'CANCELLED_BY_USER', cancelled_at = NOW()
    WHERE id = ANY(${created}) AND status NOT IN ('CANCELLED_BY_USER', 'CANCELLED_BY_PROVIDER')
  `;
  created.length = 0;
});

afterAll(async () => {
  if (!dbOk) return;
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("O3b — a started job is a controlled stop, not a cancellation", () => {
  test("the customer is refused, and the booking is left exactly as it was", async () => {
    if (!dbOk) return;
    const { id } = await paidBooking(BookingStatus.IN_PROGRESS);
    const before = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true, cancelledAt: true, paymentStatus: true },
    });

    const r = await cancelAsCustomer(id);
    expect(r.status).toBe(409);
    expect(r.json.success).toBe(false);
    expect(r.json.code).toBe("SERVICE_IN_PROGRESS");
    // The message has to give the customer somewhere to go, not just a refusal.
    expect(String(r.json.error).toLowerCase()).toContain("support");

    const after = await prisma.booking.findUniqueOrThrow({
      where: { id },
      select: { status: true, cancelledAt: true, paymentStatus: true },
    });
    expect(after).toEqual(before);
    // And no money moved.
    expect(await refundRequestCount(id)).toBe(0);
  });

  test("the SAME customer on the SAME booking before it starts is still allowed", async () => {
    if (!dbOk) return;
    // The control that stops this becoming "cancellation is broken".
    const { id } = await paidBooking(BookingStatus.EN_ROUTE);
    const r = await cancelAsCustomer(id);
    expect(r.status).toBe(200);
    expect(r.json.success).toBe(true);
    expect(await statusOf(id)).toBe("CANCELLED_BY_USER");
  });

  test("support can still stop a started job — the route exists, it just is not the customer's", async () => {
    if (!dbOk) return;
    const { id } = await paidBooking(BookingStatus.IN_PROGRESS);
    const result = await bookingService.cancel(
      { userId: ctx.superAdmin.id, admin: { refundPolicy: "customer_policy" } },
      id,
      "controlled stop — customer asked support",
    );
    expect("error" in result).toBe(false);
    expect(await statusOf(id)).toBe("CANCELLED_BY_USER");
  });
});

describe.serial("O7 — money goes back the way it came", () => {
  test("a wallet-paid booking is refunded to the WALLET, and never through the gateway", async () => {
    if (!dbOk) return;
    const { id, amount } = await paidBooking(BookingStatus.ACCEPTED);

    const before = await prisma.user.findUnique({ where: { id: ctx.customerA.id }, select: { walletBalance: true } });
    const r = await cancelAsCustomer(id);
    expect(r.status).toBe(200);

    const credited = await awaitWalletCredit(ctx.customerA.id, Number(before?.walletBalance ?? 0));
    expect(credited).toBeGreaterThan(0);
    expect(credited).toBeLessThanOrEqual(amount + 0.01);

    // The routing assertion: no gateway refund was attempted for money that never went to a gateway.
    expect(await refundRequestCount(id, { NOT: { gatewayRefundId: null } })).toBe(0);
  });

  test("the credit is a real ledger movement, not a balance nudge", async () => {
    if (!dbOk) return;
    const { id } = await paidBooking(BookingStatus.ACCEPTED);
    await cancelAsCustomer(id);
    // Whatever was returned must be backed by a wallet transaction referencing this booking.
    expect(await awaitWalletTxn(ctx.customerA.id, id)).toBeGreaterThan(0);
  });
});
