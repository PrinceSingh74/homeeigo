import type { AiGatewayRole } from "@prisma/client";
import prisma from "../../lib/prisma";
import { aiBrainConfig } from "../config";
import type { ContextSection } from "../types";

export async function saveContextSnapshot(input: {
  requestId: string;
  actorId: string;
  actorRole: AiGatewayRole;
  contextHash: string;
  contextSize: number;
  sections: ContextSection[];
}): Promise<void> {
  const expiresAt = new Date(Date.now() + aiBrainConfig.contextSnapshotTtlHours * 3_600_000);

  await prisma.aiContextSnapshot.create({
    data: {
      requestId: input.requestId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      contextHash: input.contextHash,
      contextSize: input.contextSize,
      sections: input.sections as unknown as Record<string, unknown>[],
      expiresAt,
    },
  }).catch(() => undefined);
}

export async function getContextHistory(actorId: string, limit = 20) {
  return prisma.aiContextSnapshot.findMany({
    where: { actorId },
    orderBy: { builtAt: "desc" },
    take: limit,
    select: {
      id: true,
      requestId: true,
      contextHash: true,
      contextSize: true,
      builtAt: true,
      actorRole: true,
    },
  });
}

export async function getContextSnapshotByRequest(requestId: string) {
  return prisma.aiContextSnapshot.findFirst({
    where: { requestId },
  });
}

export async function searchContextSnapshots(query: {
  actorId?: string;
  contextHash?: string;
  since?: Date;
  limit?: number;
}) {
  return prisma.aiContextSnapshot.findMany({
    where: {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.contextHash ? { contextHash: query.contextHash } : {}),
      ...(query.since ? { builtAt: { gte: query.since } } : {}),
    },
    orderBy: { builtAt: "desc" },
    take: query.limit ?? 50,
  });
}
