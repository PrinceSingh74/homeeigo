import { Elysia, t } from "elysia";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { authPlugin } from "../plugins/auth.plugin";
import prisma from "../lib/prisma";
import { AuditLogService } from "../services/audit-log.service";
import { detectStuckInstances, recoverInstance } from "../services/workflow-recovery.service";
import { publishBudgetGauges } from "../services/ai-budget.service";
import { aiWorkflowDraftService } from "../services/ai-workflow-draft.service";
import { cancellationRiskService } from "../services/cancellation-risk.service";
import { providerAcceptanceService } from "../services/provider-acceptance.service";

/**
 * Phase 14 — governance controls over HTTP.
 *
 * Mounted under `/api/admin` deliberately: routes there are matched by `admin-route-permissions`
 * and **denied by default when unmapped**, so a governance endpoint cannot be reachable by
 * accident. Every write below is mapped explicitly in that table.
 *
 * The read/write split follows the same line the ML routes drew — inspecting a budget or a stuck
 * instance is ANALYTICS/READ; setting a spend cap or moving an instance's state is
 * SETTINGS/UPDATE, because both change what the platform will do next.
 */
export const adminGovernanceRoutes = new Elysia({ prefix: "/api/admin/governance" })
  // `authPlugin` BEFORE `adminRbacPlugin`, exactly as routes/admin.ts mounts them.
  //
  // With `adminRbacPlugin` alone every route here answered 401 to every caller, admins included.
  // Its inner auth plugin is a named Elysia plugin, and named plugins are deduplicated: once
  // routes/admin.ts has registered it, this standalone router (mounted directly in index.ts, not
  // inside admin.ts) never gets the auth derive, so `requireRole` is undefined and admin-rbac's
  // fail-closed branch refuses the request. Failing closed was the right direction — nothing was
  // exposed — but it made this console unusable. Found in Pass 6 by logging in as the demo admin.
  .use(authPlugin)
  .use(adminRbacPlugin)

  // ── AI spend governance ────────────────────────────────────────────────────
  /**
   * Current caps and their consumption. Returns an empty list until somebody sets one — that is
   * the honest state of a platform with no agreed spend limit, not a defect.
   */
  .get("/ai-budgets", async () => {
    const policies = await prisma.aiBudgetPolicy.findMany({
      orderBy: [{ scope: "asc" }, { scopeKey: "asc" }],
      include: { windows: { orderBy: { windowKey: "desc" }, take: 7 } },
    });
    return {
      success: true,
      data: {
        policies,
        // Said plainly rather than left to be inferred from an empty array.
        enforcementState: policies.some((p) => p.isActive)
          ? "ENFORCED"
          : "NO_POLICY_CONFIGURED — AI spend is measured but not capped",
      },
    };
  })

  /**
   * Set or update a cap.
   *
   * `limitUsd` is required and has no default. A budget endpoint that ships a suggested number
   * is how an invented limit becomes policy: whoever calls this has to state the figure, and the
   * note explaining it is mandatory because the justification is the part an auditor needs.
   */
  .put("/ai-budgets", async ({ body, requireAdminContext }) => {
    const admin = requireAdminContext();
    const existing = await prisma.aiBudgetPolicy.findUnique({
      where: { scope_scopeKey_period: { scope: body.scope, scopeKey: body.scopeKey, period: body.period } },
    });

    const policy = await prisma.aiBudgetPolicy.upsert({
      where: { scope_scopeKey_period: { scope: body.scope, scopeKey: body.scopeKey, period: body.period } },
      create: {
        scope: body.scope,
        scopeKey: body.scopeKey,
        period: body.period,
        limitUsd: body.limitUsd,
        failMode: body.failMode ?? "FAIL_CLOSED",
        isActive: body.isActive ?? true,
        note: body.note,
        createdBy: admin.userId,
      },
      update: {
        limitUsd: body.limitUsd,
        failMode: body.failMode ?? "FAIL_CLOSED",
        isActive: body.isActive ?? true,
        note: body.note,
        updatedBy: admin.userId,
      },
    });

    await AuditLogService.recordGoverned("AI_BUDGET_POLICY_CHANGED", "success", {
      userId: admin.userId,
      reason: body.note,
      details: {
        scope: body.scope,
        scopeKey: body.scopeKey,
        period: body.period,
        before: existing ? { limitUsd: existing.limitUsd, failMode: existing.failMode, isActive: existing.isActive } : null,
        after: { limitUsd: policy.limitUsd, failMode: policy.failMode, isActive: policy.isActive },
      },
    });

    await publishBudgetGauges();
    return { success: true, data: policy };
  }, {
    body: t.Object({
      scope: t.Union([t.Literal("GLOBAL"), t.Literal("PROVIDER"), t.Literal("ROLE"), t.Literal("ENDPOINT")]),
      scopeKey: t.String({ minLength: 1, maxLength: 100 }),
      period: t.Union([t.Literal("DAY"), t.Literal("MONTH")]),
      limitUsd: t.Number({ minimum: 0 }),
      failMode: t.Optional(t.Union([t.Literal("FAIL_OPEN"), t.Literal("FAIL_CLOSED")])),
      isActive: t.Optional(t.Boolean()),
      note: t.String({ minLength: 10, maxLength: 500 }),
    }),
  })

  // ── Stuck workflow recovery ────────────────────────────────────────────────
  /**
   * Instances that cannot make progress, each with the evidence that says so. A parked instance
   * whose wake-up is still in the future never appears here — it is healthy.
   */
  .get("/workflows/stuck", async () => ({ success: true, data: await detectStuckInstances() }))

  /**
   * Recover one instance.
   *
   * `observedStatus` and `observedUpdatedAt` are required, not conveniences: they are the state
   * the operator was looking at, and carrying them into the update is what makes two simultaneous
   * recoveries resolve to exactly one winner rather than two wake-up jobs on one instance.
   */
  .post("/workflows/:instanceId/recover", async ({ params, body, requireAdminContext }) => {
    const admin = requireAdminContext();
    const data = await recoverInstance({
      instanceId: params.instanceId,
      action: body.action,
      actorId: admin.userId,
      reason: body.reason,
      observedStatus: body.observedStatus,
      observedUpdatedAt: new Date(body.observedUpdatedAt),
    });
    return { success: data.ok, data };
  }, {
    body: t.Object({
      action: t.Union([t.Literal("REQUEUE"), t.Literal("CANCEL")]),
      reason: t.String({ minLength: 10, maxLength: 500 }),
      observedStatus: t.Union([
        t.Literal("PENDING"), t.Literal("RUNNING"), t.Literal("WAITING"),
        t.Literal("SCHEDULED"), t.Literal("PAUSED"),
      ]),
      observedUpdatedAt: t.String(),
    }),
  })
  // ── Phase 15: AI-assisted workflow drafting ────────────────────────────────
  /** Proposals awaiting or past review. Nothing here is executable. */
  .get("/workflow-drafts", async ({ query }) => ({
    success: true,
    data: {
      drafts: await aiWorkflowDraftService.list(query.status as never),
      note: "Drafts are proposals. Workflows in this platform are defined in code, so an approved draft still requires a developer to commit the definition before anything runs.",
    },
  }), {
    query: t.Object({ status: t.Optional(t.String()) }),
  })

  /**
   * Record a proposed workflow.
   *
   * Validation runs before storage and again at approval. An invalid draft is stored too, marked
   * REJECTED_UNSAFE — what a model tried to produce is the most useful evidence there is.
   */
  .post("/workflow-drafts", async ({ body, requireAdminContext }) => {
    const admin = requireAdminContext();
    const { draft, validation } = await aiWorkflowDraftService.createDraft({
      proposedId: body.proposedId,
      name: body.name,
      intent: body.intent,
      trigger: body.trigger,
      steps: body.steps as never,
      actorId: admin.userId,
      modelProvider: body.modelProvider,
      modelName: body.modelName,
    });
    return { success: true, data: { draft, validation } };
  }, {
    body: t.Object({
      proposedId: t.String({ minLength: 3, maxLength: 100 }),
      name: t.String({ minLength: 3, maxLength: 200 }),
      intent: t.String({ minLength: 10, maxLength: 2000 }),
      trigger: t.String({ minLength: 3, maxLength: 200 }),
      steps: t.Array(t.Record(t.String(), t.Unknown()), { maxItems: 60 }),
      modelProvider: t.Optional(t.String()),
      modelName: t.Optional(t.String()),
    }),
  })

  /** A person decides. Approval authorises implementation; it does not activate anything. */
  .post("/workflow-drafts/:id/review", async ({ params, body, requireAdminContext }) => {
    const admin = requireAdminContext();
    const data = await aiWorkflowDraftService.review({
      draftId: params.id,
      decision: body.decision,
      actorId: admin.userId,
      note: body.note,
    });
    return { success: data.ok, data };
  }, {
    body: t.Object({
      decision: t.Union([t.Literal("APPROVE"), t.Literal("REJECT")]),
      note: t.String({ minLength: 10, maxLength: 500 }),
    }),
  })

  /**
   * Phase 15 — offline evaluation of the cancellation-risk candidate.
   *
   * Read-only and offline: it trains on a temporal split and reports metrics. Nothing consumes the
   * score and no version is registered in the ML registry — promoting a model whose advantage sits
   * inside its own error bar is exactly what `materiality` exists to prevent.
   */
  .get("/models/cancellation-risk/evaluation", async () => ({
    success: true,
    data: await cancellationRiskService.evaluate(),
  }))

  /**
   * Phase 15 — offline evaluation of the provider-acceptance candidate.
   *
   * Read the `materiality` block, not `beatsBaseline`. On the current data the candidate reaches
   * ~0.95 AUC and is still **worse** than predicting each provider's own historical acceptance
   * rate — a figure that reads as a triumph in isolation and as a regression against its baseline.
   */
  .get("/models/provider-acceptance/evaluation", async () => ({
    success: true,
    data: await providerAcceptanceService.evaluate(),
  }));
