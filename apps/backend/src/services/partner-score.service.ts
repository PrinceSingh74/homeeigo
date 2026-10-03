import { BookingStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { eventPlatformConfig } from "../events/core/config";
import { emitStandalone } from "../events/core/event-publisher";
import { buildPartnerScoreUpdatedEvent } from "../events/catalog/partner.events";
import {
  computePartnerScore,
  explainScoreChange,
  snapshotKey,
  type ComputedPartnerScore,
  type ScoreFacts,
} from "../lib/partner-score-policy";
import { parsePagination } from "../lib/pagination";
import { toInputJsonArray, toInputJsonObject } from "../lib/json-input";

const ON_TIME_TOLERANCE_MIN = 15;
const TREND_WINDOWS = [7, 30, 90] as const;

type OnTimeRow = { with_arrival: number; on_time: number; late_since: number };

export class PartnerScoreService {
  async getCurrent(providerId: string) {
    const row = await prisma.partnerScore.findUnique({ where: { providerId } });
    if (!row) return this.recalculate(providerId);
    return this.toDto(row, await this.trends(providerId));
  }

  async getHistory(providerId: string, query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination({ ...query, limit: query.limit ?? "20" });
    const [rows, total] = await Promise.all([
      prisma.partnerScoreHistory.findMany({
        where: { providerId },
        orderBy: { createdAt: "desc" },
        skip,
        take: Math.min(limit, 50),
      }),
      prisma.partnerScoreHistory.count({ where: { providerId } }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        previousScore: r.previousScore,
        newScore: r.newScore,
        previousBand: r.previousBand,
        newBand: r.newBand,
        delta: r.delta,
        reasons: r.reasons,
        components: r.components,
        evidence: r.evidence,
        policyVersion: r.policyVersion,
        calculatedAt: r.calculatedAt.toISOString(),
      })),
      page,
      limit,
      total,
    };
  }

  /**
   * Event-driven refresh. Never called from a page-load GET except as a cold-start fill.
   */
  async recalculate(providerId: string): Promise<ReturnType<PartnerScoreService["toDto"]> | null> {
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { id: true, userId: true, complianceRestricted: true },
    });
    if (!provider) return null;

    const previous = await prisma.partnerScore.findUnique({ where: { providerId } });
    const { facts, evidence } = await this.loadFacts(providerId, previous?.calculatedAt ?? null);
    const computed = computePartnerScore(facts);
    const previousComputed = previous ? this.rowToComputed(previous) : null;
    const changed =
      !previous ||
      previous.overallScore !== computed.overallScore ||
      previous.band !== computed.band ||
      SCORE_COMPONENT_CHANGED(previous, computed);

    const now = new Date();
    const row = await prisma.$transaction(async (tx) => {
      const saved = await tx.partnerScore.upsert({
        where: { providerId },
        create: this.persistData(providerId, computed, now),
        update: this.persistData(providerId, computed, now),
      });
      if (changed) {
        const reasons = explainScoreChange(previousComputed, computed, evidence);
        try {
          await tx.partnerScoreHistory.create({
            data: {
              providerId,
              policyVersion: computed.policyVersion,
              snapshotKey: snapshotKey(providerId, computed),
              previousScore: previous?.overallScore ?? null,
              newScore: computed.overallScore,
              previousBand: previous?.band ?? null,
              newBand: computed.band,
              delta:
                computed.overallScore != null && previous?.overallScore != null
                  ? Math.round((computed.overallScore - previous.overallScore) * 10) / 10
                  : computed.overallScore,
              reasons: toInputJsonArray(reasons) ?? [],
              components: toInputJsonObject(computed.components) ?? {},
              evidence: toInputJsonObject(evidence) ?? {},
              calculatedAt: now,
            },
          });
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code !== "P2002") throw err;
        }
      }
      return saved;
    });

    if (changed && previous) {
      await this.emitAndNotify(provider.userId, providerId, previous.overallScore, computed, evidence);
    }

    const { partnerCareerService } = await import("./partner-career.service");
    await partnerCareerService.evaluate(providerId).catch(() => undefined);

    return this.toDto(row, await this.trends(providerId));
  }

  private async emitAndNotify(
    userId: string,
    providerId: string,
    previousScore: number | null,
    computed: ComputedPartnerScore,
    evidence: { lowRatings: number; lateArrivals: number; partnerCancellations: number },
  ) {
    const delta =
      computed.overallScore != null && previousScore != null
        ? Math.round((computed.overallScore - previousScore) * 10) / 10
        : 0;
    if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
      await emitStandalone(
        prisma,
        buildPartnerScoreUpdatedEvent({
          providerId,
          previousScore,
          newScore: computed.overallScore,
          band: computed.band,
          policyVersion: computed.policyVersion,
        }),
      ).catch(() => undefined);
    }
    if (Math.abs(delta) < 1 && computed.band !== "INSUFFICIENT_DATA") return;
    const { notificationService } = await import("./notification.service");
    const reasons = explainScoreChange(null, computed, evidence)
      .slice(0, 3)
      .map((r) => r.detail)
      .join("; ");
    void notificationService
      .createForUser({
        userId,
        type: "partner_score_updated",
        title: "Your partner score changed",
        message:
          computed.overallScore == null
            ? "Your score is waiting on more completed jobs before it can be calculated."
            : `Score is now ${computed.overallScore}/100 (${computed.band.replaceAll("_", " ")}). ${reasons}`,
        referenceId: providerId,
        referenceType: "partner_score",
      })
      .catch(() => undefined);
  }

  private persistData(providerId: string, computed: ComputedPartnerScore, now: Date) {
    return {
      providerId,
      policyVersion: computed.policyVersion,
      overallScore: computed.overallScore,
      band: computed.band,
      quality: computed.components.quality,
      reliability: computed.components.reliability,
      completion: computed.components.completion,
      onTime: computed.components.onTime,
      customerSatisfaction: computed.components.customerSatisfaction,
      compliance: computed.components.compliance,
      safety: computed.components.safety,
      qualityWeight: computed.weights.quality,
      reliabilityWeight: computed.weights.reliability,
      completionWeight: computed.weights.completion,
      onTimeWeight: computed.weights.onTime,
      csatWeight: computed.weights.customerSatisfaction,
      complianceWeight: computed.weights.compliance,
      safetyWeight: computed.weights.safety,
      sampleCompletedJobs: computed.sampleCompletedJobs,
      sampleRatings: computed.sampleRatings,
      sampleArrivals: computed.sampleArrivals,
      sampleAssignments: computed.sampleAssignments,
      calculatedAt: now,
    };
  }

  private rowToComputed(row: {
    policyVersion: string;
    overallScore: number | null;
    band: ComputedPartnerScore["band"];
    quality: number | null;
    reliability: number | null;
    completion: number | null;
    onTime: number | null;
    customerSatisfaction: number | null;
    compliance: number | null;
    safety: number | null;
    qualityWeight: number;
    reliabilityWeight: number;
    completionWeight: number;
    onTimeWeight: number;
    csatWeight: number;
    complianceWeight: number;
    safetyWeight: number;
    sampleCompletedJobs: number;
    sampleRatings: number;
    sampleArrivals: number;
    sampleAssignments: number;
  }): ComputedPartnerScore {
    const components = {
      quality: row.quality,
      reliability: row.reliability,
      completion: row.completion,
      onTime: row.onTime,
      customerSatisfaction: row.customerSatisfaction,
      compliance: row.compliance,
      safety: row.safety,
    };
    return {
      policyVersion: row.policyVersion as ComputedPartnerScore["policyVersion"],
      overallScore: row.overallScore,
      band: row.band,
      components,
      componentDetails: [],
      weights: {
        quality: row.qualityWeight,
        reliability: row.reliabilityWeight,
        completion: row.completionWeight,
        onTime: row.onTimeWeight,
        customerSatisfaction: row.csatWeight,
        compliance: row.complianceWeight,
        safety: row.safetyWeight,
      },
      sampleCompletedJobs: row.sampleCompletedJobs,
      sampleRatings: row.sampleRatings,
      sampleArrivals: row.sampleArrivals,
      sampleAssignments: row.sampleAssignments,
    };
  }

  private toDto(
    row: Awaited<ReturnType<typeof prisma.partnerScore.findUnique>> extends infer T ? NonNullable<T> : never,
    trends: Awaited<ReturnType<PartnerScoreService["trends"]>>,
  ) {
    return {
      policyVersion: row.policyVersion,
      overallScore: row.overallScore,
      band: row.band,
      components: {
        quality: { value: row.quality, weight: row.qualityWeight },
        reliability: { value: row.reliability, weight: row.reliabilityWeight },
        completion: { value: row.completion, weight: row.completionWeight },
        onTime: { value: row.onTime, weight: row.onTimeWeight },
        customerSatisfaction: { value: row.customerSatisfaction, weight: row.csatWeight },
        compliance: { value: row.compliance, weight: row.complianceWeight },
        safety: { value: row.safety, weight: row.safetyWeight },
      },
      sample: {
        completedJobs: row.sampleCompletedJobs,
        ratings: row.sampleRatings,
        arrivals: row.sampleArrivals,
        assignments: row.sampleAssignments,
      },
      calculatedAt: row.calculatedAt.toISOString(),
      trends,
    };
  }

  private async trends(providerId: string) {
    const out: Record<string, { delta: number | null; insufficient: boolean }> = {};
    for (const days of TREND_WINDOWS) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const [oldest, newest] = await Promise.all([
        prisma.partnerScoreHistory.findFirst({
          where: { providerId, createdAt: { gte: since } },
          orderBy: { createdAt: "asc" },
          select: { id: true, newScore: true },
        }),
        prisma.partnerScoreHistory.findFirst({
          where: { providerId, createdAt: { gte: since } },
          orderBy: { createdAt: "desc" },
          select: { id: true, newScore: true },
        }),
      ]);
      if (!oldest || !newest || oldest.newScore == null || newest.newScore == null || oldest.id === newest.id) {
        out[`${days}d`] = { delta: null, insufficient: true };
      } else {
        out[`${days}d`] = {
          delta: Math.round((newest.newScore - oldest.newScore) * 10) / 10,
          insufficient: false,
        };
      }
    }
    return out;
  }

  async loadFacts(
    providerId: string,
    since: Date | null,
  ): Promise<{ facts: ScoreFacts; evidence: { lowRatings: number; lateArrivals: number; partnerCancellations: number } }> {
    const sinceDate = since ?? new Date(0);
    const [
      provider,
      ratingCount,
      highStars,
      ratingAgg,
      totalBookings,
      completedJobs,
      partnerCancellations,
      totalAssignments,
      acceptedAssignments,
      onTime,
      documentsTotal,
      documentsVerified,
      kyc,
      risk,
      lowRatingsSince,
      cancellationsSince,
    ] = await Promise.all([
      prisma.provider.findUnique({
        where: { id: providerId },
        select: { rating: true, complianceRestricted: true, user: { select: { kycStatus: true } } },
      }),
      prisma.rating.count({ where: { providerId } }),
      prisma.rating.count({ where: { providerId, stars: { gte: 4 } } }),
      prisma.rating.aggregate({ where: { providerId }, _avg: { stars: true } }),
      prisma.booking.count({ where: { providerId } }),
      prisma.booking.count({ where: { providerId, status: BookingStatus.COMPLETED } }),
      prisma.booking.count({ where: { providerId, status: BookingStatus.CANCELLED_BY_PROVIDER } }),
      prisma.assignmentAttempt.count({ where: { providerId } }),
      prisma.assignmentAttempt.count({ where: { providerId, status: "ACCEPTED" } }),
      prisma.$queryRaw<OnTimeRow[]>`
        SELECT
          COUNT(*)::int AS with_arrival,
          COUNT(*) FILTER (
            WHERE EXTRACT(EPOCH FROM (t.actual_arrival_time - b.scheduled_date)) / 60.0 <= ${ON_TIME_TOLERANCE_MIN}
          )::int AS on_time,
          COUNT(*) FILTER (
            WHERE t.actual_arrival_time >= ${sinceDate}
              AND EXTRACT(EPOCH FROM (t.actual_arrival_time - b.scheduled_date)) / 60.0 > ${ON_TIME_TOLERANCE_MIN}
          )::int AS late_since
        FROM bookings b
        INNER JOIN tracking t ON t.booking_id = b.id
        WHERE b.provider_id = ${providerId}
          AND b.status = 'COMPLETED'
          AND t.actual_arrival_time IS NOT NULL
      `,
      prisma.providerDocument.count({ where: { providerId } }),
      prisma.providerDocument.count({ where: { providerId, isVerified: true } }),
      prisma.provider.findUnique({
        where: { id: providerId },
        select: { user: { select: { kycStatus: true } }, isVerified: true },
      }),
      prisma.partnerRiskProfile.findUnique({
        where: { providerId },
        select: { reviewStatus: true },
      }),
      prisma.rating.count({ where: { providerId, stars: { lte: 2 }, createdAt: { gte: sinceDate } } }),
      prisma.booking.count({
        where: { providerId, status: BookingStatus.CANCELLED_BY_PROVIDER, cancelledAt: { gte: sinceDate } },
      }),
    ]);

    const ot = onTime[0] ?? { with_arrival: 0, on_time: 0, late_since: 0 };
    const rating = ratingAgg._avg.stars ?? provider?.rating ?? 0;

    return {
      facts: {
        rating,
        ratingCount,
        highStarCount: highStars,
        completedJobs,
        totalBookings,
        partnerCancellations,
        acceptedAssignments,
        totalAssignments,
        onTimeArrivals: ot.on_time,
        arrivalsWithTracking: ot.with_arrival,
        documentsTotal,
        documentsVerified,
        kycVerified: kyc?.user.kycStatus === "APPROVED" || kyc?.isVerified === true,
        complianceRestricted: provider?.complianceRestricted ?? false,
        reviewStatus: risk?.reviewStatus ?? null,
      },
      evidence: {
        lowRatings: lowRatingsSince,
        lateArrivals: ot.late_since,
        partnerCancellations: cancellationsSince,
      },
    };
  }
}

function SCORE_COMPONENT_CHANGED(
  previous: { quality: number | null; reliability: number | null; completion: number | null; onTime: number | null; customerSatisfaction: number | null; compliance: number | null; safety: number | null },
  computed: ComputedPartnerScore,
): boolean {
  return (
    previous.quality !== computed.components.quality ||
    previous.reliability !== computed.components.reliability ||
    previous.completion !== computed.components.completion ||
    previous.onTime !== computed.components.onTime ||
    previous.customerSatisfaction !== computed.components.customerSatisfaction ||
    previous.compliance !== computed.components.compliance ||
    previous.safety !== computed.components.safety
  );
}

export const partnerScoreService = new PartnerScoreService();
