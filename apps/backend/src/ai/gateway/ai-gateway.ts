import crypto from "crypto";
import type { AiGatewayRole, AiRequestStatus } from "@prisma/client";
import { aiConfig } from "../config";
import type { AiActorContext, AiGatewayInput, AiGatewayResult } from "../types";
import { AI_TIMEOUT_MS } from "../types";
import { validateAiInput } from "../security/input-validator";
import { validatePromptSecurity, isolateSystemPrompt } from "../security/prompt-security";
import { validateAiOutput } from "../security/output-validator";
import { authorizeAiRequest } from "../security/authorization";
import { checkAiRateLimit } from "../rate-limit/ai-rate-limit";
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

export async function invokeAiGateway(options: GatewayInvokeOptions): Promise<AiGatewayResult> {
  if (!aiConfig.enabled) {
    throw new AiGatewayError("AI Gateway disabled", "GATEWAY_DISABLED", "FAILED");
  }

  const requestId = crypto.randomUUID();
  const t0 = Date.now();
  const { actor, endpoint } = options;

  const validation = validateAiInput(options.input);
  if (!validation.valid) {
    throw new AiGatewayError(validation.errors.join("; "), "VALIDATION_ERROR", "BLOCKED");
  }
  const input: AiGatewayInput = validation.input;

  const auth = authorizeAiRequest(actor.actorRole, endpoint, input.templateId);
  if (!auth.allowed) {
    throw new AiGatewayError(auth.reason, "FORBIDDEN", "BLOCKED");
  }

  const rate = await checkAiRateLimit(actor.actorId, actor.actorRole, actor.ipAddress);
  if (!rate.allowed) {
    throw new AiGatewayError("Rate limit exceeded", "RATE_LIMITED", "BLOCKED");
  }

  const security = validatePromptSecurity(input.message, actor.actorRole);
  if (!security.safe) {
    await recordAiAudit({
      requestId,
      actorId: actor.actorId,
      actorRole: actor.actorRole,
      action: "prompt_blocked",
      reason: security.reason,
      promptHash: hashResponse(input.message),
      promptTokens: 0,
      completionTokens: 0,
      costUsd: 0,
      status: "BLOCKED",
      ipAddress: actor.ipAddress,
      traceId: actor.traceId,
    });
    throw new AiGatewayError(security.reason, "PROMPT_BLOCKED", "BLOCKED");
  }

  recordAiMetric(actor.actorRole, endpoint);

  const template = await getTemplate(input.templateId, actor.actorRole);
  const built = await buildAiContext(actor.actorRole, security.sanitized, input.context, input.history);
  const userPrompt = renderUserPrompt(template, security.sanitized, built.systemContext);
  const systemPrompt = isolateSystemPrompt(template.systemPrompt, userPrompt);

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

    const output = await validateAiOutput(routed.content, {
      expectJson: Boolean(input.responseSchema),
      schema: input.responseSchema,
      validateIds: true,
    });

    if (!output.valid) {
      throw new AiGatewayError(output.reason, "OUTPUT_VALIDATION_FAILED", "FAILED");
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
        traceId: actor.traceId,
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
        traceId: actor.traceId,
      }),
      recordDailyCost(prisma, new Date(), routed.provider, actor.actorRole, routed.promptTokens, routed.completionTokens, costUsd),
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
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    const code = err instanceof AiGatewayError ? err.code : "PROVIDER_ERROR";
    const status: AiRequestStatus = code === "TIMEOUT" ? "TIMEOUT" : "FAILED";
    recordAiFailure(actor.actorRole, code);

    await recordAiRequest({
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
      traceId: actor.traceId,
    }).catch(() => undefined);

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
