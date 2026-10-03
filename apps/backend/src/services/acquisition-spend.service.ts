import type { PartnerLeadSource } from "@prisma/client";
import prisma from "../lib/prisma";
import { sanitizeUserInput } from "../utils/sanitizer";

export type AcquisitionSpendInput = {
  source: PartnerLeadSource;
  campaign?: string;
  channel?: string;
  periodStart: string;
  periodEnd: string;
  amount: number;
  currency?: string;
  notes?: string;
};

function parsePeriod(start: string, end: string) {
  const periodStart = new Date(start);
  const periodEnd = new Date(end);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    throw new Error("VALIDATION:Invalid spend period");
  }
  if (periodEnd < periodStart) {
    throw new Error("VALIDATION:periodEnd must be on or after periodStart");
  }
  return { periodStart, periodEnd };
}

export class AcquisitionSpendService {
  async list(filters?: { source?: PartnerLeadSource; campaign?: string }) {
    return prisma.acquisitionSpend.findMany({
      where: {
        source: filters?.source,
        campaign: filters?.campaign ? { contains: filters.campaign, mode: "insensitive" } : undefined,
      },
      orderBy: { periodStart: "desc" },
      take: 200,
    });
  }

  async create(input: AcquisitionSpendInput, adminId: string) {
    if (!Number.isFinite(input.amount) || input.amount < 0) {
      throw new Error("VALIDATION:Spend amount must be a non-negative number");
    }
    const { periodStart, periodEnd } = parsePeriod(input.periodStart, input.periodEnd);
    return prisma.acquisitionSpend.create({
      data: {
        source: input.source,
        campaign: input.campaign ? sanitizeUserInput(input.campaign, 120) : undefined,
        channel: input.channel ? sanitizeUserInput(input.channel, 80) : undefined,
        periodStart,
        periodEnd,
        amount: input.amount,
        currency: input.currency === "INR" || !input.currency ? "INR" : sanitizeUserInput(input.currency, 8),
        notes: input.notes ? sanitizeUserInput(input.notes, 500) : undefined,
        createdByAdminId: adminId,
      },
    });
  }

  async update(id: string, input: Partial<AcquisitionSpendInput>) {
    const existing = await prisma.acquisitionSpend.findUnique({ where: { id } });
    if (!existing) throw new Error("NOT_FOUND:Spend record not found");
    const periodStart = input.periodStart ? new Date(input.periodStart) : existing.periodStart;
    const periodEnd = input.periodEnd ? new Date(input.periodEnd) : existing.periodEnd;
    if (periodEnd < periodStart) throw new Error("VALIDATION:periodEnd must be on or after periodStart");
    if (input.amount != null && (!Number.isFinite(input.amount) || input.amount < 0)) {
      throw new Error("VALIDATION:Spend amount must be a non-negative number");
    }
    return prisma.acquisitionSpend.update({
      where: { id },
      data: {
        source: input.source,
        campaign: input.campaign != null ? sanitizeUserInput(input.campaign, 120) : undefined,
        channel: input.channel != null ? sanitizeUserInput(input.channel, 80) : undefined,
        periodStart,
        periodEnd,
        amount: input.amount,
        notes: input.notes != null ? sanitizeUserInput(input.notes, 500) : undefined,
      },
    });
  }

  async remove(id: string) {
    const existing = await prisma.acquisitionSpend.findUnique({ where: { id } });
    if (!existing) throw new Error("NOT_FOUND:Spend record not found");
    await prisma.acquisitionSpend.delete({ where: { id } });
    return { id, deleted: true };
  }

  async totalsForRange(rangeStart: Date, rangeEnd: Date, source?: PartnerLeadSource) {
    const rows = await prisma.acquisitionSpend.findMany({
      where: {
        source,
        periodStart: { lte: rangeEnd },
        periodEnd: { gte: rangeStart },
      },
    });
    const bySource = new Map<PartnerLeadSource, number>();
    let total = 0;
    for (const row of rows) {
      total += row.amount;
      bySource.set(row.source, (bySource.get(row.source) ?? 0) + row.amount);
    }
    return {
      available: rows.length > 0,
      currency: "INR",
      totalSpend: rows.length > 0 ? Math.round(total * 100) / 100 : null,
      bySource: Object.fromEntries(bySource),
      recordCount: rows.length,
    };
  }
}

export const acquisitionSpendService = new AcquisitionSpendService();
