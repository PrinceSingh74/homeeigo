import type { AiMemoryType } from "@prisma/client";
import prisma from "../../lib/prisma";
import {
  recordMemoryRead,
  recordMemoryWrite,
  recordMemoryArchive,
  recordCrossOwnerMemoryRead,
} from "../../lib/ai-brain-metrics";
import { screenMemoryContent } from "./memory-safety";
import type { MemorySearchQuery, MemoryStoreInput } from "../types";
import { MEMORY_DEFAULTS } from "../types";

export type MemoryRecord = {
  id: string;
  memoryKey: string;
  memoryType: AiMemoryType;
  ownerId: string | null;
  content: Record<string, unknown>;
  summary: string | null;
  priority: number;
  importance: number;
  confidence: number;
  freshness: Date;
  version: number;
  expiresAt: Date | null;
};

function resolveTtl(memoryType: AiMemoryType, ttlSeconds?: number): number {
  if (ttlSeconds) return ttlSeconds;
  const map: Partial<Record<AiMemoryType, number>> = {
    SESSION: MEMORY_DEFAULTS.sessionTtlSeconds,
    CONVERSATION: MEMORY_DEFAULTS.conversationTtlSeconds,
    WORKING: MEMORY_DEFAULTS.workingTtlSeconds,
    SEMANTIC: MEMORY_DEFAULTS.semanticTtlSeconds,
  };
  return map[memoryType] ?? MEMORY_DEFAULTS.sessionTtlSeconds;
}

/** Raised when memory content is refused. Callers decide whether to surface or swallow it. */
export class MemoryRejectedError extends Error {
  constructor(public readonly reason: string) {
    super(`memory_rejected:${reason}`);
    this.name = "MemoryRejectedError";
  }
}

export async function storeMemory(input: MemoryStoreInput): Promise<MemoryRecord> {
  // Screen before anything is persisted. Memory is replayed into every later prompt, so a
  // payload that lands here outlives the request that carried it.
  const verdict = screenMemoryContent({
    summary: input.summary,
    content: input.content,
    stage: "write",
    memoryType: input.memoryType,
  });
  if (!verdict.safe) throw new MemoryRejectedError(verdict.reason);

  const ttl = resolveTtl(input.memoryType, input.ttlSeconds);
  const expiresAt = new Date(Date.now() + ttl * 1000);

  const existing = await prisma.aiMemory.findFirst({
    where: {
      memoryKey: input.memoryKey,
      ownerId: input.ownerId ?? null,
      memoryType: input.memoryType,
    },
  }).catch(() => null);

  const record = existing
    ? await prisma.aiMemory.update({
        where: { id: existing.id },
        data: {
          content: input.content,
          summary: input.summary,
          priority: input.priority ?? existing.priority,
          importance: input.importance ?? existing.importance,
          confidence: input.confidence ?? existing.confidence,
          freshness: new Date(),
          ttlSeconds: ttl,
          expiresAt,
          version: { increment: 1 },
          metadata: input.metadata ?? undefined,
          isArchived: false,
        },
      })
    : await prisma.aiMemory.create({
        data: {
          memoryKey: input.memoryKey,
          memoryType: input.memoryType,
          ownerId: input.ownerId,
          tenantId: input.tenantId,
          content: input.content,
          summary: input.summary,
          priority: input.priority ?? 0,
          importance: input.importance ?? 0.5,
          confidence: input.confidence ?? 1.0,
          ttlSeconds: ttl,
          expiresAt,
          metadata: input.metadata,
        },
      });

  recordMemoryWrite(input.memoryType);
  return record as MemoryRecord;
}

export async function retrieveMemory(
  memoryKey: string,
  ownerId: string | undefined,
  memoryType: AiMemoryType,
): Promise<MemoryRecord | null> {
  const record = await prisma.aiMemory.findFirst({
    where: {
      memoryKey,
      ownerId: ownerId ?? null,
      memoryType,
      isArchived: false,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });

  recordMemoryRead(memoryType);
  return record as MemoryRecord | null;
}

export async function retrieveMemories(query: MemorySearchQuery): Promise<MemoryRecord[]> {
  // An absent owner used to drop the filter entirely, returning every user's memories.
  // Scope is now mandatory in effect: no owner means the shared/global scope (`null`),
  // never "all owners". Reading across users requires `allOwners`, which only an
  // authorised admin surface may pass, and which is recorded.
  const ownerScope = query.allOwners
    ? {}
    : { ownerId: query.ownerId ?? null };

  if (query.allOwners) recordCrossOwnerMemoryRead(query.memoryType ?? "SEMANTIC");

  const records = await prisma.aiMemory.findMany({
    where: {
      ...ownerScope,
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.memoryType ? { memoryType: query.memoryType } : {}),
      ...(query.includeArchived ? {} : { isArchived: false }),
      ...(query.minImportance ? { importance: { gte: query.minImportance } } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ importance: "desc" }, { freshness: "desc" }],
    take: query.limit ?? 20,
  });

  if (query.query) {
    const q = query.query.toLowerCase();
    const filtered = records.filter((r) => {
      const text = `${r.summary ?? ""} ${JSON.stringify(r.content)}`.toLowerCase();
      return text.includes(q);
    });
    recordMemoryRead(query.memoryType ?? "SEMANTIC");
    return filtered as MemoryRecord[];
  }

  recordMemoryRead(query.memoryType ?? "SEMANTIC");
  return records as MemoryRecord[];
}

export async function updateMemory(
  id: string,
  updates: Partial<Pick<MemoryStoreInput, "content" | "summary" | "importance" | "confidence" | "priority">>,
): Promise<MemoryRecord | null> {
  const record = await prisma.aiMemory.update({
    where: { id },
    data: {
      ...(updates.content ? { content: updates.content } : {}),
      ...(updates.summary !== undefined ? { summary: updates.summary } : {}),
      ...(updates.importance !== undefined ? { importance: updates.importance } : {}),
      ...(updates.confidence !== undefined ? { confidence: updates.confidence } : {}),
      ...(updates.priority !== undefined ? { priority: updates.priority } : {}),
      freshness: new Date(),
      version: { increment: 1 },
    },
  }).catch(() => null);

  if (record) recordMemoryWrite(record.memoryType);
  return record as MemoryRecord | null;
}

export async function archiveMemory(id: string): Promise<boolean> {
  const record = await prisma.aiMemory.update({
    where: { id },
    data: { isArchived: true },
  }).catch(() => null);

  if (record) recordMemoryArchive(record.memoryType);
  return Boolean(record);
}

export async function recallMemoriesForActor(
  ownerId: string,
  query: string,
  limit = 5,
): Promise<MemoryRecord[]> {
  return retrieveMemories({ ownerId, query, limit, minImportance: 0.2 });
}

export async function compressMemory(id: string, summary: string): Promise<MemoryRecord | null> {
  return updateMemory(id, { summary, content: { compressed: true, originalSize: summary.length } });
}

export async function expireStaleMemories(): Promise<number> {
  const result = await prisma.aiMemory.updateMany({
    where: {
      expiresAt: { lt: new Date() },
      isArchived: false,
    },
    data: { isArchived: true },
  }).catch(() => ({ count: 0 }));
  return result.count;
}

export async function getMemoryStatistics(ownerId?: string) {
  const where = ownerId ? { ownerId } : {};
  const [total, byType, archived] = await Promise.all([
    prisma.aiMemory.count({ where: { ...where, isArchived: false } }),
    prisma.aiMemory.groupBy({
      by: ["memoryType"],
      where: { ...where, isArchived: false },
      _count: { id: true },
    }),
    prisma.aiMemory.count({ where: { ...where, isArchived: true } }),
  ]);

  return {
    total,
    archived,
    byType: Object.fromEntries(byType.map((g) => [g.memoryType, g._count.id])),
  };
}
