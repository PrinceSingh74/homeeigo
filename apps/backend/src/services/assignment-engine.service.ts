import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
} from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import { redisClient } from "../lib/redis";
import { bookingPriorityService } from "./booking-priority.service";
import { matchingService } from "./matching.service";
import { notificationService } from "./notification.service";

const DISPATCH_TIMEOUT_MS = Number(process.env.ASSIGNMENT_DISPATCH_TIMEOUT_MS || 120_000);
const MAX_DISPATCH_PER_TICK = Number(process.env.ASSIGNMENT_MAX_PER_TICK || 10);
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
        const attempt = await tx.assignmentAttempt.findFirst({
          where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
          orderBy: { dispatchedAt: "desc" },
        });
        if (attempt) {
          const responseMs = Date.now() - attempt.dispatchedAt.getTime();
          await tx.assignmentAttempt.update({
            where: { id: attempt.id },
            data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: now, responseMs },
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
        await tx.assignmentAudit.create({
          data: { jobId: job.id, action: "TIMEOUT", details: JSON.stringify({ attemptId: attempt?.id }) },
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

    const candidate = matches.find((m) => m.availability && !excluded.includes(m.providerId));
    if (!candidate) {
      await this.audit(jobId, "NO_PROVIDER", { serviceId: booking.serviceId });
      return false;
    }

    const provider = await prisma.provider.findUnique({
      where: { id: candidate.providerId },
      include: { user: true },
    });
    if (!provider) return false;

    const now = new Date();
    const timeoutAt = new Date(now.getTime() + DISPATCH_TIMEOUT_MS);

    await prisma.$transaction(async (tx) => {
      await tx.assignmentAttempt.create({
        data: {
          jobId,
          providerId: provider.id,
          status: AssignmentAttemptStatus.SENT,
          dispatchedAt: now,
        },
      });
      await tx.assignmentJob.update({
        where: { id: jobId },
        data: {
          status: AssignmentJobStatus.DISPATCHED,
          currentProviderId: provider.id,
          dispatchAttempts: { increment: 1 },
          lastDispatchedAt: now,
          timeoutAt,
        },
      });
      await tx.assignmentAudit.create({
        data: {
          jobId,
          action: "DISPATCH",
          details: JSON.stringify({
            providerId: provider.id,
            score: candidate.totalScore,
            bookingPriority: booking.priorityScore,
          }),
        },
      });
    });

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
      await tx.assignmentJob.update({
        where: { id: job.id },
        data: {
          status: AssignmentJobStatus.ACCEPTED,
          acceptedAt: now,
          timeoutAt: null,
        },
      });
      await tx.assignmentAudit.create({
        data: { jobId: job.id, action: "ACCEPT", details: JSON.stringify({ providerId }) },
      });
    });

    await bookingPriorityService.recordAssignmentWait(bookingId);
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
      await tx.assignmentAudit.create({
        data: { jobId: job.id, action: "REJECT", details: JSON.stringify({ providerId, reason }) },
      });
    });
  }

  private async audit(jobId: string, action: string, details: Record<string, unknown>) {
    await prisma.assignmentAudit.create({
      data: { jobId, action, details: JSON.stringify(details) },
    });
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
        queueWaitTimeMs: Math.round(avgQueueWait._avg.waitTimeMs ?? 0),
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

export const assignmentEngine = new AssignmentEngine();
