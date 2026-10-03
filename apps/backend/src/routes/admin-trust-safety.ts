import { Elysia, t } from "elysia";
import { partnerSafetyService } from "../services/partner-safety.service";
import { partnerRiskService } from "../services/partner-risk.service";
import { complianceExpiryService } from "../services/compliance-expiry.service";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import prisma from "../lib/prisma";

export const adminTrustSafetyRoutes = new Elysia()
  .use(adminRbacPlugin)
  .get("/trust-safety/overview", async () => {
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const [expiring, expired, restricted, openIncidents, sosOpen, riskReview] = await Promise.all([
      prisma.providerDocument.count({
        where: { expiryDate: { gte: now, lte: soon } },
      }),
      prisma.providerDocument.count({
        where: { expiryDate: { lt: now } },
      }),
      prisma.provider.count({ where: { complianceRestricted: true } }),
      prisma.partnerSafetyIncident.count({
        where: { status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } },
      }),
      prisma.partnerSafetyIncident.count({
        where: { type: "SOS", status: { in: ["OPEN", "ACKNOWLEDGED", "IN_PROGRESS"] } },
      }),
      prisma.partnerRiskProfile.count({ where: { reviewStatus: "REVIEW" } }),
    ]);
    return {
      success: true,
      data: { expiring, expired, restricted, openIncidents, sosOpen, riskReview },
    };
  })
  .get("/trust-safety/compliance", async ({ query }) => {
    const data = await complianceExpiryService.adminQueue({
      filter: query.filter as "expiring" | "expired" | "restricted" | "pending" | "verified" | undefined,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 25,
    });
    return { success: true, data };
  })
  .post("/trust-safety/compliance/:providerId/unrestrict", async ({ params, requireAdminContext, body }) => {
    const { userId } = requireAdminContext();
    await complianceExpiryService.unrestrict(params.providerId, userId, body?.reason || "Admin unrestrict");
    return { success: true };
  }, {
    params: t.Object({ providerId: t.String() }),
    body: t.Optional(t.Object({ reason: t.Optional(t.String()) })),
  })
  .get("/trust-safety/risk", async ({ query }) => {
    const data = await partnerRiskService.adminQueue({
      level: query.level,
      reviewStatus: query.reviewStatus,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 25,
    });
    return { success: true, data };
  })
  .get("/trust-safety/risk/:providerId", async ({ params, query }) => {
    const data = await partnerRiskService.detail(
      params.providerId,
      query.page ? Number(query.page) : 1,
      query.limit ? Number(query.limit) : 25,
    );
    return { success: true, data };
  })
  .post("/trust-safety/risk/:providerId/review", async ({ params, requireAdminContext, body }) => {
    const { userId } = requireAdminContext();
    const profile = await partnerRiskService.review({
      providerId: params.providerId,
      actorId: userId,
      action: body.action,
      notes: body.notes,
    });
    return { success: true, data: { profile } };
  }, {
    params: t.Object({ providerId: t.String() }),
    body: t.Object({
      action: t.Union([
        t.Literal("MONITOR"),
        t.Literal("REVIEW"),
        t.Literal("CLEAR"),
        t.Literal("RESTRICT"),
        t.Literal("SUSPEND"),
      ]),
      notes: t.Optional(t.String()),
    }),
  })
  .get("/trust-safety/incidents", async ({ query }) => {
    const data = await partnerSafetyService.adminQueue({
      status: query.status,
      type: query.type,
      severity: query.severity,
      providerId: query.providerId,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 25,
    });
    return { success: true, data };
  })
  .get("/trust-safety/incidents/:id", async ({ params, set }) => {
    const data = await partnerSafetyService.adminDetail(params.id);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Incident not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .post("/trust-safety/incidents/:id/assign", async ({ params, requireAdminContext, body }) => {
    const { userId } = requireAdminContext();
    const row = await partnerSafetyService.assign(params.id, userId, body.assignedTo);
    return { success: true, data: { incident: row } };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ assignedTo: t.String() }),
  })
  .post("/trust-safety/incidents/:id/acknowledge", async ({ params, requireAdminContext }) => {
    const { userId } = requireAdminContext();
    const row = await partnerSafetyService.acknowledge(params.id, userId);
    return { success: true, data: { incident: row } };
  })
  .post("/trust-safety/incidents/:id/resolve", async ({ params, requireAdminContext, body }) => {
    const { userId } = requireAdminContext();
    const row = await partnerSafetyService.resolve(params.id, userId, body.notes);
    if (!row) return { success: false, error: "Incident not found", code: "NOT_FOUND" };
    return { success: true, data: { incident: row } };
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({ notes: t.String({ minLength: 3, maxLength: 2000 }) }),
  });
