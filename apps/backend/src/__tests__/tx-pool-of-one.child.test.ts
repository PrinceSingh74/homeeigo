/**
 * CHILD of tx-pool-of-one.test.ts — runs only when that parent spawns it (TX_POOL_OF_ONE_PROBE=1)
 * with a DATABASE_URL whose pool is exactly one connection. Skipped in an ordinary run.
 *
 * On one connection, any query issued on the BASE client from inside an interactive transaction
 * has no connection to get: the transaction holds the only one. It waits out pool_timeout and
 * fails — every time. That turns the "second connection inside a transaction" class (the
 * 2026-09-30 broadcast-accept pool deadlock, and the 2026-10-01 dispatch-offer geofence lookup)
 * from an intermittent full-suite failure into a deterministic one.
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { prisma } from "../lib/prisma";
import { bookingService } from "../services/booking.service";
import { createBookingWithQuote } from "./helpers/quote-token";
import { assignmentEngine } from "../services/assignment-engine.service";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  futureSlot,
  heartbeatFresh,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";

const ACTIVE = process.env.TX_POOL_OF_ONE_PROBE === "1";
const RUN_ID = `pool1-${Date.now().toString(36)}`;
const GATE_CONTEXT_TTL_MS = 5_000;
let ctx: AdvCtx;

async function settleInlineDispatch(): Promise<void> {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    const { inFlight, waiting } = assignmentEngine.inlineDispatchBacklog();
    if (inFlight === 0 && waiting === 0) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("inline dispatch never settled");
}

async function paidBooking(hoursAhead: number): Promise<string> {
  const created = await createBookingWithQuote(ctx.customerA.id, {
    serviceId: ctx.serviceId,
    addressId: ctx.addressAId,
    scheduledDate: futureSlot(hoursAhead).toISOString(),
  });
  if (!("booking" in created)) throw new Error(`create refused: ${JSON.stringify(created).slice(0, 200)}`);
  const bookingId = (created as { booking: { id: string } }).booking.id;
  // create's own background dispatch (withheld: unpaid) must finish before the booking is paid,
  // or it can wake up afterwards and race the dispatch under test.
  await settleInlineDispatch();
  await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: "SUCCESS" } });
  return bookingId;
}

describe.skipIf(!ACTIVE)("interactive transactions on a pool of one connection", () => {
  beforeAll(async () => {
    // Positive control: this suite proves nothing unless the pool really is one connection.
    const limit = new URL(process.env.DATABASE_URL ?? "").searchParams.get("connection_limit");
    if (limit !== "1") throw new Error(`probe requires connection_limit=1, got ${limit ?? "none"}`);
    if (!(await dbReachable())) throw new Error("homigo_test is not reachable");
    ctx = await seedAdversarialFixtures(RUN_ID);
  }, 120_000);

  afterAll(async () => {
    if (ctx) await cleanupAdversarialFixtures(RUN_ID);
  }, 120_000);

  test("dispatch offers to a partner with named service regions (offer tx + region lookup)", async () => {
    // A named region sends assertOfferEligible down its geofence branch, inside the offer transaction.
    await prisma.provider.update({ where: { id: ctx.providerId }, data: { serviceRegions: ["Noida"] } });
    try {
      await heartbeatFresh(ctx);
      const bookingId = await paidBooking(150);
      const sent = await assignmentEngine.dispatchBookingNow(bookingId);
      const job = await prisma.assignmentJob.findUniqueOrThrow({ where: { bookingId }, select: { id: true } });
      const offers = await prisma.assignmentAttempt.findMany({
        where: { jobId: job.id, status: "SENT" },
        select: { providerId: true },
      });
      expect(offers.map((o) => o.providerId)).toContain(ctx.providerId);
      expect(sent).toBe(true);
    } finally {
      await prisma.provider.update({ where: { id: ctx.providerId }, data: { serviceRegions: [] } });
    }
  }, 120_000);

  test("accept with a cold gate-context memo (accept tx + capability recheck)", async () => {
    await heartbeatFresh(ctx);
    const bookingId = await paidBooking(170);
    expect(await assignmentEngine.dispatchBookingNow(bookingId)).toBe(true);
    await new Promise((r) => setTimeout(r, GATE_CONTEXT_TTL_MS + 300)); // memo is now cold
    await heartbeatFresh(ctx);
    const result = await bookingService.accept(ctx.providerId, bookingId);
    expect(result.ok ? "ok" : result.error).toBe("ok");
  }, 120_000);
});
