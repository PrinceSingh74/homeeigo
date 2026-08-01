import { BookingStatus, QueuePriority } from "@prisma/client";
import prisma from "../lib/prisma";
import { resolveTierPriorityScore } from "../lib/membership-tiers";
import { fromWaitTimeMsBigInt, toWaitTimeMsBigInt } from "../lib/wait-time-ms";
import { entitlementService, type Entitlements } from "./entitlement.service";

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

    let queuePosition: number;
    if (priority === QueuePriority.HIGH) {
      queuePosition =
        (await prisma.booking.count({
          where: { ...pendingWhere, queuePriority: QueuePriority.HIGH },
        })) + 1;
    } else {
      const highCount = await prisma.booking.count({
        where: { ...pendingWhere, queuePriority: QueuePriority.HIGH },
      });
      const normalAhead = await prisma.booking.count({
        where: { ...pendingWhere, queuePriority: QueuePriority.NORMAL },
      });
      queuePosition = highCount + normalAhead + 1;
    }

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
  async getAssignmentQueue(limit = 50) {
    const rows = await prisma.booking.findMany({
      where: {
        status: { in: PENDING_STATUSES },
        providerId: null,
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
