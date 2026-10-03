import type { PartnerCareerLevel } from "@prisma/client";
import prisma from "../lib/prisma";
import { eventPlatformConfig } from "../events/core/config";
import { emitStandalone } from "../events/core/event-publisher";
import { buildPartnerLevelChangedEvent } from "../events/catalog/partner.events";
import {
  CAREER_BADGE_LABELS,
  computeCareerProgress,
  promotionReason,
  resolveCareerLevel,
  type CareerFacts,
} from "../lib/partner-career-policy";
import { parsePagination } from "../lib/pagination";
import { toInputJsonObject } from "../lib/json-input";
import { canonicalizeLifecycle } from "../lib/partner-lifecycle-fsm";

export class PartnerCareerService {
  async getCurrent(providerId: string) {
    const provider = await this.loadProvider(providerId);
    if (!provider) return null;
    const facts = await this.loadFacts(provider);
    const progress = computeCareerProgress(provider.careerLevel, facts);
    const badges = await prisma.partnerBadgeAward.findMany({
      where: { providerId, revokedAt: null },
      orderBy: { awardedAt: "desc" },
    });
    return {
      ...progress,
      currentLevel: provider.careerLevel,
      badges: badges.map((b) => ({
        code: b.badgeCode,
        label: CAREER_BADGE_LABELS[b.badgeCode] ?? b.badgeCode,
        awardedAt: b.awardedAt.toISOString(),
        reason: b.reason,
      })),
      providerBadges: provider.badges,
    };
  }

  async getHistory(providerId: string, query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination({ ...query, limit: query.limit ?? "20" });
    const [rows, total] = await Promise.all([
      prisma.partnerCareerHistory.findMany({
        where: { providerId },
        orderBy: { createdAt: "desc" },
        skip,
        take: Math.min(limit, 50),
      }),
      prisma.partnerCareerHistory.count({ where: { providerId } }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        previousLevel: r.previousLevel,
        newLevel: r.newLevel,
        reason: r.reason,
        qualifyingMetrics: r.qualifyingMetrics,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      limit,
      total,
    };
  }

  async evaluate(providerId: string) {
    const provider = await this.loadProvider(providerId);
    if (!provider) return null;
    const facts = await this.loadFacts(provider);
    const resolution = resolveCareerLevel(provider.careerLevel, facts);
    if (resolution.promoted) {
      await prisma.$transaction(async (tx) => {
        const updated = await tx.provider.updateMany({
          where: { id: providerId, careerLevel: provider.careerLevel },
          data: { careerLevel: resolution.nextStored },
        });
        if (updated.count === 0) return;
        await tx.partnerCareerHistory.create({
          data: {
            providerId,
            previousLevel: provider.careerLevel,
            newLevel: resolution.nextStored,
            reason: promotionReason(resolution.nextStored, facts),
            qualifyingMetrics: toInputJsonObject({
              completedJobs: facts.completedJobs,
              rating: facts.rating,
              completionRate: facts.completionRate,
              onTimeRate: facts.onTimeRate,
              certifications: facts.certifications,
              academyCompleted: facts.academyCompleted,
            }) ?? {},
          },
        });
      });
      await this.notifyPromotion(provider.userId, providerId, provider.careerLevel, resolution.nextStored, facts);
    }
    await this.syncBadgeAwards(providerId, provider.badges, facts);
    return this.getCurrent(providerId);
  }

  private async notifyPromotion(
    userId: string,
    providerId: string,
    from: PartnerCareerLevel,
    to: PartnerCareerLevel,
    facts: CareerFacts,
  ) {
    if (eventPlatformConfig.outboxEnabled && eventPlatformConfig.partnerEventsEnabled) {
      await emitStandalone(
        prisma,
        buildPartnerLevelChangedEvent({
          providerId,
          previousLevel: from,
          newLevel: to,
        }),
      ).catch(() => undefined);
    }
    const { notificationService } = await import("./notification.service");
    void notificationService
      .createForUser({
        userId,
        type: "partner_level_changed",
        title: `You reached ${to.replaceAll("_", " ")}`,
        message: `Promoted from ${from} to ${to}. ${promotionReason(to, facts)}`,
        referenceId: providerId,
        referenceType: "partner_career",
      })
      .catch(() => undefined);
  }

  /**
   * Audit existing Provider.badges[] (canonical awarder: rating.service.awardBadges).
   * Safety Champion is awarded only from approved CLEARED risk status + no compliance restriction.
   */
  async syncBadgeAwards(providerId: string, currentBadges: string[], facts: CareerFacts) {
    const extra: string[] = [];
    if (!facts.complianceRestricted && canonicalizeLifecycle(facts.lifecycleState) === "ACTIVE") {
      const risk = await prisma.partnerRiskProfile.findUnique({
        where: { providerId },
        select: { reviewStatus: true },
      });
      if (risk?.reviewStatus === "CLEARED") extra.push("safety_champion");
    }
    const desired = Array.from(new Set([...currentBadges, ...extra]));
    const existing = await prisma.partnerBadgeAward.findMany({ where: { providerId } });
    const byCode = new Map(existing.map((e) => [e.badgeCode, e]));

    for (const code of desired) {
      const row = byCode.get(code);
      if (!row) {
        await prisma.partnerBadgeAward.create({
          data: {
            providerId,
            badgeCode: code,
            reason: CAREER_BADGE_LABELS[code] ?? code,
            qualifyingMetrics: toInputJsonObject({
              completedJobs: facts.completedJobs,
              rating: facts.rating,
              completionRate: facts.completionRate,
            }) ?? undefined,
          },
        }).catch(() => undefined);
      } else if (row.revokedAt) {
        await prisma.partnerBadgeAward.update({
          where: { id: row.id },
          data: { revokedAt: null, awardedAt: new Date() },
        });
      }
    }
    for (const row of existing) {
      if (!desired.includes(row.badgeCode) && !row.revokedAt) {
        await prisma.partnerBadgeAward.update({
          where: { id: row.id },
          data: { revokedAt: new Date() },
        });
      }
    }
  }

  private async loadProvider(providerId: string) {
    return prisma.provider.findUnique({
      where: { id: providerId },
      select: {
        id: true,
        userId: true,
        careerLevel: true,
        lifecycleState: true,
        badges: true,
        rating: true,
        completedBookings: true,
        completionRate: true,
        onTimeRate: true,
        certifications: true,
        complianceRestricted: true,
      },
    });
  }

  private async loadFacts(
    provider: NonNullable<Awaited<ReturnType<PartnerCareerService["loadProvider"]>>>,
  ): Promise<CareerFacts> {
    const academyCompleted = await prisma.partnerAcademyProgress.count({
      where: { providerId: provider.id, completedAt: { not: null } },
    });
    return {
      completedJobs: provider.completedBookings,
      rating: provider.rating,
      completionRate: provider.completionRate,
      onTimeRate: provider.onTimeRate,
      certifications: provider.certifications.length,
      academyCompleted,
      complianceRestricted: provider.complianceRestricted,
      lifecycleState: provider.lifecycleState,
    };
  }
}

export const partnerCareerService = new PartnerCareerService();
