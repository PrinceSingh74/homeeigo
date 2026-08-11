import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { invokeAiGateway, getAiHealth, AiGatewayError, AI_ERROR_STATUS } from "../ai";
import { mapUserRoleToAiRole } from "../ai/security/authorization";
import { getUsageSummary } from "../ai/cost/ai-cost.service";
import { clientIp, traceId } from "../lib/request-identity";
import prisma from "../lib/prisma";
import type { AiGatewayRole } from "@prisma/client";

async function handleGatewayRequest(
  request: Request,
  userId: string,
  userRole: string,
  endpoint: "customer" | "partner" | "admin" | "chat",
  body: unknown,
  set: { status: number },
) {
  const aiRole = mapUserRoleToAiRole(userRole, endpoint);
  if (!aiRole) {
    set.status = 403;
    return { success: false, error: "Role not authorized for this AI endpoint", code: "FORBIDDEN" };
  }

  try {
    const result = await invokeAiGateway({
      actor: {
        actorId: userId,
        actorRole: aiRole as AiGatewayRole,
        ipAddress: clientIp(request),
        traceId: traceId(request),
      },
      endpoint,
      input: body,
    });
    return { success: true, data: result };
  } catch (err) {
    if (err instanceof AiGatewayError) {
      set.status = AI_ERROR_STATUS[err.code] ?? 502;
      return { success: false, error: err.message, code: err.code };
    }
    set.status = 502;
    return { success: false, error: "AI Gateway error", code: "PROVIDER_ERROR" };
  }
}

const aiBodySchema = t.Object({
  message: t.String(),
  templateId: t.Optional(t.String()),
  conversationId: t.Optional(t.String()),
  history: t.Optional(
    t.Array(
      t.Object({
        role: t.Union([t.Literal("user"), t.Literal("assistant"), t.Literal("system")]),
        content: t.String(),
      }),
    ),
  ),
  context: t.Optional(
    t.Object({
      userId: t.Optional(t.String()),
      customerId: t.Optional(t.String()),
      partnerId: t.Optional(t.String()),
      bookingId: t.Optional(t.String()),
      location: t.Optional(
        t.Object({
          lat: t.Number(),
          lng: t.Number(),
          city: t.Optional(t.String()),
        }),
      ),
      metadata: t.Optional(t.Record(t.String(), t.Unknown())),
    }),
  ),
  responseSchema: t.Optional(t.Record(t.String(), t.Unknown())),
});

/** Phase 3 Enterprise AI Gateway routes — single entry point for LLM requests. */
export const aiGatewayRoutes = new Elysia({ prefix: "/api/ai" })
  .use(authPlugin)
  .post(
    "/gateway/chat",
    async ({ requireAuth, body, request, set }) => {
      const { userId, role } = requireAuth();
      return handleGatewayRequest(request, userId, role, "chat", body, set);
    },
    { body: aiBodySchema },
  )
  .post(
    "/customer",
    async ({ requireAuth, body, request, set }) => {
      const { userId, role } = requireAuth();
      return handleGatewayRequest(request, userId, role, "customer", body, set);
    },
    { body: aiBodySchema },
  )
  .post(
    "/partner",
    async ({ requireAuth, body, request, set }) => {
      const { userId, role } = requireAuth();
      return handleGatewayRequest(request, userId, role, "partner", body, set);
    },
    { body: aiBodySchema },
  )
  .post(
    "/admin",
    async ({ requireAuth, body, request, set }) => {
      const { userId, role } = requireAuth();
      return handleGatewayRequest(request, userId, role, "admin", body, set);
    },
    { body: aiBodySchema },
  )
  .get("/usage", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    if (role !== "ADMIN") {
      set.status = 403;
      return { success: false, error: "Admin only", code: "FORBIDDEN" };
    }
    const days = Math.min(Number(query.days ?? 7), 90);
    const since = new Date(Date.now() - days * 86_400_000);
    const summary = await getUsageSummary(prisma, since);
    return { success: true, data: { periodDays: days, ...summary, requestedBy: userId } };
  })
  .get("/cost", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    if (role !== "ADMIN") {
      set.status = 403;
      return { success: false, error: "Admin only", code: "FORBIDDEN" };
    }
    const days = Math.min(Number(query.days ?? 30), 90);
    const since = new Date(Date.now() - days * 86_400_000);
    const costs = await prisma.aiGatewayCost.findMany({
      where: { date: { gte: since } },
      orderBy: { date: "desc" },
    });
    const total = costs.reduce((s, c) => s + c.totalCostUsd, 0);
    return { success: true, data: { periodDays: days, totalCostUsd: total, breakdown: costs } };
  })
  .get("/health", async () => {
    const health = await getAiHealth();
    return {
      success: true,
      data: {
        ...health,
        timestamp: new Date().toISOString(),
      },
    };
  });
