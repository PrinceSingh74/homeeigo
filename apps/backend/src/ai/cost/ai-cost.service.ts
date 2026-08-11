import type { AiGatewayRole, AiProviderType } from "@prisma/client";
import { aiConfig } from "../config";

type Pricing = { input: number; output: number; cached: number };

/**
 * Pricing is per provider and hand-maintained. A provider with no entry has no price —
 * it must not silently borrow another provider's rate, and it must not report 0, which
 * would read as "this request was free" in every cost dashboard.
 */
function pricingFor(provider: AiProviderType): Pricing | undefined {
  switch (provider) {
    case "ANTHROPIC":
      return aiConfig.pricing.anthropic;
    case "GEMINI":
      return aiConfig.pricing.gemini;
    case "GROQ":
      return aiConfig.pricing.groq;
    case "OPENAI":
      return aiConfig.pricing.openai;
    default:
      return undefined;
  }
}

export type CostResult = { costUsd: number; costStatus: "COMPUTED" | "UNKNOWN" };

/** Cost with an explicit status, so "unknown" is never indistinguishable from "free". */
export function computeTokenCostDetailed(
  provider: AiProviderType,
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0,
): CostResult {
  const pricing = pricingFor(provider);
  if (!pricing) return { costUsd: 0, costStatus: "UNKNOWN" };

  const billablePrompt = Math.max(0, promptTokens - cachedTokens);
  const inputCost = (billablePrompt / 1_000_000) * pricing.input;
  const cachedCost = (cachedTokens / 1_000_000) * pricing.cached;
  const outputCost = (completionTokens / 1_000_000) * pricing.output;
  return {
    costUsd: Number((inputCost + cachedCost + outputCost).toFixed(8)),
    costStatus: "COMPUTED",
  };
}

export function computeTokenCost(
  provider: AiProviderType,
  promptTokens: number,
  completionTokens: number,
  cachedTokens = 0,
): number {
  return computeTokenCostDetailed(provider, promptTokens, completionTokens, cachedTokens).costUsd;
}

export async function recordDailyCost(
  prisma: {
    aiGatewayCost: {
      upsert: (args: unknown) => Promise<unknown>;
    };
  },
  date: Date,
  provider: AiProviderType,
  actorRole: AiGatewayRole,
  promptTokens: number,
  completionTokens: number,
  costUsd: number,
): Promise<void> {
  const day = new Date(date.toISOString().slice(0, 10));
  await prisma.aiGatewayCost.upsert({
    where: {
      date_provider_actorRole: { date: day, provider, actorRole },
    },
    create: {
      date: day,
      provider,
      actorRole,
      requestCount: 1,
      promptTokens,
      completionTokens,
      totalCostUsd: costUsd,
    },
    update: {
      requestCount: { increment: 1 },
      promptTokens: { increment: promptTokens },
      completionTokens: { increment: completionTokens },
      totalCostUsd: { increment: costUsd },
    },
  });
}

export type UsageSummary = {
  totalRequests: number;
  totalCostUsd: number;
  byProvider: Record<string, { requests: number; costUsd: number }>;
  byRole: Record<string, { requests: number; costUsd: number }>;
};

export async function getUsageSummary(
  prisma: {
    aiGatewayRequest: {
      aggregate: (args: unknown) => Promise<{ _count: { id: number }; _sum: { costUsd: number | null } }>;
      groupBy: (args: unknown) => Promise<Array<{ provider: AiProviderType; _count: { id: number }; _sum: { costUsd: number | null } }>>;
    };
    aiGatewayCost: {
      aggregate: (args: unknown) => Promise<{ _sum: { totalCostUsd: number | null } }>;
      findMany: (args: unknown) => Promise<Array<{ date: Date; provider: AiProviderType; actorRole: AiGatewayRole; totalCostUsd: number; requestCount: number }>>;
    };
  },
  since: Date,
): Promise<UsageSummary> {
  const [agg, byProvider, costs] = await Promise.all([
    prisma.aiGatewayRequest.aggregate({
      where: { createdAt: { gte: since } },
      _count: { id: true },
      _sum: { costUsd: true },
    }),
    prisma.aiGatewayRequest.groupBy({
      by: ["provider"],
      where: { createdAt: { gte: since }, provider: { not: null } },
      _count: { id: true },
      _sum: { costUsd: true },
    }),
    prisma.aiGatewayCost.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "desc" },
      take: 90,
    }),
  ]);

  const byProviderMap: Record<string, { requests: number; costUsd: number }> = {};
  for (const row of byProvider) {
    if (!row.provider) continue;
    byProviderMap[row.provider] = {
      requests: row._count.id,
      costUsd: row._sum.costUsd ?? 0,
    };
  }

  const byRole: Record<string, { requests: number; costUsd: number }> = {};
  for (const row of costs) {
    const key = row.actorRole;
    if (!byRole[key]) byRole[key] = { requests: 0, costUsd: 0 };
    byRole[key].requests += row.requestCount;
    byRole[key].costUsd += row.totalCostUsd;
  }

  return {
    totalRequests: agg._count.id,
    totalCostUsd: agg._sum.costUsd ?? 0,
    byProvider: byProviderMap,
    byRole,
  };
}
