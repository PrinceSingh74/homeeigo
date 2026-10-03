import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cleanupAdversarialFixtures,
  dbReachable,
  prisma,
  seedAdversarialFixtures,
  type AdvCtx,
} from "./helpers/adversarial-fixtures";
import { bookingRefundService, nextRefundRetryAt } from "../services/booking-refund.service";

/**
 * 5E — the failed-cancellation-refund retry scan.
 *
 * ── The defect this file pins ────────────────────────────────────────────────
 *
 * The scan takes the 25 oldest FAILED refunds by `updatedAt` and, for each, counts its RETRY audit
 * rows to decide whether it has spent its 5 attempts. A row that HAS spent them is skipped with
 * `continue` — before anything writes to it. So its `updatedAt` stops moving, while every row still
 * being retried keeps having its refreshed.
 *
 * Exhausted rows therefore drift to the FRONT of an `updatedAt asc` ordering and stay there. Once 25
 * of them exist, they fill the window permanently and a customer whose refund fails after that is
 * never retried at all — their money simply stops moving, with no error and no alert. The retry
 * budget is also spent in 25 minutes (5 attempts, one per 5-minute tick), so a gateway outage
 * lasting half an hour permanently exhausts every refund in flight.
 *
 * The scan also cost two queries per row (an audit count and a booking read), which is the visible
 * symptom that led here — but the starvation is the reason this is a money bug and not a slow query.
 */
const RUN = `refund-retry-${Date.now().toString(36)}`;
const MAX_RETRIES = 5;
let ctx: AdvCtx;
let dbOk = false;

/**
 * A FAILED cancellation refund. `bookingId` is deliberately a non-existent booking so the scan stops
 * at its booking lookup: this file is about WHICH rows the scan reaches, and processing a real refund
 * would move money that has nothing to do with that question.
 */
async function seedFailedRefund(opts: {
  index: number;
  bookingId: string;
  retryAudits: number;
  updatedAgoMs: number;
  amount?: number;
}) {
  const id = `${RUN}-rr-${opts.index}`;
  await prisma.$executeRawUnsafe(
    `INSERT INTO refund_requests (id, payment_id, user_id, amount, reason, status, requested_by,
                                  idempotency_key, created_at, updated_at)
     VALUES ($1, $2, $3, $6, 'test', 'FAILED', 'system', $4, NOW(), $5)`,
    id,
    ctx.paymentForRefundId,
    ctx.customerA.id,
    `cancel-refund:${opts.bookingId}`,
    new Date(Date.now() - opts.updatedAgoMs),
    opts.amount ?? 100,
  );
  /**
   * Attempts spent live on the row now. The audit rows below remain the historical trail, and the
   * 20260916110000 migration derives `retry_count` from exactly this count for rows that predate it,
   * so a legacy exhausted refund does not silently get five fresh attempts.
   */
  await prisma.$executeRawUnsafe(
    `UPDATE refund_requests SET retry_count = $2, updated_at = $3 WHERE id = $1`,
    id,
    opts.retryAudits,
    new Date(Date.now() - opts.updatedAgoMs),
  );
  for (let i = 0; i < opts.retryAudits; i++) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO refund_audits (id, refund_request_id, action, actor_id, details, created_at)
       VALUES ($1, $2, 'RETRY', 'system', $3, NOW())`,
      `${id}-a-${i}`,
      id,
      `attempt_${i + 1}`,
    );
  }
  return id;
}

/**
 * `retryFailedRefunds` scans EVERY eligible FAILED cancellation refund in the database, and other
 * suites share it: a full run once left four of their own eligible rows behind, and an assertion on the
 * scan's total (`scanned === 1`) read 5. So these tests judge the scan by what it did to THIS suite's
 * rows: an attempt is claimed by incrementing `retry_count` before anything else happens.
 */
async function retryState(ids: string[]) {
  const rows = await prisma.refundRequest.findMany({ where: { id: { in: ids } }, select: { id: true, retryCount: true, updatedAt: true } });
  return new Map(rows.map((r) => [r.id, { retryCount: r.retryCount, updatedAt: r.updatedAt.getTime() }]));
}

/**
 * A row the scan can really act on must point at a booking that exists: a refund whose booking is gone
 * is skipped before an attempt is claimed, so it would never show up in `retry_count`.
 */
async function realBookingId() {
  return (await prisma.payment.findUniqueOrThrow({ where: { id: ctx.paymentForRefundId }, select: { bookingId: true } })).bookingId;
}

async function clearRefunds() {
  await prisma.$executeRawUnsafe(`DELETE FROM refund_audits WHERE refund_request_id LIKE $1`, `${RUN}-rr-%`);
  await prisma.$executeRawUnsafe(`DELETE FROM refund_requests WHERE id LIKE $1`, `${RUN}-rr-%`);
}

beforeAll(async () => {
  dbOk = await dbReachable();
  if (!dbOk) return;
  ctx = await seedAdversarialFixtures(RUN);
  await clearRefunds();
}, 60_000);

afterAll(async () => {
  if (!dbOk) return;
  await clearRefunds();
  await cleanupAdversarialFixtures(RUN);
}, 60_000);

describe("failed refund retry scan", () => {
  test("a fresh failure is still reached when the queue is full of exhausted refunds", async () => {
    if (!dbOk) return;
    await clearRefunds();

    // 25 refunds that have already spent every attempt, all older than the fresh one — which is
    // exactly how they age, since an exhausted row is skipped before anything updates it.
    for (let i = 0; i < 25; i++) {
      await seedFailedRefund({
        index: i,
        bookingId: `${RUN}-dead-${i}`,
        retryAudits: MAX_RETRIES,
        updatedAgoMs: (i + 2) * 3_600_000,
      });
    }
    // One customer whose refund has just failed and has attempts left.
    const fresh = await seedFailedRefund({
      index: 99,
      bookingId: await realBookingId(),
      retryAudits: 0,
      // Older than anything another suite writes during a run (so it is not queued behind them), newer
      // than every exhausted row (so the starvation this test guards would still bury it).
      updatedAgoMs: 90 * 60_000,
    });
    const deadIds = Array.from({ length: 25 }, (_, i) => `${RUN}-rr-${i}`);
    const before = await retryState([...deadIds, fresh]);

    const result = await bookingRefundService.retryFailedRefunds(25);
    const after = await retryState([...deadIds, fresh]);

    /**
     * The scan must spend its window on rows it can actually act on. Scanning 25 exhausted rows and
     * never seeing `fresh` is the starvation: the customer's money stops moving silently.
     */
    const scannedIds = await prisma.refundRequest.findMany({
      where: { idempotencyKey: { startsWith: "cancel-refund:" }, id: { startsWith: `${RUN}-rr-` } }, // any status: the fresh one may now be COMPLETED
      select: { id: true },
    });
    expect(scannedIds.length).toBe(26); // nothing was deleted; this is about ordering, not cleanup

    // The fresh row is eligible and must be inside the scanned window.
    expect(result.scanned).toBeLessThanOrEqual(25);
    expect(result.scanned).toBeGreaterThan(0);

    const reached = await prisma.refundRequest.findUnique({ where: { id: fresh }, select: { id: true } });
    expect(reached).not.toBeNull();

    /**
     * The direct assertion: exhausted rows must not occupy the window at all. Before 5E the scan
     * returned 25 — every one of them spent — and `fresh` was never considered.
     */
    expect(after.get(fresh)!.retryCount).toBe(before.get(fresh)!.retryCount + 1);
    for (const id of deadIds) {
      expect(after.get(id)).toEqual(before.get(id));
    }
  });

  test("an exhausted refund is not re-examined on every tick", async () => {
    if (!dbOk) return;
    await clearRefunds();
    for (let i = 0; i < 3; i++) {
      await seedFailedRefund({
        index: i,
        bookingId: `${RUN}-dead-${i}`,
        retryAudits: MAX_RETRIES,
        updatedAgoMs: (i + 1) * 3_600_000,
      });
    }

    // Nothing is eligible, so the scan should touch nothing rather than re-count five audits apiece.
    const deadIds = [0, 1, 2].map((i) => `${RUN}-rr-${i}`);
    const before = await retryState(deadIds);
    await bookingRefundService.retryFailedRefunds(25);
    expect(await retryState(deadIds)).toEqual(before);
  });

  test("a refund with attempts remaining is still eligible", async () => {
    if (!dbOk) return;
    await clearRefunds();
    const id = await seedFailedRefund({ index: 0, bookingId: await realBookingId(), retryAudits: MAX_RETRIES - 1, updatedAgoMs: 90 * 60_000 });

    await bookingRefundService.retryFailedRefunds(25);
    expect((await retryState([id])).get(id)!.retryCount).toBe(MAX_RETRIES);
  });

  test("a refund whose booking is gone is skipped without spending an attempt", async () => {
    if (!dbOk) return;
    await clearRefunds();
    const id = await seedFailedRefund({ index: 0, bookingId: `${RUN}-missing`, retryAudits: 0, updatedAgoMs: 60_000 });

    await bookingRefundService.retryFailedRefunds(25);

    // Nothing was attempted, so nothing may be charged against the retry budget — otherwise a
    // transient lookup problem would silently burn a customer's five chances.
    const after = await prisma.refundRequest.findUnique({ where: { id }, select: { retryCount: true } });
    expect(after?.retryCount).toBe(0);
    expect(await prisma.refundAudit.count({ where: { refundRequestId: id, action: "RETRY" } })).toBe(0);
  });

  test("a reachable refund has its attempt claimed before the gateway call, not after it succeeds", async () => {
    if (!dbOk) return;
    await clearRefunds();
    const real = await prisma.booking.findFirst({ where: { userId: ctx.customerA.id }, select: { id: true } });
    if (!real) return;

    /**
     * Amount 0, so `processCancellationRefund` returns status "none" — reachable, but NOT a success.
     * That distinction is the whole test: with a succeeding refund both a claim-before and a
     * claim-after implementation end at retryCount 1, so the assertion could not fail and proved
     * nothing. This row can only reach 1 if the attempt is claimed before the outcome is known.
     */
    const id = await seedFailedRefund({
      index: 1,
      bookingId: real.id,
      retryAudits: 0,
      updatedAgoMs: 60_000,
      amount: 0,
    });

    const result = await bookingRefundService.retryFailedRefunds(25).catch(() => ({ succeeded: 0 }));
    expect(result.succeeded).toBe(0);

    /**
     * The attempt is spent whatever the outcome. If a process died mid-refund and the count only
     * advanced on success, the refund would be retried as though it had never been sent — the path
     * to a double refund. Spending it is the safe direction.
     */
    const row = await prisma.refundRequest.findUnique({ where: { id }, select: { retryCount: true } });
    expect(row?.retryCount).toBe(1);
    expect(await prisma.refundAudit.count({ where: { refundRequestId: id, action: "RETRY" } })).toBe(1);
  });

  test("the first retry is immediate — the fast path is unchanged by the backoff decision", () => {
    /**
     * OWNER DECISION #8. `attempt` is the attempt just made, so attempt 1 returning null means the
     * first retry happens on the next maintenance tick exactly as it always did. Adopting a backoff
     * that delayed the FIRST retry would have made every ordinary refund slower to fix a rarer
     * failure; this one only spreads the tail.
     */
    expect(nextRefundRetryAt(1)).toBeNull();
  });

  test("later attempts back off exponentially from the tick interval", () => {
    const now = new Date("2026-09-17T12:00:00Z");
    const minutesAfter = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 60_000 : null);

    // 5, 10, 20, 40 — a budget spanning ~75 minutes instead of 25.
    expect(minutesAfter(nextRefundRetryAt(2, now))).toBe(5);
    expect(minutesAfter(nextRefundRetryAt(3, now))).toBe(10);
    expect(minutesAfter(nextRefundRetryAt(4, now))).toBe(20);
    expect(minutesAfter(nextRefundRetryAt(5, now))).toBe(40);
  });

  test("the schedule outlasts an outage that would previously have exhausted every refund", () => {
    /**
     * The failure this decision exists for: a gateway down for half an hour used to burn all five
     * attempts, leaving customers needing manual intervention. The cumulative span must now exceed
     * that comfortably.
     */
    const now = new Date("2026-09-17T12:00:00Z");
    const last = nextRefundRetryAt(5, now);
    const spanMinutes = 5 + 10 + 20 + (last ? (last.getTime() - now.getTime()) / 60_000 : 0);
    expect(spanMinutes).toBeGreaterThan(60);
  });

  test("the migration backfill derives spent attempts from the audit trail", async () => {
    if (!dbOk) return;
    await clearRefunds();
    // A legacy row: audits recorded, retry_count never written (exactly the pre-migration state).
    const id = await seedFailedRefund({ index: 0, bookingId: `${RUN}-legacy`, retryAudits: MAX_RETRIES, updatedAgoMs: 60_000 });
    await prisma.$executeRawUnsafe(`UPDATE refund_requests SET retry_count = 0 WHERE id = $1`, id);

    // Without the backfill this row would be handed five fresh attempts against a gateway that
    // already refused it five times. The migration's UPDATE is replayed here verbatim.
    await prisma.$executeRawUnsafe(`
      UPDATE "refund_requests" r
      SET "retry_count" = COALESCE(a.n, 0)
      FROM (
        SELECT "refund_request_id", COUNT(*)::int AS n
        FROM "refund_audits" WHERE "action" = 'RETRY' GROUP BY "refund_request_id"
      ) a
      WHERE a."refund_request_id" = r."id" AND r."id" = $1`, id);

    const row = await prisma.refundRequest.findUnique({ where: { id }, select: { retryCount: true } });
    expect(row?.retryCount).toBe(MAX_RETRIES);
    const before = await retryState([id]);
    await bookingRefundService.retryFailedRefunds(25);
    expect(await retryState([id])).toEqual(before);
  });
});
