import { CommissionStatus, FraudAlertStatus, FraudEventType, FraudRiskLevel } from "@prisma/client";
import prisma from "../lib/prisma";
import { fraudSignalService } from "./fraud-signal.service";
import { fraudRiskService } from "./fraud-risk.service";
import { emailDeliveryService } from "./email-delivery.service";
import type { FraudContext } from "../lib/fraud-context";

function notifyFraudAlert(title: string, description: string, severity: FraudRiskLevel) {
  const adminEmail = process.env.ADMIN_EMAIL || process.env.FRAUD_ALERT_EMAIL;
  if (!adminEmail) return;
  emailDeliveryService.sendFraudAlert(adminEmail, title, `${description} (severity: ${severity})`);
}

export class ReferralFraudService {
  async logDecision(opts: {
    actorId?: string;
    action: string;
    targetUserId?: string;
    targetCommissionId?: string;
    targetReferralId?: string;
    reason?: string;
    metadata?: Record<string, unknown>;
  }) {
    await prisma.fraudDecisionLog.create({
      data: {
        actorId: opts.actorId ?? "system",
        action: opts.action,
        targetUserId: opts.targetUserId,
        targetCommissionId: opts.targetCommissionId,
        targetReferralId: opts.targetReferralId,
        reason: opts.reason,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
      },
    });
  }

  async createAlert(opts: {
    userId?: string;
    referralTransactionId?: string;
    commissionId?: string;
    category: string;
    severity: FraudRiskLevel;
    title: string;
    description: string;
    metadata?: Record<string, unknown>;
  }) {
    return prisma.fraudAlert.create({
      data: {
        userId: opts.userId,
        referralTransactionId: opts.referralTransactionId,
        commissionId: opts.commissionId,
        category: opts.category,
        severity: opts.severity,
        title: opts.title,
        description: opts.description,
        metadata: opts.metadata ? JSON.stringify(opts.metadata) : undefined,
      },
    }).then((alert) => {
      if (opts.severity === FraudRiskLevel.HIGH || opts.severity === FraudRiskLevel.CRITICAL) {
        notifyFraudAlert(opts.title, opts.description, opts.severity);
      }
      return alert;
    });
  }

  /** Evaluate referral signup; returns false if referral should be blocked. */
  async onReferralSignup(
    referrerId: string,
    refereeId: string,
    code: string,
    ctx: FraudContext,
  ): Promise<{ allowed: boolean; riskScore: number; reasons: string[] }> {
    await fraudSignalService.capture(FraudEventType.SIGNUP, { ...ctx, userId: refereeId }, {
      id: refereeId,
      type: "user",
    });
    // Referral velocity only — do not attach referee device/IP to referrer identity history.
    await fraudSignalService.capture(FraudEventType.REFERRAL, { userId: referrerId }, {
      id: refereeId,
      type: "referral_signup",
    });

    const eval_ = await fraudRiskService.evaluateReferralPair(referrerId, refereeId, ctx);

    if (eval_.blockSignup) {
      await this.createAlert({
        userId: referrerId,
        category: eval_.factors.some((f) => f.includes("self_referral"))
          ? "SELF_REFERRAL"
          : "MULTI_ACCOUNT",
        severity: eval_.level,
        title: "Referral signup blocked by fraud engine",
        description: eval_.factors.join("; "),
        metadata: { refereeId, code, score: eval_.score },
      });
      await this.logDecision({
        action: "BLOCK_REFERRAL",
        targetUserId: referrerId,
        targetReferralId: refereeId,
        reason: eval_.factors.join("; "),
        metadata: { refereeId, score: eval_.score },
      });
      return { allowed: false, riskScore: eval_.score, reasons: eval_.factors };
    }

    if (eval_.freezeCommission || eval_.level === FraudRiskLevel.HIGH) {
      await this.createAlert({
        userId: referrerId,
        category: "REFERRAL_FARMING",
        severity: eval_.level,
        title: "High-risk referral signup flagged",
        description: eval_.factors.join("; "),
        metadata: { refereeId, code },
      });
    }

    return { allowed: true, riskScore: eval_.score, reasons: eval_.factors };
  }

  /** Resolve commission status after booking qualification. */
  async commissionStatusForQualification(
    referrerId: string,
    refereeId: string,
    ctx: FraudContext,
  ): Promise<{ status: CommissionStatus; riskScore: number; factors: string[] }> {
    await fraudSignalService.capture(FraudEventType.BOOKING, { ...ctx, userId: refereeId });

    const eval_ = await fraudRiskService.evaluateReferralPair(referrerId, refereeId, ctx);

    if (eval_.blockCommission) {
      await this.createAlert({
        userId: referrerId,
        category: "COMMISSION_BLOCKED",
        severity: FraudRiskLevel.CRITICAL,
        title: "Commission auto-blocked",
        description: eval_.factors.join("; "),
      });
      await this.logDecision({
        action: "BLOCK_COMMISSION",
        targetUserId: referrerId,
        reason: eval_.factors.join("; "),
      });
      return { status: CommissionStatus.REJECTED, riskScore: eval_.score, factors: eval_.factors };
    }

    if (eval_.freezeCommission) {
      await this.createAlert({
        userId: referrerId,
        category: "COMMISSION_FROZEN",
        severity: eval_.level,
        title: "Commission frozen pending review",
        description: eval_.factors.join("; "),
      });
      await this.logDecision({
        action: "FREEZE_COMMISSION",
        targetUserId: referrerId,
        reason: eval_.factors.join("; "),
      });
      return { status: CommissionStatus.FROZEN, riskScore: eval_.score, factors: eval_.factors };
    }

    if (eval_.level === FraudRiskLevel.MEDIUM) {
      return { status: CommissionStatus.REVIEW, riskScore: eval_.score, factors: eval_.factors };
    }

    return { status: CommissionStatus.APPROVED, riskScore: eval_.score, factors: eval_.factors };
  }

  async onWithdrawal(userId: string, amount: number, ctx: FraudContext) {
    await fraudSignalService.capture(FraudEventType.WITHDRAWAL, { ...ctx, userId }, {
      id: String(amount),
      type: "referral_withdrawal",
    });
    const eval_ = await fraudRiskService.evaluateUser(userId, ctx);
    if (eval_.level === FraudRiskLevel.CRITICAL || eval_.level === FraudRiskLevel.HIGH) {
      await this.createAlert({
        userId,
        category: "WITHDRAWAL_RISK",
        severity: eval_.level,
        title: "High-risk referral withdrawal",
        description: `Withdrawal ₹${amount}: ${eval_.factors.join("; ")}`,
      });
    }
    return eval_;
  }

  // ===== Admin actions =====

  async approveCommission(commissionId: string, adminId: string, note?: string) {
    const c = await prisma.referralCommission.update({
      where: { id: commissionId },
      data: {
        status: CommissionStatus.APPROVED,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        releasedAt: new Date(),
      },
    });
    await this.logDecision({
      actorId: adminId,
      action: "APPROVE_COMMISSION",
      targetCommissionId: commissionId,
      targetUserId: c.referrerId,
      reason: note,
    });
    return c;
  }

  async rejectCommission(commissionId: string, adminId: string, reason: string) {
    const c = await prisma.referralCommission.update({
      where: { id: commissionId },
      data: {
        status: CommissionStatus.REJECTED,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        rejectReason: reason,
      },
    });
    await this.logDecision({
      actorId: adminId,
      action: "REJECT_COMMISSION",
      targetCommissionId: commissionId,
      targetUserId: c.referrerId,
      reason,
    });
    return c;
  }

  async freezeCommission(commissionId: string, adminId: string, reason?: string) {
    const c = await prisma.referralCommission.update({
      where: { id: commissionId },
      data: { status: CommissionStatus.FROZEN, frozenAt: new Date(), reviewedBy: adminId },
    });
    await this.logDecision({
      actorId: adminId,
      action: "FREEZE_COMMISSION",
      targetCommissionId: commissionId,
      targetUserId: c.referrerId,
      reason,
    });
    return c;
  }

  async unfreezeCommission(commissionId: string, adminId: string) {
    const c = await prisma.referralCommission.update({
      where: { id: commissionId },
      data: { status: CommissionStatus.REVIEW, frozenAt: null },
    });
    await this.logDecision({
      actorId: adminId,
      action: "UNFREEZE_COMMISSION",
      targetCommissionId: commissionId,
      targetUserId: c.referrerId,
    });
    return c;
  }

  async blacklistUser(userId: string, adminId: string, reason: string) {
    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: true, bannedReason: `Fraud: ${reason}`, bannedAt: new Date() },
    });
    await this.logDecision({ actorId: adminId, action: "BLACKLIST_USER", targetUserId: userId, reason });
  }
}

export const referralFraudService = new ReferralFraudService();
