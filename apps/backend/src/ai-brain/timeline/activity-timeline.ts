import prisma from "../../lib/prisma";
import type { TimelineEntry } from "../types";

export async function recordTimelineEntry(entry: TimelineEntry): Promise<void> {
  await prisma.aiActivityTimeline.create({
    data: {
      requestId: entry.requestId,
      traceId: entry.traceId,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      promptId: entry.promptId,
      promptVersion: entry.promptVersion,
      model: entry.model,
      provider: entry.provider,
      contextHash: entry.contextHash,
      promptTokens: entry.promptTokens,
      completionTokens: entry.completionTokens,
      latencyMs: entry.latencyMs,
      costUsd: entry.costUsd,
      status: entry.status,
      fallbackUsed: entry.fallbackUsed,
      blocked: entry.blocked,
      blockReason: entry.blockReason,
      resultHash: entry.resultHash,
      metadata: entry.metadata,
    },
  }).catch(() => undefined);
}

export async function getActivityTimeline(filters: {
  actorId?: string;
  requestId?: string;
  since?: Date;
  limit?: number;
  status?: string;
}) {
  return prisma.aiActivityTimeline.findMany({
    where: {
      ...(filters.actorId ? { actorId: filters.actorId } : {}),
      ...(filters.requestId ? { requestId: filters.requestId } : {}),
      ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
      ...(filters.status ? { status: filters.status as never } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: filters.limit ?? 50,
  });
}

export async function getTimelineStatistics(since?: Date) {
  const where = since ? { createdAt: { gte: since } } : {};

  const [total, blocked, fallback, avgLatency, totalCost] = await Promise.all([
    prisma.aiActivityTimeline.count({ where }),
    prisma.aiActivityTimeline.count({ where: { ...where, blocked: true } }),
    prisma.aiActivityTimeline.count({ where: { ...where, fallbackUsed: true } }),
    prisma.aiActivityTimeline.aggregate({ where, _avg: { latencyMs: true } }),
    prisma.aiActivityTimeline.aggregate({ where, _sum: { costUsd: true } }),
  ]);

  return {
    total,
    blocked,
    fallback,
    avgLatencyMs: Math.round(avgLatency._avg.latencyMs ?? 0),
    totalCostUsd: totalCost._sum.costUsd ?? 0,
  };
}

export async function getPromptAnalytics(since?: Date) {
  const where = since ? { createdAt: { gte: since } } : {};

  const byPrompt = await prisma.aiActivityTimeline.groupBy({
    by: ["promptId"],
    where: { ...where, promptId: { not: null } },
    _count: { id: true },
    _avg: { latencyMs: true, costUsd: true },
    _sum: { promptTokens: true, completionTokens: true },
  });

  return byPrompt.map((g) => ({
    promptId: g.promptId,
    requestCount: g._count.id,
    avgLatencyMs: Math.round(g._avg.latencyMs ?? 0),
    avgCostUsd: g._avg.costUsd ?? 0,
    totalPromptTokens: g._sum.promptTokens ?? 0,
    totalCompletionTokens: g._sum.completionTokens ?? 0,
  }));
}
