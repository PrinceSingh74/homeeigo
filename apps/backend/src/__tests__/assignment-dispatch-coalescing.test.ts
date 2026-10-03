/**
 * Concurrent dispatches of ONE job share a single run (2026-10-01).
 *
 * create's background dispatch, the settlement hook, a reject and the cron tick all reach
 * dispatchToNextProvider, and nothing stopped two of them working the same job at once. The loser
 * found every candidate already offered (or lost each insert to the unique index), so it recorded a
 * NO_PROVIDER attempt — spending the job's retry budget on work that had in fact succeeded, while its
 * offer transactions held the booking row that concurrent accepts were waiting for.
 */
import "../load-env";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { prisma } from "../lib/prisma";
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

const RUN_ID = `dispatch-coalesce-${Date.now().toString(36)}`;
const CONCURRENT_DISPATCHES = 5;
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

describe("dispatch of one job", () => {
  test(`${CONCURRENT_DISPATCHES} concurrent dispatches of a paid booking run once and spend one attempt`, async () => {
    await heartbeatFresh(ctx);
    const created = await bookingService.create(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(150).toISOString(),
    });
    expect("booking" in created).toBe(true);
    const bookingId = (created as { booking: { id: string } }).booking.id;
    await settleInlineDispatch(); // create's own (unpaid → withheld) dispatch is finished
    await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: "SUCCESS" } });

    const results = await Promise.all(
      Array.from({ length: CONCURRENT_DISPATCHES }, () => assignmentEngine.dispatchBookingNow(bookingId)),
    );

    const job = await prisma.assignmentJob.findUniqueOrThrow({
      where: { bookingId },
      select: { id: true, status: true, dispatchAttempts: true },
    });
    const offers = await prisma.assignmentAttempt.findMany({ where: { jobId: job.id }, select: { providerId: true } });
    const noProvider = await prisma.assignmentAudit.count({ where: { jobId: job.id, action: "NO_PROVIDER" } });

    // Positive control: the dispatch really offered the fixture partner.
    expect(offers.map((o) => o.providerId)).toContain(ctx.providerId);
    expect(results).toEqual(Array.from({ length: CONCURRENT_DISPATCHES }, () => true));
    expect({ status: job.status, dispatchAttempts: job.dispatchAttempts, noProvider }).toEqual({
      status: "DISPATCHED",
      dispatchAttempts: 1,
      noProvider: 0,
    });
    expect(assignmentEngine.dispatchInFlight(job.id)).toBe(false);
  }, 120_000);
});
