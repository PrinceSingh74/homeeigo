import { evictProviderFromBooking } from "../lib/ws-eviction";
import { acceptanceRatePct, acceptanceWindowStart } from "../lib/acceptance-rate";
import { isNoPaymentFollowUp, isSettled } from "./booking-payment-gate";
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
import { resolveMustIncludeProviderIds } from "./dispatch-must-include.service";
import { preferPinnedAmongEligible } from "../lib/dispatch-must-include";
import { createWsEnvelope, pushToUser } from "./notification-hub";
import { notificationService } from "./notification.service";
import { incCounter, observeHist, setGauge } from "../lib/metrics";
import { fromWaitTimeMsBigInt } from "../lib/wait-time-ms";
import { eventPlatformConfig } from "../events/core/config";
import { emitInTransaction } from "../events/core/event-publisher";
import { buildPartnerDispatchedEvent } from "../events/catalog/partner.events";
import { partnerOperationsService } from "./partner-operations.service";
import { setBookingAuditContext } from "../lib/booking-audit-context";
import { loadServiceGateContext } from "./provider-capability-loader";
import { offerRequiresLivePresence } from "../lib/scheduled-offer-presence";

const DISPATCH_TIMEOUT_MS = Number(process.env.ASSIGNMENT_DISPATCH_TIMEOUT_MS || 300_000);
/** How long a far-ahead appointment stays on the partner's request list. */
const SCHEDULED_OFFER_TIMEOUT_MS = 72 * 60 * 60 * 1000;
const MAX_DISPATCH_PER_TICK = Number(process.env.ASSIGNMENT_MAX_PER_TICK || 10);
// Broadcast dispatch: offer a booking to ALL eligible providers at once (first to accept wins)
// instead of a single sequential offer — so every qualified partner sees it in their requests
// feed. Set ASSIGNMENT_BROADCAST=false to revert to legacy single-offer.
const BROADCAST_DISPATCH = process.env.ASSIGNMENT_BROADCAST !== "false";
const BROADCAST_FANOUT = Number(process.env.ASSIGNMENT_BROADCAST_FANOUT || 25);
/**
 * Pair each dispatch candidate with its provider row, in CANDIDATE order.
 *
 * Dispatch offers customer-pinned partners first and records `offeredProviderIds[0]` as the job's
 * current provider, so offer order is a product contract, not an implementation detail. The provider
 * rows come from one `findMany ... WHERE id IN (...)`, which carries no ORDER BY — Postgres may
 * return them in any order at all. Iterating that result instead of the candidate list would unpin
 * customers, and would do it intermittently rather than reproducibly.
 *
 * Keeping the pairing here makes that ordering explicit and directly testable, instead of leaving it
 * as a property of a loop header that a later refactor can quietly invert.
 *
 * A candidate with no provider row is dropped, exactly as a null `findUnique` dropped it.
 */
export function orderedDispatchTargets<C extends { providerId: string }, P>(
  targets: C[],
  providerById: Map<string, P>,
): Array<{ candidate: C; provider: P }> {
  const paired: Array<{ candidate: C; provider: P }> = [];
  for (const candidate of targets) {
    const provider = providerById.get(candidate.providerId);
    if (!provider) continue;
    paired.push({ candidate, provider });
  }
  return paired;
}

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
  private readonly dispatchesInFlight = new Map<string, Promise<boolean>>();

  private async acquireInlineSlot(): Promise<void> {
    if (this.inlineSlots > 0) {
      this.inlineSlots -= 1;
      this.publishInlineBacklog();
      return;
    }
    const queued = new Promise<void>((resolve) => this.inlineWaiters.push(resolve));
    this.publishInlineBacklog();
    await queued;
  }

  private releaseInlineSlot(): void {
    const next = this.inlineWaiters.shift();
    if (next) next();
    else this.inlineSlots += 1;
    this.publishInlineBacklog();
  }

  /**
   * The background-dispatch backlog. Waiters are unbounded by design (201 must return at once), so a
   * create burst can leave a booking's inline dispatch queued for a long time — and when it finally runs
   * it races whatever else touches that job (the cron tick, an accept). Visible as a gauge so a backlog
   * is never inferred after the fact.
   */
  inlineDispatchBacklog(): { inFlight: number; waiting: number } {
    return { inFlight: MAX_INLINE_DISPATCH - this.inlineSlots, waiting: this.inlineWaiters.length };
  }

  private publishInlineBacklog(): void {
    const { inFlight, waiting } = this.inlineDispatchBacklog();
    setGauge("assignment_inline_dispatch_in_flight", inFlight);
    setGauge("assignment_inline_dispatch_waiting", waiting);
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

      const queue = await bookingPriorityService.getAssignmentQueue(MAX_DISPATCH_PER_TICK, { dispatchableOnly: true });
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
          await this.exhaustJob(activeJob.id);
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

  /**
   * Give up on a job — and close the offers it still has open.
   *
   * This used to be a two-line `update` that set the job EXHAUSTED and walked away. Every
   * `AssignmentAttempt` still in SENT stayed in SENT, forever: nothing else in the engine touches an
   * attempt once its job has left the dispatch states, and `timeoutAt` is cleared on the way out so
   * even the timeout sweeper can no longer see it.
   *
   * The partner is the one who pays for that. `myBookings(status="pending")` lists their SENT
   * attempts, so an abandoned offer keeps rendering as a live "New request" indefinitely — four such
   * cards were sitting in one partner's feed, dispatched 24 to 41 days earlier, on a five-minute
   * offer window. Tapping Accept on one is the failure the partner actually reports: the job is long
   * gone, and the only feedback is a red toast.
   *
   * TIMEOUT rather than a new status because that is what the attempt was: an offer whose window
   * closed without an answer. It already means "expired unanswered" everywhere else — the acceptance
   * rate, the dispatch metrics and the partner's own history — and inventing a second word for it
   * would split every one of those readings in two.
   */
  private async exhaustJob(jobId: string): Promise<void> {
    const now = new Date();
    const abandoned = await prisma.$transaction(async (tx) => {
      const open = await tx.assignmentAttempt.findMany({
        where: { jobId, status: AssignmentAttemptStatus.SENT },
        select: { providerId: true },
      });
      await tx.assignmentAttempt.updateMany({
        where: { jobId, status: AssignmentAttemptStatus.SENT },
        data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: now },
      });
      await tx.assignmentJob.update({
        where: { id: jobId },
        data: { status: AssignmentJobStatus.EXHAUSTED, timeoutAt: null, currentProviderId: null },
      });
      return open.map((a) => a.providerId);
    }, TX_OPTS);

    await this.audit(jobId, "EXHAUSTED", { expiredOffers: abandoned.length });
    if (abandoned.length > 0) incCounter("dispatch_timeout_total", undefined, abandoned.length);

    // The offer is gone, so the booking-room grant that came with it is gone too — same reasoning
    // as the timeout path, which learned this lesson already.
    const job = await prisma.assignmentJob.findUnique({
      where: { id: jobId },
      select: { bookingId: true },
    });
    if (!job) return;
    for (const providerId of new Set(abandoned)) {
      await evictProviderFromBooking(job.bookingId, providerId, "offer_expired");
    }
  }

  private async handleTimeouts() {
    const now = new Date();
    const timedOutProviderIds: string[] = [];
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
        const expiredOffers = await tx.assignmentAttempt.findMany({
          where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
          select: { providerId: true },
        });
        await tx.assignmentAttempt.updateMany({
          where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
          data: { status: AssignmentAttemptStatus.TIMEOUT, respondedAt: now },
        });
        timedOutProviderIds.push(...expiredOffers.map((a) => a.providerId));
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
        await setBookingAuditContext(tx, { actorType: "system", actorId: null, reason: "offer timed out; tentative partner released" });
        await tx.booking.updateMany({
          where: { id: job.bookingId, status: BookingStatus.PENDING },
          data: { providerId: null },
        });
        await tx.assignmentAudit.create({
          data: { jobId: job.id, action: "TIMEOUT", details: JSON.stringify({ bookingId: job.bookingId, expiredAllOffers: true }) },
        });
      }, TX_OPTS);
      // The offered partners' booking-room grant died with the offer; the reject path already
      // evicts, the timeout path did not — the same stale socket, four hundred lines apart.
      for (const pid of new Set(timedOutProviderIds)) {
        void evictProviderFromBooking(job.bookingId, pid, "offer_timeout");
      }
    }
  }

  /**
   * One dispatch of a job at a time in this process; a caller arriving mid-flight shares that run.
   *
   * create's background dispatch, the settlement hook, a reject and the cron tick all funnel here, and
   * nothing stopped two of them working the same job at once. The second one re-read the same attempts,
   * re-matched, re-locked the booking FOR SHARE and every candidate's provider row FOR UPDATE, and then
   * lost each insert to the (job_id, provider_id) unique index — 7 P2002s in the 2026-10-01 failing
   * run, each one a transaction that had held the booking row while concurrent accepts waited on it.
   * Across instances the unique index remains the arbiter; this removes the duplicate work in-process.
   */
  private dispatchToNextProvider(jobId: string): Promise<boolean> {
    const inFlight = this.dispatchesInFlight.get(jobId);
    if (inFlight) {
      incCounter("assignment_dispatch_coalesced_total");
      return inFlight;
    }
    const run: Promise<boolean> = this.dispatchToNextProviderOnce(jobId).finally(() => {
      if (this.dispatchesInFlight.get(jobId) === run) this.dispatchesInFlight.delete(jobId);
    });
    this.dispatchesInFlight.set(jobId, run);
    return run;
  }

  /** Dispatches of a job currently running in this process (for tests and diagnostics). */
  dispatchInFlight(jobId: string): boolean {
    return this.dispatchesInFlight.has(jobId);
  }

  private async dispatchToNextProviderOnce(jobId: string): Promise<boolean> {
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

    /**
     * ── OWNER DECISION #1: an unpaid booking is not offered to anyone ─────────
     *
     * Accept is payment-gated, so a partner offered an unsettled booking is offered work they will
     * be refused if they take it. Measured across the database when this was decided: 2,566 of 3,451
     * assignment jobs — 74% — were for bookings that had not settled, so three quarters of all
     * dispatch traffic was unactionable.
     *
     * It is not merely noise. An unanswered offer holds a place against the partner's concurrency
     * budget until it times out, and a timed-out offer counts as a REFUSAL in the acceptance rate
     * the platform ranks them by. Partners were being measured on, and throttled by, offers they
     * were never permitted to accept — and the cause was the customer's payment, not their own
     * behaviour.
     *
     * The job row is still created at booking time and left PENDING; only the fan-out waits.
     * `onBookingPaymentSettled` dispatches on settlement and the assignment cron re-dispatches
     * PENDING jobs every 30 seconds, so the machinery to start matching the moment money arrives
     * already exists — this removes a premature call rather than adding anything.
     *
     * The gate lives here because every path funnels through this method: the inline call at
     * creation, the cron, and the settlement hook. A rule placed at any one of them would be a rule
     * the other two could bypass.
     */
    // §11: a case-created follow-up with its fee waived owes nothing (never marked paid).
    if (!isSettled(booking.paymentStatus) && !(await isNoPaymentFollowUp(booking.id))) {
      logger.debug("dispatch_withheld_unpaid", {
        category: "APPLICATION",
        bookingId: booking.id,
        jobId,
        paymentStatus: booking.paymentStatus,
      });
      return false;
    }

    /**
     * Phase 11 — no fabricated job location. A booking without coordinates used to be matched
     * around central Mumbai (19.076, 72.8777), so a job anywhere else could be offered to whoever
     * happened to be near Mumbai. With no position nobody can be shown to be inside a service area:
     * no candidates, reason LOCATION_GATE_FAILED, counted as an attempt like any NO_PROVIDER outcome
     * so the job still reaches EXHAUSTED and the ops alert instead of retrying forever.
     */
    const lat = booking.address?.latitude;
    const lng = booking.address?.longitude;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      incCounter("matching_rejection_total", { reason: "LOCATION_GATE_FAILED", scope: "job" });
      logger.warn("dispatch_job_location_missing", { category: "APPLICATION", bookingId: booking.id, jobId });
      await prisma.assignmentJob.update({
        where: { id: jobId },
        data: { dispatchAttempts: { increment: 1 } },
      });
      await this.audit(jobId, "NO_PROVIDER", {
        serviceId: booking.serviceId,
        matchCount: 0,
        reason: "LOCATION_GATE_FAILED",
      });
      return false;
    }
    const excluded = job.attempts.map((a) => a.providerId);

    const matches = await matchingService.findBestProviders({
      serviceId: booking.serviceId,
      customerId: booking.userId,
      latitude: lat,
      longitude: lng,
      scheduledDate: booking.scheduledDate,
      maxResults: 15,
    });

    const mustIncludeIds = new Set(
      (await resolveMustIncludeProviderIds(booking.user)).filter((id) => !excluded.includes(id)),
    );

    const ranked = matches
      .filter((m) => !excluded.includes(m.providerId))
      .sort((a, b) => b.totalScore - a.totalScore);
    /**
     * W2-D2. A pin is a SOFT preference over partners matching already admitted — never an entry
     * ticket. It used to synthesise a 10,000-score match for the pinned partner and merge it in,
     * which put a partner who had failed every hard gate at the front of the offer list. Now a
     * pinned partner who is not in `ranked` is simply not offered.
     */
    const eligible = preferPinnedAmongEligible(ranked, mustIncludeIds);
    const pinnedAdmitted = eligible.filter((m) => mustIncludeIds.has(m.providerId)).length;
    if (mustIncludeIds.size > 0) {
      logger.info("dispatch_pin_preference", {
        jobId,
        pinned: mustIncludeIds.size,
        // A pinned partner that failed hard eligibility shows up here as the gap between the two.
        pinnedAdmitted,
      });
    }

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
    const livePresenceRequired = offerRequiresLivePresence(booking.scheduledDate, now);
    const untilSlotMs = booking.scheduledDate.getTime() - now.getTime();
    const offerWindowMs = livePresenceRequired
      ? DISPATCH_TIMEOUT_MS
      : Math.min(SCHEDULED_OFFER_TIMEOUT_MS, Math.max(DISPATCH_TIMEOUT_MS, untilSlotMs - 2 * 60 * 60 * 1000));
    const timeoutAt = new Date(now.getTime() + offerWindowMs);
    // W2-D2: a pin no longer forces broadcast mode. It changes ORDER among eligible partners and
    // nothing about how dispatch fans out.
    const broadcast = BROADCAST_DISPATCH;
    const pinned = eligible.filter((m) => mustIncludeIds.has(m.providerId));
    const others = eligible.filter((m) => !mustIncludeIds.has(m.providerId));
    const targets = broadcast
      ? [...pinned, ...others.slice(0, Math.max(0, BROADCAST_FANOUT - pinned.length))]
      : eligible.slice(0, 1);

    /**
     * One lookup for the whole broadcast, not one per candidate.
     *
     * This loop reads exactly two fields off the row — `id` and `userId` — yet it used to issue a
     * `findUnique` per candidate with `include: { user: true }`, hydrating a 97-column provider row
     * joined to a 66-column user row (including that user's encrypted PII) to use two strings. At
     * BROADCAST_FANOUT=25 and MAX_DISPATCH_PER_TICK=10 that is 250 round trips per 30-second tick.
     *
     * Measured against homigo_test, 25 candidates: 139.3 ms → 3.4 ms, 25 queries → 1, returning an
     * identical set of (id, userId) pairs. `orderedDispatchTargets` keeps the skip semantics: a
     * candidate whose provider row is missing is dropped exactly as a null `findUnique` dropped it.
     */
    const candidateProviders = await prisma.provider.findMany({
      where: { id: { in: targets.map((t) => t.providerId) } },
      select: { id: true, userId: true },
    });
    // Phase 11: the service side of the capability re-check, built once per booking OUTSIDE the
    // per-offer transactions (each offer then costs one query per capability table, nothing more).
    const capabilityCtx = await loadServiceGateContext(booking.serviceId, booking.userId);
    const providerById = new Map(candidateProviders.map((p) => [p.id, p]));

    const offeredProviderIds: string[] = [];
    for (const { provider } of orderedDispatchTargets(targets, providerById)) {

      try {
        await prisma.$transaction(async (tx) => {
          const stillThere = await tx.assignmentJob.findUnique({
            where: { id: jobId },
            select: { id: true },
          });
          if (!stillThere) {
            throw new Error("SKIP_OFFER:JOB_GONE");
          }
          // Re-checked under a share lock: the PENDING read above is unlocked, and a cancel or claim
          // committing in between used to leave a fresh SENT offer on a closed booking. FOR SHARE
          // makes a concurrent cancel wait for this offer to commit (its closeOffersInTx then closes
          // it), or makes this offer see the committed cancel and skip.
          const live = await tx.$queryRaw<Array<{ status: string; provider_id: string | null }>>`
            SELECT status, provider_id FROM bookings WHERE id = ${booking.id} FOR SHARE`;
          if (!live[0] || live[0].status !== BookingStatus.PENDING || live[0].provider_id) {
            throw new Error("SKIP_OFFER:BOOKING_CLOSED");
          }
          const blocked = await partnerOperationsService.assertOfferEligible(tx, provider.id, {
            latitude: lat,
            longitude: lng,
            scheduledDate: booking.scheduledDate,
            capability: capabilityCtx,
            livePresenceRequired,
          });
          if (blocked) {
            // W2-D2: no partner — pinned or not — is offered past a failed offer-time gate.
            incCounter("final_revalidation_failures", { reason: blocked });
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
      // How long a customer waited between creating the booking and a partner actually being offered it.
      observeHist("assignment_dispatch_latency_seconds", Math.max(0, (Date.now() - booking.createdAt.getTime()) / 1000));

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
            // Every offered partner receives this, most of whom will never hold the job: first name only.
            customerName: booking.user.firstName,
            serviceName: booking.service.name,
            // X-29: no internal assignment-job id — no partner client reads it; the booking id is enough.
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

    // accept() already did this inside its own transaction (markAcceptedInTx); this pass is the
    // idempotent catch-up for any other caller. Refuses if the booking has since moved to another
    // partner (admin reassign), so it can never rewrite the job to a displaced partner.
    let current = false;
    await prisma.$transaction(async (tx) => {
      const owner = await tx.$queryRaw<Array<{ provider_id: string | null }>>`
        SELECT provider_id FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
      if (owner[0]?.provider_id !== providerId) return;
      current = true;
      await this.markAcceptedInTx(tx, bookingId, providerId);
    }, TX_OPTS);
    if (!current) return;

    incCounter("dispatch_success_total");
    incCounter("booking_assigned_total");
    await bookingPriorityService.recordAssignmentWait(bookingId);
    void this.refreshProviderAcceptanceRate(providerId);
  }

  /**
   * The accepting partner's offer → ACCEPTED, every other open offer closed, job ACCEPTED — in the
   * caller's transaction (accept() runs it in the same transaction as the booking's ACCEPTED write,
   * so a crash can no longer leave rival offers open on a claimed booking). Idempotent.
   */
  async markAcceptedInTx(tx: Prisma.TransactionClient, bookingId: string, providerId: string) {
    const job = await tx.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) return;
    if (job.status === AssignmentJobStatus.ACCEPTED && job.currentProviderId === providerId) {
      const open = await tx.assignmentAttempt.count({ where: { jobId: job.id, status: AssignmentAttemptStatus.SENT } });
      if (open === 0) return;
    }
    const now = new Date();
    {
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
    }
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
      await setBookingAuditContext(tx, { actorType: "partner", actorId: providerId, reason: `offer rejected${reason ? `: ${reason}` : ""}` });
      await tx.booking.updateMany({ where: { id: bookingId, providerId, status: "PENDING" }, data: { providerId: null } });
      await tx.assignmentAudit.create({
        data: { jobId: job.id, action: "REJECT", details: JSON.stringify({ providerId, reason }) },
      });
    }, TX_OPTS);
    void evictProviderFromBooking(bookingId, providerId, "offer_rejected");
    void this.refreshProviderAcceptanceRate(providerId);
  }

  /** Booking cancelled by customer or provider — close open dispatch. */
  /**
   * Close every open offer on a booking's job INSIDE the caller's transaction — the same transaction
   * that makes the booking terminal (cancel) or hands it to someone else (admin reassign). Done
   * post-commit, a crash in between left SENT offers open: the booking still showed in partners'
   * feeds and each open offer held that partner's capacity forever.
   *
   * Returns the partners whose offers were closed so the caller can evict their sockets after commit.
   */
  async closeOffersInTx(
    tx: Prisma.TransactionClient,
    bookingId: string,
    outcome:
      | { kind: "cancelled" }
      | { kind: "reassigned"; providerId: string; adminId: string },
  ): Promise<string[]> {
    const job = await tx.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) return [];
    const now = new Date();
    const open = await tx.assignmentAttempt.findMany({
      where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
      select: { providerId: true },
    });
    await tx.assignmentAttempt.updateMany({
      where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
      data: {
        status: outcome.kind === "cancelled" ? AssignmentAttemptStatus.TIMEOUT : AssignmentAttemptStatus.SUPERSEDED,
        respondedAt: now,
      },
    });
    await tx.assignmentJob.update({
      where: { id: job.id },
      data:
        outcome.kind === "cancelled"
          ? { status: AssignmentJobStatus.CANCELLED, currentProviderId: null, timeoutAt: null }
          : { status: AssignmentJobStatus.ACCEPTED, currentProviderId: outcome.providerId, acceptedAt: now, timeoutAt: null },
    });
    await tx.assignmentAudit.create({
      data: {
        jobId: job.id,
        action: outcome.kind === "cancelled" ? "CANCEL" : "ADMIN_REASSIGN",
        details: JSON.stringify(
          outcome.kind === "cancelled"
            ? { bookingId, closedOffers: open.length }
            : { bookingId, providerId: outcome.providerId, adminId: outcome.adminId, closedOffers: open.length },
        ),
      },
    });
    return [...new Set(open.map((a) => a.providerId))];
  }

  async onBookingCancelled(bookingId: string) {
    const job = await prisma.assignmentJob.findUnique({ where: { bookingId } });
    if (!job) return;

    const now = new Date();
    const cancelledOfferProviderIds: string[] = [];
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
      const openOffers = await tx.assignmentAttempt.findMany({
        where: { jobId: job.id, status: AssignmentAttemptStatus.SENT },
        select: { providerId: true },
      });
      cancelledOfferProviderIds.push(...openOffers.map((a) => a.providerId));
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
    for (const pid of new Set(cancelledOfferProviderIds)) {
      void evictProviderFromBooking(bookingId, pid, "offer_withdrawn");
    }
  }

  private async audit(jobId: string, action: string, details: Record<string, unknown>) {
    await prisma.assignmentAudit.create({
      data: { jobId, action, details: JSON.stringify(details) },
    });
  }

  /** Keep providers.acceptance_rate aligned with live dispatch outcomes (30d window). */
  private async refreshProviderAcceptanceRate(providerId: string) {
    const since = acceptanceWindowStart();
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

    // Shared definition — see lib/acceptance-rate.ts. Non-null here because total > 0.
    const rate = acceptanceRatePct(accepted, total) ?? 0;
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
    /**
     * The same definition the provider column uses, not a second one.
     *
     * This divided by `attempts - sent` with no time window and resolved an empty sample to 0 — so
     * the admin dispatch panel could report "0% acceptance" on a platform that had simply not
     * dispatched anything yet, while the provider column deliberately writes nothing in that case.
     * Two different answers to the same question, and the fabricated one was the visible one.
     */
    const totalResponses = attempts - sent;
    const acceptanceRate = acceptanceRatePct(acceptedCount, totalResponses);

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
        /**
         * Null, not zero, when no job has been dispatched.
         *
         * A different question from the partner acceptance rate — this is a FUNNEL ratio over jobs,
         * not offers — but the same fallback problem: 0% conversion on a platform that has dispatched
         * nothing asserts total failure rather than an absence of data.
         */
        conversionPct: totalJobs > 0 ? Math.round((accepted / totalJobs) * 1000) / 10 : null,
      },
    };
  }
}

export const assignmentEngine = new AssignmentEngine();
