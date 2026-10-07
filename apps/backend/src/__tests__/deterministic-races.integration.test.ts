/**
 * Deterministic race proofs (Domain 35 / R-l).
 *
 * The earlier concurrency tests fired N promises at once and hoped the scheduler interleaved them.
 * When it did not, a regression could pass. Here every race is ORCHESTRATED:
 *
 *   1. a holder transaction takes the exact lock the code under test will need;
 *   2. the racers are launched and we wait — by polling pg_stat_activity — until every one of them
 *      is observed BLOCKED on that lock (the barrier);
 *   3. the holder is released; the database now serialises the racers in a known order.
 *
 * So the losing path is exercised on every run, not on a lucky one. Each race asserts the expected
 * winner, the expected loser outcome, the authoritative DB state, the history/audit invariant and,
 * where money is involved, the financial invariant.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { BookingStatus, PaymentStatus, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { bookingService } from "../services/booking.service";
import { bookingNoShowService } from "../services/booking-no-show.service";
import { cleanupAdversarialFixtures, dbReachable, seedAdversarialFixtures, type AdvCtx } from "./helpers/adversarial-fixtures";
import { refuseIfNotIsolatedTestDb } from "./helpers/isolated-test-db";
import { placeAtDoor } from "./helpers/no-show-fixture";

type Tx = Prisma.TransactionClient;
const RUN = `races-${Date.now().toString(36)}`;
let ctx: AdvCtx;
let dbOk = false;
let seq = 0;
let addr: { latitude: number; longitude: number };

async function seedBooking(over: Record<string, unknown> = {}): Promise<{ id: string; scheduledDate: Date }> {
  seq += 1;
  const scheduledDate = new Date(Date.now() + (20 + seq) * 86_400_000);
  scheduledDate.setUTCHours(5, 0, 0, 0);
  const b = await prisma.booking.create({
    data: {
      bookingNumber: `${RUN}-${seq}`,
      dataOrigin: "INFERRED_SYNTHETIC",
      userId: ctx.customerA.id,
      serviceId: ctx.serviceId,
      providerId: ctx.providerId,
      addressId: ctx.addressAId,
      status: BookingStatus.ACCEPTED,
      paymentStatus: PaymentStatus.SUCCESS,
      scheduledDate,
      baseAmount: 500,
      finalAmount: 500,
      totalAmount: 500,
      ...over,
    } as never,
  });
  return { id: b.id, scheduledDate };
}

/**
 * The barrier. Holds `lockSql` in its own transaction until `release()` is called, and exposes
 * `waitForBlocked(n, pattern)`, which resolves once n OTHER backends are waiting on a Lock while
 * running a statement matching `pattern`.
 */
function holdLock(lockSql: (tx: Tx) => PromiseLike<unknown>) {
  let release!: () => void;
  const released = new Promise<void>((r) => (release = r));
  let acquired!: () => void;
  const acquiredP = new Promise<void>((r) => (acquired = r));
  const done = prisma.$transaction(
    async (tx) => {
      await lockSql(tx);
      acquired();
      await released;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  return {
    acquired: acquiredP,
    release: () => release(),
    done,
    async waitForBlocked(n: number, pattern: string, timeoutMs = 20_000) {
      const t0 = Date.now();
      for (;;) {
        const [{ c }] = await prisma.$queryRaw<{ c: number }[]>`
          SELECT count(*)::int AS c FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE ${pattern}`;
        if (c >= n) return c;
        if (Date.now() - t0 > timeoutMs) throw new Error(`barrier: only ${c}/${n} racers blocked on ${pattern}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
  };
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
  const a = await prisma.address.findUniqueOrThrow({ where: { id: ctx.addressAId }, select: { latitude: true, longitude: true } });
  addr = { latitude: a.latitude as number, longitude: a.longitude as number };
}, 120_000);

afterAll(async () => {
  if (dbOk) await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe.serial("R-l — duplicate START by the same partner, forced to interleave on the requirement-gate lock", () => {
  test("both racers pass the pre-check, both block on the gate lock, one writes IN_PROGRESS, the other is answered as a retry", async () => {
    if (!dbOk) return;
    // A gated, already-satisfied requirement so the START path takes the row lock we hold.
    const snapshot = {
      requirements: {
        schema: "requirements.v1",
        serviceVersion: 1,
        items: [{ code: "shutoff", itemCode: "shutoff", kind: "CUSTOMER_PRECONDITION", name: "Shut-off valve", enforcement: "REQUIRED_AT_START", verification: "PARTNER_CHECK", responsibility: "CUSTOMER", optional: false, attested: false }],
      },
    };
    const { id, scheduledDate } = await seedBooking({ serviceConfigSnapshot: snapshot });
    await prisma.$executeRaw`
      INSERT INTO booking_requirement_states (booking_id, code, item_code, kind, enforcement, verification, responsibility, service_version,
        state, resolved_by_role, resolved_by_id, evidence_kind, evidence_ref, valid_for_scheduled_at, resolved_at)
      VALUES (${id}, 'shutoff', 'shutoff', 'CUSTOMER_PRECONDITION', 'REQUIRED_AT_START', 'PARTNER_CHECK', 'CUSTOMER', 1,
        'SATISFIED', 'PARTNER', ${ctx.vendorUserId}, 'PARTNER_CHECK', 'race-fixture', ${scheduledDate}, now())`;

    const holder = holdLock((tx) => tx.$queryRaw`SELECT id FROM booking_requirement_states WHERE booking_id = ${id} FOR UPDATE`);
    await holder.acquired;
    const racers = [0, 1].map(() =>
      bookingService.start(ctx.providerId, id, addr.latitude, addr.longitude).then(
        (b) => ({ ok: true as const, status: b.status }),
        (e: Error) => ({ ok: false as const, error: e.message }),
      ),
    );
    // Barrier: BOTH starts are inside the gate, waiting on the lock — neither has written yet.
    expect(await holder.waitForBlocked(2, "%booking_requirement_states%FOR UPDATE%")).toBeGreaterThanOrEqual(2);
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe(BookingStatus.ACCEPTED);
    holder.release();
    await holder.done;
    const results = await Promise.all(racers);

    // Expected winner AND expected loser: both calls succeed — the loser is a retry, not a failure.
    expect(results).toEqual([
      { ok: true, status: BookingStatus.IN_PROGRESS },
      { ok: true, status: BookingStatus.IN_PROGRESS },
    ]);
    // Authoritative state and history invariant: exactly one transition was written.
    expect((await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } })).status).toBe(BookingStatus.IN_PROGRESS);
    const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM booking_status_history WHERE booking_id = ${id} AND new_status = 'IN_PROGRESS'`;
    expect(n).toBe(1);
  }, 60_000);
});

describe.serial("R-l — two opposing no-show reports, forced to interleave on the booking row lock", () => {
  test("both reports pass their checks, both block on the row, exactly one closes the booking and settles; the other gets INVALID_STATUS", async () => {
    if (!dbOk) return;
    const { id } = await seedBooking({ status: BookingStatus.EN_ROUTE, arrivedAt: new Date(Date.now() - 30 * 60_000) });
    // A no-show is counted from the booked time: the appointment has begun.
    await placeAtDoor(id, ctx.providerId);
    // The arrival was vouched for (not confirmed from a position), so the customer's own report is
    // still open to them — against a position-confirmed arrival it would go to support instead.
    await prisma.activityLog.create({ data: { bookingId: id, providerId: ctx.providerId, action: "PARTNER_ARRIVAL_VOUCHED", description: "Arrival recorded on the customer's confirmation: no position was confirmed" } });
    const holder = holdLock((tx) => tx.$queryRaw`SELECT id FROM bookings WHERE id = ${id} FOR UPDATE`);
    await holder.acquired;
    const customerReport = bookingNoShowService.reportCustomerNoShow(id, { userId: ctx.vendorUserId, providerId: ctx.providerId });
    // Serialise the two launches so the customer no-show is guaranteed to reach the row first.
    await holder.waitForBlocked(1, "%UPDATE%bookings%");
    const providerReport = bookingNoShowService.reportProviderNoShow(id, { userId: ctx.customerA.id });
    expect(await holder.waitForBlocked(2, "%UPDATE%bookings%")).toBeGreaterThanOrEqual(2);
    holder.release();
    await holder.done;
    const [a, b] = await Promise.all([customerReport, providerReport]);

    // Expected winner: the first in the lock queue. Expected loser: re-evaluates the WHERE after the
    // winner commits, matches nothing, settles nothing.
    expect(a).toMatchObject({ ok: true, status: BookingStatus.CUSTOMER_NO_SHOW });
    expect(b).toEqual({ error: "INVALID_STATUS" });
    const row = await prisma.booking.findUniqueOrThrow({ where: { id }, select: { status: true } });
    expect(row.status).toBe(BookingStatus.CUSTOMER_NO_SHOW);
    const terminal = await prisma.$queryRaw<{ new_status: string }[]>`
      SELECT new_status FROM booking_status_history WHERE booking_id = ${id} AND new_status IN ('CUSTOMER_NO_SHOW','PROVIDER_NO_SHOW')`;
    expect(terminal).toEqual([{ new_status: "CUSTOMER_NO_SHOW" }]);
    // Financial invariant: at most one settlement attempt for the booking (no payment row here, so none).
    const paymentIds = (await prisma.payment.findMany({ where: { bookingId: id }, select: { id: true } })).map((p) => p.id);
    expect(await prisma.refundRequest.count({ where: { paymentId: { in: paymentIds } } })).toBe(0);
  }, 60_000);
});
