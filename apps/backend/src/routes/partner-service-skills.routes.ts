/**
 * Partner service skills after signup.
 * A partner requests a catalogue service; an admin approves it before dispatch can offer it.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import {
  buildServiceSkillBoard,
  decideServiceSkill,
  listPendingServiceSkills,
  requestServiceSkill,
  serviceSkillTablesPresent,
  withdrawServiceSkillRequest,
  type ServiceSkillError,
  type ServiceSkillResult,
} from "../services/partner-service-skills.service";

const STATUS: Record<ServiceSkillError, number> = {
  NOT_DEPLOYED: 503,
  PROVIDER_NOT_FOUND: 404,
  SERVICE_NOT_FOUND: 404,
  NOT_FOUND: 404,
  ALREADY_OFFERED: 409,
  CAPABILITY_LOCKED: 409,
  INVALID_TRANSITION: 409,
  REASON_REQUIRED: 400,
};

function reply<T>(set: { status?: number | string }, result: ServiceSkillResult<T>) {
  if (result.ok) return { success: true as const, data: result.data };
  set.status = STATUS[result.error] ?? 500;
  return { success: false as const, error: result.detail ?? result.error, code: result.error };
}

export const partnerServiceSkillRoutes = new Elysia({ name: "partner-service-skills" })
  .use(authPlugin)
  .get("/api/providers/me/service-skills", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const board = await buildServiceSkillBoard(providerId, await serviceSkillTablesPresent());
    if (!board) {
      set.status = 404;
      return { success: false as const, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true as const, data: board };
  })
  .post("/api/providers/me/capabilities/services", async ({ requireProvider, body, set }) => {
    const user = requireProvider();
    return reply(set, await requestServiceSkill({
      providerId: user.providerId,
      actorUserId: user.userId,
      serviceId: body.serviceId,
      note: body.note,
    }));
  }, { body: t.Object({ serviceId: t.String({ maxLength: 64 }), note: t.Optional(t.String({ maxLength: 300 })) }) })
  .delete("/api/providers/me/capabilities/services/:rowId", async ({ requireProvider, params, set }) => {
    const user = requireProvider();
    const rowId = Number(params.rowId);
    if (!Number.isSafeInteger(rowId) || rowId <= 0) {
      set.status = 404;
      return { success: false as const, error: "Not found", code: "NOT_FOUND" };
    }
    return reply(set, await withdrawServiceSkillRequest(user.providerId, user.userId, rowId));
  });

export const adminServiceSkillRoutes = new Elysia({ name: "admin-service-skills" })
  .use(authPlugin)
  .use(adminRbacPlugin)
  .get("/api/admin/service-skill-requests", async ({ set }) => {
    if (!(await serviceSkillTablesPresent())) {
      set.status = 503;
      return { success: false as const, error: "Service skill approval is not deployed", code: "NOT_DEPLOYED" };
    }
    return { success: true as const, data: { requests: await listPendingServiceSkills() } };
  })
  .get("/api/admin/providers/:id/service-skills", async ({ params, set }) => {
    const board = await buildServiceSkillBoard(params.id, await serviceSkillTablesPresent());
    if (!board) {
      set.status = 404;
      return { success: false as const, error: "Not found", code: "NOT_FOUND" };
    }
    return { success: true as const, data: board };
  })
  .post("/api/admin/providers/:id/services/:serviceId/:action", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    const action = params.action;
    if (action !== "approve" && action !== "suspend" && action !== "revoke") {
      set.status = 404;
      return { success: false as const, error: "Not found", code: "NOT_FOUND" };
    }
    return reply(set, await decideServiceSkill({
      providerId: params.id,
      serviceId: params.serviceId,
      action,
      adminUserId: auth.userId,
      reason: body?.reason ?? null,
    }));
  }, { body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 500 })) })) });
