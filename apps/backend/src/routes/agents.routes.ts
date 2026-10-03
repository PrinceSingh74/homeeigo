import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import prisma from "../lib/prisma";
import {
  agentsConfig,
  checkAgentReadiness,
  findOrphanedRuns,
  getAgentHealth,
  getAgentStatuses,
  getDependencyHealth,
  getRun,
  isAgentId,
  runAgent,
} from "../agents";

/**
 * Phase 16 agent control surface.
 *
 * ADMIN only, on every route including the read ones. An agent run timeline exposes ticket ids,
 * partner ids, fraud signals and finance readings across every domain at once, so the aggregate
 * is more sensitive than any single record in it — which is the reason it is not merely gated on
 * "can see agents" but on the platform's highest role.
 *
 * There is no route that executes a tool, approves an approval, or changes an agent definition.
 * Approvals continue to be decided through the existing `/api/ai/tools/approvals` surface, which
 * already carries the non-self-approval and single-consume rules; adding a second approval door
 * here would mean two sets of rules to keep in step, and the quieter one would eventually win.
 */

function clientIp(request: Request): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined
  );
}

function traceId(request: Request): string | undefined {
  return (
    request.headers.get("traceparent")?.split("-")[1] ??
    request.headers.get("x-request-id") ??
    undefined
  );
}

function requireAdmin(role: string, set: { status?: number | string }) {
  if (role !== "ADMIN") {
    set.status = 403;
    return { success: false, error: "Admin only", code: "FORBIDDEN" };
  }
  return null;
}

export const agentsRoutes = new Elysia({ prefix: "/api/agents" })
  /**
   * Liveness only. Deliberately says whether the layer is enabled and whether the switch is
   * pulled, and nothing about individual agents — a probe endpoint should not enumerate
   * capabilities to an unauthenticated caller.
   */
  .get("/health", () => ({
    success: true,
    data: {
      enabled: agentsConfig.enabled,
      killSwitch: agentsConfig.killSwitch,
      timestamp: new Date().toISOString(),
    },
  }))

  .use(authPlugin)

  /** The control-centre view: every agent, its version, its real current mode and its bounds. */
  .get("/", async ({ requireAuth, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const [agents, readiness, health, dependencies] = await Promise.all([
      getAgentStatuses(),
      checkAgentReadiness(),
      getAgentHealth(),
      getDependencyHealth(),
    ]);
    return {
      success: true,
      data: {
        agents,
        health,
        dependencies,
        // Reported alongside the modes, not instead of them. An agent can be LIVE and unable to
        // execute anything; showing only the mode would hide that.
        readiness,
        config: {
          enabled: agentsConfig.enabled,
          killSwitch: agentsConfig.killSwitch,
          executionEnvironments: agentsConfig.executionEnvironments,
        },
      },
    };
  })

  /**
   * Start a run.
   *
   * `mode` accepts only "shadow" as a downgrade. There is deliberately no way to request LIVE
   * from here: live execution is decided by the environment allowlist and the feature flag, and
   * a request parameter that could override them would be a bypass of both §39 and §40 dressed
   * up as an option.
   */
  .post(
    "/:agentId/run",
    async ({ requireAuth, params, body, request, set }) => {
      const { userId, role } = requireAuth();
      const denied = requireAdmin(role, set);
      if (denied) return denied;

      if (!isAgentId(params.agentId)) {
        set.status = 404;
        return { success: false, error: "Unknown agent", code: "AGENT_NOT_FOUND" };
      }

      const result = await runAgent({
        agentId: params.agentId,
        goal: body.goal,
        input: body.input ?? "",
        actor: {
          actorId: userId,
          // Overwritten by the runtime with the agent's own declared role. Passed for shape only;
          // an agent's tool authority comes from its definition, never from its caller.
          actorRole: "ADMIN",
          userRole: role,
          ipAddress: clientIp(request),
          traceId: traceId(request),
        },
        trigger: {
          type: "MANUAL",
          subjectType: body.subjectType,
          subjectId: body.subjectId,
        },
        forceShadow: body.mode === "shadow",
        /**
         * The intent, when the caller PICKED an action rather than typed a sentence.
         *
         * The command surface offers an explicit intent selector, and that selection is a
         * property of the call site rather than a guess about prose — which is exactly the case
         * `declaredIntent` exists for. An unrecognised value is not honoured; the runtime falls
         * back to classifying the goal, so a stale client cannot widen what a run may do.
         */
        declaredIntent: body.intent,
      });

      return { success: true, data: result };
    },
    {
      params: t.Object({ agentId: t.String() }),
      // Every field the handler reads is declared. An undeclared field is STRIPPED by Elysia
      // before the handler sees it, so an omission here reads as a silently ignored input rather
      // than a validation error.
      body: t.Object({
        goal: t.String({ minLength: 3, maxLength: 500 }),
        input: t.Optional(t.String({ maxLength: 20_000 })),
        subjectType: t.Optional(t.String({ maxLength: 40 })),
        subjectId: t.Optional(t.String({ maxLength: 64 })),
        mode: t.Optional(t.Union([t.Literal("shadow")])),
        // Declared, not asserted: the runtime still decides what this means, and still
        // refuses a side effect the agent is not allowed to perform.
        intent: t.Optional(t.String({ maxLength: 20 })),
      }),
    },
  )

  /** Recent runs, newest first. Filterable by agent and status. */
  .get(
    "/runs",
    async ({ requireAuth, query, set }) => {
      const { role } = requireAuth();
      const denied = requireAdmin(role, set);
      if (denied) return denied;

      const runs = await prisma.agentRun.findMany({
        where: {
          ...(query.agentId ? { agentId: query.agentId } : {}),
          ...(query.status ? { status: query.status as never } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: Math.min(100, Math.max(1, Number(query.limit ?? 25))),
        select: {
          runId: true,
          agentId: true,
          agentVersion: true,
          mode: true,
          status: true,
          riskTier: true,
          goal: true,
          triggerType: true,
          subjectType: true,
          subjectId: true,
          stepCount: true,
          toolCallCount: true,
          costUsd: true,
          latencyMs: true,
          stopReason: true,
          escalationReason: true,
          errorCode: true,
          createdAt: true,
          completedAt: true,
          // Carries the resolved intent and any clarification questions. Without it the list
          // cannot distinguish a run that was refused from one that asked a question, and both
          // land on the operator's screen as ESCALATED.
          metadata: true,
        },
      });
      return { success: true, data: { runs } };
    },
    {
      query: t.Object({
        agentId: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  )

  /**
   * One run's full timeline.
   *
   * Returns the recorded steps — capability, risk, policy decision, tool execution id, approval
   * id, verification verdict and redacted arguments. It does not return, and the platform never
   * stores, the model's raw output or any hidden reasoning: §66 asks for structured rationale,
   * and raw chain-of-thought is neither structured nor reliable as an account of what happened.
   */
  .get("/runs/:runId", async ({ requireAuth, params, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;

    const run = await getRun(params.runId);
    if (!run) {
      set.status = 404;
      return { success: false, error: "Run not found", code: "NOT_FOUND" };
    }

    // Join to the tool layer so an operator can see the authoritative execution row behind each
    // step rather than having to trust the agent's own copy of the outcome.
    const executionIds = run.steps.map((s) => s.executionId).filter((v): v is string => Boolean(v));
    const executions = executionIds.length
      ? await prisma.aiToolExecution.findMany({
          where: { executionId: { in: executionIds } },
          select: {
            executionId: true,
            toolId: true,
            status: true,
            policyDecision: true,
            errorCode: true,
            durationMs: true,
            approvalId: true,
            startedAt: true,
          },
        })
      : [];

    return { success: true, data: { run, executions } };
  })

  /**
   * Runs abandoned by a dead process.
   *
   * Reported, never auto-restarted from here. §37 is explicit that recovery must not blindly
   * re-run from step zero, and the safe action depends on whether the pending step's side effect
   * landed — a question the persisted steps answer and this endpoint surfaces.
   */
  .get("/recovery/orphans", async ({ requireAuth, set }) => {
    const { role } = requireAuth();
    const denied = requireAdmin(role, set);
    if (denied) return denied;
    const orphans = await findOrphanedRuns();
    return {
      success: true,
      data: {
        leaseMs: agentsConfig.leaseMs,
        count: orphans.length,
        orphans: orphans.map((r) => ({
          runId: r.runId,
          agentId: r.agentId,
          status: r.status,
          mode: r.mode,
          heartbeatAt: r.heartbeatAt,
          lastStep: r.steps.at(-1) ?? null,
        })),
      },
    };
  });
