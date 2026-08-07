import crypto from "crypto";
import type { AiGatewayRole, AiRequestStatus } from "@prisma/client";
import { aiConfig } from "../config";
import type { AiActorContext, AiGatewayInput, AiGatewayResult } from "../types";
import { AI_TIMEOUT_MS } from "../types";
import { validateAiInput } from "../security/input-validator";
import { validatePromptSecurity, isolateSystemPrompt } from "../security/prompt-security";
import { validateAiOutput } from "../security/output-validator";
import { authorizeAiRequest, getRolePermissions } from "../security/authorization";
import { checkAiRateLimit } from "../rate-limit/ai-rate-limit";
import { buildEnterpriseContext } from "../../ai-brain/context/enterprise-context-builder";
import { composePrompt, injectHallucinationGuard } from "../../ai-brain/prompts/prompt-intelligence";
import { recordTimelineEntry } from "../../ai-brain/timeline/activity-timeline";
import { validateBrainInput, validateBrainOutput } from "../../ai-brain/security/brain-security";
import { persistGatewayTurn } from "../../ai-brain/gateway/conversation-bridge";
import { aiBrainConfig } from "../../ai-brain/config";
import { buildAiContext } from "../context/context-engine";
import { getTemplate, renderUserPrompt } from "../templates/prompt-templates";
import { routeModelRequest } from "../router/model-router";
import { recordAiAudit, recordAiRequest, hashResponse } from "../audit/ai-audit.service";
import { computeTokenCost, recordDailyCost } from "../cost/ai-cost.service";
import prisma from "../../lib/prisma";
import {
  recordAiRequest as recordAiMetric,
  recordAiSuccess,
  recordAiFailure,
  recordAiLatency,
  recordAiCost,
} from "../../lib/ai-metrics";

export type GatewayInvokeOptions = {
  actor: AiActorContext;
  endpoint: "customer" | "partner" | "admin" | "chat";
  input: unknown;
};

export class AiGatewayError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: AiRequestStatus = "FAILED",
  ) {
    super(message);
    this.name = "AiGatewayError";
  }
}

async function recordBlockedTimeline(params: {
  requestId: string;
  actor: AiActorContext;
  reason: string;
  code: string;
  templateId?: string;
  latencyMs?: number;
}): Promise<void> {
  if (!aiBrainConfig.enabled) return;
  await recordTimelineEntry({
    requestId: params.requestId,
    traceId: params.actor.traceId,
    actorId: params.actor.actorId,
    actorRole: params.actor.actorRole,
    promptId: params.templateId,
    promptTokens: 0,
    completionTokens: 0,
    latencyMs: params.latencyMs ?? 0,
    costUsd: 0,
    status: "BLOCKED",
    fallbackUsed: false,
    blocked: true,
    blockReason: params.reason,
    metadata: { code: params.code },
  });
}

export async function invokeAiGateway(options: GatewayInvokeOptions): Promise<AiGatewayResult> {
  if (!aiConfig.enabled) {
    throw new AiGatewayError("AI Gateway disabled", "GATEWAY_DISABLED", "FAILED");
  }

  const requestId = crypto.randomUUID();
  const traceId = options.actor.traceId ?? requestId;
  const actor: AiActorContext = { ...options.actor, traceId };
  const t0 = Date.now();
  const { endpoint } = options;

  const validation = validateAiInput(options.input);
  if (!validation.valid) {
    await recordBlockedTimeline({
      requestId,
      actor,
      reason: validation.errors.join("; "),
      code: "VALIDATION_ERROR",
      latencyMs: Date.now() - t0,
    });
    throw new AiGatewayError(validation.errors.join("; "), "VALIDATION_ERROR", "BLOCKED");
  }
  const input: AiGatewayInput = validation.input;

  const auth = authorizeAiRequest(actor.actorRole, endpoint, input.templateId);
  if (!auth.allowed) {
    await recordBlockedTimeline({
      requestId,
      actor,
      reason: auth.reason,
      code: "FORBIDDEN",
      templateId: input.templateId,
      latencyMs: Date.now() - t0,
    });
    throw new AiGatewayError(auth.reason, "FORBIDDEN", "BLOCKED");
  }

  const rate = await checkAiRateLimit(actor.actorId, actor.actorRole, actor.ipAddress);
  if (!rate.allowed) {
    await recordBlockedTimeline({
      requestId,
      actor,
      reason: "Rate limit exceeded",
      code: "RATE_LIMITED",
      templateId: input.templateId,
      latencyMs: Date.now() - t0,
    });
    throw new AiGatewayError("Rate limit exceeded", "RATE_LIMITED", "BLOCKED");
  }

  const security = aiBrainConfig.enabled
    ? validateBrainInput(input.message, actor.actorRole)
    : validatePromptSecurity(input.message, actor.actorRole);

  if (!security.safe) {
    await Promise.all([
      recordAiAudit({
        requestId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "prompt_blocked",
        reason: security.reason,
        promptHash: security.promptHash,
        promptTokens: 0,
        completionTokens: 0,
        costUsd: 0,
        status: "BLOCKED",
        ipAddress: actor.ipAddress,
        traceId,
      }),
      recordBlockedTimeline({
        requestId,
        actor,
        reason: security.reason ?? "prompt blocked",
        code: "PROMPT_BLOCKED",
        templateId: input.templateId,
        latencyMs: Date.now() - t0,
      }),
    ]);
    throw new AiGatewayError(security.reason ?? "Prompt blocked", "PROMPT_BLOCKED", "BLOCKED");
  }

  recordAiMetric(actor.actorRole, endpoint);

  const permissions = getRolePermissions(actor.actorRole);

  const enterpriseCtx = aiBrainConfig.enabled
    ? await buildEnterpriseContext(
        {
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          message: security.sanitized,
          context: input.context,
          history: input.history,
          conversationId: input.conversationId,
          organizationId: actor.organizationId,
        },
        requestId,
      )
    : null;

  const composed = aiBrainConfig.enabled && enterpriseCtx
    ? await composePrompt({
        promptId: input.templateId,
        role: actor.actorRole,
        context: enterpriseCtx,
        message: security.sanitized,
        permissions,
        actorId: actor.actorId,
      })
    : null;

  const legacyTemplate = await getTemplate(input.templateId, actor.actorRole);
  const template = composed
    ? { templateId: composed.promptId, maxTokens: legacyTemplate.maxTokens, systemPrompt: composed.systemPrompt }
    : legacyTemplate;

  const built = enterpriseCtx ?? await buildAiContext(actor.actorRole, security.sanitized, input.context, input.history);
  const userPrompt = composed?.userPrompt ?? renderUserPrompt(template, security.sanitized, built.systemContext);
  const hallucinationGuard = enterpriseCtx ? injectHallucinationGuard(enterpriseCtx) : "";
  const systemPrompt = isolateSystemPrompt(
    composed?.systemPrompt ?? template.systemPrompt,
    `${hallucinationGuard}\n${userPrompt}`,
  );

  try {
    const routed = await Promise.race([
      routeModelRequest({
        systemPrompt,
        messages: built.messages,
        maxTokens: template.maxTokens,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new AiGatewayError("Gateway timeout", "TIMEOUT", "TIMEOUT")), AI_TIMEOUT_MS.gateway),
      ),
    ]);

    const output = aiBrainConfig.enabled
      ? await validateBrainOutput(routed.content, {
          expectJson: Boolean(input.responseSchema),
          schema: input.responseSchema,
        })
      : await validateAiOutput(routed.content, {
          expectJson: Boolean(input.responseSchema),
          schema: input.responseSchema,
          validateIds: true,
        });

    if (!output.valid) {
      throw new AiGatewayError(output.reason ?? "Output validation failed", "OUTPUT_VALIDATION_FAILED", "FAILED");
    }

    const costUsd = computeTokenCost(
      routed.provider,
      routed.promptTokens,
      routed.completionTokens,
      routed.cachedTokens,
    );
    const latencyMs = Date.now() - t0;
    const status: AiRequestStatus = routed.fallbackUsed ? "FALLBACK" : "SUCCESS";
    const responseHash = hashResponse(output.content);

    let conversationId = input.conversationId;
    if (aiBrainConfig.enabled) {
      const turn = await persistGatewayTurn(
        actor.actorId,
        input.conversationId,
        security.sanitized,
        output.content,
      );
      conversationId = turn.conversationId;
    }

    await Promise.all([
      recordAiRequest({
        requestId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        templateId: template.templateId,
        promptHash: security.promptHash,
        responseHash,
        provider: routed.provider,
        status,
        latencyMs,
        promptTokens: routed.promptTokens,
        completionTokens: routed.completionTokens,
        cachedTokens: routed.cachedTokens ?? 0,
        costUsd,
        fallbackUsed: routed.fallbackUsed,
        ipAddress: actor.ipAddress,
        traceId,
      }),
      recordAiAudit({
        requestId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        action: "ai_completion",
        promptHash: security.promptHash,
        responseHash,
        provider: routed.provider,
        latencyMs,
        promptTokens: routed.promptTokens,
        completionTokens: routed.completionTokens,
        costUsd,
        status,
        ipAddress: actor.ipAddress,
        traceId,
      }),
      recordDailyCost(prisma, new Date(), routed.provider, actor.actorRole, routed.promptTokens, routed.completionTokens, costUsd),
      aiBrainConfig.enabled
        ? recordTimelineEntry({
            requestId,
            traceId,
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            promptId: composed?.promptId ?? template.templateId,
            promptVersion: composed?.promptVersion,
            model: routed.model,
            provider: routed.provider,
            contextHash: enterpriseCtx?.contextHash,
            promptTokens: routed.promptTokens,
            completionTokens: routed.completionTokens,
            latencyMs,
            costUsd,
            status,
            fallbackUsed: routed.fallbackUsed,
            blocked: false,
            resultHash: responseHash,
            metadata: {
              endpoint,
              compressionRatio: composed?.compressionRatio,
              conversationId,
              permissions,
            },
          })
        : Promise.resolve(),
    ]);

    recordAiSuccess(actor.actorRole, routed.provider);
    recordAiLatency(latencyMs, routed.provider);
    recordAiCost(costUsd, routed.provider, actor.actorRole);

    return {
      requestId,
      content: output.content,
      provider: routed.provider,
      model: routed.model,
      status,
      latencyMs,
      promptTokens: routed.promptTokens,
      completionTokens: routed.completionTokens,
      cachedTokens: routed.cachedTokens ?? 0,
      costUsd,
      fallbackUsed: routed.fallbackUsed,
      templateId: template.templateId,
      conversationId,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const code = err instanceof AiGatewayError ? err.code : "PROVIDER_ERROR";
    const status: AiRequestStatus = code === "TIMEOUT" ? "TIMEOUT" : "FAILED";
    recordAiFailure(actor.actorRole, code);

    await Promise.all([
      recordAiRequest({
        requestId,
        actorId: actor.actorId,
        actorRole: actor.actorRole,
        templateId: input.templateId,
        promptHash: security.promptHash,
        status,
        latencyMs,
        promptTokens: 0,
        completionTokens: 0,
        cachedTokens: 0,
        costUsd: 0,
        fallbackUsed: false,
        errorCode: code,
        ipAddress: actor.ipAddress,
        traceId,
      }),
      aiBrainConfig.enabled
        ? recordTimelineEntry({
            requestId,
            traceId,
            actorId: actor.actorId,
            actorRole: actor.actorRole,
            promptId: input.templateId,
            contextHash: enterpriseCtx?.contextHash,
            promptTokens: 0,
            completionTokens: 0,
            latencyMs,
            costUsd: 0,
            status,
            fallbackUsed: false,
            blocked: code === "PROMPT_BLOCKED" || code === "FORBIDDEN" || code === "VALIDATION_ERROR",
            blockReason: code,
          })
        : Promise.resolve(),
    ]).catch(() => undefined);

    throw err;
  }
}

export async function getAiHealth(): Promise<{
  status: "ok" | "degraded" | "down";
  gateway: boolean;
  gemini: { configured: boolean; circuit: string };
  openai: { configured: boolean; circuit: string };
}> {
  const { getCircuitStates } = await import("../router/model-router");
  const { isGeminiConfigured, isOpenAiConfigured } = await import("../config");
  const circuits = getCircuitStates();
  const geminiOk = isGeminiConfigured() && circuits.GEMINI !== "open";
  const openaiOk = isOpenAiConfigured() || aiConfig.dryRun;
  const status = geminiOk || openaiOk ? (geminiOk ? "ok" : "degraded") : "down";
  return {
    status,
    gateway: aiConfig.enabled,
    gemini: { configured: isGeminiConfigured(), circuit: circuits.GEMINI },
    openai: { configured: isOpenAiConfigured(), circuit: circuits.OPENAI },
  };
}
