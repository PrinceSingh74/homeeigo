import { CampaignStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { AuditLogService } from "./audit-log.service";
import { entitlementService } from "./entitlement.service";

export type CampaignEligibilityMeta = {
  ipAddress?: string;
  deviceId?: string;
};

class CampaignLimitsService {
  async checkEligibility(
    userId: string,
    campaignId: string,
    _meta: CampaignEligibilityMeta = {},
  ): Promise<{
    eligible: boolean;
    reason?: string;
    remainingRedemptions?: number;
  }> {
    try {
      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
          usages: {
            where: { userId },
            select: { id: true },
          },
        },
      });

      if (!campaign) {
        return { eligible: false, reason: "Campaign not found" };
      }

      if (campaign.status !== CampaignStatus.ACTIVE) {
        return { eligible: false, reason: "Campaign not active" };
      }

      const now = new Date();
      if (campaign.startsAt && campaign.startsAt > now) {
        return { eligible: false, reason: "Campaign not started" };
      }
      if (campaign.expiresAt && campaign.expiresAt < now) {
        return { eligible: false, reason: "Campaign expired" };
      }

      const userRedemptions = campaign.usages.length;
      if (userRedemptions >= campaign.maxRedemptionsPerUser) {
        return {
          eligible: false,
          reason: "You have already redeemed this campaign",
          remainingRedemptions: 0,
        };
      }

      if (campaign.maxRedemptions != null && campaign.redemptionCount >= campaign.maxRedemptions) {
        return { eligible: false, reason: "Campaign redemption limit reached" };
      }

      if (campaign.premiumOnly) {
        const entitlements = await entitlementService.resolve(userId);
        if (!entitlements.hasMembership) {
          return { eligible: false, reason: "Membership required for this campaign" };
        }
      }

      return {
        eligible: true,
        remainingRedemptions: campaign.maxRedemptionsPerUser - userRedemptions,
      };
    } catch (err) {
      console.error("Campaign eligibility check failed:", err);
      return { eligible: false, reason: "Eligibility check failed" };
    }
  }

  async isDuplicateRedemption(userId: string, campaignId: string): Promise<boolean> {
    const count = await prisma.couponUsage.count({
      where: { userId, campaignId },
    });
    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { maxRedemptionsPerUser: true },
    });
    if (!campaign) return true;
    return count >= campaign.maxRedemptionsPerUser;
  }

  async assertCanRedeem(userId: string, campaignId: string, meta?: CampaignEligibilityMeta): Promise<void> {
    const eligibility = await this.checkEligibility(userId, campaignId, meta);
    if (!eligibility.eligible) {
      throw new Error(eligibility.reason ?? "Campaign not eligible");
    }
    if (await this.isDuplicateRedemption(userId, campaignId)) {
      throw new Error("Campaign already redeemed");
    }
  }

  async cleanupOldRedemptions(): Promise<number> {
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const result = await prisma.couponUsage.deleteMany({
      where: {
        createdAt: { lt: ninetyDaysAgo },
        campaign: { expiresAt: { lt: ninetyDaysAgo } },
      },
    });
    return result.count;
  }
}

export const campaignLimitsService = new CampaignLimitsService();
