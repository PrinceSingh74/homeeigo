import crypto from "crypto";
import type { AiProviderType, AiRequestStatus } from "@prisma/client";
import { aiConfig, liveInferenceConfigured } from "../config";
import type { AiActorContext, AiGatewayInput, AiGatewayResult } from "../types";
import { AI_TIMEOUT_MS } from "../types";
import { validateAiInput } from "../security/input-validator";
import { validatePromptSecurity, isolateSystemPrompt, hashContent } from "../security/prompt-security";
import { validateAiOutput } from "../security/output-validator";
import { authorizeAiRequest, getRolePermissions } from "../security/authorization";
import { checkAiRateLimit } from "../rate-limit/ai-rate-limit";
import { estimateTokens } from "../providers/model-providers";
import { checkAndReserveBudget, settleBudget, abandonBudget, currentEligibleProviders } from "../../services/ai-budget.service";
import { buildEnterpriseContext } from "../../ai-brain/context/enterprise-context-builder";
import { composePrompt, injectHallucinationGuard } from "../../ai-brain/prompts/prompt-intelligence";
import { recordTimelineEntry } from "../../ai-brain/timeline/activity-timeline";
import { validateBrainInput, validateBrainOutput } from "../../ai-brain/security/brain-security";
import { persistGatewayTurn } from "../../ai-brain/gateway/conversation-bridge";
import { aiBrainConfig } from "../../ai-brain/config";
import { bindAiContextToActor } from "../../ai-tools/execution/actor-resolver";
import { buildAiContext } from "../context/context-engine";
import { getTemplate, renderUserPrompt } from "../templates/prompt-templates";
import type { PromptTemplate } from "../templates/prompt-templates";
import { routeModelRequest, RouterDeadlineError, RouterExhaustedError } from "../router/model-router";
// NOTE: the tool bridge is imported lazily inside invokeAiGateway (see the tools branch). A static
// import here closed a 7-hop cycle: tool-registry → handlers → support services → THIS gateway →
// tool-bridge → tool-registry, whose correctness depended on module load order.
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
  recordMockedResponse,
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
    intent?: import("../intent/intent-classifier").AiIntent | string;
    /** Underlying application role, for tool handlers that resolve a provider record. */
    userRole?: string;
    /** Only true where the caller can present a confirmation to the user. */
    allowWrites?: boolean;
  };
};

export class AiGatewayError extends Error {
  /** Diagnostic detail for logs and audit only. Never part of a response. */
  internalReason?: string;

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
 * The only text a caller ever sees for a blocked prompt.
 *
 * The firewall's reason names the rule that matched (`injection_pattern:<first 40 characters of the
 * regex>`), and every AI route returns `err.message` to the client — so a blocked prompt used to hand
 * any signed-in user the pattern to rephrase around. The reason still reaches the audit row, the
 * timeline and the logs; the response says only that the message was refused.
 */
export const PROMPT_BLOCKED_PUBLIC_MESSAGE = "This message can't be processed. Please rephrase it and try again.";

export function promptBlockedError(reason: string | undefined): AiGatewayError {
  const err = new AiGatewayError(PROMPT_BLOCKED_PUBLIC_MESSAGE, "PROMPT_BLOCKED", "BLOCKED");
  err.internalReason = reason ?? "prompt blocked";
  return err;
}

/**
 * Gateway error code → HTTP status, defined once.
 *
 * Every route that fronts the gateway maps errors through this table so the same
 * condition cannot surface as 429 on one entry point and 502 on another. Anything not
 * listed is an upstream provider fault and becomes 502.
 */
export const AI_ERROR_STATUS: Record<string, number> = {
  /** 402: the request was well-formed and permitted; the platform has run out of AI budget. */
  BUDGET_EXCEEDED: 402,
  /** 402 too: a well-formed request refused because no spend cap has been agreed on a deployed host. */
  BUDGET_POLICY_REQUIRED: 402,
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
        /**
         * `PromptSecurityResult`'s unsafe variant is `{ safe: false, reason, category }` — it
         * carries NO `promptHash`. Only `validateBrainInput` (the ai-brain path) always returns
         * one, so with ai-brain disabled every BLOCKED prompt was audited with
         * `promptHash: undefined`, losing the hash on exactly the records a security review needs.
         * Derived from the message when the variant omits it, using the same `hashContent` the
         * safe path uses, so blocked and allowed records hash identically.
         */
        promptHash: "promptHash" in security ? security.promptHash : hashContent(input.message),
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
    throw promptBlockedError(security.reason);
  }

  recordAiMetric(actor.actorRole, endpoint);

  input.context = await bindAiContextToActor(actor, input.context);

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
  // Spread the legacy template rather than rebuilding a partial one.
  //
  // The three fields anything downstream reads are unchanged: `templateId` and `systemPrompt` are
  // still overridden by the composed prompt and `maxTokens` still comes from the legacy template.
  // The difference is that `template` is now a real `PromptTemplate` instead of a three-field
  // object, so it satisfies `renderUserPrompt` without widening that signature.
  //
  // It also closes a latent trap: the partial object dropped `userTemplate`, so if the composed
  // path ever did reach `renderUserPrompt` — today it cannot, because `ComposedPrompt.userPrompt`
  // is a required string and `??` short-circuits — it would have silently fallen back to the
  // generic "User: {message}" rendering instead of the template's own user format.
  const template: PromptTemplate = composed
    ? { ...legacyTemplate, templateId: composed.promptId, systemPrompt: composed.systemPrompt }
    : legacyTemplate;

  const built = enterpriseCtx ?? await buildAiContext(actor.actorRole, security.sanitized, input.context, input.history);
  const userPrompt = composed?.userPrompt ?? renderUserPrompt(template, security.sanitized, built.systemContext);
  const hallucinationGuard = enterpriseCtx ? injectHallucinationGuard(enterpriseCtx) : "";
  const systemPrompt = isolateSystemPrompt(
    composed?.systemPrompt ?? template.systemPrompt,
    `${hallucinationGuard}\n${userPrompt}`,
  );

  /**
   * Phase 14 — the spend cap.
   *
   * Placed here, and not earlier, because a reservation must be priced against the prompt that is
   * actually about to be sent: before composition the prompt does not exist yet, and pricing a
   * guess would make reserved and settled spend disagree for reasons nobody could trace.
   *
   * Placed here, and not later, because this is the last point at which nothing has been spent.
   * A cap enforced after the provider answers is a report, not a control.
   *
   * With no policy configured this is one counter increment and a pass-through — the platform's
   * behaviour is unchanged until somebody sets a limit.
   */
  const budget = await checkAndReserveBudget({
    eligibleProviders: currentEligibleProviders(),
    actorRole: actor.actorRole,
    actorId: actor.actorId,
    endpoint,
    estimatedPromptTokens: estimateTokens({ messages: built.messages, systemPrompt }),
    maxOutputTokens: template.maxTokens,
    traceId,
  });

  if (!budget.allowed) {
    // "Out of budget" and "no budget has been agreed" are different facts for an operator and a
    // client; reporting the second as BUDGET_EXCEEDED sends someone looking for spend that never
    // happened. Both remain refusals.
    const code = budget.decision === "NO_POLICY_CONFIGURED" ? "BUDGET_POLICY_REQUIRED" : "BUDGET_EXCEEDED";
    await recordBlockedTimeline({
      requestId,
      actor,
      reason: budget.reason,
      code,
      templateId: input.templateId,
      latencyMs: Date.now() - t0,
    });
    throw new AiGatewayError(budget.reason, code, "BLOCKED");
  }

  /**
   * Every exit from here on must release the reservation. Success settles it to the measured cost;
   * any failure abandons it, because a request that never reached a provider spent nothing and must
   * not hold budget for the rest of the window. The flag makes a double release impossible.
   */
  let budgetSettled = false;
  const releaseBudget = async (actual?: { costUsd: number; costStatus: "COMPUTED" | "UNKNOWN" }) => {
    if (budgetSettled || budget.reservations.length === 0) return;
    budgetSettled = true;
    await (actual ? settleBudget(budget.reservations, actual) : abandonBudget(budget.reservations));
  };

  try {
    // Tool-enabled turns run the model↔tool conversation; everything else routes once.
    //
    // The bridge is driven from here rather than beside the gateway so that tool use stays
    // behind the same single entry: the RBAC check, rate limit, prompt screening and audit
    // above have already run, and the result below is validated and audited like any other.
    const toolContext = options.tools;
    const runToolConversation = toolContext?.enabled
      ? (await import("../../ai-tools/bridge/tool-bridge")).runToolConversation
      : null;
    const routed = await Promise.race([
      toolContext?.enabled && runToolConversation
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
            /**
             * A tool loop reaches providers through the same router, so its turns are dry-runs
             * under exactly the conditions a direct call is. The bridge does not surface that per
             * turn, so it is derived from the configuration that decides it — the alternative is a
             * tool-assisted answer being billed as real spend while a plain one is not.
             */
            mocked: !liveInferenceConfigured(r.provider as AiProviderResponseProvider),
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

    const estimated = computeTokenCostDetailed(
      routed.provider,
      routed.promptTokens,
      routed.completionTokens,
      routed.cachedTokens,
    );

    /**
     * A dry-run contacted no provider, so it cost nothing. The token figures attached to it are an
     * estimate of what the canned string WOULD have cost, and were previously aggregated as actual
     * spend — on a deployment with no provider credential, every rupee reported by
     * `homigo_ai_daily_cost_usd` was imaginary.
     *
     * Actual cost is therefore forced to zero for a mock, and the estimate is reported separately
     * so nothing is lost: an operator can still see what the traffic would cost once a key is
     * configured, without that number ever being mistaken for money already spent.
     */
    const costStatus = estimated.costStatus;
    const costUsd = routed.mocked ? 0 : estimated.costUsd;
    if (routed.mocked) {
      recordMockedResponse(routed.provider, actor.actorRole, estimated.costUsd, costStatus);
    }
    // Settle before anything else can throw: the measured cost is known now, and an audit or
    // persistence failure below must not leave the reservation held for the rest of the window.
    await releaseBudget({ costUsd, costStatus });
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
    recordAiCost(costUsd, routed.provider, actor.actorRole, costStatus);

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
    /**
     * Abandon, not settle. The request failed, so whatever it may have cost is not knowable from
     * here — a provider error can arrive after tokens were billed or before a connection was made,
     * and the platform has no figure for either. Settling a fabricated cost would put an invented
     * number into the budget accumulator; holding the reservation would leak headroom until the
     * window rolls. Releasing it un-settled is the only honest option, and the request is still
     * counted by `request_count`, which the reservation already incremented.
     */
    await releaseBudget();
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
        /**
         * §23 — the failure path recorded no prompt version, so a request that resolved a prompt
         * and then failed could not be traced back to the prompt text that produced it. Failures
         * are exactly where that trace is wanted: "which prompt version was serving when this
         * started erroring" is unanswerable if only successes carry the version.
         */
        promptVersion: composed?.promptVersion,
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
