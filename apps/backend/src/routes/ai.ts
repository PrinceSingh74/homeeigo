import { Elysia, t } from "elysia";
import type { AiGatewayRole } from "@prisma/client";
import { authPlugin } from "../plugins/auth.plugin";
import { parseBody } from "../lib/route-security";
import { aiChatSchema } from "../schemas/ai.schema";
import { customerAiService } from "../services/customer-ai.service";
import { aiConversationService } from "../services/ai-conversation.service";
import {
  invokeAiGateway,
  AiGatewayError,
  AI_ERROR_STATUS,
  aiConfig,
  isAnyProviderConfigured,
} from "../ai";
import { mapUserRoleToAiRole } from "../ai/security/authorization";
import { clientIp, traceId } from "../lib/request-identity";
import { logger } from "../lib/logger";
import { recordAiDegraded, recordAiIntent } from "../lib/ai-metrics";
import { classifyIntent } from "../ai/intent/intent-classifier";
import { contextPolicyFor } from "../ai/context/context-policy";
import { buildServiceContext } from "../ai/context/service-context";
import { learnPreferences } from "../ai-brain/memory/preference-memory";
import prisma from "../lib/prisma";

/** What the customer chat path resolved to. Surfaced to the client as `mode`. */
type CustomerChatOutcome =
  | {
      mode: "llm";
      content: string;
      provider: string;
      model: string;
      fallbackUsed: boolean;
      intent: string;
      /** Catalogue rows the model was grounded on — keeps CTAs pointing at real services. */
      groundedServices: Array<{ id: string; name: string; category: string; basePrice: number }>;
    }
  | { mode: "deterministic_fallback"; reason: string; intent: string };

/**
 * Runs the customer turn through the AI Gateway, degrading deterministically.
 *
 * Errors are split deliberately. A caller mistake — unauthorised role, oversized or
 * malformed input, a blocked prompt-injection attempt, or an exhausted rate limit — is
 * NOT something a canned answer should paper over, so it propagates and the route
 * returns the gateway's own status code. Only an infrastructure condition (gateway
 * switched off, no provider credentials, every provider in the failover chain exhausted
 * after bounded retry) degrades to the deterministic matcher.
 */
async function customerChatViaGateway(input: {
  userId: string;
  userRole: string;
  request: Request;
  message: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  conversationId?: string;
  city?: string;
}): Promise<CustomerChatOutcome> {
  const aiRole = mapUserRoleToAiRole(input.userRole, "chat");
  if (!aiRole) {
    throw new AiGatewayError("Role not authorized for AI chat", "FORBIDDEN", "BLOCKED");
  }

  // Intent first: it decides which data this turn may load, so it runs before any query.
  const { intent, rule } = classifyIntent(input.message);
  recordAiIntent(intent, rule);

  // With no provider credentials — or with dry-run on — the provider adapters return a
  // synthetic "[<PROVIDER> dry-run] Acknowledged: …" string. That is a test fixture, not
  // an answer, and must never reach a customer labelled as model output. Degrade before
  // calling rather than after, so no fabricated content is ever produced on this path.
  if (aiConfig.dryRun || !isAnyProviderConfigured()) {
    recordAiDegraded("chat", "PROVIDERS_UNCONFIGURED");
    return { mode: "deterministic_fallback", reason: "PROVIDERS_UNCONFIGURED", intent };
  }

  // Context policy → minimal, field-allowlisted, budget-bounded grounding.
  const scope = contextPolicyFor("CUSTOMER", intent);
  const grounding = await buildServiceContext({
    message: input.message,
    intent,
    scope,
    city: input.city,
  });

  try {
    const result = await invokeAiGateway({
      actor: {
        actorId: input.userId,
        actorRole: aiRole as AiGatewayRole,
        ipAddress: clientIp(input.request),
        traceId: traceId(input.request),
      },
      endpoint: "chat",
      input: {
        message: input.message,
        history: input.history,
        conversationId: input.conversationId,
        // Registry-managed prompt. `getActivePromptVersion` can supersede this id with a
        // newer DB version without a deploy.
        templateId: "customer.service_recommendation.v1",
        context: {
          userId: input.userId,
          customerId: input.userId,
          metadata: { groundingContext: grounding.content, intent, contextSections: grounding.sections },
        },
      },
      // Read tools only on this surface. Write tools stay off until the client can present
      // a confirmation step and send it back — offering them here would mean the model
      // proposing a booking the UI has no way to have the user agree to.
      tools: {
        enabled: true,
        intent,
        userRole: input.userRole,
        allowWrites: false,
      },
    });
    // Learn durable preferences from the turn. Deliberately not awaited into the response
    // path: a preference write must never delay or fail a customer's answer.
    void learnPreferences({ actorId: input.userId, actorRole: "CUSTOMER", message: input.message })
      .catch(() => undefined);

    return {
      mode: "llm",
      content: result.content,
      provider: result.provider,
      model: result.model,
      fallbackUsed: result.fallbackUsed,
      intent,
      groundedServices: grounding.services,
    };
  } catch (err) {
    if (err instanceof AiGatewayError) {
      // Security and policy decisions must reach the client as themselves.
      if (err.code !== "GATEWAY_DISABLED" && err.code !== "PROVIDER_ERROR") throw err;
      recordAiDegraded("chat", err.code);
      return { mode: "deterministic_fallback", reason: err.code, intent };
    }
    // An unexpected fault must not take the assistant down; it degrades and is logged.
    logger.warn("ai_chat_gateway_degraded", {
      userId: input.userId,
      error: err instanceof Error ? err.message : String(err),
    });
    recordAiDegraded("chat", "PROVIDER_ERROR");
    return { mode: "deterministic_fallback", reason: "PROVIDER_UNAVAILABLE", intent };
  }
}

export const aiRoutes = new Elysia({ prefix: "/api/ai" })
  .use(authPlugin)
  .post(
    "/chat",
    async ({ requireAuth, body: raw, request, set }) => {
      const { userId, role } = requireAuth();
      const body = parseBody(aiChatSchema, raw);
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { firstName: true },
      });

      // Gateway-first. Every security control — RBAC, request validation, prompt-injection
      // screening, rate limiting, output validation, audit, usage and cost accounting —
      // lives inside invokeAiGateway, so the customer path must go through it rather than
      // around it. The deterministic matcher below is a degraded mode, not the product.
      let gateway: CustomerChatOutcome;
      try {
        gateway = await customerChatViaGateway({
          userId,
          userRole: role,
          request,
          message: body.message,
          history: body.history,
          conversationId: body.conversationId,
          city: body.city,
        });
      } catch (err) {
        // A policy decision is the answer, not an error to hide behind a canned reply.
        if (err instanceof AiGatewayError) {
          set.status = AI_ERROR_STATUS[err.code] ?? 502;
          return { success: false, error: err.message, code: err.code };
        }
        throw err;
      }

      // Booking affordances stay deterministic in both modes: a model must not be able to
      // invent a service outside the catalogue or drop the booking CTA.
      const affordances = customerAiService.affordances(body.message);
      const reply =
        gateway.mode === "llm"
          ? { message: gateway.content, ...affordances }
          : customerAiService.chat({
              message: body.message,
              history: body.history,
              firstName: user?.firstName,
            });

      // Resolve the rule's category slug to a REAL catalog service so the
      // recommendation is DB-driven and deep-links to a bookable service.
      let suggestedService:
        | { id: string; name: string; basePrice: number }
        | undefined;
      if (reply.suggestedServiceId) {
        const slug = reply.suggestedServiceId;
        const svc = await prisma.service.findFirst({
          where: {
            isActive: true,
            OR: [
              { category: slug },
              { slug: { contains: slug } },
              { name: { contains: slug.split("-")[0] ?? slug, mode: "insensitive" } },
            ],
          },
          select: { id: true, name: true, basePrice: true },
          orderBy: { popularity: "desc" },
        });
        if (svc) suggestedService = svc;
      }

      // Persist the turn to PostgreSQL (source of truth for chat history).
      const conversationId = await aiConversationService.appendTurn(
        userId,
        body.conversationId,
        body.message,
        reply.message,
      );

      return {
        success: true,
        data: {
          conversationId,
          reply: reply.message,
          quickActions: reply.quickActions,
          // Real service id when resolved, else the original category slug.
          suggestedServiceId: suggestedService?.id ?? reply.suggestedServiceId,
          suggestedService,
          // Honest provenance: the client must be able to tell a model answer from a
          // canned one. `provider`/`model` are omitted in degraded mode rather than faked.
          mode: gateway.mode,
          intent: gateway.intent,
          ...(gateway.mode === "llm"
            ? { provider: gateway.provider, model: gateway.model, fallbackUsed: gateway.fallbackUsed }
            : { degradedReason: gateway.reason }),
        },
      };
    },
    {
      body: t.Object({
        message: t.String(),
        conversationId: t.Optional(t.String()),
        // Must be declared here too: Elysia's t.Object strips fields it does not know,
        // so an undeclared `city` would never reach parseBody.
        city: t.Optional(t.String()),
        history: t.Optional(
          t.Array(
            t.Object({
              role: t.Union([t.Literal("user"), t.Literal("assistant")]),
              content: t.String(),
            }),
          ),
        ),
      }),
    },
  )
  // ── Conversation history (PostgreSQL-backed) ──────────────────────────────
  .get("/conversations", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await aiConversationService.list(userId);
    return { success: true, data: { conversations: data } };
  })
  .get("/conversations/latest", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await aiConversationService.latest(userId);
    return { success: true, data };
  })
  .get("/conversations/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const data = await aiConversationService.messages(userId, params.id);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Conversation not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .delete("/conversations/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const ok = await aiConversationService.remove(userId, params.id);
    if (!ok) {
      set.status = 404;
      return { success: false, error: "Conversation not found", code: "NOT_FOUND" };
    }
    return { success: true, message: "Conversation deleted" };
  });
