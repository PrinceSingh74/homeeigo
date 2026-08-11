import crypto from "crypto";
import type { AiGatewayRole, AiProviderType, AiRequestStatus } from "@prisma/client";
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
import { routeModelRequest, RouterDeadlineError, RouterExhaustedError } from "../router/model-router";
import { runToolConversation } from "../../ai-tools/bridge/tool-bridge";
import type { AiProviderType as AiProviderResponseProvider } from "@prisma/client";
import { recordAiAudit, recordAiRequest, hashResponse } from "../audit/ai-audit.service";
import { computeTokenCostDetailed, recordDailyCost } from "../cost/ai-cost.service";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  recordAiRequest as recordAiMetric,
  recordAiSuccess,
  recordAiFailure,
  recordAiLatency,
  recordAiCost,
  recordAiTokens,
} from "../../lib/ai-metrics";

export type GatewayInvokeOptions = {
  actor: AiActorContext;
  endpoint: "customer" | "partner" | "admin" | "chat";
  input: unknown;
  /**
   * Opt-in tool use for this request.
   *
   * Off by default: a surface must decide it can carry a confirmation step before write
   * tools are offered, and callers that only want an answer should not pay for tool
   * discovery or risk a tool round.
   */
  tools?: {
    enabled: boolean;
    intent?: import("../intent/intent-classifier").AiIntent;
    /** Underlying application role, for tool handlers that resolve a provider record. */
    userRole?: string;
    /** Only true where the caller can present a confirmation to the user. */
    allowWrites?: boolean;
  };
};

export class AiGatewayError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: AiRequestStatus = "FAILED",
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "AiGatewayError";
  }
}

/**
 * Gateway error code → HTTP status, defined once.
 *
 * Every route that fronts the gateway maps errors through this table so the same
 * condition cannot surface as 429 on one entry point and 502 on another. Anything not
 * listed is an upstream provider fault and becomes 502.
 */
export const AI_ERROR_STATUS: Record<string, number> = {
  FORBIDDEN: 403,
  RATE_LIMITED: 429,
  PROMPT_BLOCKED: 400,
  VALIDATION_ERROR: 400,
  OUTPUT_VALIDATION_FAILED: 502,
  TIMEOUT: 504,
  GATEWAY_DISABLED: 503,
};

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
    // Tool-enabled turns run the model↔tool conversation; everything else routes once.
    //
    // The bridge is driven from here rather than beside the gateway so that tool use stays
    // behind the same single entry: the RBAC check, rate limit, prompt screening and audit
    // above have already run, and the result below is validated and audited like any other.
    const toolContext = options.tools;
    const routed = await Promise.race([
      toolContext?.enabled
        ? runToolConversation({
            actor: {
              actorId: actor.actorId,
              actorRole: actor.actorRole,
              userRole: toolContext.userRole ?? actor.actorRole,
              ipAddress: actor.ipAddress,
              traceId,
              correlationId: requestId,
            },
            intent: toolContext.intent,
            systemPrompt,
            messages: built.messages,
            maxTokens: template.maxTokens,
            allowWrites: toolContext.allowWrites === true,
            // The frozen router stays the only path to a provider — the bridge never
            // reaches an adapter itself.
            route: (req) => routeModelRequest(req),
          }).then((r) => ({
            content: r.content,
            provider: r.provider as AiProviderResponseProvider,
            model: r.model,
            promptTokens: r.promptTokens,
            completionTokens: r.completionTokens,
            cachedTokens: 0,
            latencyMs: 0,
            fallbackUsed: false,
            fallbackDepth: 0,
            attempts: [],
            // The bridge's final turn is prose by construction, so there is no provider
            // stop reason to carry; the tool trace below is the meaningful outcome.
            finishReason: undefined as string | undefined,
            toolCalls: r.toolCalls,
            loopLimitHit: r.loopLimitHit,
          }))
        : routeModelRequest({
            systemPrompt,
            messages: built.messages,
            maxTokens: template.maxTokens,
          }),
      // Outer bound only. The router enforces the shared per-request deadline; this race
      // is the backstop for anything that could hang outside the router's control.
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new AiGatewayError("Gateway timeout", "TIMEOUT", "TIMEOUT")),
          Math.max(AI_TIMEOUT_MS.gateway, aiConfig.totalDeadlineMs + 2_000),
        ),
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

    const { costUsd, costStatus } = computeTokenCostDetailed(
      routed.provider,
      routed.promptTokens,
      routed.completionTokens,
      routed.cachedTokens,
    );
    recordAiTokens(routed.provider, routed.promptTokens, routed.completionTokens);
    const latencyMs = Date.now() - t0;
    const status: AiRequestStatus = routed.fallbackUsed ? "FALLBACK" : "SUCCESS";
    const responseHash = hashResponse(output.content);

    // One line per provider attempt. Content never appears here — provider, outcome,
    // taxonomy code and timing only — so the trail is safe to keep verbatim.
    if (routed.attempts.length > 1) {
      logger.info("ai_provider_failover", {
        category: "APPLICATION",
        requestId,
        traceId,
        fallbackDepth: routed.fallbackDepth,
        selectedProvider: routed.provider,
        attempts: routed.attempts.map((a) => ({
          attemptId: a.attemptId,
          provider: a.provider,
          outcome: a.outcome,
          errorCode: a.errorCode,
          httpStatus: a.httpStatus,
          latencyMs: a.latencyMs,
          cooldownMs: a.cooldownMs,
        })),
      });
    }

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
        promptVersion: composed?.promptVersion,
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
      costStatus,
      fallbackUsed: routed.fallbackUsed,
      fallbackDepth: routed.fallbackDepth,
      finishReason: routed.finishReason,
      templateId: template.templateId,
      conversationId,
    };
  } catch (err) {
    const latencyMs = Date.now() - t0;
    // Router outcomes carry their own meaning: a spent deadline is a timeout, not a
    // provider fault, and must not be reported as one.
    const code = err instanceof AiGatewayError
      ? err.code
      : err instanceof RouterDeadlineError
        ? "TIMEOUT"
        : "PROVIDER_ERROR";
    const status: AiRequestStatus = code === "TIMEOUT" ? "TIMEOUT" : "FAILED";
    recordAiFailure(actor.actorRole, code);

    // The per-attempt trail is the only record of what the chain actually tried before
    // giving up. It carries no prompt content.
    const routerAttempts =
      err instanceof RouterExhaustedError || err instanceof RouterDeadlineError ? err.attempts : [];
    if (routerAttempts.length > 0) {
      logger.warn("ai_chain_exhausted", {
        category: "APPLICATION",
        requestId,
        traceId,
        code,
        attempts: routerAttempts.map((a) => ({
          attemptId: a.attemptId,
          provider: a.provider,
          outcome: a.outcome,
          errorCode: a.errorCode,
          httpStatus: a.httpStatus,
          latencyMs: a.latencyMs,
          cooldownMs: a.cooldownMs,
        })),
      });
    }

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

    // Normalise before leaving the gateway. Rethrowing the raw error leaked the provider's
    // own response body to callers and logs — for an OpenAI auth failure that body contains
    // a partially-masked API key and provider URLs. Callers also branch on
    // `instanceof AiGatewayError`, so an unwrapped error silently bypassed their handling.
    // The original is kept as `cause` for server-side diagnostics only.
    if (err instanceof AiGatewayError) throw err;
    throw new AiGatewayError("Upstream AI provider failed", "PROVIDER_ERROR", status, {
      cause: err,
    });
  }
}

type ProviderHealth = {
  configured: boolean;
  enabled: boolean;
  health: string;
  circuit: string;
  cooldownRemainingMs: number;
};

/**
 * Reports configuration and health *status* only — never a credential, a prefix, or a
 * length. `configured` is a presence boolean derived from the environment.
 */
export async function getAiHealth(): Promise<{
  status: "ok" | "degraded" | "down";
  gateway: boolean;
  primary: string;
  providerOrder: string[];
  /** Whole-request budget shared by every failover attempt. */
  totalDeadlineMs: number;
  providers: Record<string, ProviderHealth>;
  anthropic: ProviderHealth;
  gemini: ProviderHealth;
  groq: ProviderHealth;
  openai: ProviderHealth;
}> {
  const { describeProviderChain } = await import("../router/model-router");
  const { providerHealth, isProviderEnabled, cooldownRemainingMs, providerBreaker } = await import(
    "../router/provider-registry"
  );
  const { isProviderConfigured } = await import("../config");

  const describe = (p: AiProviderType): ProviderHealth => ({
    configured: isProviderConfigured(p),
    enabled: isProviderEnabled(p),
    health: providerHealth(p),
    circuit: providerBreaker(p).getState(),
    cooldownRemainingMs: cooldownRemainingMs(p),
  });

  const chain = describeProviderChain();
  // Healthy only when the *preferred* provider can serve; if merely a fallback can, the
  // gateway still answers but is running below its intended configuration.
  const servable = (d: { health: string }) => d.health === "AVAILABLE" || d.health === "DEGRADED";
  const primaryOk = chain.length > 0 && servable(chain[0]!);
  const anyOk = chain.some(servable);

  const providers: Record<string, ProviderHealth> = {};
  for (const entry of chain) providers[entry.provider] = describe(entry.provider);

  return {
    status: primaryOk ? "ok" : anyOk ? "degraded" : "down",
    gateway: aiConfig.enabled,
    primary: chain[0]?.provider ?? "none",
    providerOrder: chain.map((c) => c.provider),
    totalDeadlineMs: aiConfig.totalDeadlineMs,
    providers,
    anthropic: describe("ANTHROPIC"),
    gemini: describe("GEMINI"),
    groq: describe("GROQ"),
    openai: describe("OPENAI"),
  };
}
