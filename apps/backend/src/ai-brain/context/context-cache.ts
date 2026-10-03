import type { AiGatewayRole } from "@prisma/client";
import prisma from "../../lib/prisma";
import { recordMemoryHit, recordMemoryMiss, recordContextCacheDenied } from "../../lib/ai-brain-metrics";
import { aiBrainConfig } from "../config";
import type { EnterpriseBuiltContext } from "../types";
import { toInputJsonObject } from "../../lib/json-input";

/**
 * Does this row still hold the context shape the code expects?
 *
 * The cached value was previously asserted with `as unknown as EnterpriseBuiltContext` — an
 * unchecked claim about arbitrary JSON read back from the database. Nothing guarantees an older
 * row matches the current type: a deploy that adds or renames a field leaves rows written by the
 * previous version live until they expire. With the assertion, such a row yielded an object whose
 * required fields were simply `undefined`, and that object is injected into the model's prompt —
 * so the failure surfaced as a degraded answer, not an error.
 *
 * A mismatch is treated as a MISS, so the context is rebuilt and the stale row is overwritten.
 * Cache misses are ordinary; a silently malformed prompt context is not.
 *
 * Deliberately NOT reported through `recordContextCacheDenied`: that counter is documented as an
 * actor/role isolation alert that should sit at zero, and a shape change is not a security event.
 */
function isEnterpriseBuiltContext(value: unknown): value is EnterpriseBuiltContext {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.systemContext === "string" &&
    Array.isArray(c.messages) &&
    Array.isArray(c.sections) &&
    typeof c.contextHash === "string" &&
    typeof c.contextSize === "number" &&
    typeof c.tokenBudget === "number" &&
    typeof c.trimmed === "boolean" &&
    typeof c.metadata === "object" &&
    c.metadata !== null
  );
}

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

  // Validate BEFORE counting a hit: a row that cannot be used is not a hit.
  if (!isEnterpriseBuiltContext(entry.contextData)) {
    recordMemoryMiss("context_cache");
    return null;
  }

  await prisma.aiContextCache.update({
    where: { id: entry.id },
    data: { hitCount: { increment: 1 } },
  }).catch(() => undefined);

  recordMemoryHit("context_cache");
  return entry.contextData;
}

export async function setCachedContext(
  cacheKey: string,
  actorId: string,
  actorRole: AiGatewayRole,
  contextHash: string,
  context: EnterpriseBuiltContext,
): Promise<void> {
  const expiresAt = new Date(Date.now() + aiBrainConfig.contextCacheTtlSeconds * 1000);

  // Validated, not asserted. If the assembled context carries anything a Json column cannot hold,
  // skip caching rather than failing the write — the caller already treats caching as best-effort
  // (`.catch(() => undefined)`), and a miss just rebuilds the context.
  const storable = toInputJsonObject(context);
  if (!storable) return;

  await prisma.aiContextCache.upsert({
    where: { cacheKey },
    create: {
      cacheKey,
      actorId,
      actorRole,
      contextHash,
      contextData: storable,
      expiresAt,
    },
    update: {
      contextHash,
      contextData: storable,
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
