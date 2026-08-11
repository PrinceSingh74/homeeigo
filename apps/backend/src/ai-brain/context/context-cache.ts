import type { AiGatewayRole } from "@prisma/client";
import prisma from "../../lib/prisma";
import { recordMemoryHit, recordMemoryMiss, recordContextCacheDenied } from "../../lib/ai-brain-metrics";
import { aiBrainConfig } from "../config";
import type { EnterpriseBuiltContext } from "../types";

export async function getCachedContext(
  cacheKey: string,
  actorId: string,
  actorRole: AiGatewayRole,
): Promise<EnterpriseBuiltContext | null> {
  const entry = await prisma.aiContextCache.findUnique({
    where: { cacheKey },
  }).catch(() => null);

  if (!entry || entry.expiresAt < new Date()) {
    recordMemoryMiss("context_cache");
    return null;
  }

  // Ownership is re-checked on read, not merely assumed from the key.
  //
  // `actorId`/`actorRole` were accepted and then ignored: isolation rested entirely on the
  // caller embedding the actor in `cacheKey`. That is a convention a future change to the
  // key format would silently break, handing one user another user's assembled context —
  // with no compile error and no test failure. The stored row knows its owner, so ask it.
  if (entry.actorId !== actorId || entry.actorRole !== actorRole) {
    recordContextCacheDenied(entry.actorRole === actorRole ? "actor_mismatch" : "role_mismatch");
    recordMemoryMiss("context_cache");
    return null;
  }

  await prisma.aiContextCache.update({
    where: { id: entry.id },
    data: { hitCount: { increment: 1 } },
  }).catch(() => undefined);

  recordMemoryHit("context_cache");
  return entry.contextData as unknown as EnterpriseBuiltContext;
}

export async function setCachedContext(
  cacheKey: string,
  actorId: string,
  actorRole: AiGatewayRole,
  contextHash: string,
  context: EnterpriseBuiltContext,
): Promise<void> {
  const expiresAt = new Date(Date.now() + aiBrainConfig.contextCacheTtlSeconds * 1000);

  await prisma.aiContextCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      actorId,
      actorRole,
      contextHash,
      contextData: context as unknown as Record<string, unknown>,
      expiresAt,
    },
    update: {
      contextHash,
      contextData: context as unknown as Record<string, unknown>,
      expiresAt,
      updatedAt: new Date(),
    },
  }).catch(() => undefined);
}

export async function purgeExpiredContextCache(): Promise<number> {
  const result = await prisma.aiContextCache.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  }).catch(() => ({ count: 0 }));
  return result.count;
}

export async function listContextCache(filters?: {
  actorId?: string;
  limit?: number;
}) {
  return prisma.aiContextCache.findMany({
    where: filters?.actorId ? { actorId: filters.actorId } : {},
    orderBy: { updatedAt: "desc" },
    take: filters?.limit ?? 50,
    select: {
      id: true,
      cacheKey: true,
      actorId: true,
      actorRole: true,
      contextHash: true,
      hitCount: true,
      expiresAt: true,
      createdAt: true,
      updatedAt: true,
    },
  });
}
