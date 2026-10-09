/**
 * Concurrent accepts of a BROADCAST offer must not deadlock on the connection pool.
 *
 * Found 2026-09-30 by the dispatch race harness: N concurrent accepts of a broadcast-offered booking
 * (no partner pinned) all failed — none won, every one threw "Transaction already closed" / "Unable
 * to start a transaction". pg_stat_activity showed the winner `idle in transaction (ClientRead)`
 * holding the booking row lock while every other pooled connection queued behind that lock.
 *
 * Mechanism: `assertAcceptEligible` resolved the service gate context through a memo that loads on
 * the BASE client. With the memo cold (TTL 5 s), the winner needed a second connection inside its
 * transaction, and every connection was held by an accept waiting for the winner's row lock — a
 * cycle Postgres cannot see. The directly-assigned accept race never showed it because
 * `booking.create`'s pre-check had just warmed the memo for the same service and customer.
 *
 * The test waits out the memo TTL so the context is cold by construction, then fires more accepts
 * than the test pool has connections (connection_limit=5).
 */
import "../load-env";
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  prisma,
  dbReachable,
  seedAdversarialFixtures,
  cleanupAdversarialFixtures,
  futureSlot,
  heartbeatFresh,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingService } from "../services/booking.service";
import { createBookingWithQuote } from "./helpers/quote-token";
import { assignmentEngine } from "../services/assignment-engine.service";
import { createDedicatedPoolClient } from "../lib/prisma-base";

/**
 * FORENSIC capture (2026-10-01). This test fails only inside the full suite (5 × "Unable to start a
 * transaction in the given time"; the test then takes ~40 s instead of ~6 s). Isolated reproductions —
 * in-process pool pressure 0–5 held connections, 30-way serialised accepts — never failed. What the
 * failing run does have is a global processQueue over residue from earlier files and a background
 * inline-dispatch backlog. On failure this prints both, plus what every connection was doing, read
 * through its own one-connection client so the evidence cannot be starved by the condition it records.
 */
async function forensic(label: string, extra: Record<string, unknown>) {
  const probe = createDedicatedPoolClient(1, 5);
  try {
    const rows = await probe.$queryRaw<Array<{ state: string | null; wait: string | null; xact_ms: number | null; q: string | null }>>`
      SELECT state, wait_event_type || ':' || wait_event AS wait,
             (EXTRACT(EPOCH FROM (now() - xact_start)) * 1000)::int AS xact_ms,
             left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS q
      FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()
      ORDER BY xact_start NULLS LAST`;
    console.log(`[bcast-forensic] ${label} ${JSON.stringify({ ...extra, backlog: assignmentEngine.inlineDispatchBacklog(), connections: rows })}`);
  } catch (err) {
    console.log(`[bcast-forensic] ${label} capture failed: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    await probe.$disconnect();
  }
}

const RUN_ID = `bcast-accept-${Date.now().toString(36)}`;
const GATE_CONTEXT_TTL_MS = 5_000;
const requestedAccepts = Number(process.env.BCAST_ACCEPTS ?? "10");
const CONCURRENT_ACCEPTS = Number.isInteger(requestedAccepts) && requestedAccepts >= 2 ? requestedAccepts : 10;
let ctx: AdvCtx;

beforeAll(async () => {
  // A missing database must FAIL this suite, not skip it green.
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
describe("broadcast accept under concurrency", () => {
  test(`${CONCURRENT_ACCEPTS} concurrent accepts of a broadcast offer with a cold gate-context memo — exactly one wins, none throw`, async () => {
    const created = await createBookingWithQuote(ctx.customerA.id, {
      serviceId: ctx.serviceId,
      addressId: ctx.addressAId,
      scheduledDate: futureSlot(160).toISOString(),
    });
    expect("booking" in created).toBe(true);
    const bookingId = (created as { booking: { id: string } }).booking.id;

    // This test needs the customer and fixture partner in the same provenance population.
    // Preserve the shared fixture's normal evidence-based provenance; align only this test's customer.
    const providerProvenance = await prisma.user.findUniqueOrThrow({
      where: { id: ctx.vendorUserId },
      select: { dataOrigin: true },
    });
    await prisma.user.update({
      where: { id: ctx.customerA.id },
      data: { dataOrigin: providerProvenance.dataOrigin },
    });

    // create() launches a non-blocking dispatch attempt. Settle it before paying
    // and starting the deterministic dispatch/acceptance phase below.
    await settleInlineDispatch();

    // Dispatch and accept are both payment-gated; a paid booking is the state in which this happens.
    await prisma.booking.update({ where: { id: bookingId }, data: { paymentStatus: "SUCCESS" } });
    const job = await assignmentEngine.createJob(bookingId);

    // This regression targets concurrent ACCEPTs, not the global cron/Redis queue lock.
    // Use the deterministic single-booking dispatch path to create the broadcast offer.
    const dispatched = await assignmentEngine.dispatchBookingNow(bookingId);
    expect(dispatched).toBe(true);

    const offered = await prisma.assignmentAttempt.findMany({
      where: { jobId: job.id, status: "SENT" },
      select: { providerId: true },
    });
    // Positive control: the fixture partner really holds a broadcast offer and nobody is pinned yet.
    expect(offered.map((o) => o.providerId)).toContain(ctx.providerId);
    const before = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { providerId: true } });
    expect(before.providerId).toBeNull();

    await new Promise((r) => setTimeout(r, GATE_CONTEXT_TTL_MS + 300)); // memo is now cold
    await heartbeatFresh(ctx);

    const backlogBefore = assignmentEngine.inlineDispatchBacklog();
    const tAccept = performance.now();
    const results = await Promise.allSettled(
      Array.from({ length: CONCURRENT_ACCEPTS }, () => bookingService.accept(ctx.providerId, bookingId)),
    );
    const acceptMs = Math.round(performance.now() - tAccept);
    const threw = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    const ok = results.filter((r) => r.status === "fulfilled" && (r.value as { ok?: boolean }).ok === true);
    if (threw.length > 0) {
      await forensic("accepts threw", { threw: threw.length, backlogBefore, acceptMs });
    }

    expect(threw.map((r) => String(r.reason?.message ?? r.reason).split("\n").pop())).toEqual([]);
    // Exactly one accept claims the booking. The rest are the SAME partner tapping again, and
    // get the documented idempotent answer ("already yours", newlyAccepted=false).
    const won = ok.filter((r) => (r as PromiseFulfilledResult<{ newlyAccepted?: boolean }>).value.newlyAccepted === true);
    expect(won.length).toBe(1);
    expect(ok.length).toBe(CONCURRENT_ACCEPTS);
    const after = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId }, select: { status: true, providerId: true } });
    expect(after.status).toBe("ACCEPTED");
    expect(after.providerId).toBe(ctx.providerId);
  }, Math.max(120_000, CONCURRENT_ACCEPTS * 2_500));
});
