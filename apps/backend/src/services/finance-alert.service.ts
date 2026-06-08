import { FinanceAlertSeverity } from "@prisma/client";
import prisma from "../lib/prisma";
import { recordFinancialMetric } from "../lib/financial-metrics";

export class FinanceAlertService {
  async raise(
    alertType: string,
    severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
    message: string,
    metadata?: Record<string, unknown>,
  ) {
    recordFinancialMetric("finance_integrity_failures_total", 1);

    const recent = await prisma.financeAlert.count({
      where: {
        alertType,
        resolved: false,
        createdAt: { gte: new Date(Date.now() - 60 * 60 * 1000) },
      },
    });
    if (recent >= 3) return null;

    return prisma.financeAlert.create({
      data: {
        alertType,
        severity: severity as FinanceAlertSeverity,
        message,
        metadata: metadata ? JSON.stringify(metadata) : undefined,
      },
    });
  }

  async listOpen(limit = 50) {
    return prisma.financeAlert.findMany({
      where: { resolved: false },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
  }

  async resolve(id: string) {
    return prisma.financeAlert.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date() },
    });
  }
}

export const financeAlertService = new FinanceAlertService();
