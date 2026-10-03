import { Elysia, t } from "elysia";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { authPlugin } from "../plugins/auth.plugin";
import { mlRegistryService } from "../services/ml-registry.service";
import { mlShadowService } from "../services/ml-shadow.service";
import { mlReadinessService } from "../services/ml-readiness.service";
import { mlPlatformHealthService } from "../services/ml-platform-health.service";
import { demandEvaluationService } from "../../analytics/forecast/demand-evaluation.service";
import { demandBaselineService } from "../../analytics/forecast/demand-baseline.service";

/**
 * Phase 12 — ML governance over HTTP.
 *
 * ── Why these live under /api/admin ────────────────────────────────────────────
 *
 * `/api/mlops/*` already exists and reports the warehouse registry behind `requireRole("ADMIN")` —
 * one coarse gate that any admin passes. Approving a model decides what the platform will predict,
 * and predictions steer dispatch and capacity, so it belongs behind the same per-permission RBAC as
 * every other governance act on this platform. Routes mounted under `/api/admin` are matched by
 * `admin-route-permissions` and denied by default when unmapped, which is the property that makes
 * adding a route here safe.
 *
 * The read-only diagnostics stay separate from the governance writes: reading a readiness report is
 * ANALYTICS/READ, changing which model serves is SETTINGS/APPROVE.
 */
export const adminMlRoutes = new Elysia({ prefix: "/api/admin/ml" })
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

  /** Whether the platform is in a state where its predictions describe the present. */
  .get("/health", async () => ({ success: true, data: await mlPlatformHealthService.health() }))

  /** Measured data readiness and leakage for every Phase-12 model. */
  .get("/readiness", async () => ({ success: true, data: await mlReadinessService.assessAll() }))

  /** Every governed model with its current stages. */
  .get("/models", async () => ({ success: true, data: await mlRegistryService.list() }))

  /** Full version history for one model, newest first. */
  .get("/models/:name/versions", async ({ params }) => ({
    success: true, data: await mlRegistryService.history(params.name),
  }))

  /**
   * Run the demand holdout evaluation.
   *
   * Read-only and side-effect free: it builds a dataset, computes baselines and reports error. It
   * does not register a candidate — measuring a model and deciding to use it are separate acts.
   */
  .get("/demand/evaluation", async ({ query }) => {
    const testDays = query.testDays ? Number(query.testDays) : undefined;
    return { success: true, data: await demandEvaluationService.evaluate({ testDays }) };
  })

  /** The deterministic forecaster, including when the warehouse cannot answer. */
  .get("/demand/forecast", async ({ query }) => {
    const horizon = query.horizonDays ? Number(query.horizonDays) : 7;
    return { success: true, data: await demandBaselineService.forecast(horizon) };
  })

  /** Shadow rows and the candidate-vs-incumbent comparison for one candidate version. */
  .get("/shadow/:versionId", async ({ params, query }) => ({
    success: true,
    data: {
      comparison: await mlShadowService.compare({
        modelName: String(query.modelName ?? ""), candidateVersionId: params.versionId,
      }),
      rows: await mlShadowService.rows(params.versionId),
    },
  }))

  /**
   * Register a new candidate version.
   *
   * The stage is deliberately not a caller-supplied field on this route: everything registered here
   * enters as CANDIDATE. A route that let a caller name the entry stage is one typo away from being
   * the blind-promotion path this phase forbids.
   */
  .post("/models/:name/versions", async ({ params, body, requireAdminContext, set }) => {
    const { userId } = requireAdminContext();
    const r = await mlRegistryService.register({
      modelName: params.name,
      datasetVersion: body.datasetVersion,
      featureVersion: body.featureVersion,
      codeVersion: body.codeVersion,
      artifactRef: body.artifactRef,
      artifactHash: body.artifactHash ?? null,
      metrics: body.metrics,
      hyperparameters: body.hyperparameters,
      seed: body.seed ?? null,
      baselineName: body.baselineName ?? null,
      beatsBaseline: body.beatsBaseline ?? null,
      actorId: userId,
    });
    if (!r.ok) { set.status = 400; return { success: false, error: r.detail, code: r.code }; }
    return { success: true, data: r.data, detail: r.detail };
  }, {
    body: t.Object({
      datasetVersion: t.String({ minLength: 1, maxLength: 200 }),
      featureVersion: t.String({ minLength: 1, maxLength: 200 }),
      codeVersion: t.String({ minLength: 1, maxLength: 200 }),
      artifactRef: t.String({ minLength: 1, maxLength: 500 }),
      artifactHash: t.Optional(t.String({ maxLength: 128 })),
      metrics: t.Optional(t.Any()),
      hyperparameters: t.Optional(t.Any()),
      seed: t.Optional(t.Number()),
      baselineName: t.Optional(t.String({ maxLength: 200 })),
      beatsBaseline: t.Optional(t.Boolean()),
    }),
  })

  /** Move a version between pre-approval stages. PRODUCTION and APPROVED are refused here. */
  .post("/versions/:id/transition", async ({ params, body, requireAdminContext, set }) => {
    const { userId } = requireAdminContext();
    const r = await mlRegistryService.transition({
      id: params.id, to: body.to as never, actorId: userId, reason: body.reason,
    });
    if (!r.ok) { set.status = 400; return { success: false, error: r.detail, code: r.code }; }
    return { success: true, data: r.data, detail: r.detail };
  }, {
    body: t.Object({
      to: t.Union([
        t.Literal("TRAINED"), t.Literal("EVALUATED"), t.Literal("CANDIDATE"),
        t.Literal("SHADOW"), t.Literal("REJECTED"), t.Literal("RETIRED"),
      ]),
      reason: t.Optional(t.String({ maxLength: 500 })),
    }),
  })

  /** A person approves a version. Approval is not promotion. */
  .post("/versions/:id/approve", async ({ params, body, requireAdminContext, set }) => {
    const { userId } = requireAdminContext();
    const r = await mlRegistryService.approve({ id: params.id, actorId: userId, note: body.note });
    if (!r.ok) { set.status = 400; return { success: false, error: r.detail, code: r.code }; }
    return { success: true, data: r.data, detail: r.detail };
  }, { body: t.Object({ note: t.String({ minLength: 10, maxLength: 1000 }) }) })

  /** Promote an already-approved version. Refuses anything else. */
  .post("/versions/:id/promote", async ({ params, requireAdminContext, set }) => {
    const { userId } = requireAdminContext();
    const r = await mlRegistryService.promote({ id: params.id, actorId: userId });
    if (!r.ok) { set.status = 400; return { success: false, error: r.detail, code: r.code }; }
    return { success: true, data: r.data, detail: r.detail };
  })

  /** Roll production back to the version it replaced. */
  .post("/models/:name/rollback", async ({ params, body, requireAdminContext, set }) => {
    const { userId } = requireAdminContext();
    const r = await mlRegistryService.rollback({ modelName: params.name, actorId: userId, reason: body.reason });
    if (!r.ok) { set.status = 400; return { success: false, error: r.detail, code: r.code }; }
    return { success: true, data: r.data, detail: r.detail };
  }, { body: t.Object({ reason: t.String({ minLength: 10, maxLength: 500 }) }) });
