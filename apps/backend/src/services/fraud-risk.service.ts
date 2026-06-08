import { FraudRiskLevel } from "@prisma/client";
import prisma from "../lib/prisma";
import { fraudSignalService } from "./fraud-signal.service";
import type { FraudContext } from "../lib/fraud-context";

export type RiskEvaluation = {
  score: number;
  level: FraudRiskLevel;
  factors: string[];
  blockSignup: boolean;
  blockCommission: boolean;
  freezeCommission: boolean;
};

const levelFromScore = (score: number): FraudRiskLevel => {
  if (score >= 85) return FraudRiskLevel.CRITICAL;
  if (score >= 65) return FraudRiskLevel.HIGH;
  if (score >= 35) return FraudRiskLevel.MEDIUM;
  return FraudRiskLevel.LOW;
};

export class FraudRiskService {
  async evaluateUser(userId: string, ctx?: FraudContext): Promise<RiskEvaluation> {
    const factors: string[] = [];
    let score = 0;

    if (ctx?.deviceId) {
      const shared = await fraudSignalService.usersSharingDevice(ctx.deviceId, userId);
      if (shared.length >= 3) {
        score += 40;
        factors.push(`device_shared_${shared.length}_accounts`);
      } else if (shared.length >= 1) {
        score += 20;
        factors.push(`device_shared_${shared.length}_account`);
      }
    }

    if (ctx?.ipAddress && ctx.ipAddress !== "unknown") {
      const sharedIp = await fraudSignalService.usersSharingIp(ctx.ipAddress, userId);
      if (sharedIp.length >= 5) {
        score += 35;
        factors.push(`ip_shared_${sharedIp.length}_accounts`);
      } else if (sharedIp.length >= 2) {
        score += 15;
        factors.push(`ip_shared_${sharedIp.length}_accounts`);
      }
      const signupVel = await fraudSignalService.signupVelocity(ctx.ipAddress);
      if (signupVel >= 5) {
        score += 30;
        factors.push(`signup_velocity_${signupVel}_per_hour`);
      }
    }

    if (ctx?.browserFingerprint) {
      const shared = await fraudSignalService.usersSharingBrowserFingerprint(
        ctx.browserFingerprint,
        userId,
      );
      if (shared.length >= 2) {
        score += 25;
        factors.push(`browser_fingerprint_shared_${shared.length}`);
      }
    }

    const referralVel = await fraudSignalService.referralVelocity(userId);
    if (referralVel >= 10) {
      score += 30;
      factors.push(`referral_velocity_${referralVel}_24h`);
    } else if (referralVel >= 5) {
      score += 15;
      factors.push(`referral_velocity_${referralVel}_24h`);
    }

    const [pending, qualified] = await Promise.all([
      prisma.referralTransaction.count({ where: { referrerId: userId, status: "PENDING" } }),
      prisma.referralTransaction.count({ where: { referrerId: userId, status: "QUALIFIED" } }),
    ]);
    if (pending >= 5 && qualified === 0) {
      score += 25;
      factors.push("referral_farming_pending_no_qualified");
    }
    if (pending > 0 && qualified > 0) {
      const conversion = qualified / (pending + qualified);
      if (conversion < 0.1 && pending >= 3) {
        score += 20;
        factors.push("abnormal_low_conversion");
      }
    }

    const frozenCount = await prisma.referralCommission.count({
      where: { referrerId: userId, status: { in: ["FROZEN", "REVIEW"] } },
    });
    if (frozenCount > 0) {
      score += 10;
      factors.push(`has_${frozenCount}_frozen_commissions`);
    }

    const withdrawalCount = await prisma.referralWithdrawal.count({
      where: { userId, createdAt: { gte: new Date(Date.now() - 24 * 3600_000) } },
    });
    if (withdrawalCount >= 3) {
      score += 15;
      factors.push(`withdrawal_velocity_${withdrawalCount}_24h`);
    }

    score = Math.min(100, score);
    const level = levelFromScore(score);

    await prisma.fraudRiskScore.upsert({
      where: { userId },
      create: { userId, score, level, factors: JSON.stringify(factors) },
      update: { score, level, factors: JSON.stringify(factors), lastEvaluatedAt: new Date() },
    });

    const hasSelfReferral = factors.some((f) => f.includes("self_referral") || f.startsWith("same_device") || f.startsWith("same_browser"));
    return {
      score,
      level,
      factors,
      blockSignup: false,
      blockCommission: score >= 85 || hasSelfReferral,
      freezeCommission: score >= 65,
    };
  }

  async evaluateReferralPair(
    referrerId: string,
    refereeId: string,
    ctx: FraudContext,
  ): Promise<RiskEvaluation> {
    const factors: string[] = [];
    let score = 0;

    const shared = await fraudSignalService.referrerRefereeShareSignals(referrerId, refereeId, ctx);
    for (const m of shared) {
      if (m === "same_device" || m === "same_device_fingerprint") {
        score += 50;
        factors.push("self_referral_same_device");
      }
      if (m === "same_ip") {
        score += 30;
        factors.push("self_referral_same_ip");
      }
      if (m === "same_browser") {
        score += 40;
        factors.push("self_referral_same_browser");
      }
    }

    const referrerRisk = await this.evaluateUser(referrerId, ctx);
    score += Math.round(referrerRisk.score * 0.3);
    factors.push(...referrerRisk.factors.map((f) => `referrer_${f}`));

    score = Math.min(100, score);
    const level = levelFromScore(score);

    const hasSelfReferral = shared.length > 0 || factors.some((f) => f.includes("self_referral"));
    return {
      score,
      level,
      factors,
      blockSignup: hasSelfReferral || score >= 90,
      blockCommission: score >= 70 || hasSelfReferral,
      freezeCommission: score >= 50 || hasSelfReferral,
    };
  }
}

export const fraudRiskService = new FraudRiskService();
