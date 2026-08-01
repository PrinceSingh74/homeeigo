import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import { redisClient } from "../lib/redis";
import { bookingPriorityService } from "./booking-priority.service";
import { matchingService } from "./matching.service";
import { createWsEnvelope, pushToUser } from "./notification-hub";
import { notificationService } from "./notification.service";
import { incCounter } from "../lib/metrics";
import { fromWaitTimeMsBigInt } from "../lib/wait-time-ms";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildPartnerDispatchedEvent } from "../events/catalog/partner.events";

const DISPATCH_TIMEOUT_MS = Number(process.env.ASSIGNMENT_DISPATCH_TIMEOUT_MS || 300_000);
const MAX_DISPATCH_PER_TICK = Number(process.env.ASSIGNMENT_MAX_PER_TICK || 10);
// Broadcast dispatch: offer a booking to ALL eligible providers at once (first to accept wins)
// instead of a single sequential offer — so every qualified partner sees it in their requests
// feed. Set ASSIGNMENT_BROADCAST=false to revert to legacy single-offer.
const BROADCAST_DISPATCH = process.env.ASSIGNMENT_BROADCAST !== "false";
const BROADCAST_FANOUT = Number(process.env.ASSIGNMENT_BROADCAST_FANOUT || 25);
const LOCK_KEY = "assignment:processor";
const LOCK_TTL_SEC = 25;

/**
 * Automatic provider dispatch engine — drains the priority queue, notifies
 * providers, tracks responses, and auto-reassigns on reject/timeout.
 */
export class AssignmentEngine {
  /** Create a dispatch job when a booking enters the queue without a provider. */
  async createJob(bookingId: string) {
    const existing = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (existing) return existing;

    const job = await prisma.assignmentJob.create({
      data: { bookingId, status: AssignmentJobStatus.PENDING },
    });
    await this.audit(job.id, "JOB_CREATED", { bookingId });
    return job;
  }

  /** Dispatch immediately on booking create — cron remains as backup/reassign. */
  async dispatchBookingNow(bookingId: string): Promise<boolean> {
    let job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) job = await this.createJob(bookingId);

    if (
      job.status !== AssignmentJobStatus.PENDING &&
      job.status !== AssignmentJobStatus.REASSIGNED &&
      job.status !== AssignmentJobStatus.TIMEOUT
    ) {
      return false;
    }
    if (job.dispatchAttempts >= job.maxAttempts) return false;

    return this.dispatchToNextProvider(job.id);
  }

  /** Cron entry point — idempotent, distributed-lock safe. */
  async processQueue(): Promise<{ processed: number; dispatched: number }> {
    const token = randomUUID();
    const acquired = await redisClient.acquireLock(LOCK_KEY, token, LOCK_TTL_SEC);
    if (!acquired) return { processed: 0, dispatched: 0 };

    let processed = 0;
    let dispatched = 0;
    try {
      await this.handleTimeouts();

      const queue = await bookingPriorityService.getAssignmentQueue(MAX_DISPATCH_PER_TICK);
      for (const item of queue) {
        const job = await prisma.assignmentJob.findUnique({ where: { bookingId: item.bookingId } });
        if (!job) {
          await this.createJob(item.bookingId);
        }
        const activeJob = await prisma.assignmentJob.findUnique({ where: { bookingId: item.bookingId } });
        if (!activeJob) continue;
        if (
          activeJob.status !== AssignmentJobStatus.PENDING &&
          activeJob.status !== AssignmentJobStatus.REASSIGNED &&
          activeJob.status !== AssignmentJobStatus.TIMEOUT
        ) {
          continue;
        }
        if (activeJob.dispatchAttempts >= activeJob.maxAttempts) {
          await prisma.assignmentJob.update({
            where: { id: activeJob.id },
            data: { status: AssignmentJobStatus.EXHAUSTED },
          });
          await this.audit(activeJob.id, "EXHAUSTED", {});
          continue;
        }

        const sent = await this.dispatchToNextProvider(activeJob.id);
        processed++;
        if (sent) dispatched++;
      }
    } finally {
      await redisClient.releaseLock(LOCK_KEY, token);
    }
    return { processed, dispatched };
  }

  private async handleTimeouts() {
    const now = new Date();
    const expired = await prisma.assignmentJob.findMany({
      where: {
        status: AssignmentJobStatus.DISPATCHED,
        timeoutAt: { lte: now },
      },
      take: 20,
    });

    for (const job of expired) {
      await prisma.$transaction(async (tx) => {
        const booking = await tx.booking.findUnique({
          where: { id: job.bookingId },
          select: { status: true, providerId: true },
        });

        // Booking already claimed (e.g. partner accepted) — close the job without
        // clearing provider_id (prevents ACCEPTED + vendor=null corruption).
        if (booking && booking.status !== BookingStatus.PENDING) {
          const attempt = await tx.assignmentAttempt.findFirst({
            where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
            orderBy: { dispatchedAt: "desc" },
          });
          if (attempt && booking.providerId) {
            await tx.assignmentAttempt.update({
              where: { id: attempt.id },
              data: {
                status: AssignmentAttemptStatus.ACCEPTED,
                respondedAt: now,
                responseMs: now.getTime() - attempt.dispatchedAt.getTime(),
              },
            });
          }
          await tx.assignmentJob.update({
            where: { id: job.id },
            data: {
              status: AssignmentJobStatus.ACCEPTED,
              acceptedAt: now,
              timeoutAt: null,
              currentProviderId: booking.providerId,
            },
          });
          await tx.assignmentAudit.create({
            data: {
              jobId: job.id,
              action: "ACCEPT",
              details: JSON.stringify({ providerId: booking.providerId, via: "timeout_skip" }),
            },
          });
          return;
        }

        // Broadcast: expire ALL pending offers for this job (not just one) so every provider's
        // requests feed clears when the window lapses with no acceptance.
        await tx.assignmentAttempt.updateMany({
          where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
          data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: now },
        });
        incCounter("dispatch_timeout_total");
        await tx.assignmentJob.update({
          where: { id: job.id },
          data: {
            status: AssignmentJobStatus.REASSIGNED,
            currentProviderId: null,
            timeoutAt: null,
            autoReassignCount: { increment: 1 },
          },
        });
        // Release the tentative assignment so the next dispatch can claim it
        // (only un-accepted PENDING bookings reach here).
        await tx.booking.updateMany({
          where: { id: job.bookingId, status: BookingStatus.PENDING },
          data: { providerId: null },
        });
        await tx.assignmentAudit.create({
          data: { jobId: job.id, action: "TIMEOUT", details: JSON.stringify({ bookingId: job.bookingId, expiredAllOffers: true }) },
        });
      });
    }
  }

  private async dispatchToNextProvider(jobId: string): Promise<boolean> {
    const job = await prisma.assignmentJob.findUnique({
      where: { id: jobId },
      include: {
        booking: {
          include: {
            user: true,
            service: true,
            address: true,
          },
        },
        attempts: { select: { providerId: true } },
      },
    });
    if (!job?.booking) return false;
    const booking = job.booking;

    if (booking.providerId || booking.status !== BookingStatus.PENDING) {
      await prisma.assignmentJob.update({
        where: { id: jobId },
        data: { status: AssignmentJobStatus.CANCELLED },
      });
      return false;
    }

    const lat = booking.address?.latitude ?? 19.076;
    const lng = booking.address?.longitude ?? 72.8777;
    const excluded = job.attempts.map((a) => a.providerId);

    const matches = await matchingService.findBestProviders({
      serviceId: booking.serviceId,
      customerId: booking.userId,
      latitude: lat,
      longitude: lng,
      scheduledDate: booking.scheduledDate,
      maxResults: 15,
    });

    const eligible = matches
      .filter((m) => !excluded.includes(m.providerId))
      .sort((a, b) => b.totalScore - a.totalScore);

    if (eligible.length === 0) {
      await this.audit(jobId, "NO_PROVIDER", {
        serviceId: booking.serviceId,
        matchCount: matches.length,
        excludedCount: excluded.length,
      });
      return false;
    }

    // Offer to ALL eligible providers at once (broadcast) so every qualified partner sees the
    // request. The booking stays PENDING (providerId null) during the offer window; the FIRST
    // provider to accept claims it under the Serializable accept + slot-exclusion lock
    // (resolveAcceptingProvider). Legacy single-offer when ASSIGNMENT_BROADCAST=false.
    const now = new Date();
    const timeoutAt = new Date(now.getTime() + DISPATCH_TIMEOUT_MS);
    const targets = BROADCAST_DISPATCH ? eligible.slice(0, BROADCAST_FANOUT) : eligible.slice(0, 1);

    const offeredProviderIds: string[] = [];
    for (const candidate of targets) {
      const provider = await prisma.provider.findUnique({
        where: { id: candidate.providerId },
        include: { user: true },
      });
      if (!provider) continue;

      try {
        await prisma.$transaction(async (tx) => {
          await tx.assignmentAttempt.create({
            data: { jobId, providerId: provider.id, status: AssignmentAttemptStatus.SENT, dispatchedAt: now },
          });
          if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
            await emitInTransaction(
              tx,
              buildPartnerDispatchedEvent({
                providerId: provider.id,
                bookingId: booking.id,
                jobId,
                dispatchedAt: now,
                serviceId: booking.serviceId,
              }),
            );
          }
        });
      } catch (err) {
        // Already offered to this provider for this job — skip, keep broadcasting.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
      offeredProviderIds.push(provider.id);
      incCounter("dispatch_attempts_total");

      await notificationService.sendNotification(provider.userId, "BOOKING_REQUEST", {
        title: "New Booking Request",
        body: `${booking.user.firstName} wants ${booking.service.name}`,
        sound: "notification_high",
        referenceId: booking.id,
        referenceType: "booking",
        actions: [
          { action: "accept", title: "Accept" },
          { action: "reject", title: "Reject" },
        ],
        data: {
          bookingId: booking.id,
          price: booking.finalAmount,
          customerName: `${booking.user.firstName} ${booking.user.lastName}`,
          serviceName: booking.service.name,
          assignmentJobId: jobId,
        },
      });

      pushToUser(
        provider.userId,
        createWsEnvelope(
          "booking_dispatched",
          { bookingId: booking.id, providerId: provider.id, serviceName: booking.service.name, status: "PENDING" },
          booking.id,
        ),
      );
    }

    if (offeredProviderIds.length === 0) {
      await this.audit(jobId, "NO_PROVIDER", {
        serviceId: booking.serviceId,
        matchCount: matches.length,
        excludedCount: excluded.length,
        reason: "no_offerable_provider",
      });
      return false;
    }

    await prisma.assignmentJob.update({
      where: { id: jobId },
      data: {
        status: AssignmentJobStatus.DISPATCHED,
        currentProviderId: offeredProviderIds[0],
        dispatchAttempts: { increment: 1 },
        lastDispatchedAt: now,
        timeoutAt,
      },
    });
    await this.audit(jobId, "DISPATCH", {
      broadcast: BROADCAST_DISPATCH,
      offered: offeredProviderIds.length,
      providerIds: offeredProviderIds,
      topScore: eligible[0]?.totalScore,
      bookingPriority: booking.priorityScore,
    });
    return true;
  }

  /** Provider accepted — wire from booking-live. */
  async onProviderAccepted(bookingId: string, providerId: string) {
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) return;

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const attempt = await tx.assignmentAttempt.findFirst({
        where: { jobId: job.id, providerId, status: AssignmentAttemptStatus.SENT },
        orderBy: { dispatchedAt: "desc" },
      });
      if (attempt) {
        await tx.assignmentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: AssignmentAttemptStatus.ACCEPTED,
            respondedAt: now,
            responseMs: now.getTime() - attempt.dispatchedAt.getTime(),
          },
        });
      }
      // Broadcast: the moment one provider accepts, expire every OTHER pending offer so the
      // (now-claimed) booking disappears from the other partners' requests feeds.
      await tx.assignmentAttempt.updateMany({
        where: { jobId: job.id, status: AssignmentAttemptStatus.SENT, providerId: { not: providerId } },
        data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: now },
      });
      await tx.assignmentJob.update({
        where: { id: job.id },
        data: {
          status: AssignmentJobStatus.ACCEPTED,
          acceptedAt: now,
          currentProviderId: providerId,
          timeoutAt: null,
        },
      });
      await tx.assignmentAudit.create({
        data: { jobId: job.id, action: "ACCEPT", details: JSON.stringify({ providerId, broadcast: BROADCAST_DISPATCH }) },
      });
    });

    incCounter("dispatch_success_total");
    incCounter("booking_assigned_total");
    await bookingPriorityService.recordAssignmentWait(bookingId);
    void this.refreshProviderAcceptanceRate(providerId);
  }

  /** Provider rejected — auto-reassign on next cron tick. */
  async onProviderRejected(bookingId: string, providerId: string, reason?: string) {
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) return;

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const attempt = await tx.assignmentAttempt.findFirst({
        where: { jobId: job.id, providerId, status: AssignmentAttemptStatus.SENT },
        orderBy: { dispatchedAt: "desc" },
      });
      if (attempt) {
        await tx.assignmentAttempt.update({
          where: { id: attempt.id },
          data: {
            status: AssignmentAttemptStatus.REJECTED,
            respondedAt: now,
            responseMs: now.getTime() - attempt.dispatchedAt.getTime(),
          },
        });
      }
      await tx.assignmentJob.update({
        where: { id: job.id },
        data: {
          status: AssignmentJobStatus.REASSIGNED,
          currentProviderId: null,
          timeoutAt: null,
          autoReassignCount: { increment: 1 },
        },
      });
      // Release the tentative assignment ONLY if this provider still holds it and
      // the booking is unclaimed — never disturb a booking already accepted elsewhere.
      await tx.booking.updateMany({ where: { id: bookingId, providerId, status: "PENDING" }, data: { providerId: null } });
      await tx.assignmentAudit.create({
        data: { jobId: job.id, action: "REJECT", details: JSON.stringify({ providerId, reason }) },
      });
    });
    void this.refreshProviderAcceptanceRate(providerId);
  }

  /** Booking cancelled by customer or provider — close open dispatch. */
  async onBookingCancelled(bookingId: string) {
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) return;

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const openAttempt = await tx.assignmentAttempt.findFirst({
        where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
        orderBy: { dispatchedAt: "desc" },
      });
      if (openAttempt) {
        await tx.assignmentAttempt.update({
          where: { id: openAttempt.id },
          data: {
            status: AssignmentAttemptStatus.TIMEOUT,
            respondedAt: now,
            responseMs: now.getTime() - openAttempt.dispatchedAt.getTime(),
          },
        });
      }
      await tx.assignmentJob.update({
        where: { id: job.id },
        data: {
          status: AssignmentJobStatus.CANCELLED,
          currentProviderId: null,
          timeoutAt: null,
        },
      });
      await tx.assignmentAudit.create({
        data: { jobId: job.id, action: "CANCEL", details: JSON.stringify({ bookingId }) },
      });
    });
  }

  private async audit(jobId: string, action: string, details: Record<string, unknown>) {
    await prisma.assignmentAudit.create({
      data: { jobId, action, details: JSON.stringify(details) },
    });
  }

  /** Keep providers.acceptance_rate aligned with live dispatch outcomes (30d window). */
  private async refreshProviderAcceptanceRate(providerId: string) {
    const since = new Date(Date.now() - 30 * 24 * 3600_000);
    const [accepted, rejected] = await Promise.all([
      prisma.assignmentAttempt.count({
        where: { providerId, status: AssignmentAttemptStatus.ACCEPTED, dispatchedAt: { gte: since } },
      }),
      prisma.assignmentAttempt.count({
        where: {
          providerId,
          status: { in: [AssignmentAttemptStatus.REJECTED, AssignmentAttemptStatus.TIMEOUT] },
          dispatchedAt: { gte: since },
        },
      }),
    ]);
    const total = accepted + rejected;
    const rate = total > 0 ? Math.round((accepted / total) * 10000) / 100 : 100;
    await prisma.provider
      .update({
        where: { id: providerId },
        data: { acceptanceRate: rate, rejectedBookings: rejected },
      })
      .catch(() => {});
  }

  /** Admin dispatch metrics + assignment funnel. */
  async dispatchMetrics() {
    const [
      totalJobs,
      pending,
      dispatched,
      accepted,
      exhausted,
      attempts,
      avgDispatch,
      avgQueueWait,
      autoReassigns,
      acceptanceAttempts,
    ] = await Promise.all([
      prisma.assignmentJob.count(),
      prisma.assignmentJob.count({ where: { status: AssignmentJobStatus.PENDING } }),
      prisma.assignmentJob.count({ where: { status: AssignmentJobStatus.DISPATCHED } }),
      prisma.assignmentJob.count({ where: { status: AssignmentJobStatus.ACCEPTED } }),
      prisma.assignmentJob.count({ where: { status: AssignmentJobStatus.EXHAUSTED } }),
      prisma.assignmentAttempt.count(),
      prisma.assignmentJob.aggregate({
        where: { lastDispatchedAt: { not: null } },
        _avg: { dispatchAttempts: true },
      }),
      prisma.booking.aggregate({
        where: { waitTimeMs: { not: null } },
        _avg: { waitTimeMs: true },
      }),
      prisma.assignmentJob.aggregate({ _sum: { autoReassignCount: true } }),
      prisma.assignmentAttempt.groupBy({
        by: ["status"],
        _count: true,
      }),
    ]);

    const sent = acceptanceAttempts.find((a) => a.status === AssignmentAttemptStatus.SENT)?._count ?? 0;
    const acceptedCount =
      acceptanceAttempts.find((a) => a.status === AssignmentAttemptStatus.ACCEPTED)?._count ?? 0;
    const totalResponses = attempts - sent;
    const acceptanceRate =
      totalResponses > 0 ? Math.round((acceptedCount / totalResponses) * 1000) / 10 : 0;

    const dispatchTimes = await prisma.assignmentAttempt.findMany({
      where: { responseMs: { not: null } },
      select: { responseMs: true },
      take: 500,
      orderBy: { dispatchedAt: "desc" },
    });
    const avgDispatchTimeMs =
      dispatchTimes.length > 0
        ? Math.round(
            dispatchTimes.reduce((s, a) => s + (a.responseMs ?? 0), 0) / dispatchTimes.length,
          )
        : 0;

    return {
      queueHealth: {
        pendingJobs: pending,
        inFlight: dispatched,
        acceptedJobs: accepted,
        exhaustedJobs: exhausted,
        totalJobs,
      },
      dispatchMetrics: {
        dispatchAttempts: attempts,
        avgDispatchAttemptsPerJob: Math.round(avgDispatch._avg.dispatchAttempts ?? 0),
        acceptanceRatePct: acceptanceRate,
        averageDispatchTimeMs: avgDispatchTimeMs,
        queueWaitTimeMs: Math.round(fromWaitTimeMsBigInt(avgQueueWait._avg.waitTimeMs) ?? 0),
        autoReassignCount: autoReassigns._sum.autoReassignCount ?? 0,
      },
      assignmentFunnel: {
        created: totalJobs,
        dispatched: await prisma.assignmentJob.count({
          where: { dispatchAttempts: { gt: 0 } },
        }),
        accepted,
        exhausted,
        conversionPct:
          totalJobs > 0 ? Math.round((accepted / totalJobs) * 1000) / 10 : 0,
      },
    };
  }
}

function isProviderSlotConflict(err: unknown): boolean {
  const text = err instanceof Error ? `${err.message} ${String(err)}` : String(err);
  return text.includes("bookings_provider_slot_excl") || text.includes("23P01");
}

export const assignmentEngine = new AssignmentEngine();
