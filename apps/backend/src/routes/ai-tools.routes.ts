import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { mapUserRoleToAiRole } from "../ai/security/authorization";
import type { AiGatewayRole } from "@prisma/client";
import {
  executeTool,
  ToolExecutionError,
  listTools,
  getToolDefinition,
  seedToolRegistry,
  listRegistryFromDb,
  getRegistryToolFromDb,
  getExecutionHistory,
  getDeniedExecutions,
  listPendingApprovals,
  listHighRiskQueue,
  decideApproval,
  cancelApproval,
  getApprovalStatistics,
  getApprovalById,
  listPolicyLogs,
  getPolicyExplorerSummary,
  getToolMetricsSummary,
  getCircuitBreakerStates,
  aiToolsConfig,
  countToolsByCategory,
} from "../ai-tools";

function clientIp(request: Request): string | undefined {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? undefined;
}

function traceId(request: Request): string | undefined {
  return request.headers.get("traceparent")?.split("-")[1]
    ?? request.headers.get("x-request-id")
    ?? undefined;
}

function resolveAiRole(userRole: string): AiGatewayRole | null {
  if (userRole === "ADMIN") return "ADMIN";
  if (userRole === "CUSTOMER") return "CUSTOMER";
  if (userRole === "VENDOR") return "PARTNER";
  return mapUserRoleToAiRole(userRole, "chat");
}

function requireAdmin(role: string, set: { status: number }) {
  if (role !== "ADMIN") {
    set.status = 403;
    return { success: false, error: "Admin only", code: "FORBIDDEN" };
  }
  return null;
}

/** Phase 5 Enterprise AI Tools routes. */
export const aiToolsRoutes = new Elysia({ prefix: "/api/ai/tools" })
  // Public health — matches /api/ai/health pattern (no JWT required for probes)
  .get("/health", () => ({
    success: true,
    data: {
      enabled: aiToolsConfig.enabled,
      toolCounts: countToolsByCategory(),
      timestamp: new Date().toISOString(),
    },
  }))

  .use(authPlugin)

  .get("/", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const tools = query.source === "db"
      ? await listRegistryFromDb({ category: query.category, status: query.status })
      : listTools({ category: query.category, status: query.status, riskLevel: query.riskLevel });
    return { success: true, data: { tools, counts: countToolsByCategory() } };
  }, {
    query: t.Object({
      category: t.Optional(t.String()),
      status: t.Optional(t.String()),
      riskLevel: t.Optional(t.String()),
      source: t.Optional(t.String()),
    }),
  })

  .get("/registry", async ({ requireAuth, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const seeded = await seedToolRegistry();
    const tools = await listRegistryFromDb();
    return { success: true, data: { seeded, tools, counts: countToolsByCategory() } };
  })

  .get("/:id", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const tool = getToolDefinition(params.id) ?? await getRegistryToolFromDb(params.id);
    if (!tool) {
      set.status = 404;
      return { success: false, error: "Tool not found", code: "NOT_FOUND" };
    }
    return { success: true, data: tool };
  })

  .post("/execute", async ({ requireAuth, body, request, set }) => {
    const { userId, role } = requireAuth();
    const aiRole = resolveAiRole(role);
    if (!aiRole) {
      set.status = 403;
      return { success: false, error: "Role not authorized for tool execution", code: "FORBIDDEN" };
    }

    try {
      const result = await executeTool({
        toolId: body.toolId,
        arguments: body.arguments ?? {},
        actor: {
          actorId: userId,
          actorRole: aiRole,
          userRole: role,
          ipAddress: clientIp(request),
          traceId: traceId(request),
          correlationId: body.correlationId,
        },
        idempotencyKey: body.idempotencyKey,
        approvalId: body.approvalId,
      });
      return { success: true, data: result };
    } catch (err) {
      if (err instanceof ToolExecutionError) {
        const statusMap: Record<string, number> = {
          TOOL_NOT_FOUND: 404,
          VALIDATION_ERROR: 400,
          RATE_LIMITED: 429,
          FORBIDDEN: 403,
          TOOLS_DISABLED: 503,
        };
        set.status = statusMap[err.code] ?? 400;
        return { success: false, error: err.message, code: err.code };
      }
      set.status = 500;
      return { success: false, error: "Tool execution error", code: "EXECUTION_ERROR" };
    }
  }, {
    body: t.Object({
      toolId: t.String(),
      arguments: t.Optional(t.Record(t.String(), t.Unknown())),
      idempotencyKey: t.Optional(t.String()),
      approvalId: t.Optional(t.String()),
      correlationId: t.Optional(t.String()),
    }),
  })

  .get("/history", async ({ requireAuth, query, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const history = await getExecutionHistory({
      toolId: query.toolId,
      actorId: query.actorId ?? userId,
      status: query.status,
      limit: query.limit ? Number(query.limit) : 50,
    });
    return { success: true, data: history };
  }, {
    query: t.Object({
      toolId: t.Optional(t.String()),
      actorId: t.Optional(t.String()),
      status: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  .get("/approvals", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const approvals = await listPendingApprovals({
      toolId: query.toolId,
      limit: query.limit ? Number(query.limit) : 50,
    });
    const stats = await getApprovalStatistics();
    return { success: true, data: { approvals, stats } };
  }, {
    query: t.Object({
      toolId: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  .post("/approvals/:approvalId/decide", async ({ requireAuth, params, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    try {
      const result = await decideApproval({
        approvalId: params.approvalId,
        approverId: userId,
        decision: body.decision,
        reason: body.reason,
      });
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: (err as Error).message, code: "APPROVAL_ERROR" };
    }
  }, {
    body: t.Object({
      decision: t.Union([t.Literal("APPROVED"), t.Literal("REJECTED")]),
      reason: t.Optional(t.String()),
    }),
  })

  .post("/approvals/:approvalId/cancel", async ({ requireAuth, params, body, set }) => {
    const { userId, role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    try {
      const result = await cancelApproval(params.approvalId, userId, body.reason);
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: (err as Error).message, code: "APPROVAL_ERROR" };
    }
  }, {
    body: t.Object({ reason: t.Optional(t.String()) }),
  })

  .get("/approvals/:approvalId", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const approval = await getApprovalById(params.approvalId);
    if (!approval) {
      set.status = 404;
      return { success: false, error: "Approval not found", code: "NOT_FOUND" };
    }
    return { success: true, data: approval };
  })

  .get("/policies", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const [summary, logs] = await Promise.all([
      getPolicyExplorerSummary(),
      listPolicyLogs({
        toolId: query.toolId,
        decision: query.decision,
        limit: query.limit ? Number(query.limit) : 50,
      }),
    ]);
    return { success: true, data: { summary, logs } };
  }, {
    query: t.Object({
      toolId: t.Optional(t.String()),
      decision: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })

  .get("/denied", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const requests = await getDeniedExecutions(query.limit ? Number(query.limit) : 50);
    return { success: true, data: requests };
  }, {
    query: t.Object({ limit: t.Optional(t.String()) }),
  })

  .get("/high-risk", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const queue = await listHighRiskQueue(query.limit ? Number(query.limit) : 50);
    return { success: true, data: queue };
  }, {
    query: t.Object({ limit: t.Optional(t.String()) }),
  })

  .get("/metrics", async ({ requireAuth, query, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const days = query.days ? Number(query.days) : 7;
    const [summary, circuits] = await Promise.all([
      getToolMetricsSummary(days),
      Promise.resolve(getCircuitBreakerStates()),
    ]);
    return { success: true, data: { summary, circuits, days } };
  }, {
    query: t.Object({ days: t.Optional(t.String()) }),
  });
