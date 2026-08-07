import crypto from "crypto";
import type { AiGatewayRole } from "@prisma/client";
import prisma from "../../lib/prisma";
import type { AiMessage } from "../../ai/types";
import { buildAiContext } from "../../ai/context/context-engine";
import { buildBusinessObjectSection, buildPermissionsSection } from "./role-context";
import { retrieveMemories, recallMemoriesForActor } from "../memory/memory-engine";
import { loadConversationMemory } from "../memory/conversation-memory";
import { getCachedContext, setCachedContext } from "./context-cache";
import { saveContextSnapshot } from "./context-snapshot";
import {
  recordContextBuild,
  recordContextLatency,
  recordContextSize,
} from "../../lib/ai-brain-metrics";
import type { ContextBuildRequest, ContextSection, EnterpriseBuiltContext } from "../types";
import { CONTEXT_TOKEN_BUDGET } from "../types";
import { aiBrainConfig } from "../config";

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function hashContext(sections: ContextSection[]): string {
  const payload = sections.map((s) => `${s.name}:${s.content}`).join("|");
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function trimSections(sections: ContextSection[], budget: number): { sections: ContextSection[]; trimmed: boolean } {
  const sorted = [...sections].sort((a, b) => b.priority - a.priority);
  const kept: ContextSection[] = [];
  let used = 0;
  let trimmed = false;

  for (const section of sorted) {
    if (used + section.tokenEstimate <= budget) {
      kept.push(section);
      used += section.tokenEstimate;
    } else {
      trimmed = true;
    }
  }

  return { sections: kept.sort((a, b) => a.priority - b.priority), trimmed };
}

async function buildIdentitySection(req: ContextBuildRequest): Promise<ContextSection> {
  const lines = [
    `Actor: ${req.actorId}`,
    `Role: ${req.actorRole}`,
  ];
  if (req.organizationId) lines.push(`Organization: ${req.organizationId}`);
  if (req.tenantId) lines.push(`Tenant: ${req.tenantId}`);
  if (req.language) lines.push(`Language: ${req.language}`);
  if (req.timezone) lines.push(`Timezone: ${req.timezone}`);
  if (req.sessionId) lines.push(`Session: ${req.sessionId}`);

  const content = lines.join("\n");
  return { name: "identity", content, priority: 100, tokenEstimate: estimateTokens(content) };
}

async function buildPermissionsSectionFromRole(role: AiGatewayRole): Promise<ContextSection> {
  return buildPermissionsSection(role);
}

async function buildBusinessSection(role: AiGatewayRole, req: ContextBuildRequest): Promise<ContextSection | null> {
  return buildBusinessObjectSection(role, req);
}

async function buildMemorySection(req: ContextBuildRequest): Promise<ContextSection | null> {
  const [memories, recalled] = await Promise.all([
    retrieveMemories({
      ownerId: req.actorId,
      tenantId: req.tenantId,
      limit: 10,
      minImportance: 0.3,
    }),
    recallMemoriesForActor(req.actorId, req.message, 5),
  ]);

  const merged = [...recalled, ...memories.filter((m) => !recalled.some((r) => r.id === m.id))].slice(0, 12);
  if (merged.length === 0) return null;

  const content = merged
    .map((m) => `[${m.memoryType}] ${m.summary ?? JSON.stringify(m.content)}`)
    .join("\n");
  return { name: "memory", content, priority: 70, tokenEstimate: estimateTokens(content) };
}

async function buildFeatureFlagsSection(flags?: Record<string, boolean>): Promise<ContextSection | null> {
  if (!flags || Object.keys(flags).length === 0) return null;
  const content = `Feature Flags:\n${Object.entries(flags).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`;
  return { name: "feature_flags", content, priority: 50, tokenEstimate: estimateTokens(content) };
}

async function buildConversationMemorySection(
  req: ContextBuildRequest,
): Promise<{ section: ContextSection | null; history: AiMessage[] }> {
  if (!req.conversationId) {
    return { section: null, history: req.history ?? [] };
  }

  const conv = await loadConversationMemory(req.actorId, req.conversationId);
  if (!conv) return { section: null, history: req.history ?? [] };

  const parts: string[] = [];
  if (conv.summary) parts.push(`Summary: ${conv.summary}`);
  if (conv.pinnedFacts?.length) parts.push(`Pinned Facts:\n${conv.pinnedFacts.map((f) => `- ${f}`).join("\n")}`);
  if (conv.topics?.length) parts.push(`Topics: ${conv.topics.join(", ")}`);
  if (conv.intentHistory?.length) parts.push(`Recent Intents: ${conv.intentHistory.slice(-5).join(" → ")}`);

  const section = parts.length > 0
    ? { name: "conversation_memory", content: parts.join("\n"), priority: 75, tokenEstimate: estimateTokens(parts.join("\n")) }
    : null;

  const history = conv.messages.length > 0 ? conv.messages : (req.history ?? []);
  return { section, history };
}

export async function buildEnterpriseContext(
  req: ContextBuildRequest,
  requestId?: string,
): Promise<EnterpriseBuiltContext> {
  const t0 = Date.now();
  recordContextBuild(req.actorRole);

  const cacheKey = `${req.actorId}:${req.actorRole}:${req.conversationId ?? "none"}:${crypto.createHash("sha256").update(req.message).digest("hex").slice(0, 8)}`;
  const cached = await getCachedContext(cacheKey, req.actorId, req.actorRole);
  if (cached) {
    recordContextLatency(Date.now() - t0, req.actorRole, true);
    return { ...cached, messages: [...cached.messages.filter((m) => m.role !== "user"), { role: "user", content: req.message }] };
  }

  const legacy = await buildAiContext(req.actorRole, req.message, req.context, req.history);

  const sections: ContextSection[] = [
    await buildIdentitySection(req),
    await buildPermissionsSectionFromRole(req.actorRole),
  ];

  const flagsSection = await buildFeatureFlagsSection(req.featureFlags);
  if (flagsSection) sections.push(flagsSection);

  if (req.intent) {
    const intentContent = `Detected Intent: ${req.intent}`;
    sections.push({ name: "intent", content: intentContent, priority: 85, tokenEstimate: estimateTokens(intentContent) });
  }

  const businessSection = await buildBusinessSection(req.actorRole, req);
  if (businessSection) sections.push(businessSection);

  const memorySection = await buildMemorySection(req);
  if (memorySection) sections.push(memorySection);

  const { section: convSection, history } = await buildConversationMemorySection(req);
  if (convSection) sections.push(convSection);

  if (legacy.systemContext) {
    sections.push({
      name: "legacy_context",
      content: legacy.systemContext,
      priority: 60,
      tokenEstimate: estimateTokens(legacy.systemContext),
    });
  }

  const budget = CONTEXT_TOKEN_BUDGET.default - CONTEXT_TOKEN_BUDGET.systemReserve - CONTEXT_TOKEN_BUDGET.responseReserve;
  const { sections: trimmedSections, trimmed } = trimSections(sections, budget);

  const systemContext = trimmedSections.map((s) => `--- ${s.name} ---\n${s.content}`).join("\n\n");
  const contextHash = hashContext(trimmedSections);
  const contextSize = systemContext.length;

  recordContextSize(contextSize, req.actorRole);
  recordContextLatency(Date.now() - t0, req.actorRole, false);

  const result: EnterpriseBuiltContext = {
    systemContext,
    messages: [...history, { role: "user", content: req.message }],
    sections: trimmedSections,
    metadata: {
      ...legacy.metadata,
      contextHash,
      trimmed,
      intent: req.intent,
      conversationId: req.conversationId,
    },
    contextHash,
    contextSize,
    tokenBudget: budget,
    trimmed,
  };

  await Promise.all([
    setCachedContext(cacheKey, req.actorId, req.actorRole, contextHash, result),
    requestId
      ? saveContextSnapshot({
          requestId,
          actorId: req.actorId,
          actorRole: req.actorRole,
          contextHash,
          contextSize,
          sections: trimmedSections,
        })
      : Promise.resolve(),
  ]);

  return result;
}

export async function rebuildContext(req: ContextBuildRequest, requestId?: string): Promise<EnterpriseBuiltContext> {
  const cacheKey = `${req.actorId}:${req.actorRole}:${req.conversationId ?? "none"}:rebuild`;
  await prisma.aiContextCache.deleteMany({ where: { cacheKey: { startsWith: req.actorId } } }).catch(() => undefined);
  return buildEnterpriseContext({ ...req, featureFlags: { ...req.featureFlags, forceRebuild: true } }, requestId);
}
