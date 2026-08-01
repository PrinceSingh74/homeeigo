import { CampaignStatus, CampaignType } from "@prisma/client";
import prisma from "../lib/prisma";
import { parsePagination } from "../lib/pagination";
import { campaignLimitsService } from "./campaign-limits.service";
import { AuditLogService } from "./audit-log.service";

export type CampaignDiscountResult =
  | { ok: true; campaignId: string; code: string; discount: number; type: CampaignType }
  | { ok: false; error: string };

/**
 * Premium Campaigns — server-validated coupons, promotions, bundles, offers.
 */
export class CampaignService {
  async validateForUser(
    userId: string,
    code: string,
    baseAmount: number,
  ): Promise<CampaignDiscountResult> {
    const campaign = await prisma.campaign.findUnique({
      where: { code: code.trim().toUpperCase() },
    });
    if (!campaign) return { ok: false, error: "INVALID_CODE" };
    if (campaign.status !== CampaignStatus.ACTIVE) return { ok: false, error: "CAMPAIGN_INACTIVE" };

    const now = new Date();
    if (campaign.startsAt && campaign.startsAt > now) return { ok: false, error: "NOT_STARTED" };
    if (campaign.expiresAt && campaign.expiresAt < now) return { ok: false, error: "EXPIRED" };
    if (campaign.maxRedemptions != null && campaign.redemptionCount >= campaign.maxRedemptions) {
      return { ok: false, error: "MAX_REDEMPTIONS" };
    }
    if (campaign.minOrderAmount != null && baseAmount < campaign.minOrderAmount) {
      return { ok: false, error: "MIN_ORDER_NOT_MET" };
    }

    const eligibility = await campaignLimitsService.checkEligibility(userId, campaign.id);
    if (!eligibility.eligible) {
      const code =
        eligibility.reason === "You have already redeemed this campaign"
          ? "ALREADY_REDEEMED"
          : eligibility.reason === "Campaign redemption limit reached"
            ? "MAX_REDEMPTIONS"
            : eligibility.reason === "Membership required for this campaign"
              ? "PREMIUM_REQUIRED"
              : "CAMPAIGN_INELIGIBLE";
      return { ok: false, error: code };
    }

    const discount = this.computeDiscount(campaign.discountPct, campaign.discountAmount, baseAmount);
    if (discount <= 0) return { ok: false, error: "NO_DISCOUNT" };

    return {
      ok: true,
      campaignId: campaign.id,
      code: campaign.code,
      discount,
      type: campaign.type,
    };
  }

  private computeDiscount(pct: number | null, flat: number | null, baseAmount: number): number {
    let discount = 0;
    if (pct != null && pct > 0) discount = Math.round((baseAmount * pct) / 100);
    if (flat != null && flat > 0) discount = Math.max(discount, Math.round(flat));
    return Math.min(discount, baseAmount);
  }

  async recordRedemption(
    campaignId: string,
    userId: string,
    bookingId: string,
    discountApplied: number,
    revenueBefore: number,
    revenueAfter: number,
  ) {
    await campaignLimitsService.assertCanRedeem(userId, campaignId);

    await prisma.$transaction([
      prisma.couponUsage.create({
        data: {
          campaignId,
          userId,
          bookingId,
          discountApplied,
          revenueBefore,
          revenueAfter,
        },
      }),
      prisma.campaign.update({
        where: { id: campaignId },
        data: { redemptionCount: { increment: 1 } },
      }),
    ]);

    void AuditLogService.record("CAMPAIGN_REDEEMED", "success", {
      userId,
      bookingId,
      details: { campaignId, discountApplied, revenueBefore, revenueAfter },
    });
  }

  async adminList(query: Record<string, string | undefined> = {}) {
    const { page, limit, skip } = parsePagination(query);
    const where: { status?: CampaignStatus; type?: CampaignType } = {};
    if (query.status) where.status = query.status.toUpperCase() as CampaignStatus;
    if (query.type) where.type = query.type.toUpperCase() as CampaignType;

    const [rows, total] = await Promise.all([
      prisma.campaign.findMany({ where, skip, take: limit, orderBy: { createdAt: "desc" } }),
      prisma.campaign.count({ where }),
    ]);

    return {
      campaigns: rows.map((c) => this.serialize(c)),
      total,
      page,
    };
  }

  async adminCreate(data: {
    code: string;
    name: string;
    description?: string;
    type: CampaignType;
    premiumOnly?: boolean;
    discountPct?: number;
    discountAmount?: number;
    minOrderAmount?: number;
    maxRedemptions?: number;
    maxRedemptionsPerUser?: number;
    startsAt?: string;
    expiresAt?: string;
    metadata?: string;
    status?: CampaignStatus;
  }) {
    const campaign = await prisma.campaign.create({
      data: {
        code: data.code.trim().toUpperCase(),
        name: data.name,
        description: data.description,
        type: data.type,
        status: data.status ?? CampaignStatus.DRAFT,
        premiumOnly: data.premiumOnly ?? true,
        discountPct: data.discountPct,
        discountAmount: data.discountAmount,
        minOrderAmount: data.minOrderAmount,
        maxRedemptions: data.maxRedemptions,
        maxRedemptionsPerUser: data.maxRedemptionsPerUser ?? 1,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
        metadata: data.metadata,
      },
    });
    return this.serialize(campaign);
  }

  async adminUpdate(
    id: string,
    data: Partial<{
      name: string;
      description: string;
      status: CampaignStatus;
      premiumOnly: boolean;
      discountPct: number;
      discountAmount: number;
      minOrderAmount: number;
      maxRedemptions: number;
      startsAt: string;
      expiresAt: string;
      metadata: string;
    }>,
  ) {
    const campaign = await prisma.campaign.update({
      where: { id },
      data: {
        ...data,
        startsAt: data.startsAt ? new Date(data.startsAt) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });
    return this.serialize(campaign);
  }

  async adminAnalytics(campaignId?: string) {
    const where = campaignId ? { campaignId } : {};
    const [usages, revenue] = await Promise.all([
      prisma.couponUsage.count({ where }),
      prisma.couponUsage.aggregate({
        where,
        _sum: { discountApplied: true, revenueBefore: true, revenueAfter: true },
      }),
    ]);

    const byCampaign = await prisma.couponUsage.groupBy({
      by: ["campaignId"],
      _count: true,
      _sum: { discountApplied: true, revenueAfter: true },
      orderBy: { _count: { campaignId: "desc" } },
      take: 20,
    });

    const campaignIds = byCampaign.map((b) => b.campaignId);
    const campaigns = await prisma.campaign.findMany({
      where: { id: { in: campaignIds } },
      select: { id: true, code: true, name: true, type: true },
    });
    const cmap = new Map(campaigns.map((c) => [c.id, c]));

    const revenueBefore = revenue._sum.revenueBefore ?? 0;
    const revenueAfter = revenue._sum.revenueAfter ?? 0;

    return {
      totalRedemptions: usages,
      totalDiscountGiven: revenue._sum.discountApplied ?? 0,
      revenueBefore,
      revenueAfter,
      conversionImpactPct:
        revenueBefore > 0 ? Math.round(((revenueAfter / revenueBefore) * 100 - 100) * 10) / 10 : 0,
      byCampaign: byCampaign.map((b) => ({
        campaignId: b.campaignId,
        code: cmap.get(b.campaignId)?.code,
        name: cmap.get(b.campaignId)?.name,
        type: cmap.get(b.campaignId)?.type?.toLowerCase(),
        redemptions: b._count,
        discountGiven: b._sum.discountApplied ?? 0,
        revenue: b._sum.revenueAfter ?? 0,
      })),
    };
  }

  private serialize(c: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    type: CampaignType;
    status: CampaignStatus;
    premiumOnly: boolean;
    discountPct: number | null;
    discountAmount: number | null;
    minOrderAmount: number | null;
    maxRedemptions: number | null;
    redemptionCount: number;
    startsAt: Date | null;
    expiresAt: Date | null;
    metadata: string | null;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      description: c.description,
      type: c.type.toLowerCase(),
      status: c.status.toLowerCase(),
      premiumOnly: c.premiumOnly,
      discountPct: c.discountPct,
      discountAmount: c.discountAmount,
      minOrderAmount: c.minOrderAmount,
      maxRedemptions: c.maxRedemptions,
      redemptionCount: c.redemptionCount,
      startsAt: c.startsAt,
      expiresAt: c.expiresAt,
      metadata: c.metadata,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}

export const campaignService = new CampaignService();
