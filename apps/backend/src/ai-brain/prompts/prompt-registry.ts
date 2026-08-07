import type { AiPromptApprovalStatus } from "@prisma/client";
import prisma from "../../lib/prisma";
import { listBuiltinTemplates } from "../../ai/templates/prompt-templates";
import { recordPromptRegistryTotal } from "../../lib/ai-brain-metrics";
import type { PromptRegistryEntry, PromptVersionEntry } from "../types";

const REGISTRY_CATEGORIES = [
  "customer", "partner", "admin", "finance", "fraud", "support",
  "eta", "operations", "analytics", "forecast", "internal", "system",
] as const;

export async function seedPromptRegistry(): Promise<number> {
  let seeded = 0;
  const builtins = listBuiltinTemplates();

  for (const tpl of builtins) {
    const registry = await prisma.aiPromptRegistry.upsert({
      where: { promptId: tpl.templateId },
      create: {
        promptId: tpl.templateId,
        name: tpl.name,
        category: tpl.category,
        owner: "platform",
        description: `Built-in ${tpl.category} prompt`,
        approvalStatus: "APPROVED",
        createdBy: "system",
      },
      update: {
        name: tpl.name,
        approvalStatus: "APPROVED",
      },
    });

    const existingVersion = await prisma.aiPromptVersion.findFirst({
      where: { registryId: registry.id, version: 1 },
    });

    if (!existingVersion) {
      await prisma.aiPromptVersion.create({
        data: {
          registryId: registry.id,
          version: 1,
          systemPrompt: tpl.systemPrompt,
          userTemplate: tpl.userTemplate,
          maxTokens: tpl.maxTokens,
          isActive: true,
          approvedBy: "system",
          approvedAt: new Date(),
          createdBy: "system",
        },
      });
    }

    seeded += 1;
    recordPromptRegistryTotal(tpl.category);
  }

  return seeded;
}

export async function listPromptRegistry(filters?: {
  category?: string;
  approvalStatus?: AiPromptApprovalStatus;
}): Promise<PromptRegistryEntry[]> {
  const entries = await prisma.aiPromptRegistry.findMany({
    where: {
      ...(filters?.category ? { category: filters.category } : {}),
      ...(filters?.approvalStatus ? { approvalStatus: filters.approvalStatus } : {}),
    },
    include: {
      versions: { where: { isActive: true }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  return entries.map((e) => ({
    promptId: e.promptId,
    name: e.name,
    category: e.category,
    owner: e.owner,
    description: e.description ?? undefined,
    activeVersion: e.versions[0]
      ? mapVersion(e.versions[0])
      : undefined,
  }));
}

function mapVersion(v: {
  version: number;
  systemPrompt: string;
  userTemplate: string | null;
  variables: unknown;
  temperature: number;
  maxTokens: number;
  safetyLevel: string;
  fallbackPromptId: string | null;
}): PromptVersionEntry {
  return {
    version: v.version,
    systemPrompt: v.systemPrompt,
    userTemplate: v.userTemplate ?? undefined,
    variables: (v.variables as Record<string, string> | null) ?? undefined,
    temperature: v.temperature,
    maxTokens: v.maxTokens,
    safetyLevel: v.safetyLevel,
    fallbackPromptId: v.fallbackPromptId ?? undefined,
  };
}

export async function getPromptById(promptId: string): Promise<PromptRegistryEntry | null> {
  const entry = await prisma.aiPromptRegistry.findUnique({
    where: { promptId },
    include: { versions: { where: { isActive: true }, take: 1 } },
  });

  if (!entry) return null;
  return {
    promptId: entry.promptId,
    name: entry.name,
    category: entry.category,
    owner: entry.owner,
    description: entry.description ?? undefined,
    activeVersion: entry.versions[0] ? mapVersion(entry.versions[0]) : undefined,
  };
}

export async function createPromptRegistry(input: {
  promptId: string;
  name: string;
  category: string;
  owner: string;
  description?: string;
  systemPrompt: string;
  userTemplate?: string;
  maxTokens?: number;
  createdBy?: string;
}): Promise<PromptRegistryEntry> {
  if (!REGISTRY_CATEGORIES.includes(input.category as typeof REGISTRY_CATEGORIES[number])) {
    throw new Error(`Invalid category: ${input.category}`);
  }

  const registry = await prisma.aiPromptRegistry.create({
    data: {
      promptId: input.promptId,
      name: input.name,
      category: input.category,
      owner: input.owner,
      description: input.description,
      approvalStatus: "DRAFT",
      createdBy: input.createdBy,
    },
  });

  await prisma.aiPromptVersion.create({
    data: {
      registryId: registry.id,
      version: 1,
      systemPrompt: input.systemPrompt,
      userTemplate: input.userTemplate,
      maxTokens: input.maxTokens ?? 2048,
      isActive: true,
      createdBy: input.createdBy,
    },
  });

  recordPromptRegistryTotal(input.category);
  return (await getPromptById(input.promptId))!;
}

export { REGISTRY_CATEGORIES };
