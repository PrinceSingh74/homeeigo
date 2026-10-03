/**
 * A contended broadcast accept must not take the instance's connection pool with it (2026-10-01).
 *
 * Every accept opens a Serializable transaction and then waits on the booking's FOR UPDATE while
 * holding a pooled connection. Ten partners (or one partner's retries) accepting one booking while
 * something else holds that row therefore parked up to `connection_limit` connections on one row lock,
 * and every other request on the instance — logins, catalogue reads, payments — queued behind them.
 * BookingService.accept now serialises accepts of one booking in-process, so that booking costs one
 * connection however many accepts arrive.
 *
 * The lock holder here is a FOR SHARE held for HOLD_MS on a dedicated connection: the shape of a
 * dispatch-offer transaction, which takes exactly that lock on the booking.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
import { createDedicatedPoolClient } from "../lib/prisma-base";
import { bookingService } from "../services/booking.service";
import { assignmentEngine } from "../services/assignment-engine.service";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  heartbeatFresh,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";

const RUN_ID = `accept-pool-${Date.now().toString(36)}`;
const CONCURRENT_ACCEPTS = 10;
const HOLD_MS = 4_000;
/** An unrelated query must not wait on the accept queue. Generous: an idle round trip is ~a few ms. */
const UNRELATED_QUERY_BUDGET_MS = 1_500;
let ctx: AdvCtx;

beforeAll(async () => {
  if (!(await dbReachable())) throw new Error("homigo_test is not reachable");
  ctx = await seedAdversarialFixtures(RUN_ID);
});

afterAll(async () => {
  if (ctx) await cleanupAdversarialFixtures(RUN_ID);
});

async function settleInlineDispatch(): Promise<void> {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const { inFlight, waiting } = assignmentEngine.inlineDispatchBacklog();
    if (inFlight === 0 && waiting === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("inline dispatch never settled");
}

describe("contended accept and the connection pool", () => {
  test(`${CONCURRENT_ACCEPTS} accepts queued on a held booking row leave the pool free for other traffic`, async () => {
    await heartbeatFresh(ctx);
    const created = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(180).toISOString(),
    });
    expect("booking" in created).toBe(true);
    const bookingId = (created as { booking: { id: string } }).booking.id;
    await settleInlineDispatch();
    await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: "SUCCESS" } });
    expect(await assignmentEngine.dispatchBookingNow(bookingId)).toBe(true);
    await heartbeatFresh(ctx);

    const holder = createDedicatedPoolClient(1, 10);
    let lockTaken!: () => void;
    const locked = new Promise<void>((r) => (lockTaken = r));
    try {
      const hold = holder.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${bookingId} FOR SHARE`;
          lockTaken();
          await new Promise((r) => setTimeout(r, HOLD_MS));
        },
        { maxWait: 10_000, timeout: HOLD_MS + 10_000 },
      );
      await locked;

      const accepts = Promise.allSettled(
        Array.from({ length: CONCURRENT_ACCEPTS }, () => bookingService.accept(ctx.providerId, bookingId)),
      );
      // Let every accept reach its lock wait, then time ordinary traffic.
      await new Promise((r) => setTimeout(r, 1_000));
      const t0 = performance.now();
      await prisma.$queryRaw`SELECT 1`;
      const unrelatedMs = Math.round(performance.now() - t0);

      await hold;
      const results = await accepts;
      const threw = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
      const values = results
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof bookingService.accept>>> => r.status === "fulfilled")
        .map((r) => r.value);

      expect(threw.map((r) => String(r.reason?.message ?? r.reason).split("\n").pop())).toEqual([]);
      expect(unrelatedMs).toBeLessThan(UNRELATED_QUERY_BUDGET_MS);
      expect(values.filter((v) => v.ok && v.newlyAccepted).length).toBe(1);
      expect(values.filter((v) => v.ok && !v.newlyAccepted).length).toBe(CONCURRENT_ACCEPTS - 1);
      const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true, providerId: true } });
      expect(after).toEqual({ status: "ACCEPTED", providerId: ctx.providerId });
    } finally {
      await holder.$disconnect();
    }
  }, 120_000);
});
