import { BookingStatus, WalletTxnStatus, WalletTxnType } from "@prisma/client";
import prisma from "../lib/prisma";
import { analyticsWhereVia, isBusinessRow } from "../lib/analytics-scope";
import { countStandardCompleted } from "../lib/booking-volume";
import { nextWalletTxnNumber } from "../lib/booking-number";
import { rupeesToPaise } from "../lib/money-paise";
import { incCounter } from "../lib/metrics";
import { logger } from "../lib/logger";
import { financialLedgerService } from "./financial-ledger.service";
import { financialTransactionManager } from "./financial-transaction-manager.service";
import { sanitizeUserInput } from "../utils/sanitizer";
import { parsePagination } from "../lib/pagination";
import { canonicalOwnRatingPhotos } from "../lib/rating-photos";
import { hcoinService } from "./hcoin.service";
import { buildPartnerRatingReceivedEvent } from "../events/catalog/partner.events";
import { emitPartnerEvent } from "../events/core/partner-event-emit";

const ON_TIME_TOLERANCE_MIN = 15;
const RECENT_DAYS_HIGH_WEIGHT = 7;
const RECENT_DAYS_MED_WEIGHT = 30;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export type ProviderBadge =
  | "super_star"
  | "expert"
  | "trusted"
  | "quick_responder"
  | "punctual";

export class RatingService {
  /**
   * Rating + tip in one money-safe transaction.
   *
   * The tip used to be `provider.walletBalance += tipAmount` and nothing else: no customer debit,
   * no paise column, no wallet transaction on either side, no ledger journal. The platform was
   * creating money it had never collected, and the provider-payable ledger drifted from the
   * provider wallets by exactly the sum of all tips.
   *
   * The tip is now funded from the customer's wallet (the only customer balance the platform can
   * debit server-side without a gateway round-trip) and credited to the partner in full through the
   * same wallet-transaction + ledger path every other wallet movement uses. Insufficient balance
   * rejects the whole request — the rating is not saved without its tip, so the client can let the
   * customer adjust rather than silently dropping the gratuity.
   *
   * Commission on tips is deliberately 0 — the pre-existing behaviour, now explicit in the journal.
   * A card/UPI-funded tip is a product decision (OWNER_DECISION_REQUIRED), not something to invent.
   */
  private async createWithTip(opts: {
    userId: string;
    providerId: string;
    bookingId: string;
    tipAmount: number;
    ratingData: Parameters<typeof prisma.rating.create>[0]["data"];
  }): Promise<{ rating: Awaited<ReturnType<typeof prisma.rating.create>> } | { error: "TIP_INSUFFICIENT_WALLET" | "TIP_FAILED" }> {
    const tip = opts.tipAmount;
    const tipPaise = rupeesToPaise(tip);
    try {
      const rating = await financialTransactionManager.executeWithLedger({
        journal: financialLedgerService.journalForBookingTip(opts.bookingId, tip),
        mutate: async (tx) => {
          // Same per-wallet serialisation wallet-checkout uses, so a tip cannot race a checkout.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"wallet_pay:" + opts.userId}))`;

          const customerBefore = await tx.user.findUnique({
            where: { id: opts.userId },
            select: { walletBalance: true, walletBalancePaise: true },
          });
          if (!customerBefore) throw new Error("USER_NOT_FOUND");
          if (customerBefore.walletBalance + 0.005 < tip) throw new Error("TIP_INSUFFICIENT_WALLET");

          const created = await tx.rating.create({ data: opts.ratingData });

          await tx.user.update({
            where: { id: opts.userId },
            data: { walletBalance: { decrement: tip }, walletBalancePaise: { decrement: tipPaise } },
          });
          // Closing balances are READ BACK, never derived — the wallet_balance_consistency check
          // exists to catch a ledger/wallet divergence, and a computed "after" would satisfy it
          // by construction.
          const customerAfter = await tx.user.findUniqueOrThrow({
            where: { id: opts.userId },
            select: { walletBalance: true, walletBalancePaise: true },
          });
          await tx.walletTransaction.create({
            data: {
              transactionNumber: await nextWalletTxnNumber(tx),
              userId: opts.userId,
              amount: tip,
              amountPaise: tipPaise,
              walletBalanceBefore: customerBefore.walletBalance,
              walletBalanceBeforePaise: customerBefore.walletBalancePaise,
              walletBalanceAfter: customerAfter.walletBalance,
              walletBalanceAfterPaise: customerAfter.walletBalancePaise,
              type: WalletTxnType.DEBIT,
              status: WalletTxnStatus.COMPLETED,
              description: "Tip for your service partner",
              referenceId: opts.bookingId,
              referenceType: "booking_tip",
              idempotencyKey: `tip-debit:${opts.bookingId}`,
              completedAt: new Date(),
            },
          });

          const providerBefore = await tx.provider.findUniqueOrThrow({
            where: { id: opts.providerId },
            select: { walletBalance: true, walletBalancePaise: true },
          });
          await tx.provider.update({
            where: { id: opts.providerId },
            data: { walletBalance: { increment: tip }, walletBalancePaise: { increment: tipPaise } },
          });
          const providerAfter = await tx.provider.findUniqueOrThrow({
            where: { id: opts.providerId },
            select: { walletBalance: true, walletBalancePaise: true },
          });
          await tx.walletTransaction.create({
            data: {
              transactionNumber: await nextWalletTxnNumber(tx),
              providerId: opts.providerId,
              amount: tip,
              amountPaise: tipPaise,
              walletBalanceBefore: providerBefore.walletBalance,
              walletBalanceBeforePaise: providerBefore.walletBalancePaise,
              walletBalanceAfter: providerAfter.walletBalance,
              walletBalanceAfterPaise: providerAfter.walletBalancePaise,
              type: WalletTxnType.CREDIT,
              status: WalletTxnStatus.COMPLETED,
              description: "Customer tip",
              referenceId: opts.bookingId,
              referenceType: "booking_tip",
              idempotencyKey: `tip-credit:${opts.bookingId}`,
              completedAt: new Date(),
            },
          });

          return created;
        },
      });
      incCounter("booking_tip_credited_total");
      return { rating };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "TIP_INSUFFICIENT_WALLET") {
        incCounter("booking_tip_rejected_total", { reason: "insufficient_wallet" });
        return { error: "TIP_INSUFFICIENT_WALLET" };
      }
      incCounter("booking_tip_rejected_total", { reason: "error" });
      logger.error("booking_tip_failed", { bookingId: opts.bookingId, error: message });
      return { error: "TIP_FAILED" };
    }
  }

  async create(
    userId: string,
    body: {
      bookingId: string;
      rating: number;
      reviewText?: string;
      photos?: string[];
      tipAmount?: number;
      liked?: string[];
      couldImprove?: string[];
    },
  ) {
    const booking = await prisma.booking.findFirst({
      where: { id: body.bookingId, userId, status: "COMPLETED" },
      include: { rating: true, provider: true },
    });
    if (!booking || booking.rating) return { error: "INVALID_BOOKING" as const };
    if (!booking.providerId) return { error: "INVALID_BOOKING" as const };
    if (body.rating < 1 || body.rating > 5) return { error: "VALIDATION_ERROR" as const };
    // Only photos this customer uploaded through our endpoint, re-addressed from a trusted origin.
    const photos = await canonicalOwnRatingPhotos(userId, body.photos);
    if (!photos) return { error: "INVALID_PHOTOS" as const };

    const tipAmount = Math.round((body.tipAmount ?? 0) * 100) / 100;
    const ratingData = {
      bookingId: body.bookingId,
      userId,
      providerId: booking.providerId,
      stars: body.rating,
      reviewText: body.reviewText ? sanitizeUserInput(body.reviewText, 1000) : undefined,
      photos,
      tipAmount,
      liked: body.liked ?? [],
      couldImprove: body.couldImprove ?? [],
    };

    let rating;
    if (tipAmount > 0) {
      const tipped = await this.createWithTip({
        userId,
        providerId: booking.providerId,
        bookingId: body.bookingId,
        tipAmount,
        ratingData,
      });
      if ("error" in tipped) return tipped;
      rating = tipped.rating;
    } else {
      rating = await prisma.rating.create({ data: ratingData });
    }

    await this.updateProviderMetrics(booking.providerId);

    const providerBefore = booking.provider?.rating ?? null;
    void emitPartnerEvent(
      buildPartnerRatingReceivedEvent({
        providerId: booking.providerId,
        bookingId: body.bookingId,
        ratingId: rating.id,
        stars: body.rating,
        previousRating: providerBefore,
      }),
    ).catch((err: unknown) => {
      incCounter("partner_event_emit_failed_total", { event: "rating_received" });
      logger.error("rating_received_event_emit_failed", { bookingId: body.bookingId, error: err instanceof Error ? err.message : String(err) });
    });

    // Loyalty: reward H-Coins for leaving a review (once per booking).
    void hcoinService.earn(userId, "REVIEW_SUBMITTED", body.bookingId).catch(() => {});

    return rating;
  }

  async byBooking(userId: string, bookingId: string) {
    const r = await prisma.rating.findFirst({
      where: { bookingId, userId },
    });
    if (!r) return null;
    return {
      id: r.id,
      rating: r.stars,
      reviewText: r.reviewText,
      photos: r.photos,
      tipAmount: r.tipAmount,
      createdAt: r.createdAt,
      helpfulCount: r.helpfulCount,
      providerResponse: r.providerResponse,
      respondedAt: r.respondedAt,
    };
  }

  async update(userId: string, id: string, patch: { rating?: number; reviewText?: string; photos?: string[] }) {
    const existing = await prisma.rating.findFirst({ where: { id, userId } });
    if (!existing) return null;
    let photos: string[] | undefined;
    if (patch.photos !== undefined) {
      const checked = await canonicalOwnRatingPhotos(userId, patch.photos);
      if (!checked) return "INVALID_PHOTOS" as const;
      photos = checked;
    }
    await prisma.rating.update({
      where: { id },
      data: {
        stars: patch.rating,
        reviewText: patch.reviewText
          ? sanitizeUserInput(patch.reviewText, 1000)
          : undefined,
        photos,
      },
    });
    if (patch.rating !== undefined) {
      await this.updateProviderMetrics(existing.providerId);
    }
    return true;
  }

  async providerRespond(providerId: string, id: string, response: string) {
    const r = await prisma.rating.findFirst({
      where: { id, providerId },
      include: { provider: true },
    });
    if (!r) return null;
    const updated = await prisma.rating.update({
      where: { id },
      data: {
        providerResponse: sanitizeUserInput(response, 1000),
        respondedAt: new Date(),
      },
    });

    // Tell the customer their review got a reply (non-blocking; in-app + WS push).
    const { notificationService } = await import("./notification.service");
    void notificationService
      .createForUser({
        userId: r.userId,
        type: "review_reply",
        title: "Your review got a reply",
        message: `${r.provider?.businessName ?? "Your professional"} replied to your review.`,
        referenceId: r.bookingId,
        referenceType: "booking",
      })
      .catch(() => undefined);

    return updated;
  }

  async listForUser(userId: string, query: Record<string, string | undefined>) {
    const { page, limit, skip } = parsePagination(query);
    const [rows, total] = await Promise.all([
      prisma.rating.findMany({
        where: { userId },
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          provider: { include: { user: true } },
          booking: { include: { service: true } },
        },
      }),
      prisma.rating.count({ where: { userId } }),
    ]);
    return {
      ratings: rows.map((r) => ({
        id: r.id,
        bookingNumber: r.booking.bookingNumber,
        provider: {
          id: r.providerId,
          name: `${r.provider.user.firstName} ${r.provider.user.lastName}`,
          image: r.provider.profileImage,
        },
        service: { name: r.booking.service.name },
        rating: r.stars,
        reviewText: r.reviewText,
        photos: r.photos,
        tipAmount: r.tipAmount,
        providerResponse: r.providerResponse,
        respondedAt: r.respondedAt,
        createdAt: r.createdAt,
      })),
      total,
      page,
    };
  }

  /**
   * PLATFORM-WIDE public reviews for the customer home "Loved by customers" rail.
   * Any customer's review (after any service, any provider) surfaces here — only
   * public, non-flagged rows with actual review text. Newest first + aggregate.
   */
  async listPublicRecent(query: Record<string, string | undefined>) {
    const limit = Math.min(Math.max(Number(query.limit) || 12, 1), 30);
    const where = {
      isPublic: true,
      isFlagged: false,
      reviewText: { not: null },
    } as const;
    const [rows, total, agg] = await Promise.all([
      prisma.rating.findMany({
        where,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          user: { select: { firstName: true, lastName: true } },
          booking: { include: { service: { select: { name: true } } } },
        },
      }),
      prisma.rating.count({ where }),
      prisma.rating.aggregate({ where, _avg: { stars: true } }),
    ]);
    return {
      reviews: rows.map((r) => ({
        id: r.id,
        name: r.isAnonymous
          ? "HOMEEIGO Customer"
          : `${r.user.firstName ?? "HOMEEIGO"} ${(r.user.lastName ?? "").charAt(0)}`.trim(),
        rating: r.stars,
        reviewText: r.reviewText,
        service: r.booking?.service?.name ?? "Home service",
        createdAt: r.createdAt,
        providerResponse: r.providerResponse,
      })),
      total,
      averageRating: agg._avg.stars != null ? Math.round(agg._avg.stars * 10) / 10 : null,
    };
  }

  /**
   * Recency-weighted average rating.
   *   ≤ 7 days  → 3x weight
   *   ≤ 30 days → 2x weight
   *   older     → 1x weight
   *
   * Computed with date-floored aggregates rather than by loading the provider's whole history. The
   * weight has only three values and everything past the medium tier carries weight 1, so the tail —
   * which is almost all of it for any established partner — never needs to be materialised. The
   * average is the same identity, regrouped:
   *
   *     Σ(stars·w) / Σ(w)  =  (3·ΣstarsHigh + 2·ΣstarsMed + ΣstarsOld)
   *                           ─────────────────────────────────────────
   *                           (3·nHigh      + 2·nMed      + nOld)
   *
   * ── The floors are 8 and 31 days, not 7 and 30 ──────────────────────────────
   *
   * The original test was `Math.floor(ageMs / DAY) <= 7`, which truncates first: a rating 7.9 days
   * old has `daysOld === 7` and earns the 3x weight. The equivalent date floor is therefore
   * `createdAt > now − 8 days`, not `now − 7 days`. Writing the obvious `now − 7 days` would demote
   * a slice of every provider's most recent reviews and move published ratings — a silent product
   * change wearing a performance change's clothes. `boundaryFloor` keeps the +1 attached to the
   * constant it corrects so the two cannot drift apart.
   *
   * Measured against homigo_test: 5,000 ratings 27.0 ms → 5.2 ms (5.2x); 50,000 ratings
   * 246.6 ms → 13.2 ms (18.7x), returning an identical value on every round.
   */
  /**
   * W2-D4 — which population a partner's own metrics are computed over.
   *
   * Symmetric with matching: a business partner's rating counts business customers' ratings, a
   * fixture partner's counts fixture ratings. Provenance comes from the partner's user — the
   * inheritance `analytics-scope` already defines — so there is no second source of truth.
   */
  private async providerPopulation(providerId: string): Promise<"BUSINESS" | "NON_BUSINESS"> {
    const row = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { user: { select: { dataOrigin: true } } },
    });
    return !row || isBusinessRow(row.user.dataOrigin) ? "BUSINESS" : "NON_BUSINESS";
  }

  async calculateProviderRating(providerId: string): Promise<number> {
    const population = await this.providerPopulation(providerId);
    const now = Date.now();
    /** Inclusive day tier `n` ends when the age reaches n+1 whole days — see the note above. */
    const boundaryFloor = (days: number) => new Date(now - (days + 1) * MS_PER_DAY);
    const highFloor = boundaryFloor(RECENT_DAYS_HIGH_WEIGHT);
    const medFloor = boundaryFloor(RECENT_DAYS_MED_WEIGHT);

    const tier = (createdAt: { gt?: Date; lte?: Date }) =>
      prisma.rating.aggregate({
        // W2-D4: only ratings from the partner's own population. A certification run that rated a
        // real partner used to move that partner's live rating — the strongest matching signal.
        where: { providerId, createdAt, ...analyticsWhereVia("rating", population) },
        _count: { _all: true },
        _sum: { stars: true },
      });

    const [high, medium, older] = await Promise.all([
      tier({ gt: highFloor }),
      tier({ gt: medFloor, lte: highFloor }),
      tier({ lte: medFloor }),
    ]);

    const totalScore =
      3 * (high._sum.stars ?? 0) + 2 * (medium._sum.stars ?? 0) + (older._sum.stars ?? 0);
    const totalWeight =
      3 * high._count._all + 2 * medium._count._all + older._count._all;

    if (totalWeight === 0) return 0;
    return Math.round((totalScore / totalWeight) * 10) / 10;
  }

  /**
   * Recompute and persist all derived provider metrics:
   * rating (weighted), totalReviews, completionRate, responseRate, onTimeRate.
   * Triggers badge re-evaluation.
   */
  async updateProviderMetrics(providerId: string): Promise<void> {
    const population = await this.providerPopulation(providerId);
    const [ratingCount, weightedRating, bookingStats, onTime, completedStandard] = await Promise.all([
      prisma.rating.count({ where: { providerId, ...analyticsWhereVia("rating", population) } }),
      this.calculateProviderRating(providerId),
      this.computeBookingStats(providerId),
      this.computeOnTimeRate(providerId),
      /**
       * X-5: `completedBookings` is a VOLUME counter (tiers, badges, incentives), so this
       * recompute must not resurrect what complete() now refuses to add: REWORK / REVISIT
       * follow-ups (§11) are return visits to jobs that already counted. The rate metrics below
       * (completionRate / responseRate / onTimeRate) deliberately keep counting every booking —
       * a follow-up the partner completed is still evidence of reliability, and policy leaves
       * rating side effects unchanged.
       */
      countStandardCompleted(providerId),
    ]);

    /**
     * W2-D3: a rate is written only when there is evidence for it.
     *
     * With no bookings in the window, `responseRate` used to be written as **100** — a partner who
     * had never been offered anything was recorded as perfectly responsive, and that figure fed
     * matching and partner dashboards as if measured. With no bookings at all, `completionRate` was
     * written as 0, indistinguishable from a partner who had failed every job.
     *
     * Now a rate with no denominator is simply NOT UPDATED: the column keeps its last measured value
     * (or its schema default for a partner who has never been measured). Matching no longer trusts
     * either column without counting its evidence — see `lib/matching-signals.ts`.
     */
    const completionRate =
      bookingStats.total > 0 ? Math.round((bookingStats.completed / bookingStats.total) * 100) : null;
    const responseRate =
      bookingStats.last30Days > 0
        ? Math.round((bookingStats.last30DaysAccepted / bookingStats.last30Days) * 100)
        : null;

    await prisma.provider.update({
      where: { id: providerId },
      data: {
        rating: weightedRating,
        totalReviews: ratingCount,
        completedBookings: completedStandard,
        ...(completionRate != null ? { completionRate } : {}),
        ...(responseRate != null ? { responseRate } : {}),
        onTimeRate: onTime,
      },
    });

    await this.awardBadges(providerId);
    const { partnerScoreService } = await import("./partner-score.service");
    void partnerScoreService.recalculate(providerId).catch(() => undefined);
  }

  /**
   * Derive and persist badges from current provider metrics.
   */
  async awardBadges(providerId: string): Promise<ProviderBadge[]> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        rating: true,
        totalReviews: true,
        completedBookings: true,
        completionRate: true,
        responseRate: true,
        onTimeRate: true,
        avgResponseTime: true,
      },
    });
    if (!provider) return [];

    const badges: ProviderBadge[] = [];

    if (
      provider.rating >= 4.8 &&
      provider.completedBookings >= 50 &&
      provider.completionRate >= 98
    ) {
      badges.push("super_star");
    }
    if (
      provider.rating >= 4.5 &&
      provider.completedBookings >= 30 &&
      provider.completionRate >= 95
    ) {
      badges.push("expert");
    }
    if (
      provider.rating >= 4.0 &&
      provider.completedBookings >= 10 &&
      provider.completionRate >= 90
    ) {
      badges.push("trusted");
    }
    if (provider.responseRate >= 95 && provider.avgResponseTime > 0 && provider.avgResponseTime <= 5) {
      badges.push("quick_responder");
    }
    if (provider.onTimeRate >= 95 && provider.completedBookings >= 20) {
      badges.push("punctual");
    }

    const unique = Array.from(new Set(badges));
    await prisma.provider.update({
      where: { id: providerId },
      data: { badges: unique },
    });
    return unique;
  }

  async getRatingBreakdown(providerId: string): Promise<Record<1 | 2 | 3 | 4 | 5, number>> {
    const grouped = await prisma.rating.groupBy({
      by: ["stars"],
      where: { providerId },
      _count: true,
    });
    const breakdown: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of grouped) {
      const star = row.stars as 1 | 2 | 3 | 4 | 5;
      if (star in breakdown) breakdown[star] = row._count;
    }
    return breakdown;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async computeBookingStats(providerId: string) {
    const last30 = new Date();
    last30.setDate(last30.getDate() - 30);

    const [total, completed, last30Days, last30DaysAccepted] = await Promise.all([
      prisma.booking.count({ where: { providerId } }),
      prisma.booking.count({ where: { providerId, status: BookingStatus.COMPLETED } }),
      prisma.booking.count({ where: { providerId, createdAt: { gte: last30 } } }),
      prisma.booking.count({
        where: {
          providerId,
          createdAt: { gte: last30 },
          status: { in: [BookingStatus.ACCEPTED, BookingStatus.ASSIGNED, BookingStatus.EN_ROUTE, BookingStatus.IN_PROGRESS, BookingStatus.COMPLETED] },
        },
      }),
    ]);

    return { total, completed, last30Days, last30DaysAccepted };
  }

  private async computeOnTimeRate(providerId: string): Promise<number> {
    const completed = await prisma.booking.findMany({
      where: { providerId, status: BookingStatus.COMPLETED },
      select: { scheduledDate: true, tracking: { select: { actualArrivalTime: true } } },
    });
    const withArrival = completed.filter((b) => b.tracking?.actualArrivalTime);
    if (withArrival.length === 0) return 100;

    let onTime = 0;
    for (const b of withArrival) {
      const scheduled = b.scheduledDate.getTime();
      const actual = b.tracking!.actualArrivalTime!.getTime();
      const delayMinutes = (actual - scheduled) / 60000;
      if (delayMinutes <= ON_TIME_TOLERANCE_MIN) onTime += 1;
    }
    return Math.round((onTime / withArrival.length) * 100);
  }
}

export const ratingService = new RatingService();
