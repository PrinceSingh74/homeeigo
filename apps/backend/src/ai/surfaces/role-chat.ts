import type { AiGatewayRole } from "@prisma/client";
import { invokeAiGateway, AiGatewayError, aiConfig, isAnyProviderConfigured } from "../index";
import { promptBlockedError } from "../gateway/ai-gateway";
import { mapUserRoleToAiRole } from "../security/authorization";
import { clientIp, traceId } from "../../lib/request-identity";
import { recordAiDegraded } from "../../lib/ai-metrics";
import { logger } from "../../lib/logger";
import { resolveProviderId } from "../../ai-tools/execution/actor-resolver";
import { classifyPartnerIntent } from "../intent/partner-intent";
import { classifyAdminIntent } from "../intent/admin-intent";
import { validatePromptSecurity } from "../security/prompt-security";
import { partnerCopilotService } from "../../services/partner-copilot.service";
import { geoIntelligenceService } from "../../services/geo-intelligence.service";

export type RoleChatResult = {
  content: string;
  provider: string;
  model: string;
  fallbackUsed: boolean;
  requestId: string;
  mode: "llm" | "deterministic_fallback";
  intent: string;
  basis: string[];
  recommendation: string | null;
};

function asGatewayBody(body: unknown): Record<string, unknown> {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
}

async function answerFromTools(providerId: string, message: string): Promise<RoleChatResult> {
  const fallback = await partnerCopilotService.answer(providerId, message);
  return {
    content: fallback.content,
    provider: "DETERMINISTIC",
    model: "partner-copilot",
    fallbackUsed: false,
    requestId: `det_${Date.now()}`,
    mode: "deterministic_fallback",
    intent: fallback.intent,
    basis: fallback.basis,
    recommendation: fallback.recommendation,
  };
}

async function degradePartner(providerId: string, message: string, reason: string): Promise<RoleChatResult> {
  recordAiDegraded("partner", reason);
  const fallback = await partnerCopilotService.answer(providerId, message);
  return {
    content: fallback.content,
    provider: "DETERMINISTIC",
    model: "partner-copilot",
    fallbackUsed: true,
    requestId: `det_${Date.now()}`,
    mode: "deterministic_fallback",
    intent: fallback.intent,
    basis: fallback.basis,
    recommendation: fallback.recommendation,
  };
}

export async function partnerRoleChat(input: {
  userId: string;
  userRole: string;
  request: Request;
  body: unknown;
}): Promise<RoleChatResult> {
  const aiRole = mapUserRoleToAiRole(input.userRole, "partner");
  if (!aiRole) {
    throw new AiGatewayError("Role not authorized for partner AI", "FORBIDDEN", "BLOCKED");
  }

  const raw = asGatewayBody(input.body);
  const message = String(raw.message ?? "");
  const security = validatePromptSecurity(message, aiRole);
  if (!security.safe) {
    // The reason is logged here because this surface writes no audit row for a refusal; it is not
    // returned (see PROMPT_BLOCKED_PUBLIC_MESSAGE).
    logger.warn("ai.prompt_blocked", { surface: aiRole, userId: input.userId, reason: security.reason });
    throw promptBlockedError(security.reason);
  }
  const { intent } = classifyPartnerIntent(message);
  const providerId = await resolveProviderId(input.userId);
  if (!providerId) {
    throw new AiGatewayError("Partner profile not found", "FORBIDDEN", "BLOCKED");
  }

  if (aiConfig.dryRun || !isAnyProviderConfigured()) {
    return degradePartner(providerId, message, "PROVIDERS_UNCONFIGURED");
  }

  // Classified partner questions are answered from approved tools. LLM is reserved for
  // GENERAL so a slow/unavailable provider chain cannot 502 the Partner Web proxy.
  if (intent !== "GENERAL") {
    return answerFromTools(providerId, message);
  }

  try {
    const result = await invokeAiGateway({
      actor: {
        actorId: input.userId,
        actorRole: aiRole as AiGatewayRole,
        ipAddress: clientIp(input.request),
        traceId: traceId(input.request),
      },
      endpoint: "partner",
      input: {
        message,
        history: raw.history,
        conversationId: raw.conversationId,
        templateId: typeof raw.templateId === "string" ? raw.templateId : "partner.copilot.v1",
        context: {
          partnerId: providerId,
          userId: input.userId,
          location: (raw.context as { location?: { lat: number; lng: number; city?: string } } | undefined)?.location,
          metadata: { intent },
        },
      },
      tools: {
        enabled: true,
        intent,
        userRole: input.userRole,
        allowWrites: false,
      },
    });
    return {
      content: result.content,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      requestId: result.requestId,
      mode: "llm",
      intent,
      basis: ["Approved partner tools", "Authenticated partner context"],
      recommendation: null,
    };
  } catch (err) {
    if (err instanceof AiGatewayError) {
      if (err.code !== "GATEWAY_DISABLED" && err.code !== "PROVIDER_ERROR" && err.code !== "TIMEOUT") throw err;
      logger.warn("partner_ai_gateway_degraded", { userId: input.userId, code: err.code });
      return degradePartner(providerId, message, err.code);
    }
    logger.warn("partner_ai_gateway_degraded", {
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    return degradePartner(providerId, message, "PROVIDER_UNAVAILABLE");
  }
}

async function adminDemandFallback(): Promise<RoleChatResult> {
  const scoring = await geoIntelligenceService.zoneScoring();
  const ranked = ((scoring.data as { ranked?: Array<{
    name: string; demand24h: number; supply: number; gap: number; interpretation: string; recommendation: string | null; skillGaps?: Array<{ skill: string; gap: number }>;
  }> } | null)?.ranked) ?? [];
  const short = ranked.filter((z) => z.gap > 0).slice(0, 8);
  if (short.length === 0) {
    return {
      content: "I don't have enough verified data to locate a supply shortfall right now.",
      provider: "DETERMINISTIC",
      model: "admin-copilot",
      fallbackUsed: true,
      requestId: `det_${Date.now()}`,
      mode: "deterministic_fallback",
      intent: "DEMAND_SUPPLY",
      basis: [],
      recommendation: null,
    };
  }
  const lines = short.map((z) => {
    const skill = z.skillGaps?.[0];
    const skillBit = skill && skill.gap > 0 ? `, skill gap ${skill.skill} ${skill.gap}` : "";
    return `${z.name}: demand ${z.demand24h}, supply ${z.supply}, gap ${z.gap}${skillBit}`;
  });
  return {
    content: `Supply is short in: ${lines.join(". ")}.`,
    provider: "DETERMINISTIC",
    model: "admin-copilot",
    fallbackUsed: true,
    requestId: `det_${Date.now()}`,
    mode: "deterministic_fallback",
    intent: "DEMAND_SUPPLY",
    basis: ["zone scoring heuristic — eligible online supply vs 24h real demand"],
    recommendation: short[0]?.recommendation ?? null,
  };
}

export async function adminRoleChat(input: {
  userId: string;
  userRole: string;
  request: Request;
  body: unknown;
}): Promise<RoleChatResult> {
  const aiRole = mapUserRoleToAiRole(input.userRole, "admin");
  if (!aiRole) {
    throw new AiGatewayError("Role not authorized for admin AI", "FORBIDDEN", "BLOCKED");
  }

  const raw = asGatewayBody(input.body);
  const message = String(raw.message ?? "");
  const security = validatePromptSecurity(message, aiRole);
  if (!security.safe) {
    // The reason is logged here because this surface writes no audit row for a refusal; it is not
    // returned (see PROMPT_BLOCKED_PUBLIC_MESSAGE).
    logger.warn("ai.prompt_blocked", { surface: aiRole, userId: input.userId, reason: security.reason });
    throw promptBlockedError(security.reason);
  }
  const { intent } = classifyAdminIntent(message);

  if (aiConfig.dryRun || !isAnyProviderConfigured()) {
    recordAiDegraded("admin", "PROVIDERS_UNCONFIGURED");
    if (intent === "MUTATION_REQUEST") {
      return {
        content: "I cannot execute refunds, payouts, suspensions, or ledger changes. Those require human approval in the existing business workflow.",
        provider: "DETERMINISTIC",
        model: "admin-copilot",
        fallbackUsed: true,
        requestId: `det_${Date.now()}`,
        mode: "deterministic_fallback",
        intent,
        basis: ["High-risk policy"],
        recommendation: "Open the AI Brain approvals queue if a governed action is needed.",
      };
    }
    return adminDemandFallback();
  }

  try {
    const result = await invokeAiGateway({
      actor: {
        actorId: input.userId,
        actorRole: aiRole as AiGatewayRole,
        ipAddress: clientIp(input.request),
        traceId: traceId(input.request),
      },
      endpoint: "admin",
      input: {
        message,
        history: raw.history,
        conversationId: raw.conversationId,
        templateId: typeof raw.templateId === "string" ? raw.templateId : "admin.ops.v1",
        context: {
          userId: input.userId,
          metadata: { intent },
        },
      },
      tools: {
        enabled: true,
        intent,
        userRole: input.userRole,
        allowWrites: false,
      },
    });
    return {
      content: result.content,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      requestId: result.requestId,
      mode: "llm",
      intent,
      basis: ["Approved admin read tools"],
      recommendation: null,
    };
  } catch (err) {
    if (err instanceof AiGatewayError) {
      if (err.code !== "GATEWAY_DISABLED" && err.code !== "PROVIDER_ERROR" && err.code !== "TIMEOUT") throw err;
      recordAiDegraded("admin", err.code);
      if (intent === "MUTATION_REQUEST") {
        return {
          content: "I cannot execute that action. High-risk operations require human approval.",
          provider: "DETERMINISTIC",
          model: "admin-copilot",
          fallbackUsed: true,
          requestId: `det_${Date.now()}`,
          mode: "deterministic_fallback",
          intent,
          basis: ["High-risk policy"],
          recommendation: null,
        };
      }
      return adminDemandFallback();
    }
    logger.warn("admin_ai_gateway_degraded", {
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    recordAiDegraded("admin", "PROVIDER_UNAVAILABLE");
    return adminDemandFallback();
  }
}
