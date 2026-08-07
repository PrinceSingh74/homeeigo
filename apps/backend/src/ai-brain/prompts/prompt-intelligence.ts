import type { AiGatewayRole } from "@prisma/client";
import { isolateSystemPrompt } from "../../ai/security/prompt-security";
import { getActivePromptVersion, resolvePromptWithFallback } from "./prompt-versioning";
import { getTemplate, renderUserPrompt } from "../../ai/templates/prompt-templates";
import {
  recordPromptTokens,
  recordPromptCompression,
  recordPromptBlocked,
} from "../../lib/ai-brain-metrics";
import type { ComposedPrompt, EnterpriseBuiltContext } from "../types";
import { CONTEXT_TOKEN_BUDGET } from "../types";
import { aiBrainConfig } from "../config";

const POLICY_INJECTIONS: Record<AiGatewayRole, string> = {
  CUSTOMER: "Never share other customers' data. Never invent booking IDs. Escalate payment disputes to support.",
  PARTNER: "Never share customer PII (name, phone, address). Use only provided job IDs. Do not negotiate prices.",
  ADMIN: "Never expose raw secrets, API keys, or full customer PII. Provide actionable insights only.",
  SUPPORT: "Draft responses for agents only. Escalate safety and payment issues immediately.",
  SYSTEM: "Process structured data only. Output valid JSON when requested. No conversational filler.",
  AUTOMATION: "Execute structured tasks. Output machine-readable results. No hallucinated entity IDs.",
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function resolveVariables(
  template: string,
  variables: Record<string, string>,
  context: EnterpriseBuiltContext,
): string {
  let resolved = template;
  for (const [key, value] of Object.entries(variables)) {
    resolved = resolved.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  resolved = resolved.replace(/\{\{context\}\}/g, context.systemContext);
  resolved = resolved.replace(/\{\{message\}\}/g, context.messages.at(-1)?.content ?? "");
  return resolved;
}

function compressContext(context: string, maxTokens: number): { compressed: string; ratio: number } {
  const currentTokens = estimateTokens(context);
  if (currentTokens <= maxTokens) {
    return { compressed: context, ratio: 1 };
  }

  const lines = context.split("\n");
  const priorityLines = lines.filter((l) => l.startsWith("---") || l.includes("Booking") || l.includes("Intent"));
  const otherLines = lines.filter((l) => !priorityLines.includes(l));

  let compressed = [...priorityLines];
  let tokens = estimateTokens(compressed.join("\n"));

  for (const line of otherLines) {
    if (tokens + estimateTokens(line) <= maxTokens) {
      compressed.push(line);
      tokens += estimateTokens(line);
    }
  }

  const result = compressed.join("\n");
  const ratio = estimateTokens(result) / currentTokens;
  return { compressed: result, ratio };
}

export async function composePrompt(input: {
  promptId?: string;
  role: AiGatewayRole;
  context: EnterpriseBuiltContext;
  message: string;
  permissions?: string[];
  actorId?: string;
}): Promise<ComposedPrompt> {
  let systemPrompt: string;
  let userTemplate: string | undefined;
  let maxTokens = 2048;
  let promptVersion = 1;
  let resolvedPromptId = input.promptId ?? "default";

  if (input.promptId) {
    const registryVersion = await resolvePromptWithFallback(
      input.promptId,
      input.actorId ?? "anonymous",
    );
    if (registryVersion && registryVersion.approvalStatus === "APPROVED") {
      systemPrompt = registryVersion.systemPrompt;
      userTemplate = registryVersion.userTemplate ?? undefined;
      maxTokens = registryVersion.maxTokens;
      promptVersion = registryVersion.version;
      resolvedPromptId = registryVersion.promptId;

      if (registryVersion.variables) {
        systemPrompt = resolveVariables(systemPrompt, registryVersion.variables, input.context);
      }
    } else {
      const fallback = await getTemplate(input.promptId, input.role);
      systemPrompt = fallback.systemPrompt;
      userTemplate = fallback.userTemplate;
      maxTokens = fallback.maxTokens;
      resolvedPromptId = fallback.templateId;
    }
  } else {
    const fallback = await getTemplate(undefined, input.role);
    systemPrompt = fallback.systemPrompt;
    userTemplate = fallback.userTemplate;
    maxTokens = fallback.maxTokens;
    resolvedPromptId = fallback.templateId;
  }

  const policyBlock = POLICY_INJECTIONS[input.role];
  const permissionBlock = input.permissions?.length
    ? `Allowed actions: ${input.permissions.join(", ")}`
    : "";

  const contextBudget = CONTEXT_TOKEN_BUDGET.default - estimateTokens(systemPrompt) - CONTEXT_TOKEN_BUDGET.responseReserve;
  const { compressed, ratio } = compressContext(input.context.systemContext, contextBudget);

  if (ratio < aiBrainConfig.promptCompressionThreshold) {
    recordPromptCompression(ratio);
  }

  const enrichedContext = [compressed, policyBlock, permissionBlock].filter(Boolean).join("\n\n");
  const userPrompt = userTemplate
    ? resolveVariables(userTemplate, { message: input.message, context: enrichedContext }, input.context)
    : renderUserPrompt(
        { templateId: resolvedPromptId, name: "", category: "", actorRole: input.role, systemPrompt, userTemplate, maxTokens },
        input.message,
        enrichedContext,
      );

  const isolatedSystem = isolateSystemPrompt(
    `${systemPrompt}\n\n${policyBlock}`,
    userPrompt,
  );

  const tokenEstimate = estimateTokens(isolatedSystem) + estimateTokens(userPrompt);
  recordPromptTokens(tokenEstimate, input.role);

  if (tokenEstimate > CONTEXT_TOKEN_BUDGET.max) {
    recordPromptBlocked("token_budget_exceeded", input.role);
    throw new Error(`Prompt exceeds token budget: ${tokenEstimate} > ${CONTEXT_TOKEN_BUDGET.max}`);
  }

  return {
    systemPrompt: isolatedSystem,
    userPrompt,
    promptId: resolvedPromptId,
    promptVersion,
    tokenEstimate,
    compressionRatio: ratio,
  };
}

export function injectHallucinationGuard(context: EnterpriseBuiltContext): string {
  const knownIds: string[] = [];
  const idPattern = /\b(c[a-z0-9]{20,}|bkg_[a-z0-9]+)\b/gi;
  const matches = context.systemContext.match(idPattern) ?? [];
  knownIds.push(...matches);

  if (knownIds.length === 0) {
    return "IMPORTANT: No entity IDs in context. Do not invent booking, customer, or partner IDs.";
  }

  return `IMPORTANT: Only reference these verified IDs: ${[...new Set(knownIds)].slice(0, 20).join(", ")}. Never invent IDs.`;
}
