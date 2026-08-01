import { Elysia, t } from "elysia";
import type { ConsentPolicyType } from "@prisma/client";
import { authPlugin } from "../plugins/auth.plugin";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { complianceService } from "../services/compliance.service";
import { dataRetentionService } from "../services/data-retention.service";
import { getClientIp } from "../services/audit-log.service";

function requestCtx(request: Request) {
  return {
    ipAddress: getClientIp(request),
    userAgent: request.headers.get("user-agent") ?? undefined,
  };
}

const policyTypes = ["TERMS", "PRIVACY", "COOKIES", "REFUND"] as const;

export const complianceRoutes = new Elysia({ prefix: "/api/compliance" })
  .use(authPlugin)
  .post(
    "/export",
    async ({ requireAuth, request, set }) => {
      const { userId } = requireAuth();
      const result = await complianceService.requestExport(userId, requestCtx(request));
      if ("error" in result && result.error === "EXPORT_IN_PROGRESS") {
        set.status = 409;
        return {
          success: false,
          error: "An export request is already in progress",
          code: "EXPORT_IN_PROGRESS",
          data: { requestId: result.request.id },
        };
      }
      return {
        success: true,
        data: {
          requestId: result.request!.id,
          dueDateAt: result.request!.dueDateAt,
          slaDaysRemaining: complianceService.slaDaysRemaining(result.request!.dueDateAt),
        },
      };
    },
  )
  .post(
    "/delete",
    async ({ requireAuth, body, request, set }) => {
      const { userId } = requireAuth();
      const result = await complianceService.requestDeletion(userId, requestCtx(request), body.reason);
      if ("error" in result && result.error === "DELETION_IN_PROGRESS") {
        set.status = 409;
        return {
          success: false,
          error: "A deletion request is already in progress",
          code: "DELETION_IN_PROGRESS",
          data: { requestId: result.request.id },
        };
      }
      return {
        success: true,
        data: {
          requestId: result.request!.id,
          gracePeriodEndsAt: result.gracePeriodEndsAt,
          message: "Deletion request submitted. Admin review required before processing.",
        },
      };
    },
    { body: t.Object({ reason: t.Optional(t.String()) }) },
  )
  .post(
    "/consent/withdraw",
    async ({ requireAuth, body, request, set }) => {
      const { userId } = requireAuth();
      if (!policyTypes.includes(body.policyType as (typeof policyTypes)[number])) {
        set.status = 400;
        return { success: false, error: "Invalid policy type", code: "INVALID_INPUT" };
      }
      const result = await complianceService.withdrawConsent(
        userId,
        body.policyType as ConsentPolicyType,
        requestCtx(request),
      );
      return { success: true, data: result };
    },
    { body: t.Object({ policyType: t.String() }) },
  )
  .get(
    "/request/:id",
    async ({ requireAuth, params, set }) => {
      const { userId } = requireAuth();
      const request = await complianceService.getRequestForUser(params.id, userId);
      if (!request) {
        set.status = 404;
        return { success: false, error: "Request not found", code: "NOT_FOUND" };
      }
      return {
        success: true,
        data: {
          requestId: request.id,
          requestType: request.requestType,
          status: request.status,
          submittedAt: request.submittedAt,
          dueDateAt: request.dueDateAt,
          completedAt: request.completedAt,
          rejectionReason: request.rejectionReason,
          slaDaysRemaining: complianceService.slaDaysRemaining(request.dueDateAt),
          export: request.dataExport,
          deletion: request.deletion,
        },
      };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get(
    "/export/:id",
    async ({ requireAuth, params, set }) => {
      const { userId } = requireAuth();
      const exportRow = await complianceService.getExportForUser(params.id, userId);
      if (!exportRow) {
        set.status = 404;
        return { success: false, error: "Export not found", code: "NOT_FOUND" };
      }
      return {
        success: true,
        data: {
          exportId: exportRow.id,
          requestId: exportRow.complianceRequestId,
          status: exportRow.exportStatus,
          downloadUrl: exportRow.fileUrl,
          fileSize: exportRow.fileSize,
          fileHash: exportRow.fileHash,
          createdAt: exportRow.createdAt,
          expiresAt: exportRow.expiresAt,
          exportedAt: exportRow.exportedAt,
        },
      };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .get("/requests", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const rows = await complianceService.listUserRequests(userId, query.limit);
    return { success: true, data: { requests: rows } };
  }, { query: t.Object({ limit: t.Optional(t.Numeric()) }) })
  .use(adminRbacPlugin)
  .get("/admin/requests", async ({ requireAdminContext, query }) => {
    requireAdminContext();
    const rows = await complianceService.listForAdmin({
      limit: query.limit,
      status: query.status,
    });
    return { success: true, data: { requests: rows } };
  }, {
    query: t.Object({
      limit: t.Optional(t.Numeric()),
      status: t.Optional(t.String()),
    }),
  })
  .post(
    "/admin/requests/:id/approve",
    async ({ requireAuth, requireAdminContext, params, request, set }) => {
      requireAdminContext();
      const { userId } = requireAuth();
      const result = await complianceService.approveRequest(params.id, userId, requestCtx(request));
      if ("error" in result) {
        set.status = 400;
        return { success: false, error: "Request cannot be approved", code: result.error };
      }
      return { success: true, data: { request: result.request } };
    },
    { params: t.Object({ id: t.String() }) },
  )
  .post(
    "/admin/requests/:id/reject",
    async ({ requireAuth, requireAdminContext, params, body, request, set }) => {
      requireAdminContext();
      const { userId } = requireAuth();
      const result = await complianceService.rejectRequest(
        params.id,
        userId,
        body.reason,
        requestCtx(request),
      );
      if ("error" in result) {
        set.status = 400;
        return { success: false, error: "Request cannot be rejected", code: result.error };
      }
      return { success: true, data: { request: result.request } };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ reason: t.String({ minLength: 3 }) }),
    },
  )
  .get("/admin/retention/report", async ({ requireAdminContext }) => {
    requireAdminContext();
    const report = await dataRetentionService.getRetentionReport();
    return { success: true, data: report };
  });
