import prisma from "../lib/prisma";
import { supportTicketService } from "./support-ticket.service";
import { matchingService } from "./matching.service";

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Customer Intelligence — real data from Rating, SupportTicket, CxSurveyResponse.
 * Survey-based NPS/CSAT preferred when rows exist; otherwise transactional ratings.
 */
export class CustomerIntelligenceService {
  async getIntelligence(days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);

    const [surveyNps, surveyCsat, ratings, tickets, supportAnalytics, repeatStats] = await Promise.all([
      prisma.cxSurveyResponse.findMany({
        where: { surveyType: "NPS", createdAt: { gte: since } },
        select: { score: true },
      }),
      prisma.cxSurveyResponse.findMany({
        where: { surveyType: "CSAT", createdAt: { gte: since } },
        select: { score: true },
      }),
      prisma.rating.findMany({
        where: { createdAt: { gte: since } },
        select: { stars: true, bookingId: true },
      }),
      prisma.supportTicket.findMany({
        where: { createdAt: { gte: since } },
        select: { createdAt: true, category: true, status: true },
      }),
      supportTicketService.adminAnalytics(),
      prisma.$queryRaw<Array<{ total: number; repeaters: number }>>`
        SELECT COUNT(DISTINCT user_id)::int AS total,
               COUNT(DISTINCT user_id) FILTER (
                 WHERE user_id IN (
                   SELECT user_id FROM bookings
                   WHERE status = 'COMPLETED' AND user_id IS NOT NULL
                   GROUP BY user_id HAVING COUNT(*) > 1
                 )
               )::int AS repeaters
        FROM bookings
        WHERE created_at >= ${since} AND user_id IS NOT NULL`,
    ]);

    const nps = this.computeNps(surveyNps.map((s) => s.score), ratings.map((r) => r.stars));
    const csat = this.computeCsat(surveyCsat.map((s) => s.score), ratings.map((r) => r.stars));
    const complaintTrend = this.complaintTrend(tickets);
    const avgStars = ratings.length > 0 ? ratings.reduce((s, r) => s + r.stars, 0) / ratings.length : null;
    const repeatRate =
      repeatStats[0]?.total > 0 ? round2((repeatStats[0].repeaters / repeatStats[0].total) * 100) : null;
    const slaCompliance =
      supportAnalytics.openTotal > 0
        ? round2(Math.max(0, 100 - (supportAnalytics.slaBreached / supportAnalytics.openTotal) * 100))
        : tickets.length > 0
          ? round2(((tickets.filter((t) => t.status === "RESOLVED" || t.status === "CLOSED").length) / tickets.length) * 100)
          : null;

    const happinessScore = this.happinessScore(avgStars, slaCompliance, repeatRate);
    const serviceSatisfactionIndex = avgStars != null ? round2((avgStars / 5) * 100) : null;

    return {
      periodDays: days,
      generatedAt: new Date().toISOString(),
      nps: {
        score: nps.score,
        source: nps.source,
        sampleSize: nps.sampleSize,
        definition: nps.definition,
      },
      csat: {
        scorePct: csat.scorePct,
        source: csat.source,
        sampleSize: csat.sampleSize,
        definition: csat.definition,
      },
      complaintTrend,
      customerHappinessScore: happinessScore,
      serviceSatisfactionIndex,
      components: {
        avgRating: avgStars != null ? round2(avgStars) : null,
        slaCompliancePct: slaCompliance,
        repeatCustomerRatePct: repeatRate,
        ratingsCount: ratings.length,
        ticketsCount: tickets.length,
        surveyNpsCount: surveyNps.length,
        surveyCsatCount: surveyCsat.length,
      },
    };
  }

  private computeNps(surveyScores: number[], ratingStars: number[]) {
    if (surveyScores.length >= 5) {
      const promoters = surveyScores.filter((s) => s >= 9).length;
      const detractors = surveyScores.filter((s) => s <= 6).length;
      const score = round2(((promoters - detractors) / surveyScores.length) * 100);
      return { score, source: "survey" as const, sampleSize: surveyScores.length, definition: "Standard NPS from cx_survey_responses (9-10 promoters, 0-6 detractors)" };
    }
    if (ratingStars.length > 0) {
      const promoters = ratingStars.filter((s) => s === 5).length;
      const detractors = ratingStars.filter((s) => s <= 3).length;
      const score = round2(((promoters - detractors) / ratingStars.length) * 100);
      return {
        score,
        source: "transactional_rating" as const,
        sampleSize: ratingStars.length,
        definition: "Transactional NPS proxy from post-booking ratings (5★ promoters, 1-3★ detractors)",
      };
    }
    return { score: null, source: "missing" as const, sampleSize: 0, definition: "No survey or rating data in period" };
  }

  private computeCsat(surveyScores: number[], ratingStars: number[]) {
    if (surveyScores.length >= 3) {
      const satisfied = surveyScores.filter((s) => s >= 4).length;
      return {
        scorePct: round2((satisfied / surveyScores.length) * 100),
        source: "survey" as const,
        sampleSize: surveyScores.length,
        definition: "CSAT % (score 4-5) from cx_survey_responses",
      };
    }
    if (ratingStars.length > 0) {
      const satisfied = ratingStars.filter((s) => s >= 4).length;
      return {
        scorePct: round2((satisfied / ratingStars.length) * 100),
        source: "transactional_rating" as const,
        sampleSize: ratingStars.length,
        definition: "CSAT % (4-5★) from post-booking ratings",
      };
    }
    return { scorePct: null, source: "missing" as const, sampleSize: 0, definition: "No survey or rating data in period" };
  }

  private complaintTrend(tickets: Array<{ createdAt: Date; category: string; status: string }>) {
    const complaintCats = new Set(["complaint", "dispute", "refund", "quality", "service_issue"]);
    const byDay = new Map<string, number>();
    for (const t of tickets) {
      const cat = t.category.toLowerCase();
      const isComplaint = complaintCats.has(cat) || cat.includes("complaint");
      if (!isComplaint) continue;
      const key = t.createdAt.toISOString().slice(0, 10);
      byDay.set(key, (byDay.get(key) ?? 0) + 1);
    }
    return Array.from(byDay.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count }));
  }

  private happinessScore(
    avgStars: number | null,
    slaCompliance: number | null,
    repeatRate: number | null,
  ): number | null {
    const parts: number[] = [];
    if (avgStars != null) parts.push((avgStars / 5) * 100 * 0.4);
    if (slaCompliance != null) parts.push(slaCompliance * 0.3);
    if (repeatRate != null) parts.push(repeatRate * 0.3);
    if (parts.length === 0) return null;
    const weight = (avgStars != null ? 0.4 : 0) + (slaCompliance != null ? 0.3 : 0) + (repeatRate != null ? 0.3 : 0);
    return round2(parts.reduce((a, b) => a + b, 0) / weight);
  }

  /** Per-customer intelligence profile (bookings, ratings, tenure). */
  async profile(userId: string) {
    const [user, completedBookings, ratings] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, firstName: true, createdAt: true, referralCount: true },
      }),
      prisma.booking.count({ where: { userId, status: "COMPLETED" } }),
      prisma.rating.findMany({
        where: { booking: { userId } },
        select: { stars: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);
    const avgRatingGiven =
      ratings.length > 0 ? round2(ratings.reduce((s, r) => s + r.stars, 0) / ratings.length) : null;
    const tenureDays = user ? Math.floor((Date.now() - user.createdAt.getTime()) / DAY_MS) : 0;
    return {
      data: {
        userId,
        firstName: user?.firstName ?? null,
        completedBookings,
        avgRatingGiven,
        referralCount: user?.referralCount ?? 0,
        tenureDays,
      },
      confidence: completedBookings > 0 ? 0.85 : 0.45,
      freshness: new Date().toISOString(),
    };
  }

  /** Smart provider match near lat/lng for a service. */
  async smartMatch(opts: { lat: number; lng: number; serviceId?: string; limit?: number }) {
    if (!opts.serviceId) {
      return { data: { matches: [] as const }, confidence: 0.2, freshness: new Date().toISOString() };
    }
    const matches = await matchingService.findBestProviders({
      serviceId: opts.serviceId,
      latitude: opts.lat,
      longitude: opts.lng,
      scheduledDate: new Date(),
      maxResults: opts.limit ?? 5,
    });
    return {
      data: { matches },
      confidence: matches.length > 0 ? 0.9 : 0.35,
      freshness: new Date().toISOString(),
    };
  }
}

export const customerIntelligenceService = new CustomerIntelligenceService();
