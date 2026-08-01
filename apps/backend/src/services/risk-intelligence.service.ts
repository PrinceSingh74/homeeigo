import prisma from "../lib/prisma";
import { fraudAdminService } from "./fraud-admin.service";
import { chargebackWorkflowService } from "./chargeback-workflow.service";
import { financialIntegrityService } from "./financial-integrity.service";

const DAY_MS = 24 * 60 * 60 * 1000;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

export class RiskIntelligenceService {
  async getIntelligence(days = 30) {
    const since = new Date(Date.now() - days * DAY_MS);

    const [fraudOverview, highRisk, chargebacks, integrity, complianceOpen, complianceOverdue, timeline] =
      await Promise.all([
        fraudAdminService.overview(),
        fraudAdminService.highRiskUsers(50),
        chargebackWorkflowService.analytics(),
        financialIntegrityService.validate(),
        prisma.complianceRequest.count({ where: { status: { in: ["PENDING", "APPROVED", "PROCESSING"] } } }),
        prisma.complianceRequest.count({
          where: { status: { in: ["PENDING", "APPROVED", "PROCESSING"] }, dueDateAt: { lt: new Date() } },
        }),
        this.buildTimeline(since),
      ]);

    const avgFraudScore =
      highRisk.length > 0 ? highRisk.reduce((s, u) => s + (u.score ?? 0), 0) / highRisk.length : 0;
    const fraudConfidence = clamp(100 - avgFraudScore);
    const paymentRiskScore = clamp(100 - (chargebacks.chargebackRatio ?? 0) * 5);
    const complianceRiskScore =
      complianceOpen > 0 ? clamp(100 - (complianceOverdue / complianceOpen) * 100) : 100;
    const financeHealth = integrity.score ?? 70;
    const customerTrust = fraudConfidence;
    const partnerTrust = clamp(100 - (fraudOverview.fraudRatePct ?? 0));

    const trustScore = round2(
      customerTrust * 0.25 +
        partnerTrust * 0.2 +
        paymentRiskScore * 0.25 +
        fraudConfidence * 0.15 +
        complianceRiskScore * 0.15,
    );

    return {
      periodDays: days,
      generatedAt: new Date().toISOString(),
      unifiedTrustScore: {
        score: trustScore,
        breakdown: {
          customerTrust: round2(customerTrust),
          partnerTrust: round2(partnerTrust),
          paymentRisk: round2(paymentRiskScore),
          fraudRisk: round2(100 - fraudConfidence),
          complianceRisk: round2(100 - complianceRiskScore),
        },
        definition: "Weighted composite 0-100 from live fraud, payment, compliance and finance health signals",
      },
      fraudConfidence: {
        score: round2(fraudConfidence),
        avgRiskScore: round2(avgFraudScore),
        highRiskUsers: highRisk.length,
        openAlerts: fraudOverview.openAlerts,
      },
      paymentRisk: {
        score: round2(paymentRiskScore),
        chargebackRatioPct: chargebacks.chargebackRatio ?? 0,
        openExposure: chargebacks.openExposure ?? 0,
      },
      complianceRisk: {
        score: round2(complianceRiskScore),
        openRequests: complianceOpen,
        overdueRequests: complianceOverdue,
      },
      financeHealthScore: financeHealth,
      riskTimeline: timeline,
    };
  }

  private async buildTimeline(since: Date) {
    const [alerts, finEvents, decisions] = await Promise.all([
      prisma.fraudAlert.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, title: true, severity: true, category: true, status: true, createdAt: true },
      }),
      prisma.financialRiskEvent.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, eventType: true, severity: true, userId: true, createdAt: true },
      }),
      prisma.fraudDecisionLog.findMany({
        where: { createdAt: { gte: since } },
        orderBy: { createdAt: "desc" },
        take: 30,
        select: { id: true, action: true, targetUserId: true, reason: true, createdAt: true },
      }),
    ]);

    const events = [
      ...alerts.map((a) => ({
        id: a.id,
        type: "fraud_alert" as const,
        severity: a.severity,
        title: a.title,
        at: a.createdAt.toISOString(),
      })),
      ...finEvents.map((e) => ({
        id: e.id,
        type: "financial_risk" as const,
        severity: e.severity,
        title: e.eventType,
        at: e.createdAt.toISOString(),
      })),
      ...decisions.map((d) => ({
        id: d.id,
        type: "fraud_decision" as const,
        severity: "MEDIUM",
        title: d.action,
        at: d.createdAt.toISOString(),
      })),
    ];

    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 50);
  }
}

export const riskIntelligenceService = new RiskIntelligenceService();
