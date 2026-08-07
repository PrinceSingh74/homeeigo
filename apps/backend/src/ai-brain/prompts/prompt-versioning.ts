import crypto from "crypto";
import prisma from "../../lib/prisma";
import { recordPromptVersionTotal } from "../../lib/ai-brain-metrics";

export async function createPromptVersion(input: {
  promptId: string;
  systemPrompt: string;
  userTemplate?: string;
  variables?: Record<string, string>;
  temperature?: number;
  maxTokens?: number;
  experimentTag?: string;
  createdBy?: string;
}): Promise<{ promptId: string; version: number }> {
  const registry = await prisma.aiPromptRegistry.findUnique({
    where: { promptId: input.promptId },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (!registry) throw new Error(`Prompt not found: ${input.promptId}`);

  const prevVersion = registry.versions[0];
  const nextVersion = (prevVersion?.version ?? 0) + 1;

  const diff = prevVersion
    ? computeDiff(prevVersion.systemPrompt, input.systemPrompt)
    : null;

  await prisma.aiPromptVersion.updateMany({
    where: { registryId: registry.id, isActive: true },
    data: { isActive: false },
  });

  await prisma.aiPromptVersion.create({
    data: {
      registryId: registry.id,
      version: nextVersion,
      systemPrompt: input.systemPrompt,
      userTemplate: input.userTemplate,
      variables: input.variables,
      temperature: input.temperature ?? 0.7,
      maxTokens: input.maxTokens ?? 2048,
      diffFromPrevious: diff,
      experimentTag: input.experimentTag,
      isActive: true,
      createdBy: input.createdBy,
    },
  });

  recordPromptVersionTotal(registry.category);
  return { promptId: input.promptId, version: nextVersion };
}

function computeDiff(previous: string, current: string): string {
  const prevLines = previous.split("\n");
  const currLines = current.split("\n");
  const added = currLines.filter((l) => !prevLines.includes(l));
  const removed = prevLines.filter((l) => !currLines.includes(l));
  return JSON.stringify({ added: added.slice(0, 10), removed: removed.slice(0, 10) });
}

export async function approvePromptVersion(
  promptId: string,
  version: number,
  approvedBy: string,
): Promise<void> {
  const registry = await prisma.aiPromptRegistry.findUnique({ where: { promptId } });
  if (!registry) throw new Error(`Prompt not found: ${promptId}`);

  await prisma.aiPromptVersion.updateMany({
    where: { registryId: registry.id, version },
    data: { approvedBy, approvedAt: new Date() },
  });

  await prisma.aiPromptRegistry.update({
    where: { id: registry.id },
    data: { approvalStatus: "APPROVED", updatedBy: approvedBy },
  });
}

export async function rejectPromptVersion(promptId: string, rejectedBy: string): Promise<void> {
  await prisma.aiPromptRegistry.update({
    where: { promptId },
    data: { approvalStatus: "REJECTED", updatedBy: rejectedBy },
  });
}

export async function rollbackPromptVersion(
  promptId: string,
  targetVersion: number,
  rolledBackBy: string,
): Promise<void> {
  const registry = await prisma.aiPromptRegistry.findUnique({
    where: { promptId },
    include: { versions: true },
  });

  if (!registry) throw new Error(`Prompt not found: ${promptId}`);

  const target = registry.versions.find((v) => v.version === targetVersion);
  if (!target) throw new Error(`Version ${targetVersion} not found`);

  await prisma.aiPromptVersion.updateMany({
    where: { registryId: registry.id, isActive: true },
    data: { isActive: false },
  });

  await prisma.aiPromptVersion.update({
    where: { id: target.id },
    data: { isActive: true, isDeprecated: false },
  });

  await prisma.aiPromptRegistry.update({
    where: { id: registry.id },
    data: { approvalStatus: "APPROVED", updatedBy: rolledBackBy },
  });
}

export async function deprecatePromptVersion(promptId: string, version: number): Promise<void> {
  const registry = await prisma.aiPromptRegistry.findUnique({ where: { promptId } });
  if (!registry) throw new Error(`Prompt not found: ${promptId}`);

  await prisma.aiPromptVersion.updateMany({
    where: { registryId: registry.id, version },
    data: { isDeprecated: true, isActive: false },
  });

  await prisma.aiPromptRegistry.update({
    where: { id: registry.id },
    data: { approvalStatus: "DEPRECATED" },
  });
}

export async function listPromptVersions(promptId: string) {
  const registry = await prisma.aiPromptRegistry.findUnique({
    where: { promptId },
    include: { versions: { orderBy: { version: "desc" } } },
  });

  if (!registry) return [];

  return registry.versions.map((v) => ({
    version: v.version,
    isActive: v.isActive,
    isDeprecated: v.isDeprecated,
    experimentTag: v.experimentTag,
    approvedBy: v.approvedBy,
    approvedAt: v.approvedAt,
    createdBy: v.createdBy,
    createdAt: v.createdAt,
    diffFromPrevious: v.diffFromPrevious,
  }));
}

export async function getActivePromptVersion(promptId: string) {
  const registry = await prisma.aiPromptRegistry.findUnique({
    where: { promptId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });

  if (!registry?.versions[0]) return null;

  const v = registry.versions[0];
  return formatPromptVersion(registry, v);
}

function formatPromptVersion(
  registry: { promptId: string; name: string; category: string; approvalStatus: string },
  v: {
    version: number;
    systemPrompt: string;
    userTemplate: string | null;
    variables: unknown;
    temperature: number;
    maxTokens: number;
    safetyLevel: string | null;
    fallbackPromptId: string | null;
    experimentTag: string | null;
  },
) {
  return {
    promptId: registry.promptId,
    name: registry.name,
    category: registry.category,
    version: v.version,
    systemPrompt: v.systemPrompt,
    userTemplate: v.userTemplate,
    variables: v.variables as Record<string, string> | null,
    temperature: v.temperature,
    maxTokens: v.maxTokens,
    safetyLevel: v.safetyLevel,
    fallbackPromptId: v.fallbackPromptId,
    experimentTag: v.experimentTag,
    approvalStatus: registry.approvalStatus,
  };
}

function bucketActor(actorId: string, seed: string): number {
  const hash = crypto.createHash("sha256").update(`${actorId}:${seed}`).digest();
  return hash.readUInt32BE(0);
}

/** A/B experiment routing — picks active experiment variant by actor bucket. */
export async function resolvePromptForRequest(promptId: string, actorId: string) {
  const registry = await prisma.aiPromptRegistry.findUnique({
    where: { promptId },
    include: {
      versions: {
        where: { isActive: true, isDeprecated: false },
        orderBy: { version: "desc" },
      },
    },
  });

  if (!registry || registry.versions.length === 0) return null;

  const experimentVersions = registry.versions.filter((v) => v.experimentTag);
  if (experimentVersions.length >= 2) {
    const bucket = bucketActor(actorId, promptId) % experimentVersions.length;
    return formatPromptVersion(registry, experimentVersions[bucket]!);
  }

  return formatPromptVersion(registry, registry.versions[0]!);
}

/** Walk fallback chain when primary prompt is rejected or unavailable. */
export async function resolvePromptWithFallback(
  promptId: string,
  actorId: string,
  depth = 0,
): Promise<Awaited<ReturnType<typeof getActivePromptVersion>>> {
  if (depth > 3) return null;

  const version = await resolvePromptForRequest(promptId, actorId);
  if (!version) return null;

  if (version.approvalStatus === "APPROVED" && version.systemPrompt) {
    return version;
  }

  if (version.fallbackPromptId) {
    return resolvePromptWithFallback(version.fallbackPromptId, actorId, depth + 1);
  }

  return version.approvalStatus === "APPROVED" ? version : null;
}

export async function getPromptVersionDiff(promptId: string, version: number) {
  const registry = await prisma.aiPromptRegistry.findUnique({
    where: { promptId },
    include: { versions: { where: { version } } },
  });
  if (!registry?.versions[0]) return null;
  return {
    promptId,
    version,
    diffFromPrevious: registry.versions[0].diffFromPrevious,
    systemPrompt: registry.versions[0].systemPrompt,
  };
}
