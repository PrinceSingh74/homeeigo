import {
  AssignmentAttemptStatus,
  AssignmentJobStatus,
  BookingStatus,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
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
import { partnerOperationsService } from "./partner-operations.service";

const DISPATCH_TIMEOUT_MS = Number(process.env.ASSIGNMENT_DISPATCH_TIMEOUT_MS || 300_000);
const MAX_DISPATCH_PER_TICK = Number(process.env.ASSIGNMENT_MAX_PER_TICK || 10);
// Broadcast dispatch: offer a booking to ALL eligible providers at once (first to accept wins)
// instead of a single sequential offer — so every qualified partner sees it in their requests
// feed. Set ASSIGNMENT_BROADCAST=false to revert to legacy single-offer.
const BROADCAST_DISPATCH = process.env.ASSIGNMENT_BROADCAST !== "false";
const BROADCAST_FANOUT = Number(process.env.ASSIGNMENT_BROADCAST_FANOUT || 25);
const LOCK_KEY = "assignment:processor";
const LOCK_TTL_SEC = 25;
/** Interactive tx must survive pool wait under connection_limit=8; Prisma default timeout is 5s. */
const TX_OPTS = { maxWait: 20_000, timeout: 30_000 } as const;
/**
 * Burst `booking.create` fire-and-forget dispatch used to spawn one interactive tx per
 * booking with no cap. Twenty concurrent creates (chaos-10) exhausts the documented
 * pool-8 contract (P2024). Semantics unchanged: 201 still returns immediately; cron
 * still heals PENDING jobs. Only in-flight fan-out is bounded.
 */
const MAX_INLINE_DISPATCH = 2;

/**
 * Automatic provider dispatch engine — drains the priority queue, notifies
 * providers, tracks responses, and auto-reassigns on reject/timeout.
 */
export class AssignmentEngine {
  private inlineSlots = MAX_INLINE_DISPATCH;
  private readonly inlineWaiters: Array<() => void> = [];

  private async acquireInlineSlot(): Promise<void> {
    if (this.inlineSlots > 0) {
      this.inlineSlots -= 1;
      return;
    }
    await new Promise<void>((resolve) => this.inlineWaiters.push(resolve));
  }

  private releaseInlineSlot(): void {
    const next = this.inlineWaiters.shift();
    if (next) next();
    else this.inlineSlots += 1;
  }

  /**
   * Non-blocking dispatch for booking create / reject. At most MAX_INLINE_DISPATCH
   * run at once so a create burst cannot saturate connection_limit=8.
   */
  dispatchBookingNowBackground(bookingId: string): void {
    void this.acquireInlineSlot()
      .then(() => this.dispatchBookingNow(bookingId))
      .catch((err: unknown) => {
        incCounter("assignment_inline_dispatch_failed_total");
        logger.error("assignment_inline_dispatch_failed", {
          bookingId,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
        });
      })
      .finally(() => this.releaseInlineSlot());
  }

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
    // Leave headroom before lock TTL so finally{releaseLock} always runs under dirty-queue load
    // (combined suite can otherwise run past LOCK_TTL / test timeouts and leak the in-memory lock).
    const tickDeadlineMs = Date.now() + Math.max(5_000, (LOCK_TTL_SEC - 5) * 1000);
    try {
      await this.handleTimeouts();

      const queue = await bookingPriorityService.getAssignmentQueue(MAX_DISPATCH_PER_TICK);
      for (const item of queue) {
        if (Date.now() >= tickDeadlineMs) {
          logger.warn("assignment_process_queue_tick_deadline", {
            processed,
            dispatched,
            remaining: queue.length,
          });
          break;
        }
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

        /**
         * A throw from one job must not abort the rest of this tick's queue.
         *
         * `dispatchToNextProvider` has no internal catch, so an error anywhere past its per-
         * candidate transaction (notification send, WS push, the final job-status update)
         * previously propagated straight out of this `for` loop — silently ending the tick and
         * leaving every remaining queued booking, however old, unprocessed until the next run.
         * That is a direct, compounding contributor to queue starvation: the older a stuck job,
         * the more chances it has had to be the one that aborts everyone behind it.
         */
        try {
          // Extend TTL only while we still own the key. acquireLock is SET NX and
          // must not be used here — it cannot refresh Redis EX, and the in-memory
          // fallback would re-take a lock another tick (or a test reset) already dropped.
          const stillLeader = await redisClient.refreshLock(LOCK_KEY, token, LOCK_TTL_SEC);
          if (!stillLeader) break;
          const sent = await this.dispatchToNextProvider(activeJob.id);
          processed++;
          if (sent) dispatched++;
        } catch (err) {
          incCounter("assignment_dispatch_tick_error_total");
          logger.error("assignment_dispatch_tick_failed", {
            jobId: activeJob.id,
            bookingId: item.bookingId,
            error: err instanceof Error ? err.message : String(err),
            stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
          });
        }
      }
    } catch (err) {
      // Pool exhaustion (P2024) during queue load / timeout handling must not crash the tick —
      // cron retries; aborting mid-suite under connection_limit=8 left chaos-10 uncaught.
      incCounter("assignment_dispatch_tick_error_total");
      logger.error("assignment_process_queue_failed", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
        processed,
        dispatched,
      });
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
      }, TX_OPTS);
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
      /**
       * A no-candidate outcome is still an attempt. Left uncounted, a job whose entire matching
       * pool has already declined returns NO_PROVIDER on every cron tick forever — dispatchAttempts
       * stays 0, so `dispatchAttempts >= maxAttempts` (the only path to EXHAUSTED) can never fire,
       * and the job occupies a getAssignmentQueue() slot permanently. With a strict oldest-first
       * FIFO and no other eviction, enough of these accumulate to starve every booking behind them.
       * EXHAUSTED does not cancel the booking — it only stops silent retry and raises an ops alert
       * for manual reassignment, so counting this path is safe.
       */
      await prisma.assignmentJob.update({
        where: { id: jobId },
        data: { dispatchAttempts: { increment: 1 } },
      });
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
          const stillThere = await tx.assignmentJob.findUnique({
            where: { id: jobId },
            select: { id: true },
          });
          if (!stillThere) {
            throw new Error("SKIP_OFFER:JOB_GONE");
          }
          const blocked = await partnerOperationsService.assertOfferEligible(tx, provider.id, {
            latitude: lat,
            longitude: lng,
            scheduledDate: booking.scheduledDate,
          });
          if (blocked) {
            throw new Error(`SKIP_OFFER:${blocked}`);
          }
          await tx.assignmentAttempt.create({
            data: { jobId, providerId: provider.id, status: AssignmentAttemptStatus.SENT, dispatchedAt: now },
          });
          await tx.provider.update({
            where: { id: provider.id },
            data: { currentStatus: "offered" },
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
        }, TX_OPTS);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("SKIP_OFFER:")) continue;
        // Already offered to this provider for this job — skip, keep broadcasting.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
        throw err;
      }
      offeredProviderIds.push(provider.id);
      incCounter("dispatch_attempts_total");

      /**
       * The AssignmentAttempt this provider needs to see the job in `myBookings()` is already
       * committed above — notifying them is best-effort on top of that, not a precondition for
       * it. Previously an uncaught throw here (a bad push token, a template lookup failure, a
       * transient WS error) propagated straight out of this function, skipping the final
       * `assignmentJob.update` to DISPATCHED below entirely. The result was a job stuck PENDING
       * forever with a real SENT AssignmentAttempt already on record — dispatched in substance,
       * invisible to the retry/exhaustion logic, and with no error anywhere explaining why.
       */
      try {
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
      } catch (err) {
        incCounter("assignment_notify_failed_total");
        logger.error("assignment_dispatch_notify_failed", {
          jobId,
          bookingId: booking.id,
          providerId: provider.id,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack?.slice(0, 2000) : undefined,
        });
      }
    }

    if (offeredProviderIds.length === 0) {
      // Same reasoning as the eligible.length===0 branch above: this is still an attempt.
      await prisma.assignmentJob.update({
        where: { id: jobId },
        data: { dispatchAttempts: { increment: 1 } },
      });
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
    }, TX_OPTS);

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
    }, TX_OPTS);
    void this.refreshProviderAcceptanceRate(providerId);
  }

  /** Booking cancelled by customer or provider — close open dispatch. */
  async onBookingCancelled(bookingId: string) {
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) return;

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      /**
       * Broadcast dispatch (the default — see BROADCAST_DISPATCH) offers a job to several
       * providers at once, so more than one AssignmentAttempt can be SENT for a single job. This
       * used to close only the single most-recently-dispatched attempt (`findFirst` +
       * single `update`), which left every other broadcast recipient's attempt permanently SENT
       * once the booking was cancelled — nothing else in the system ever revisits a SENT row
       * outside the DISPATCHED-job timeout path, which no longer applies once the job moves to
       * CANCELLED below. Each stuck SENT attempt then counts against that provider's capacity
       * forever (`partnerOperationsService.loadCapacityMap` — `reservedOffers`), eventually
       * making an otherwise-idle provider register as `capacityFull` and silently stop receiving
       * any new offers at all. `updateMany` closes every open attempt on this job, matching the
       * same broadcast-wide expiry `handleTimeouts()` already does for the ordinary timeout path.
       */
      await tx.assignmentAttempt.updateMany({
        where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
        data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: now },
      });
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
    }, TX_OPTS);
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

    /**
     * An empty 30-day window means "no evidence", and that is not 100%.
     *
     * This previously wrote `100` whenever the window held no terminal attempts — so a provider who
     * went quiet for a month was re-scored as a *perfect* acceptor the moment they were dispatched
     * to again. Against a platform-wide acceptance rate of 7.5%, and with only 16 of 54 providers
     * having ever accepted anything, 100 is the most misleading value the column can hold. It is
     * read by the admin provider list, ETA intelligence and partner context.
     *
     * The column is `NOT NULL DEFAULT 0`, so it cannot represent "unknown" — writing 0 instead
     * would be the same fabrication pointing the other way ("this provider always refuses"). The
     * honest action with no evidence is to write nothing and leave the last real measurement in
     * place, which is what this does.
     *
     * The deeper issue — that `acceptance_rate` cannot distinguish UNKNOWN from 0% or 100% — needs
     * a nullable column and every consumer taught to handle it. That is a schema change with a wide
     * blast radius, recorded as a follow-up rather than made as a side effect here.
     */
    if (total === 0) {
      logger.debug("provider_acceptance_rate_no_evidence", {
        category: "APPLICATION",
        providerId,
        windowDays: 30,
      });
      return;
    }

    const rate = Math.round((accepted / total) * 10000) / 100;
    await prisma.provider
      .update({
        where: { id: providerId },
        data: { acceptanceRate: rate, rejectedBookings: rejected },
      })
      .catch((err) => {
        // Was swallowed silently. A stale acceptance rate shown to an admin as current is the
        // failure mode this whole line of work exists to prevent, so the miss is now visible.
        logger.warn("provider_acceptance_rate_update_failed", {
          category: "APPLICATION",
          providerId,
          error: err instanceof Error ? err.message : String(err),
        });
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
