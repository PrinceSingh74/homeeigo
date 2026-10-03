import type { AiGatewayRole } from "@prisma/client";
import prisma from "../../lib/prisma";
import { aiBrainConfig } from "../config";
import type { ContextSection } from "../types";
import { toInputJsonArray } from "../../lib/json-input";

export async function saveContextSnapshot(input: {
  requestId: string;
  actorId: string;
  actorRole: AiGatewayRole;
  contextHash: string;
  contextSize: number;
  sections: ContextSection[];
}): Promise<void> {
  const expiresAt = new Date(Date.now() + aiBrainConfig.contextSnapshotTtlHours * 3_600_000);

  const storable = toInputJsonArray(input.sections);
  if (!storable) return;

  await prisma.aiContextSnapshot.create({
    data: {
      requestId: input.requestId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      contextHash: input.contextHash,
      contextSize: input.contextSize,
      // Validated rather than asserted — see lib/json-input. A snapshot is forensic and its
      // write is already best-effort, so an unstorable section list skips the row instead of
      // throwing inside a `.catch(() => undefined)` that would hide the reason entirely.
      sections: storable,
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
