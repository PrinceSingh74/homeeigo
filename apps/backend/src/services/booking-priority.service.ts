import { BookingStatus, QueuePriority } from "@prisma/client";
import prisma from "../lib/prisma";
import { resolveTierPriorityScore } from "../lib/membership-tiers";
import { fromWaitTimeMsBigInt, toWaitTimeMsBigInt } from "../lib/wait-time-ms";
import { type Entitlements } from "./entitlement.service";
import { pendingNoPaymentFollowUpIds } from "./booking-payment-gate";

const PENDING_STATUSES: BookingStatus[] = ["PENDING"];

/**
 * Priority Queue Engine — premium bookings get HIGH priority and are
 * served before NORMAL bookings when providers are assigned.
 */
export class BookingPriorityService {
  resolvePriorityScore(entitlements?: Entitlements | null): number {
    return resolveTierPriorityScore(entitlements?.tier);
  }

  resolvePriority(userId: string, entitlements?: Entitlements) {
    const e = entitlements;
    const score = this.resolvePriorityScore(e);
    return score >= 60 || e?.priorityBooking || e?.hasMembership
      ? QueuePriority.HIGH
      : QueuePriority.NORMAL;
  }

  async estimateWaitTimeMs(priority: QueuePriority): Promise<number> {
    const [avgRow, pendingAhead] = await Promise.all([
      prisma.booking.aggregate({
        where: { queuePriority: priority, waitTimeMs: { not: null } },
        _avg: { waitTimeMs: true },
      }),
      prisma.booking.count({
        where: {
          status: { in: PENDING_STATUSES },
          providerId: null,
          queuePriority: priority,
        },
      }),
    ]);
    const baseAvg = Math.round(
      fromWaitTimeMsBigInt(avgRow._avg.waitTimeMs) ??
        (priority === QueuePriority.HIGH ? 5 * 60_000 : 18 * 60_000),
    );
    return baseAvg * Math.max(1, pendingAhead + 1);
  }

  /** Enqueue a booking and assign its queue position (server-side). */
  async enqueue(
    bookingId: string,
    priority: QueuePriority,
    priorityScore: number,
  ): Promise<{ queuePosition: number; estimatedWaitTimeMs: number }> {
    const now = new Date();
    const estimatedWaitTimeMs = await this.estimateWaitTimeMs(priority);
    const pendingWhere = {
      status: { in: PENDING_STATUSES },
      providerId: null,
      id: { not: bookingId },
    } as const;

    /**
     * One grouped count instead of one or two separate ones: a NORMAL booking needs both the HIGH
     * and the NORMAL backlog, which used to be two sequential round trips on the booking-creation
     * path. Backed by the partial index `bookings_queue_pending_idx`
     * (migration 20260920110000), so this reads only pending unassigned rows rather than the table.
     */
    const grouped = await prisma.booking.groupBy({
      by: ["queuePriority"],
      where: pendingWhere,
      _count: { _all: true },
    });
    const ahead = (p: QueuePriority) =>
      grouped.find((g) => g.queuePriority === p)?._count._all ?? 0;
    const queuePosition =
      priority === QueuePriority.HIGH
        ? ahead(QueuePriority.HIGH) + 1
        : ahead(QueuePriority.HIGH) + ahead(QueuePriority.NORMAL) + 1;

    await prisma.booking.update({
      where: { id: bookingId },
      data: {
        queuePriority: priority,
        queuePosition,
        priorityScore,
        estimatedWaitTimeMs: toWaitTimeMsBigInt(estimatedWaitTimeMs),
        queuedAt: now,
        priorityServed: priority === QueuePriority.HIGH,
      },
    });

    return { queuePosition, estimatedWaitTimeMs };
  }

  /** Ordered queue for provider assignment — HIGH priority first, then FIFO. */
  /**
   * `dispatchableOnly` (the dispatcher): only PAID bookings. An unpaid booking cannot be offered
   * (dispatchToNextProvider withholds it without spending an attempt), so it never reached
   * EXHAUSTED — and with oldest-first ordering, MAX_DISPATCH_PER_TICK unpaid bookings at the front
   * took every slot of every tick while paid bookings behind them waited on the inline dispatch
   * alone. Payment settlement re-dispatches immediately (onBookingPaymentSettled), so nothing is
   * lost by leaving unpaid work out of the cron scan. The admin queue view still sees everything.
   */
  async getAssignmentQueue(limit = 50, opts: { dispatchableOnly?: boolean } = {}) {
    const rows = await prisma.booking.findMany({
      where: {
        status: { in: PENDING_STATUSES },
        providerId: null,
        // §11: plus case-created follow-ups whose fee was waived — they owe nothing and are never marked paid.
        ...(opts.dispatchableOnly
          ? { OR: [{ paymentStatus: "SUCCESS" as const }, { id: { in: await pendingNoPaymentFollowUpIds(limit) } }] }
          : {}),
        /**
         * A booking whose AssignmentJob already reached EXHAUSTED needs a human, not another
         * automatic retry — that is the entire point of the EXHAUSTED status. But this query has
         * no other awareness of AssignmentJob at all: reaching EXHAUSTED does not touch the
         * booking row (status stays PENDING, providerId stays null), so without this exclusion an
         * exhausted booking occupies a `take: limit` slot in this FIFO forever. With the cron
         * processing at most `limit` items per tick, enough exhausted bookings accumulate at the
         * front of the queue (oldest-first) to consume the entire tick's budget on jobs that were
         * never going to be dispatched — starving every genuinely-retriable booking behind them,
         * including brand new ones.
         */
        assignmentJob: { isNot: { status: "EXHAUSTED" } },
      },
      orderBy: [{ priorityScore: "desc" }, { queuePriority: "asc" }, { queuedAt: "asc" }],
      take: limit,
      include: {
        user: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
    });

    return rows.map((b, idx) => ({
      bookingId: b.id,
      bookingNumber: b.bookingNumber,
      position: idx + 1,
      queuePriority: b.queuePriority.toLowerCase(),
      queuePosition: b.queuePosition,
      priorityScore: b.priorityScore,
      estimatedWaitTimeMs: fromWaitTimeMsBigInt(b.estimatedWaitTimeMs),
      queuedAt: b.queuedAt,
      waitTimeMs: b.queuedAt ? Date.now() - b.queuedAt.getTime() : null,
      user: `${b.user.firstName} ${b.user.lastName}`,
      service: b.service.name,
      scheduledDate: b.scheduledDate,
    }));
  }

  /** Record queue wait time when a provider accepts (status set by booking-live). */
  async recordAssignmentWait(bookingId: string) {
    const booking = await prisma.booking.findUnique({ where: { id: bookingId } });
    if (!booking) return null;

    const assignedAt = new Date();
    const waitTimeMs = booking.queuedAt
      ? toWaitTimeMsBigInt(assignedAt.getTime() - booking.queuedAt.getTime())
      : null;

    return prisma.booking.update({
      where: { id: bookingId },
      data: { assignedAt, waitTimeMs },
    });
  }

  /** @deprecated Use recordAssignmentWait — assignment status is ACCEPTED via booking-live. */
  async markAssigned(bookingId: string, _providerId: string) {
    return this.recordAssignmentWait(bookingId);
  }

  async adminQueueAnalytics() {
    const pending = await prisma.booking.findMany({
      where: { status: { in: PENDING_STATUSES }, providerId: null },
      select: {
        queuePriority: true,
        priorityScore: true,
        queuedAt: true,
        waitTimeMs: true,
        estimatedWaitTimeMs: true,
      },
    });

    const high = pending.filter((b) => b.queuePriority === QueuePriority.HIGH);
    const normal = pending.filter((b) => b.queuePriority === QueuePriority.NORMAL);

    const avgWait = (rows: typeof pending) => {
      const times = rows
        .map((b) => (b.queuedAt ? Date.now() - b.queuedAt.getTime() : fromWaitTimeMsBigInt(b.waitTimeMs)))
        .filter((t): t is number => t != null);
      return times.length ? Math.round(times.reduce((a, c) => a + c, 0) / times.length) : 0;
    };

    const byMembership = pending.reduce<Record<string, number>>((acc, b) => {
      const bucket =
        b.priorityScore >= 100 ? "platinum" : b.priorityScore >= 80 ? "gold" : b.priorityScore >= 60 ? "silver" : "free";
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    }, {});

    const [assignedHigh, assignedNormal] = await Promise.all([
      prisma.booking.aggregate({
        where: { queuePriority: QueuePriority.HIGH, assignedAt: { not: null } },
        _avg: { waitTimeMs: true },
        _count: true,
      }),
      prisma.booking.aggregate({
        where: { queuePriority: QueuePriority.NORMAL, assignedAt: { not: null } },
        _avg: { waitTimeMs: true },
        _count: true,
      }),
    ]);

    return {
      pendingHigh: high.length,
      pendingNormal: normal.length,
      avgWaitHighMs: avgWait(high),
      avgWaitNormalMs: avgWait(normal),
      historicalAvgWaitHighMs: Math.round(fromWaitTimeMsBigInt(assignedHigh._avg.waitTimeMs) ?? 0),
      historicalAvgWaitNormalMs: Math.round(fromWaitTimeMsBigInt(assignedNormal._avg.waitTimeMs) ?? 0),
      totalAssignedHigh: assignedHigh._count,
      totalAssignedNormal: assignedNormal._count,
      queueByMembership: byMembership,
      averageWaitTimeMs: avgWait(pending),
    };
  }

  async adminPriorityAnalytics() {
    const [served, totalHigh, totalNormal] = await Promise.all([
      prisma.booking.count({ where: { priorityServed: true } }),
      prisma.booking.count({ where: { queuePriority: QueuePriority.HIGH } }),
      prisma.booking.count({ where: { queuePriority: QueuePriority.NORMAL } }),
    ]);

    return {
      priorityServedCount: served,
      highPriorityBookings: totalHigh,
      normalPriorityBookings: totalNormal,
      premiumSharePct: totalHigh + totalNormal > 0 ? Math.round((totalHigh / (totalHigh + totalNormal)) * 100) : 0,
    };
  }
}

export const bookingPriorityService = new BookingPriorityService();
