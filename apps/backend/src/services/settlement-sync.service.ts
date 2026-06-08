import { SettlementDiscrepancyType, SettlementSyncStatus } from "@prisma/client";
import prisma from "../lib/prisma";
import { razorpayService } from "./razorpay.service";
import { settlementService } from "./settlement.service";
import { recordFinancialMetric } from "../lib/financial-metrics";
import { financeAlertService } from "./finance-alert.service";

export class SettlementSyncService {
  async runSync(): Promise<{ runId: string; synced: number; discrepancies: number; accuracyPct: number }> {
    const run = await prisma.settlementSyncRun.create({
      data: { status: SettlementSyncStatus.STARTED },
    });

    try {
      const gatewaySettlements = await razorpayService.fetchSettlements(100);
      let synced = 0;
      let discrepancies = 0;

      for (const gs of gatewaySettlements) {
        const amountInr = gs.amount / 100;
        const feeInr = (gs.fees ?? 0) / 100;
        const taxInr = (gs.tax ?? 0) / 100;

        const local = await prisma.settlementBatch.findUnique({
          where: { settlementId: gs.id },
          include: { paymentSettlements: true },
        });

        if (!local) {
          await settlementService.recordFromWebhook({
            settlementId: gs.id,
            amount: amountInr,
            fee: feeInr,
            tax: taxInr,
            status: gs.status ?? "settled",
            settledAt: gs.created_at ? new Date(gs.created_at * 1000) : new Date(),
            gatewayReference: gs.id,
            raw: gs,
          });
          synced += 1;

          await prisma.settlementDiscrepancy.create({
            data: {
              syncRunId: run.id,
              type: SettlementDiscrepancyType.UNKNOWN_SETTLEMENT,
              referenceId: gs.id,
              actualAmount: amountInr,
              details: "Gateway settlement imported — was missing locally",
            },
          });
          discrepancies += 1;
          continue;
        }

        if (Math.abs(local.amount - amountInr) > 0.01) {
          await prisma.settlementDiscrepancy.create({
            data: {
              syncRunId: run.id,
              type: SettlementDiscrepancyType.AMOUNT_MISMATCH,
              referenceId: gs.id,
              expectedAmount: local.amount,
              actualAmount: amountInr,
              details: "Settlement batch amount differs from gateway",
            },
          });
          discrepancies += 1;
        }

        const dup = await prisma.settlementBatch.count({ where: { settlementId: gs.id } });
        if (dup > 1) {
          await prisma.settlementDiscrepancy.create({
            data: {
              syncRunId: run.id,
              type: SettlementDiscrepancyType.DUPLICATE_SETTLEMENT,
              referenceId: gs.id,
              details: "Duplicate settlement batch detected",
            },
          });
          discrepancies += 1;
        }

        const paymentIds = await extractPaymentIdsFromSettlement(gs.id);
        for (const pid of paymentIds) {
          const localPayment = await prisma.payment.findFirst({ where: { razorpayPaymentId: pid } });
          if (!localPayment) {
            await prisma.settlementDiscrepancy.create({
              data: {
                syncRunId: run.id,
                type: SettlementDiscrepancyType.MISSING_PAYMENT,
                referenceId: pid,
                details: `Payment ${pid} in gateway settlement but missing locally`,
              },
            });
            discrepancies += 1;
          } else if (!localPayment.settlementId) {
            await settlementService.linkPaymentsToBatch(local.id, gs.id, {
              targetAmount: amountInr,
              settledAt: local.settledAt ?? new Date(),
              gatewayReference: gs.id,
              raw: { payments: [{ id: pid, amount: localPayment.amountPaid }] },
            });
          }
        }

        synced += 1;
      }

      const accuracyPct =
        gatewaySettlements.length > 0
          ? round2(((gatewaySettlements.length - discrepancies) / gatewaySettlements.length) * 100)
          : 100;

      await prisma.settlementSyncRun.update({
        where: { id: run.id },
        data: {
          status: SettlementSyncStatus.COMPLETED,
          settlementsSynced: synced,
          discrepanciesFound: discrepancies,
          accuracyPct,
          completedAt: new Date(),
        },
      });

      if (discrepancies > 0) {
        recordFinancialMetric("settlement_mismatch_total", discrepancies);
        await financeAlertService.raise("SETTLEMENT_MISMATCH", "HIGH", `${discrepancies} settlement discrepancies found`, {
          runId: run.id,
        });
      }

      return { runId: run.id, synced, discrepancies, accuracyPct };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await prisma.settlementSyncRun.update({
        where: { id: run.id },
        data: { status: SettlementSyncStatus.FAILED, errorMessage: message, completedAt: new Date() },
      });
      throw err;
    }
  }

  async listRuns(limit = 20) {
    return prisma.settlementSyncRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
      include: { _count: { select: { discrepancies: true } } },
    });
  }

  async listDiscrepancies(syncRunId?: string, unresolvedOnly = true) {
    return prisma.settlementDiscrepancy.findMany({
      where: {
        syncRunId: syncRunId ?? undefined,
        resolved: unresolvedOnly ? false : undefined,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async resolveDiscrepancy(id: string, adminId: string) {
    return prisma.settlementDiscrepancy.update({
      where: { id },
      data: { resolved: true, resolvedAt: new Date(), resolvedBy: adminId },
    });
  }

  async metricsSummary() {
    const [latest, openDiscrepancies, avgAccuracy] = await Promise.all([
      prisma.settlementSyncRun.findFirst({ where: { status: SettlementSyncStatus.COMPLETED }, orderBy: { completedAt: "desc" } }),
      prisma.settlementDiscrepancy.count({ where: { resolved: false } }),
      prisma.settlementSyncRun.aggregate({ where: { status: SettlementSyncStatus.COMPLETED }, _avg: { accuracyPct: true } }),
    ]);
    return {
      latestRun: latest,
      openDiscrepancies,
      settlementAccuracyPct: round2(avgAccuracy._avg.accuracyPct ?? 100),
      reconciliationSuccessPct: round2(avgAccuracy._avg.accuracyPct ?? 100),
      outstandingVariance: openDiscrepancies,
    };
  }
}

async function extractPaymentIdsFromSettlement(settlementId: string): Promise<string[]> {
  const detail = await razorpayService.fetchSettlement(settlementId);
  const ids: string[] = [];
  if (detail?.payments) {
    for (const p of detail.payments) {
      if (p.id) ids.push(p.id);
    }
  }
  return ids;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const settlementSyncService = new SettlementSyncService();
