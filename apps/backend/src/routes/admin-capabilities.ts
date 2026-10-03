/**
 * Phase 11 — admin capability management: skills catalogue, provider capability review, provider ↔
 * service capability, businesses and membership, service → business ownership.
 *
 * Mounted under `/api/admin`, so every route is gated by `admin-route-permissions` (denied by default
 * when unmapped). Provider records are the `USERS` resource (as every other /admin/providers rule):
 * reads are USERS/READ, fact corrections USERS/UPDATE, verification decisions USERS/APPROVE.
 * The skills catalogue and service ownership are catalogue configuration (SETTINGS), like services.
 *
 * Every write runs through provider-capability.service, which stamps actor + reason onto the
 * transaction for the capability audit trigger. Unknown error codes answer 500, never success.
 */
import { Elysia, t } from "elysia";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { authPlugin } from "../plugins/auth.plugin";
import { isCapabilityKind, providerCapabilityService, capabilityTablesPresent } from "../services/provider-capability.service";
import { buildServiceSkillBoard, listPendingServiceSkills } from "../services/partner-service-skills.service";
import { capabilityResponse } from "./provider-capabilities";

const optStr = t.Optional(t.Union([t.String({ maxLength: 300 }), t.Null()]));
const reasonOpt = t.Optional(t.String({ maxLength: 500 }));
const notFound = (set: { status?: number | string }) => {
  set.status = 404;
  return { success: false as const, error: "Not found", code: "NOT_FOUND" };
};

export const adminCapabilitiesRoutes = new Elysia({ prefix: "/api/admin" })
  // Same order as admin-governance.ts: authPlugin first so requireAuth/requireRole are derived here.
  .use(authPlugin)
  .use(adminRbacPlugin)

  // ── skills catalogue ─────────────────────────────────────────────────────────────────────────
  .get("/skills", async ({ set }) => capabilityResponse(set, await providerCapabilityService.listSkills()))
  .post("/skills", async ({ body, set }) => capabilityResponse(set, await providerCapabilityService.createSkill(body)), {
    body: t.Object({ code: t.String({ maxLength: 80 }), category: t.String({ maxLength: 60 }), name: t.String({ maxLength: 120 }) }),
  })
  .patch("/skills/:code", async ({ params, body, set }) => capabilityResponse(set, await providerCapabilityService.updateSkill(params.code, body)), {
    body: t.Object({ category: t.Optional(t.String({ maxLength: 60 })), name: t.Optional(t.String({ maxLength: 120 })), active: t.Optional(t.Boolean()) }),
  })

  // ── provider capability review ───────────────────────────────────────────────────────────────
  .get("/providers/:id/capabilities", async ({ params, set }) => {
    const profile = await providerCapabilityService.getProviderCapabilityProfile(params.id, new Date(), "admin");
    if (!profile.ok) return capabilityResponse(set, profile);
    return { success: true, data: { ...profile.data, audit: await providerCapabilityService.auditFor(params.id) } };
  })
  .post("/providers/:id/capabilities/:kind/:rowId/:action", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    const rowId = Number(params.rowId);
    const action = params.action;
    if (!isCapabilityKind(params.kind) || !Number.isSafeInteger(rowId) || rowId <= 0 || (action !== "verify" && action !== "reject" && action !== "revoke")) return notFound(set);
    return capabilityResponse(set, await providerCapabilityService.adminTransition({
      providerId: params.id, kind: params.kind, rowId, action, adminUserId: auth.userId, reason: body?.reason ?? null, expiresAt: body?.expiresAt ?? null,
    }));
  }, { body: t.Optional(t.Object({ reason: reasonOpt, expiresAt: optStr })) })
  .patch("/providers/:id/capabilities/:kind/:rowId", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    const rowId = Number(params.rowId);
    if (!isCapabilityKind(params.kind) || !Number.isSafeInteger(rowId) || rowId <= 0) return notFound(set);
    return capabilityResponse(set, await providerCapabilityService.adminPatch({ providerId: params.id, kind: params.kind, rowId, adminUserId: auth.userId, ...body }));
  }, {
    body: t.Object({
      reason: t.String({ maxLength: 500 }),
      expiresAt: optStr, issuedAt: optStr, effectiveFrom: optStr, inspectionDueAt: optStr,
      level: optStr, proficiency: t.Optional(t.String({ maxLength: 20 })), operational: t.Optional(t.String({ maxLength: 20 })),
    }),
  })
  .get("/service-skill-requests", async ({ set }) => {
    // Reads provider_service_capabilities. A missing table is 503, never an empty success.
    if (!(await capabilityTablesPresent())) {
      set.status = 503;
      return { success: false as const, error: "Service skill approval is not deployed", code: "NOT_DEPLOYED" };
    }
    return { success: true as const, data: { requests: await listPendingServiceSkills() } };
  })
  .get("/providers/:id/service-skills", async ({ params, set }) => {
    const board = await buildServiceSkillBoard(params.id, await capabilityTablesPresent());
    if (!board) return notFound(set);
    return { success: true as const, data: board };
  })
  .post("/providers/:id/services/:serviceId/:action", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    const action = params.action;
    if (action !== "approve" && action !== "suspend" && action !== "revoke") return notFound(set);
    return capabilityResponse(set, await providerCapabilityService.adminServiceTransition({
      providerId: params.id, serviceId: params.serviceId, action, adminUserId: auth.userId, reason: body?.reason ?? null,
    }));
  }, { body: t.Optional(t.Object({ reason: reasonOpt })) })

  // ── businesses + membership ──────────────────────────────────────────────────────────────────
  .get("/businesses", async ({ set }) => capabilityResponse(set, await providerCapabilityService.listBusinesses()))
  .get("/businesses/:id", async ({ params, set }) => capabilityResponse(set, await providerCapabilityService.getBusiness(params.id)))
  .post("/businesses", async ({ body, requireAuth, set }) => {
    const auth = requireAuth();
    return capabilityResponse(set, await providerCapabilityService.createBusiness({ ...body, adminUserId: auth.userId }));
  }, {
    body: t.Object({ name: t.String({ maxLength: 160 }), legalName: optStr, registrationNumber: optStr, status: t.Optional(t.String({ maxLength: 20 })), reason: reasonOpt }),
  })
  .patch("/businesses/:id", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    return capabilityResponse(set, await providerCapabilityService.updateBusiness(params.id, { ...body, adminUserId: auth.userId }));
  }, {
    body: t.Object({ name: t.Optional(t.String({ maxLength: 160 })), legalName: optStr, registrationNumber: optStr, status: t.Optional(t.String({ maxLength: 20 })), reason: reasonOpt }),
  })
  .post("/businesses/:id/providers/:providerId", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    return capabilityResponse(set, await providerCapabilityService.addMember({
      businessId: params.id, providerId: params.providerId, role: body?.role ?? null, effectiveFrom: body?.effectiveFrom ?? null,
      effectiveTo: body?.effectiveTo ?? null, adminUserId: auth.userId, reason: body?.reason ?? null,
    }));
  }, { body: t.Optional(t.Object({ role: optStr, effectiveFrom: optStr, effectiveTo: optStr, reason: reasonOpt })) })
  .delete("/businesses/:id/providers/:providerId", async ({ params, body, query, requireAuth, set }) => {
    const auth = requireAuth();
    const reason = body?.reason ?? (typeof query?.reason === "string" ? query.reason : null);
    return capabilityResponse(set, await providerCapabilityService.removeMember({ businessId: params.id, providerId: params.providerId, adminUserId: auth.userId, reason }));
  }, { body: t.Optional(t.Object({ reason: reasonOpt })) })

  // ── service → business ownership ─────────────────────────────────────────────────────────────
  .put("/services/:id/business", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    return capabilityResponse(set, await providerCapabilityService.setServiceBusiness({ serviceId: params.id, businessId: body.businessId, adminUserId: auth.userId, reason: body.reason }));
  }, { body: t.Object({ businessId: t.Union([t.String({ maxLength: 80 }), t.Null()]), reason: t.String({ maxLength: 500 }) }) });
