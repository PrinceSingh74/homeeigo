import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { adminService, adminReviewService } from "../services/admin.service";
import { heatmapService } from "../services/heatmap.service";
import { opsMapService } from "../services/ops-map.service";
import { catalogService } from "../services/catalog.service";
import { earningsService } from "../services/earnings.service";
import { subscriptionService } from "../services/subscription.service";
import { referralService } from "../services/referral.service";
import { hcoinService } from "../services/hcoin.service";
import { transferService } from "../services/transfer.service";
import { giftCardService } from "../services/gift-card.service";
import { invoiceReportService } from "../services/invoice-report.service";
import { cashbackService } from "../services/cashback.service";
import { bookingPriorityService } from "../services/booking-priority.service";
import { campaignService } from "../services/campaign.service";
import { supportTicketService } from "../services/support-ticket.service";
import { membershipAnalyticsService } from "../services/membership-analytics.service";
import { assignmentEngine } from "../services/assignment-engine.service";
import { membershipCouponService } from "../services/membership-coupon.service";
import prisma from "../lib/prisma";
import { fraudAdminService } from "../services/fraud-admin.service";
import { referralFraudService } from "../services/referral-fraud.service";
import { settlementChargebackService } from "../services/settlement-chargeback.service";
import { settlementService } from "../services/settlement.service";
import { paymentReconciliationService } from "../services/payment-reconciliation.service";
import { financeDashboardService } from "../services/finance-dashboard.service";
import { financialRiskService } from "../services/financial-risk.service";
import { migrationVerificationService } from "../services/migration-verification.service";
import { chargebackWorkflowService } from "../services/chargeback-workflow.service";
import { chargebackEvidenceAccessService } from "../services/chargeback-evidence-access.service";
import { chargebackEvidencePdfService } from "../services/chargeback-evidence-pdf.service";
import fs from "fs";
import { settlementSyncService } from "../services/settlement-sync.service";
import { executiveReportingService } from "../services/executive-reporting.service";
import { financialIntegrityService } from "../services/financial-integrity.service";
import { financeLiabilityService } from "../services/finance-liability.service";
import { financialAuditExportService } from "../services/financial-audit-export.service";
import { financialAdjustmentService } from "../services/financial-adjustment.service";
import { ledgerBackfillService, type BackfillType } from "../services/ledger-backfill.service";
import { hcoinExpiryService } from "../services/hcoin-expiry.service";
import type { AdjustmentDirection, AdjustmentStatus, AdjustmentType } from "@prisma/client";
import { financeAlertService } from "../services/finance-alert.service";
import { gatewayReconciliationService } from "../services/gateway-reconciliation.service";
import { payoutOperationsService } from "../services/payout-operations.service";
import { settlementResolutionService } from "../services/settlement-resolution.service";
import { adminBookingOperationsService } from "../services/admin-booking-operations.service";
import { refundWorkflowService } from "../services/refund-workflow.service";
import { financeAnalyticsService } from "../services/finance-analytics.service";
import { financeIntelligenceService } from "../services/finance-intelligence.service";
import { financeConfigService } from "../services/finance-config.service";
import { customerIntelligenceService } from "../services/customer-intelligence.service";
import { growthIntelligenceService } from "../services/growth-intelligence.service";
import { riskIntelligenceService } from "../services/risk-intelligence.service";
import { platformIntelligenceService } from "../services/platform-intelligence.service";
import { recoveryIntelligenceService } from "../services/recovery-intelligence.service";
import { financeValidationService } from "../services/finance-validation.service";
import { observabilityService } from "../services/observability.service";
import { logAggregationService } from "../services/log-aggregation.service";
import { productionValidationService } from "../services/production-validation.service";
import { dataArchivalService } from "../services/data-archival.service";
import { parseBody, sanitizeQueryStrings } from "../lib/route-security";
import { adminBanUserSchema, adminVerifyProviderSchema } from "../schemas/admin.schema";
import { validate } from "../middleware/validation.middleware";
import { idParamSchema } from "../schemas/common.schema";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { rbacService } from "../services/rbac.service";
import { academyAdminService } from "../services/academy-admin.service";
import { tokenRevocationService } from "../services/token-revocation.service";
import { adminPartnerAcquisitionRoutes } from "./admin-partner-acquisition";
import { adminPartnerReferralRoutes } from "./admin-partner-referral";
import { adminTrustSafetyRoutes } from "./admin-trust-safety";
import { adminIntelligenceRoutes } from "./admin-intelligence";
import { adminAutomationRoutes } from "./admin-automation";
import { enterpriseAuditService } from "../services/enterprise-audit.service";
import { commandCenterOverviewService } from "../services/command-center-overview.service";

const createServiceBody = t.Object({
  name: t.String({ minLength: 2, maxLength: 120 }),
  description: t.String({ minLength: 2, maxLength: 2000 }),
  category: t.String({ minLength: 1 }),
  basePrice: t.Number({ minimum: 0 }),
  estimatedDuration: t.Number({ minimum: 1 }),
  subcategory: t.Optional(t.String()),
  detailedDescription: t.Optional(t.String()),
  minPrice: t.Optional(t.Number({ minimum: 0 })),
  maxPrice: t.Optional(t.Number({ minimum: 0 })),
  icon: t.Optional(t.String()),
  isActive: t.Optional(t.Boolean()),
  isFeatured: t.Optional(t.Boolean()),
  premiumOnly: t.Optional(t.Boolean()),
  availableCities: t.Optional(t.Array(t.String())),
});
const updateServiceBody = t.Partial(createServiceBody);

// A plan benefit: a plain display label, or a structured entitlement the
// EntitlementService enforces (type + value [+ quota]).
const benefitSchema = t.Union([
  t.String({ maxLength: 120 }),
  t.Object({
    label: t.String({ maxLength: 120 }),
    type: t.Optional(
      t.Union([
        t.Literal("DISCOUNT_PCT"),
        t.Literal("CASHBACK_PCT"),
        t.Literal("PREMIUM_ONLY_ACCESS"),
        t.Literal("PRIORITY_BOOKING"),
        t.Literal("PRIORITY_SUPPORT"),
        t.Literal("FREE_DELIVERY"),
      ]),
    ),
    value: t.Optional(t.Number({ minimum: 0 })),
    quotaLimit: t.Optional(t.Number({ minimum: 0 })),
    quotaPeriod: t.Optional(t.Union([t.Literal("MONTH"), t.Literal("TOTAL")])),
  }),
]);

export const adminApiRoutes = new Elysia({ prefix: "/api/admin" })
  .use(authPlugin)
  .use(adminRbacPlugin)
  .get("/dashboard", async () => {
    const data = await adminService.dashboard();
    return { success: true, data };
  })
  .get("/command-center/overview", async ({ adminContext }) => {
    const data = await commandCenterOverviewService.getOverview(adminContext!);
    return { success: true, data };
  })
  .get("/audit", async ({ query }) => {
    const q = sanitizeQueryStrings(query as Record<string, string>);
    const allowedStatus = ["SUCCESS", "FAILURE", "DENIED", "PARTIAL"] as const;
    const status = allowedStatus.includes(q.status as (typeof allowedStatus)[number])
      ? (q.status as (typeof allowedStatus)[number])
      : undefined;
    const data = await enterpriseAuditService.getAuditLogs({
      action: q.action || undefined,
      actor: q.actor || undefined,
      resource: q.resource || undefined,
      resourceId: q.resourceId || q.entityId || undefined,
      traceId: q.traceId || q.requestId || q.correlationId || undefined,
      status,
      startDate: q.startDate ? new Date(q.startDate) : undefined,
      endDate: q.endDate ? new Date(q.endDate) : undefined,
      cursor: q.cursor || undefined,
      limit: q.limit ? Number(q.limit) : 50,
    });
    return { success: true, data };
  })
  .get("/users", async ({ query }) => {
    const data = await adminService.listUsers(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data };
  })
  .get("/providers", async ({ query }) => {
    const data = await adminService.listProviders(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data };
  })
  // Partner command-center — full detail for ONE provider (profile/KYC/metrics/
  // accept-reject history/recent bookings/earnings/live location).
  .get("/providers/:id", async ({ params, set }) => {
    const detail = await adminService.getProviderDetail(params.id);
    if (!detail) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data: detail };
  })
  .get("/providers/:id/score", async ({ params, set }) => {
    const { partnerScoreService } = await import("../services/partner-score.service");
    const data = await partnerScoreService.getCurrent(params.id);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .get("/providers/:id/score/history", async ({ params, query }) => {
    const { partnerScoreService } = await import("../services/partner-score.service");
    const data = await partnerScoreService.getHistory(params.id, query as Record<string, string | undefined>);
    return { success: true, data };
  })
  .get("/providers/:id/career", async ({ params, set }) => {
    const { partnerCareerService } = await import("../services/partner-career.service");
    const data = await partnerCareerService.getCurrent(params.id);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .get("/providers/:id/career/history", async ({ params, query }) => {
    const { partnerCareerService } = await import("../services/partner-career.service");
    const data = await partnerCareerService.getHistory(params.id, query as Record<string, string | undefined>);
    return { success: true, data };
  })
  .get("/providers/:id/lifecycle", async ({ params, set }) => {
    const { partnerLifecycleService } = await import("../services/partner-lifecycle.service");
    const [current, history] = await Promise.all([
      partnerLifecycleService.getCurrent(params.id),
      partnerLifecycleService.getHistory(params.id, { limit: "30" }),
    ]);
    if (!current) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { ...current, history: history.items } };
  })
  .post(
    "/providers/:id/lifecycle",
    async ({ params, body, requireAdminContext, set }) => {
      const admin = requireAdminContext();
      const { partnerLifecycleService } = await import("../services/partner-lifecycle.service");
      const action = body.action as "approve" | "pause" | "review" | "suspend" | "reactivate";
      const result = await partnerLifecycleService.adminAction(
        params.id,
        action,
        { actorType: "ADMIN", actorId: admin.userId },
        body.reason,
      );
      if (result && "error" in result && result.error) {
        set.status = result.error === "INVALID_TRANSITION" ? 409 : result.error === "NOT_FOUND" ? 404 : 400;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, data: result && "data" in result ? result.data : result };
    },
    {
      body: t.Object({
        action: t.Union([
          t.Literal("approve"),
          t.Literal("pause"),
          t.Literal("review"),
          t.Literal("suspend"),
          t.Literal("reactivate"),
        ]),
        reason: t.Optional(t.String()),
      }),
    },
  )
  // Geofence CRUD consolidated to the single authoritative surface at /api/geo/geofences
  // (routes/geo.ts, requireRole ADMIN). Removed the duplicate here to avoid two surfaces.
  // Phase 16.4 — demand/supply heatmap (Float-grid aggregation; live geospatial analytics).
  .get("/heatmap", async ({ query }) => {
    const num = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? Number(v) : undefined);
    const minLat = num(query.minLat);
    const maxLat = num(query.maxLat);
    const minLng = num(query.minLng);
    const maxLng = num(query.maxLng);
    const bbox =
      minLat != null && maxLat != null && minLng != null && maxLng != null
        ? { minLat, maxLat, minLng, maxLng }
        : undefined;
    const data = await heatmapService.generate({ gridSize: num(query.gridSize), days: num(query.days), bbox });
    return { success: true, data };
  })
  // Phase 17.4 — real-time operations command center (providers + bookings + heatmap +
  // geofences + alerts + metrics). Reuses presence/heatmap/geofence engines.
  .get("/ops-map", async ({ query }) => {
    const gridSize = typeof query.gridSize === "string" ? Number(query.gridSize) : undefined;
    const data = await opsMapService.snapshot({ gridSize });
    return { success: true, data };
  })
  .get("/partner-availability", async ({ query, adminContext, set }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "ANALYTICS", "READ");
      const { partnerOperationsService } = await import("../services/partner-operations.service");
      const data = await partnerOperationsService.adminRoster({
        status: typeof query.status === "string" ? query.status : undefined,
        zone: typeof query.zone === "string" ? query.zone : undefined,
        skill: typeof query.skill === "string" ? query.skill : undefined,
        capacity: query.capacity === "full" || query.capacity === "available" ? query.capacity : undefined,
        search: typeof query.search === "string" ? query.search : undefined,
        page: query.page ? Number(query.page) : undefined,
        limit: query.limit ? Number(query.limit) : undefined,
      });
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed";
      set.status = 403;
      return { success: false, error: message };
    }
  })
  .get("/bookings", async ({ query }) => {
    const data = await adminService.listBookings(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data };
  })
  .get("/bookings/:id", async ({ params, set, requireAuth, request }) => {
    const auth = requireAuth();
    const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
    const detail = await adminBookingOperationsService.getDetail(params.id, { adminId: auth.userId, ipAddress: ip ?? undefined });
    if (!detail) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: detail };
  })
  .post("/bookings/:id/cancel", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await adminBookingOperationsService.cancelBooking(
        params.id,
        auth.userId,
        body.reason,
        ip ?? undefined,
      );
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Cancel failed", code: "BOOKING_CANCEL_FAILED" };
    }
  }, { body: t.Object({ reason: t.String({ minLength: 3 }) }) })
  .post("/bookings/:id/reschedule", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await adminBookingOperationsService.rescheduleBooking(
        params.id,
        auth.userId,
        body.scheduledDate,
        body.reason,
        ip ?? undefined,
      );
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Reschedule failed", code: "BOOKING_RESCHEDULE_FAILED" };
    }
  }, { body: t.Object({ scheduledDate: t.String(), reason: t.String({ minLength: 3 }) }) })
  .post("/bookings/:id/reassign", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await adminBookingOperationsService.reassignProvider(
        params.id,
        auth.userId,
        body.providerId,
        body.reason,
        ip ?? undefined,
      );
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Reassign failed", code: "BOOKING_REASSIGN_FAILED" };
    }
  }, { body: t.Object({ providerId: t.String(), reason: t.String({ minLength: 3 }) }) })
  .post("/bookings/:id/dispatch", async ({ params, body, requireAuth, request }) => {
    const auth = requireAuth();
    const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
    const result = await adminBookingOperationsService.forceDispatch(params.id, auth.userId, body.reason, ip ?? undefined);
    return { success: true, data: result };
  }, { body: t.Object({ reason: t.String({ minLength: 3 }) }) })
  .post("/bookings/:id/complete", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await adminBookingOperationsService.markComplete(params.id, auth.userId, body.reason, ip ?? undefined);
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Complete failed", code: "BOOKING_COMPLETE_FAILED" };
    }
  }, { body: t.Object({ reason: t.String({ minLength: 3 }) }) })
  .post("/bookings/:id/repair", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await adminBookingOperationsService.repairBooking(params.id, auth.userId, body.reason, ip ?? undefined);
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Repair failed", code: "BOOKING_REPAIR_FAILED" };
    }
  }, { body: t.Object({ reason: t.String({ minLength: 3 }) }) })
  .post("/bookings/:id/refund", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await adminBookingOperationsService.refundBooking(
        params.id,
        auth.userId,
        body.amount,
        body.reason,
        ip ?? undefined,
      );
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Refund failed", code: "BOOKING_REFUND_FAILED" };
    }
  }, { body: t.Object({ amount: t.Number({ minimum: 0 }), reason: t.String({ minLength: 3 }) }) })
  .post("/bookings/:id/refund/retry", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await adminBookingOperationsService.retryFailedRefund(params.id, auth.userId, body.reason, ip ?? undefined);
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Retry failed", code: "BOOKING_REFUND_RETRY_FAILED" };
    }
  }, { body: t.Object({ reason: t.String({ minLength: 3 }) }) })
  .put(
    "/providers/:id/verify",
    async ({ params: rawParams, body: raw, requireAuth, set }) => {
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(adminVerifyProviderSchema, raw, { notes: { maxLen: 2000 } });
      const admin = requireAuth();
      try {
        const provider = await adminService.verifyProvider(
          params.id,
          body.action,
          body.notes,
          admin.userId,
          body.targetStep ? { targetStep: body.targetStep } : undefined,
        );
        const actionLabel =
          body.action === "approve"
            ? "approved"
            : body.action === "reject"
              ? "rejected"
              : "sent back for changes";
        return {
          success: true,
          message: `Provider ${actionLabel} successfully`,
          data: {
            provider: {
              id: provider.id,
              isApproved: provider.isApproved,
              approvalNotes: provider.approvalNotes,
              registrationStatus: provider.registrationStatus,
              changesRequestedStep: provider.changesRequestedStep,
            },
          },
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Verification failed";
        if (message.startsWith("ACTIVATION_BLOCKED:")) {
          set.status = 400;
          return {
            success: false,
            error: message.replace("ACTIVATION_BLOCKED:", ""),
            code: "ACTIVATION_BLOCKED",
          };
        }
        if (message.startsWith("VALIDATION:")) {
          set.status = 400;
          return {
            success: false,
            error: message.replace("VALIDATION:", ""),
            code: "VALIDATION_ERROR",
          };
        }
        set.status = message === "Provider not found" ? 404 : 500;
        return { success: false, error: message, code: "VERIFY_FAILED" };
      }
    },
    {
      body: t.Object({
        action: t.Union([
          t.Literal("approve"),
          t.Literal("reject"),
          t.Literal("request_changes"),
        ]),
        notes: t.Optional(t.String()),
        targetStep: t.Optional(t.String()),
      }),
    },
  )
  .put(
    "/users/:id/ban",
    async ({ params: rawParams, body: raw, set }) => {
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(adminBanUserSchema, raw, { reason: { maxLen: 500 } });
      let user;
      try {
        user = await adminService.banUser(params.id, body.action, body.reason);
      } catch {
        set.status = 404;
        return { success: false, error: "User not found", code: "NOT_FOUND" };
      }
      return {
        success: true,
        message: `User ${body.action === "ban" ? "banned" : "unbanned"} successfully`,
        data: {
          user: {
            id: user.id,
            isBanned: user.isBanned,
            bannedReason: user.bannedReason,
          },
        },
      };
    },
    {
      body: t.Object({
        action: t.Union([t.Literal("ban"), t.Literal("unban")]),
        reason: t.Optional(t.String()),
      }),
    },
  )
  .get("/analytics", async ({ query }) => {
    const data = await adminService.analytics({
      startDate: query.startDate,
      endDate: query.endDate,
    });
    return { success: true, data };
  })
  // ---- Reviews moderation console ----
  .get("/reviews", async ({ query }) => {
    const data = await adminReviewService.list(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data };
  })
  .patch(
    "/reviews/:id",
    async ({ params, body, set }) => {
      const result = await adminReviewService.moderate(params.id, body);
      if (!result) {
        set.status = 404;
        return { success: false, error: "Review not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Review updated", data: { review: result } };
    },
    { body: t.Object({ isPublic: t.Optional(t.Boolean()), isFlagged: t.Optional(t.Boolean()) }) },
  )
  .delete("/reviews/:id", async ({ params, set }) => {
    const result = await adminReviewService.remove(params.id);
    if (!result) {
      set.status = 404;
      return { success: false, error: "Review not found", code: "NOT_FOUND" };
    }
    return { success: true, message: "Review deleted", data: result };
  })
  .post("/withdrawals/:id/approve", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const w = await earningsService.approveWithdrawal(params.id, auth.userId);
    return { success: true, data: { withdrawal: w } };
  })
  .post("/withdrawals/:id/reject", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    if (!body?.reason?.trim()) {
      set.status = 400;
      return { success: false, error: "Reason required", code: "VALIDATION_ERROR" };
    }
    const result = await earningsService.rejectWithdrawal(params.id, auth.userId, body.reason);
    return { success: true, data: result };
  }, { body: t.Object({ reason: t.String() }) })
  .post("/withdrawals/:id/process", async ({ params, requireAuth, set }) => {
    try {
      const auth = requireAuth();
      const result = await earningsService.processProviderPayout(params.id, auth.userId);
      return { success: true, message: "Withdrawal queued for payout", data: result };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to process withdrawal";
      set.status = 400;
      return { success: false, error: message, code: "WITHDRAWAL_PROCESS_FAILED" };
    }
  })
  .get("/settlements", async () => {
    const [overview, batches] = await Promise.all([
      settlementChargebackService.settlementOverview(),
      settlementChargebackService.listSettlements(50),
    ]);
    return { success: true, data: { overview, batches } };
  })
  .get("/chargebacks", async () => {
    const chargebacks = await settlementChargebackService.listChargebacks(50);
    return { success: true, data: { chargebacks } };
  })
  .get("/finance/dashboard", async ({ query }) => {
    const days = Number(query.days ?? 30);
    const [overview, trend] = await Promise.all([
      financeDashboardService.getOverview(days),
      financeDashboardService.dailyTrend(days),
    ]);
    return { success: true, data: { overview, trend } };
  })
  .get("/finance/liabilities", async () => {
    const data = await financeLiabilityService.dashboard();
    return { success: true, data };
  })
  .post("/finance/liabilities/snapshot", async ({ body, requireAuth }) => {
    requireAuth();
    const period = (body?.period ?? "DAILY") as "DAILY" | "WEEKLY" | "MONTHLY";
    const snapshot = await financeLiabilityService.captureSnapshot(period);
    return { success: true, data: { snapshot } };
  }, { body: t.Optional(t.Object({ period: t.Optional(t.String()) })) })
  .get("/finance/audit-export/:kind", async ({ params, query, set }) => {
    const kind = params.kind as "ledger" | "journals" | "refunds" | "payouts" | "chargebacks" | "wallet" | "hcoins";
    const format = (query.format as string) ?? "csv";
    const limit = Math.min(10000, Number(query.limit ?? 5000));
    if (format === "xlsx") {
      const buf = await financialAuditExportService.exportXlsx(kind, limit);
      set.headers["Content-Type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["Content-Disposition"] = `attachment; filename=finance-${kind}.xlsx`;
      return buf;
    }
    const csv = await financialAuditExportService.exportCsv(kind, limit);
    set.headers["Content-Type"] = "text/csv";
    set.headers["Content-Disposition"] = `attachment; filename=finance-${kind}.csv`;
    return csv;
  })
  // ===== Manual Financial Adjustments (maker-checker) =====
  .get("/finance/adjustments", async ({ query }) => {
    const status = typeof query.status === "string" ? (query.status as AdjustmentStatus) : undefined;
    const adjustments = await financialAdjustmentService.list({ status });
    return { success: true, data: { adjustments } };
  })
  .post(
    "/finance/adjustments",
    async ({ body, requireAuth, set }) => {
      const { userId } = requireAuth();
      try {
        const adjustment = await financialAdjustmentService.create(
          {
            type: body.type as AdjustmentType,
            direction: body.direction as AdjustmentDirection,
            amount: body.amount,
            reason: body.reason,
            supportingNotes: body.supportingNotes,
            targetUserId: body.targetUserId,
            debitAccountCode: body.debitAccountCode,
            creditAccountCode: body.creditAccountCode,
          },
          userId,
        );
        return { success: true, data: { adjustment } };
      } catch (e) {
        set.status = 400;
        return { success: false, error: e instanceof Error ? e.message : "ADJUSTMENT_ERROR", code: "VALIDATION_ERROR" };
      }
    },
    {
      body: t.Object({
        type: t.Union([
          t.Literal("CREDIT"),
          t.Literal("DEBIT"),
          t.Literal("CORRECTION"),
          t.Literal("WRITE_OFF"),
          t.Literal("LIABILITY_ADJUSTMENT"),
          t.Literal("LEDGER_FIX"),
        ]),
        direction: t.Union([t.Literal("CREDIT"), t.Literal("DEBIT")]),
        amount: t.Number({ minimum: 0.01 }),
        reason: t.String({ minLength: 3, maxLength: 2000 }),
        supportingNotes: t.Optional(t.String({ maxLength: 5000 })),
        targetUserId: t.Optional(t.String()),
        debitAccountCode: t.Optional(t.String()),
        creditAccountCode: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/finance/adjustments/:id/approve",
    async ({ params, body, requireAuth, set }) => {
      const { userId } = requireAuth();
      try {
        const adjustment = await financialAdjustmentService.approve(params.id, userId, body?.notes);
        return { success: true, data: { adjustment } };
      } catch (e) {
        set.status = 400;
        return { success: false, error: e instanceof Error ? e.message : "APPROVE_ERROR", code: "VALIDATION_ERROR" };
      }
    },
    { body: t.Optional(t.Object({ notes: t.Optional(t.String()) })) },
  )
  .post(
    "/finance/adjustments/:id/reject",
    async ({ params, body, requireAuth, set }) => {
      const { userId } = requireAuth();
      try {
        const adjustment = await financialAdjustmentService.reject(params.id, userId, body.reason);
        return { success: true, data: { adjustment } };
      } catch (e) {
        set.status = 400;
        return { success: false, error: e instanceof Error ? e.message : "REJECT_ERROR", code: "VALIDATION_ERROR" };
      }
    },
    { body: t.Object({ reason: t.String({ minLength: 3 }) }) },
  )
  .post("/finance/adjustments/:id/execute", async ({ params, requireAuth, set }) => {
    const { userId } = requireAuth();
    try {
      const adjustment = await financialAdjustmentService.execute(params.id, userId);
      return { success: true, data: { adjustment } };
    } catch (e) {
      set.status = 400;
      return { success: false, error: e instanceof Error ? e.message : "EXECUTE_ERROR", code: "VALIDATION_ERROR" };
    }
  })
  // ===== Historical Ledger Backfill =====
  .post(
    "/finance/backfill/run",
    async ({ body, requireAuth }) => {
      const { userId } = requireAuth();
      const types = Array.isArray(body?.types) ? (body!.types as BackfillType[]) : undefined;
      const run = await ledgerBackfillService.run({ types, limit: body?.limit, startedBy: userId });
      return { success: true, data: { run } };
    },
    {
      body: t.Optional(
        t.Object({ types: t.Optional(t.Array(t.String())), limit: t.Optional(t.Number({ minimum: 1 })) }),
      ),
    },
  )
  .get("/finance/backfill/history", async () => {
    const runs = await ledgerBackfillService.history(50);
    return { success: true, data: { runs } };
  })
  .get("/finance/backfill/issues", async ({ query }) => {
    const runId = typeof query.runId === "string" ? query.runId : undefined;
    const issues = await ledgerBackfillService.listIssues(runId, 200);
    return { success: true, data: { issues } };
  })
  // ===== H-Coin Expiry =====
  .get("/hcoins/expiry/report", async () => {
    const data = await hcoinExpiryService.report(50);
    return { success: true, data };
  })
  .put(
    "/hcoins/expiry/config",
    async ({ body }) => {
      const config = await hcoinExpiryService.updateConfig({ enabled: body.enabled, expiryDays: body.expiryDays });
      return { success: true, data: { config } };
    },
    { body: t.Object({ enabled: t.Optional(t.Boolean()), expiryDays: t.Optional(t.Number({ minimum: 1 })) }) },
  )
  .post(
    "/hcoins/expiry/run",
    async ({ body, requireAuth, set }) => {
      const { userId } = requireAuth();
      try {
        const result = await hcoinExpiryService.run({ startedBy: userId, dryRun: body?.dryRun });
        return { success: true, data: result };
      } catch (e) {
        set.status = 400;
        return { success: false, error: e instanceof Error ? e.message : "EXPIRY_ERROR", code: "VALIDATION_ERROR" };
      }
    },
    { body: t.Optional(t.Object({ dryRun: t.Optional(t.Boolean()) })) },
  )
  .get("/finance/reconciliation", async () => {
    const [runs, metrics] = await Promise.all([
      paymentReconciliationService.listRuns(30),
      paymentReconciliationService.metricsSummary(),
    ]);
    return { success: true, data: { runs, metrics } };
  })
  .get("/finance/reconciliation/issues", async ({ query }) => {
    const issues = await paymentReconciliationService.listIssues(
      typeof query.reconciliationId === "string" ? query.reconciliationId : undefined,
      100,
    );
    return { success: true, data: { issues } };
  })
  .post("/finance/reconciliation/run", async ({ requireAuth }) => {
    requireAuth();
    const result = await paymentReconciliationService.runDailyReconciliation();
    return { success: true, data: result };
  })
  .post("/finance/reconciliation/gateway/run", async ({ requireAuth }) => {
    requireAuth();
    const result = await gatewayReconciliationService.runGatewayReconciliation();
    return { success: true, data: result };
  })
  .get("/finance/reconciliation/gateway", async () => {
    const runs = await gatewayReconciliationService.listRuns(30);
    return { success: true, data: { runs } };
  })
  .get("/finance/reconciliation/gateway/issues", async ({ query }) => {
    const issues = await gatewayReconciliationService.listIssues(
      typeof query.runId === "string" ? query.runId : undefined,
      100,
    );
    return { success: true, data: { issues } };
  })
  .get("/finance/settlements", async () => {
    const batches = await settlementService.listBatches(50);
    return { success: true, data: { batches } };
  })
  .get("/finance/settlements/:id", async ({ params }) => {
    const batch = await settlementService.getBatchDetail(params.id);
    if (!batch) return { success: false, error: "Not found", code: "NOT_FOUND" };
    return { success: true, data: { batch } };
  })
  .get("/finance/settlements/:id/export", async ({ params, set }) => {
    const csv = await settlementService.exportBatchCsv(params.id);
    set.headers["Content-Type"] = "text/csv";
    set.headers["Content-Disposition"] = `attachment; filename=settlement-${params.id}.csv`;
    return csv;
  })
  .get("/finance/payouts", async ({ query }) => {
    const q = query as Record<string, string>;
    const filters = {
      providerId: q.providerId,
      status: q.status as import("@prisma/client").WithdrawalStatus | undefined,
      startDate: q.startDate ? new Date(q.startDate) : undefined,
      endDate: q.endDate ? new Date(q.endDate) : undefined,
      minAmount: q.minAmount ? Number(q.minAmount) : undefined,
      maxAmount: q.maxAmount ? Number(q.maxAmount) : undefined,
    };
    const [payouts, queue, batches, dashboard] = await Promise.all([
      prisma.withdrawal.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { provider: { select: { id: true, businessName: true } }, payoutAttempts: true },
      }),
      payoutOperationsService.listQueue(filters, 50),
      payoutOperationsService.listBatches(20),
      payoutOperationsService.dashboardMetrics(),
    ]);
    return { success: true, data: { payouts, queue, batches, dashboard } };
  })
  .post("/finance/payouts/batch", async ({ body, requireAuth, request, set }) => {
    const auth = requireAuth();
    const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
    const ids = body?.withdrawalIds;
    if (!Array.isArray(ids) || ids.length === 0) {
      set.status = 400;
      return { success: false, error: "withdrawalIds required", code: "VALIDATION_ERROR" };
    }
    try {
      const batch = await payoutOperationsService.createBatch(ids, auth.userId, ip ?? undefined);
      return { success: true, data: { batch } };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Batch creation failed", code: "BATCH_CREATE_FAILED" };
    }
  }, { body: t.Object({ withdrawalIds: t.Array(t.String()) }) })
  .post("/finance/payouts/batch/:id/submit", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const batch = await payoutOperationsService.submitBatchForReview(params.id, auth.userId);
    return { success: true, data: { batch } };
  })
  .post("/finance/payouts/batch/:id/approve", async ({ params, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const batch = await payoutOperationsService.approveBatch(params.id, auth.userId, ip ?? undefined);
      return { success: true, data: { batch } };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Approve failed", code: "BATCH_APPROVE_FAILED" };
    }
  })
  .post("/finance/payouts/batch/:id/reject", async ({ params, body, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const batch = await payoutOperationsService.rejectBatch(params.id, auth.userId, body.reason, ip ?? undefined);
      return { success: true, data: { batch } };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Reject failed", code: "BATCH_REJECT_FAILED" };
    }
  }, { body: t.Object({ reason: t.String({ minLength: 3 }) }) })
  .post("/finance/payouts/batch/:id/process", async ({ params, requireAuth, request, set }) => {
    try {
      const auth = requireAuth();
      const ip = request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined;
      const result = await payoutOperationsService.processBatch(params.id, auth.userId, ip ?? undefined);
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Process failed", code: "BATCH_PROCESS_FAILED" };
    }
  })
  .get("/finance/payouts/batch/:id", async ({ params, set }) => {
    const batch = await payoutOperationsService.getBatchDetail(params.id);
    if (!batch) {
      set.status = 404;
      return { success: false, error: "Batch not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { batch } };
  })
  .post("/finance/payouts/:id/retry", async ({ params, requireAuth, set }) => {
    try {
      const auth = requireAuth();
      const result = await payoutOperationsService.retryPayout(params.id, auth.userId);
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Retry failed", code: "PAYOUT_RETRY_FAILED" };
    }
  })
  .get("/finance/fraud-cases", async () => {
    const cases = await financialRiskService.listOpenCases(50);
    return { success: true, data: { cases } };
  })
  .get("/finance/migrations", async () => {
    const [latest, runs] = await Promise.all([
      migrationVerificationService.getLatestReport(),
      migrationVerificationService.listRuns(20),
    ]);
    return { success: true, data: { latest, runs } };
  })
  .post("/finance/migrations/verify", async ({ requireAuth }) => {
    requireAuth();
    const result = await migrationVerificationService.runVerification();
    return { success: true, data: result };
  })
  .get("/finance/chargebacks", async () => {
    const [cases, analytics] = await Promise.all([
      chargebackWorkflowService.listCases(100),
      chargebackWorkflowService.analytics(),
    ]);
    return { success: true, data: { chargebacks: cases, analytics } };
  })
  .get("/finance/chargebacks/:id", async ({ params }) => {
    const detail = await chargebackWorkflowService.getDetail(params.id);
    if (!detail) return { success: false, error: "Not found", code: "NOT_FOUND" };
    return { success: true, data: { chargeback: detail } };
  })
  .post("/finance/chargebacks/:id/assign", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const cb = await chargebackWorkflowService.assign(params.id, auth.userId);
    return { success: true, data: { chargeback: cb } };
  })
  .post("/finance/chargebacks/:id/respond", async ({ params, body, requireAuth }) => {
    const auth = requireAuth();
    const cb = await chargebackWorkflowService.submitResponse(params.id, auth.userId, body.responseText);
    return { success: true, data: { chargeback: cb } };
  }, { body: t.Object({ responseText: t.String({ minLength: 1 }) }) })
  .post("/finance/chargebacks/:id/close", async ({ params, body, requireAuth }) => {
    const auth = requireAuth();
    const cb = await chargebackWorkflowService.closeCase(params.id, auth.userId, body.outcome);
    return { success: true, data: { chargeback: cb } };
  }, { body: t.Object({ outcome: t.Optional(t.String()) }) })
  .post("/finance/chargebacks/:id/request-evidence", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const cb = await chargebackWorkflowService.requestEvidence(params.id, auth.userId);
    return { success: true, data: { chargeback: cb } };
  })
  .post("/finance/chargebacks/:id/resolve", async ({ params, body, requireAuth, set }) => {
    try {
      const auth = requireAuth();
      const cb = await chargebackWorkflowService.resolveCase(params.id, auth.userId, body.outcome, body.notes);
      return { success: true, data: { chargeback: cb } };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Resolve failed", code: "CHARGEBACK_RESOLVE_FAILED" };
    }
  }, { body: t.Object({ outcome: t.Union([t.Literal("WON"), t.Literal("LOST")]), notes: t.Optional(t.String()) }) })
  .get("/finance/chargebacks/:id/evidence-certificate", async ({ params, requireAuth, set }) => {
    requireAuth();
    try {
      const pack = await chargebackEvidencePdfService.generateLegalPack(params.id);
      set.headers["Content-Type"] = "application/pdf";
      set.headers["Content-Disposition"] = `attachment; filename="${pack.fileName}"`;
      return new Response(pack.buffer);
    } catch (err) {
      set.status = 404;
      return {
        success: false,
        error: err instanceof Error ? err.message : "Could not generate evidence pack",
        code: "NOT_FOUND",
      };
    }
  })
  .get("/finance/chargebacks/:id/evidence-package", async ({ params, set }) => {
    try {
      const pkg = await chargebackWorkflowService.buildEvidencePackage(params.id);
      return { success: true, data: { package: pkg } };
    } catch (err) {
      set.status = 404;
      return { success: false, error: err instanceof Error ? err.message : "Not found", code: "NOT_FOUND" };
    }
  })
  .post("/finance/chargebacks/sla-check", async ({ requireAuth }) => {
    requireAuth();
    const result = await chargebackWorkflowService.checkSlaBreaches();
    return { success: true, data: result };
  })
  .post("/finance/chargebacks/:id/evidence", async ({ params, body, requireAuth }) => {
    const auth = requireAuth();
    const buffer = Buffer.from(body.fileBase64, "base64");
    const evidence = await chargebackWorkflowService.uploadEvidence(
      params.id,
      auth.userId,
      buffer,
      body.fileName,
      body.description,
    );
    return { success: true, data: { evidence } };
  }, {
    body: t.Object({
      fileBase64: t.String({ minLength: 1 }),
      fileName: t.String({ minLength: 1 }),
      description: t.Optional(t.String()),
    }),
  })
  .post("/finance/chargebacks/evidence/:evidenceId/download-token", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const tokenInfo = await chargebackEvidenceAccessService.createDownloadToken(params.evidenceId, auth.userId);
    return { success: true, data: tokenInfo };
  })
  .get("/finance/chargebacks/evidence/download/:token", async ({ params, requireAuth, set }) => {
    const auth = requireAuth();
    try {
      const file = await chargebackEvidenceAccessService.consumeDownloadToken(params.token, auth.userId);
      set.headers["Content-Type"] = file.mimeType;
      set.headers["Content-Disposition"] = `attachment; filename="${file.fileName}"`;
      if (file.buffer) return new Response(file.buffer);
      return new Response(fs.readFileSync(file.filePath));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Access denied";
      if (msg.startsWith("FORBIDDEN:")) {
        set.status = 403;
        return { success: false, error: msg.replace("FORBIDDEN:", ""), code: "FORBIDDEN" };
      }
      set.status = 404;
      return { success: false, error: msg.replace("NOT_FOUND:", ""), code: "NOT_FOUND" };
    }
  })
  .get("/finance/chargebacks/:id/export", async ({ params, set }) => {
    const text = await chargebackWorkflowService.exportCase(params.id);
    set.headers["Content-Type"] = "text/plain";
    set.headers["Content-Disposition"] = `attachment; filename=chargeback-${params.id}.txt`;
    return text;
  })
  .get("/finance/settlement-sync", async () => {
    const [runs, metrics, discrepancies] = await Promise.all([
      settlementSyncService.listRuns(20),
      settlementSyncService.metricsSummary(),
      settlementSyncService.listDiscrepancies(undefined, true),
    ]);
    return { success: true, data: { runs, metrics, discrepancies } };
  })
  .post("/finance/settlement-sync/run", async ({ requireAuth }) => {
    requireAuth();
    const result = await settlementSyncService.runSync();
    return { success: true, data: result };
  })
  .post("/finance/settlement-sync/discrepancies/:id/resolve", async ({ params, body, requireAuth, set }) => {
    try {
      const auth = requireAuth();
      const row = await settlementResolutionService.approveResolution(params.id, auth.userId, body.notes);
      return { success: true, data: { discrepancy: row } };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Resolve failed", code: "SETTLEMENT_RESOLVE_FAILED" };
    }
  }, { body: t.Object({ notes: t.Optional(t.String()) }) })
  .post("/finance/settlement-sync/discrepancies/:id/assign", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const row = await settlementResolutionService.assign(params.id, auth.userId);
    return { success: true, data: { discrepancy: row } };
  })
  .post("/finance/settlement-sync/discrepancies/:id/investigate", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const row = await settlementResolutionService.investigate(params.id, auth.userId);
    return { success: true, data: { discrepancy: row } };
  })
  .post("/finance/settlement-sync/discrepancies/:id/escalate", async ({ params, body, requireAuth, set }) => {
    try {
      const auth = requireAuth();
      const row = await settlementResolutionService.escalate(params.id, auth.userId, body.reason);
      return { success: true, data: { discrepancy: row } };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Escalate failed", code: "SETTLEMENT_ESCALATE_FAILED" };
    }
  }, { body: t.Object({ reason: t.String({ minLength: 3 }) }) })
  .post("/finance/settlement-sync/discrepancies/:id/notes", async ({ params, body, requireAuth }) => {
    const auth = requireAuth();
    const note = await settlementResolutionService.addNote(params.id, auth.userId, body.body);
    return { success: true, data: { note } };
  }, { body: t.Object({ body: t.String({ minLength: 1 }) }) })
  .get("/finance/settlement-sync/health", async () => {
    const health = await settlementResolutionService.healthScore();
    return { success: true, data: health };
  })
  .get("/finance/reports", async ({ query }) => {
    const period = (query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly" | "custom") ?? "monthly";
    const customDays = query.days ? Number(query.days) : undefined;
    const [report, health] = await Promise.all([
      executiveReportingService.buildExecutiveReport(period, customDays),
      executiveReportingService.computeFinanceHealthScore(period),
    ]);
    return { success: true, data: { report, health } };
  })
  .get("/finance/reports/export", async ({ query, set }) => {
    const period = (query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly") ?? "monthly";
    const format = (query.format as string) ?? "csv";
    if (format === "xlsx") {
      const buf = await executiveReportingService.exportXlsx(period);
      set.headers["Content-Type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["Content-Disposition"] = `attachment; filename=finance-report-${period}.xlsx`;
      return buf;
    }
    if (format === "pdf") {
      const buf = await executiveReportingService.exportPdf(period);
      set.headers["Content-Type"] = "application/pdf";
      set.headers["Content-Disposition"] = `attachment; filename=HOMIGO-Executive-Report-${period}.pdf`;
      return buf;
    }
    const csv = await executiveReportingService.exportCsv(period);
    set.headers["Content-Type"] = "text/csv";
    set.headers["Content-Disposition"] = `attachment; filename=finance-report-${period}.csv`;
    return csv;
  })
  .get("/finance/integrity", async () => {
    const [latest, runs, alerts, dashboard] = await Promise.all([
      financialIntegrityService.getLatestReport(),
      financialIntegrityService.listRuns(20),
      financeAlertService.listOpen(30),
      financialIntegrityService.getIntegrityDashboard(),
    ]);
    return { success: true, data: { latest, runs, alerts, dashboard } };
  })
  .post("/finance/integrity/run", async ({ requireAuth }) => {
    requireAuth();
    const result = await financialIntegrityService.runChecks();
    return { success: true, data: result };
  })
  .get("/finance/integrity/validate", async () => {
    const result = await financialIntegrityService.validate();
    return { success: true, data: result };
  })
  .get("/finance/refunds", async () => {
    const [queue, analytics] = await Promise.all([
      refundWorkflowService.listQueue(undefined, 100),
      refundWorkflowService.analytics(),
    ]);
    return { success: true, data: { refunds: queue, analytics, reasonCodes: refundWorkflowService.reasonCodes } };
  })
  .post("/finance/refunds/request", async ({ body, requireAuth, set }) => {
    const auth = requireAuth();
    if (!body?.paymentId || !body?.amount || !body?.reason) {
      set.status = 400;
      return { success: false, error: "paymentId, amount, reason required", code: "VALIDATION_ERROR" };
    }
    const req = await refundWorkflowService.createRequest({
      paymentId: body.paymentId,
      amount: body.amount,
      reason: body.reason,
      reasonCode: body.reasonCode,
      requestedBy: auth.userId,
    });
    return { success: true, data: { refundRequest: req } };
  }, { body: t.Object({ paymentId: t.String(), amount: t.Number(), reason: t.String(), reasonCode: t.Optional(t.String()) }) })
  .post("/finance/refunds/:id/approve", async ({ params, body, requireAuth, set }) => {
    try {
      const auth = requireAuth();
      const result = await refundWorkflowService.approve(params.id, auth.userId, body?.notes);
      return { success: true, data: result };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "Approve failed", code: "REFUND_APPROVE_FAILED" };
    }
  }, { body: t.Optional(t.Object({ notes: t.Optional(t.String()) })) })
  .post("/finance/refunds/:id/reject", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    if (!body?.notes?.trim()) {
      set.status = 400;
      return { success: false, error: "notes required", code: "VALIDATION_ERROR" };
    }
    const result = await refundWorkflowService.reject(params.id, auth.userId, body.notes);
    return { success: true, data: { refundRequest: result } };
  }, { body: t.Object({ notes: t.String() }) })
  .get("/finance/risk", async () => {
    const review = await financialRiskService.listReviewQueue(50);
    return { success: true, data: review };
  })
  .post("/finance/risk/cases/:id/escalate", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const c = await financialRiskService.escalateCase(params.id, auth.userId);
    return { success: true, data: { fraudCase: c } };
  })
  .post("/finance/risk/holds/:userId/lift", async ({ params, requireAuth }) => {
    const auth = requireAuth();
    const hold = await financialRiskService.liftHold(params.userId, auth.userId);
    return { success: true, data: { hold } };
  })
  .get("/finance/analytics/unit-economics", async ({ query }) => {
    const days = Number(query.days ?? 30);
    const data = await financeAnalyticsService.getUnitEconomics(days);
    return { success: true, data };
  })
  // Canonical, single-source-of-truth GMV (payment-based) + booking reconciliation.
  .get("/finance/gmv", async ({ query }) => {
    const days = Number(query.days ?? 30);
    const data = await financeIntelligenceService.getCanonicalGmv(days);
    return { success: true, data };
  })
  // CFO intelligence: gross margin, EBITDA, burn rate, cash runway, profit forecast.
  .get("/finance/intelligence", async ({ query }) => {
    const days = Number(query.days ?? 30);
    const data = await financeIntelligenceService.getFinanceIntelligence(days);
    return { success: true, data };
  })
  .get("/finance/config", async ({ query }) => {
    const data = await financeConfigService.getAll();
    return { success: true, data };
  })
  .get("/finance/config/history", async ({ query }) => {
    const key = typeof query.key === "string" ? query.key : undefined;
    const limit = query.limit ? Number(query.limit) : 50;
    const history = await financeConfigService.getHistory({ key, limit });
    return { success: true, data: { history } };
  })
  .patch("/finance/config", async ({ body, adminContext, request, set }) => {
    const admin = adminContext;
    if (!admin) {
      set.status = 403;
      return { success: false, error: "Forbidden", code: "FORBIDDEN" };
    }
    const payload = body as { key?: string; value?: number; reason?: string };
    const key = String(payload.key ?? "");
    const value = Number(payload.value);
    const reason = typeof payload.reason === "string" ? payload.reason : undefined;
    try {
      const config = await financeConfigService.update(
        key,
        value,
        { adminId: admin.adminId, userId: admin.userId },
        {
          reason,
          ipAddress: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip") ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        },
      );
      return { success: true, data: { config } };
    } catch (err) {
      const code = err instanceof Error ? err.message : "UPDATE_FAILED";
      set.status = 400;
      return { success: false, error: code, code };
    }
  })
  .post("/finance/validation/run", async ({ requireAuth }) => {
    requireAuth();
    const result = await financeValidationService.runFullValidation();
    return { success: true, data: result };
  })
  // ── Enterprise OS V6 intelligence APIs (additive) ──
  .get("/cx/intelligence", async ({ query }) => {
    const days = Number(query.days ?? 30);
    const data = await customerIntelligenceService.getIntelligence(days);
    return { success: true, data };
  })
  .get("/growth/intelligence", async ({ query }) => {
    const days = Number(query.days ?? 30);
    const data = await growthIntelligenceService.getIntelligence(days);
    return { success: true, data };
  })
  .get("/risk/intelligence", async ({ query }) => {
    const days = Number(query.days ?? 30);
    const data = await riskIntelligenceService.getIntelligence(days);
    return { success: true, data };
  })
  .get("/platform/intelligence", async () => {
    const data = await platformIntelligenceService.getIntelligence();
    return { success: true, data };
  })
  .patch("/platform/flags", async ({ body, adminContext, set }) => {
    const admin = adminContext;
    if (!admin) {
      set.status = 403;
      return { success: false, error: "Forbidden", code: "FORBIDDEN" };
    }
    const payload = body as {
      key?: string;
      description?: string;
      enabled?: boolean;
      rolloutPct?: number;
      environment?: string;
      isKillSwitch?: boolean;
      reason?: string;
    };
    try {
      const flag = await platformIntelligenceService.upsertFlag(
        {
          key: String(payload.key ?? ""),
          description: typeof payload.description === "string" ? payload.description : undefined,
          enabled: Boolean(payload.enabled),
          rolloutPct: Number(payload.rolloutPct ?? 100),
          environment: typeof payload.environment === "string" ? payload.environment : "production",
          isKillSwitch: Boolean(payload.isKillSwitch),
        },
        { adminId: admin.adminId, userId: admin.userId },
        typeof payload.reason === "string" ? payload.reason : undefined,
      );
      return { success: true, data: { flag } };
    } catch (err) {
      set.status = 400;
      return { success: false, error: err instanceof Error ? err.message : "UPDATE_FAILED" };
    }
  })
  .get("/recovery/status", async () => {
    const data = await recoveryIntelligenceService.getStatus();
    return { success: true, data };
  })
  .post("/recovery/simulate", async ({ body }) => {
    const payload = body as { target?: string };
    const target = (payload.target ?? "database") as "database" | "redis" | "queue" | "api" | "region";
    const data = recoveryIntelligenceService.simulate(target);
    return { success: true, data };
  })
  .get("/account-deletions", async () => {
    const { AuditLogService } = await import("../services/audit-log.service");
    const logs = await AuditLogService.listByAction("ACCOUNT_DELETION_SCHEDULED", 100);
    return { success: true, data: { deletions: logs } };
  })
  // ------------------------------------------------------------ services CRUD
  .get("/services", async ({ query }) => {
    const data = await catalogService.adminList(
      sanitizeQueryStrings(query as Record<string, string>),
    );
    return { success: true, data };
  })
  .post(
    "/services",
    async ({ body, set }) => {
      const result = await catalogService.create(body);
      if ("error" in result) {
        set.status = 409;
        return { success: false, error: "A service with this name already exists", code: result.error };
      }
      return { success: true, message: "Service created", data: result };
    },
    { body: createServiceBody },
  )
  .put(
    "/services/:id",
    async ({ params, body, set }) => {
      const result = await catalogService.update(params.id, body);
      if ("error" in result) {
        set.status = result.error === "NOT_FOUND" ? 404 : 409;
        return {
          success: false,
          error: result.error === "NOT_FOUND" ? "Service not found" : "A service with this name already exists",
          code: result.error,
        };
      }
      return { success: true, message: "Service updated", data: result };
    },
    { body: updateServiceBody },
  )
  .patch(
    "/services/:id/status",
    async ({ params, body, set }) => {
      const result = await catalogService.setActive(params.id, body.isActive);
      if ("error" in result) {
        set.status = 404;
        return { success: false, error: "Service not found", code: "NOT_FOUND" };
      }
      return {
        success: true,
        message: body.isActive ? "Service activated" : "Service deactivated",
        data: result,
      };
    },
    { body: t.Object({ isActive: t.Boolean() }) },
  )
  .delete("/services/:id", async ({ params, set }) => {
    const result = await catalogService.remove(params.id);
    if ("error" in result) {
      if (result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Service not found", code: "NOT_FOUND" };
      }
      set.status = 409;
      return {
        success: false,
        error: `Cannot delete: service has ${result.bookings} booking(s). Deactivate it instead.`,
        code: "HAS_BOOKINGS",
      };
    }
    return { success: true, message: "Service deleted" };
  })
  // ===== Subscriptions =====
  .get("/subscriptions/plans", async ({ query }) => {
    const data = await subscriptionService.adminListPlans(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data };
  })
  .post(
    "/subscriptions/plans",
    async ({ body }) => {
      const plan = await subscriptionService.adminCreatePlan(body);
      return { success: true, message: "Plan created", data: { plan } };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2, maxLength: 120 }),
        interval: t.Union([t.Literal("MONTHLY"), t.Literal("QUARTERLY"), t.Literal("YEARLY")]),
        price: t.Number({ minimum: 0 }),
        tier: t.Optional(t.String({ maxLength: 40 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        benefits: t.Optional(t.Array(benefitSchema)),
        sortOrder: t.Optional(t.Number()),
      }),
    },
  )
  .put(
    "/subscriptions/plans/:id",
    async ({ params, body, set }) => {
      const plan = await subscriptionService.adminUpdatePlan(params.id, body);
      if (!plan) {
        set.status = 404;
        return { success: false, error: "Plan not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Plan updated", data: { plan } };
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 2, maxLength: 120 })),
        price: t.Optional(t.Number({ minimum: 0 })),
        tier: t.Optional(t.String({ maxLength: 40 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        isActive: t.Optional(t.Boolean()),
        benefits: t.Optional(t.Array(benefitSchema)),
      }),
    },
  )
  .get("/subscriptions/subscribers", async ({ query }) => {
    const data = await subscriptionService.adminSubscribers(
      sanitizeQueryStrings(query as Record<string, string>),
    );
    return { success: true, data };
  })
  .get("/subscriptions/revenue", async () => {
    const data = await subscriptionService.adminRevenue();
    return { success: true, data };
  })
  .get("/membership/analytics", async ({ query }) => {
    const period = (query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly") ?? "monthly";
    const data = await membershipAnalyticsService.dashboard(period);
    return { success: true, data };
  })
  .get("/membership/analytics/trends", async ({ query }) => {
    const period = (query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly") ?? "monthly";
    const data = await membershipAnalyticsService.trends(period);
    return { success: true, data };
  })
  .get("/membership/analytics/export", async ({ query, set }) => {
    const period = (query.period as "daily" | "weekly" | "monthly" | "quarterly" | "yearly") ?? "monthly";
    const format = (query.format as string) ?? "csv";
    const csv = await membershipAnalyticsService.exportCsv(period);
    if (format === "csv") {
      set.headers["content-type"] = "text/csv; charset=utf-8";
      set.headers["content-disposition"] = `attachment; filename="membership-analytics-${period}.csv"`;
      return csv;
    }
    set.headers["content-type"] = "text/csv; charset=utf-8";
    set.headers["content-disposition"] = `attachment; filename="membership-analytics-${period}.csv"`;
    return csv;
  })
  .get("/membership/insights", async () => {
    const { membershipInsightsService } = await import("../services/membership-insights.service");
    const data = await membershipInsightsService.adminInsights();
    return { success: true, data };
  })
  .get("/membership/cashback/dashboard", async () => {
    const data = await cashbackService.adminDashboard();
    return { success: true, data };
  })
  .get("/membership/cashback/liability", async () => {
    const data = await cashbackService.adminLiability();
    return { success: true, data };
  })
  .get("/membership/cashback/reports", async ({ query }) => {
    const data = await cashbackService.adminReports(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data };
  })
  .get("/membership/queue/analytics", async () => {
    const [queue, priority, assignmentQueue, dispatch] = await Promise.all([
      bookingPriorityService.adminQueueAnalytics(),
      bookingPriorityService.adminPriorityAnalytics(),
      bookingPriorityService.getAssignmentQueue(20),
      assignmentEngine.dispatchMetrics(),
    ]);
    return { success: true, data: { queue, priority, assignmentQueue, dispatch } };
  })
  .get("/membership/assignment/metrics", async () => {
    const data = await assignmentEngine.dispatchMetrics();
    return { success: true, data };
  })
  .get("/membership/matching/analytics", async () => {
    const premiumMatched = await prisma.booking.count({ where: { premiumMatched: true } });
    const total = await prisma.booking.count();
    return {
      success: true,
      data: {
        premiumMatchedBookings: premiumMatched,
        totalBookings: total,
        premiumMatchRatePct: total > 0 ? Math.round((premiumMatched / total) * 1000) / 10 : 0,
      },
    };
  })
  .get("/campaigns", async ({ query }) => {
    const data = await campaignService.adminList(query as Record<string, string>);
    return { success: true, data };
  })
  .post(
    "/campaigns",
    async ({ body }) => {
      const campaign = await campaignService.adminCreate({
        ...body,
        type: body.type as "COUPON" | "PROMOTION" | "BUNDLE" | "OFFER",
        status: body.status as "DRAFT" | "ACTIVE" | "DISABLED" | "EXPIRED" | undefined,
      });
      return { success: true, message: "Campaign created", data: { campaign } };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 3, maxLength: 40 }),
        name: t.String({ minLength: 2, maxLength: 120 }),
        description: t.Optional(t.String({ maxLength: 500 })),
        type: t.Union([
          t.Literal("COUPON"),
          t.Literal("PROMOTION"),
          t.Literal("BUNDLE"),
          t.Literal("OFFER"),
        ]),
        premiumOnly: t.Optional(t.Boolean()),
        discountPct: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        discountAmount: t.Optional(t.Number({ minimum: 0 })),
        minOrderAmount: t.Optional(t.Number({ minimum: 0 })),
        maxRedemptions: t.Optional(t.Number({ minimum: 1 })),
        startsAt: t.Optional(t.String()),
        expiresAt: t.Optional(t.String()),
        metadata: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal("DRAFT"),
            t.Literal("ACTIVE"),
            t.Literal("DISABLED"),
            t.Literal("EXPIRED"),
          ]),
        ),
      }),
    },
  )
  .put(
    "/campaigns/:id",
    async ({ params, body, set }) => {
      try {
        const campaign = await campaignService.adminUpdate(params.id, {
          ...body,
          status: body.status as "DRAFT" | "ACTIVE" | "DISABLED" | "EXPIRED" | undefined,
        });
        return { success: true, message: "Campaign updated", data: { campaign } };
      } catch {
        set.status = 404;
        return { success: false, error: "Campaign not found", code: "NOT_FOUND" };
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 2, maxLength: 120 })),
        description: t.Optional(t.String({ maxLength: 500 })),
        status: t.Optional(
          t.Union([
            t.Literal("DRAFT"),
            t.Literal("ACTIVE"),
            t.Literal("DISABLED"),
            t.Literal("EXPIRED"),
          ]),
        ),
        premiumOnly: t.Optional(t.Boolean()),
        discountPct: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        discountAmount: t.Optional(t.Number({ minimum: 0 })),
        minOrderAmount: t.Optional(t.Number({ minimum: 0 })),
        maxRedemptions: t.Optional(t.Number({ minimum: 1 })),
        startsAt: t.Optional(t.String()),
        expiresAt: t.Optional(t.String()),
        metadata: t.Optional(t.String()),
      }),
    },
  )
  .get("/campaigns/analytics", async ({ query }) => {
    const data = await campaignService.adminAnalytics(query.campaignId);
    return { success: true, data };
  })
  .get("/membership/coupons", async ({ query }) => {
    const data = await membershipCouponService.adminList(query as Record<string, string>);
    return { success: true, data };
  })
  .post(
    "/membership/coupons",
    async ({ body }) => {
      const coupon = await membershipCouponService.adminCreate(body);
      return { success: true, message: "Coupon created", data: { coupon } };
    },
    {
      body: t.Object({
        code: t.String({ minLength: 3, maxLength: 40 }),
        name: t.String({ minLength: 2, maxLength: 120 }),
        discountPct: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        discountAmount: t.Optional(t.Number({ minimum: 0 })),
        planRestricted: t.Optional(t.Array(t.String())),
        maxRedemptions: t.Optional(t.Number({ minimum: 1 })),
        perUserLimit: t.Optional(t.Number({ minimum: 1 })),
        geography: t.Optional(t.String()),
        serviceCategory: t.Optional(t.String()),
        campaignId: t.Optional(t.String()),
        startsAt: t.Optional(t.String()),
        expiresAt: t.Optional(t.String()),
        status: t.Optional(
          t.Union([
            t.Literal("DRAFT"),
            t.Literal("ACTIVE"),
            t.Literal("PAUSED"),
            t.Literal("ARCHIVED"),
          ]),
        ),
      }),
    },
  )
  .put(
    "/membership/coupons/:id",
    async ({ params, body, set }) => {
      try {
        const coupon = await membershipCouponService.adminUpdate(params.id, body);
        return { success: true, message: "Coupon updated", data: { coupon } };
      } catch {
        set.status = 404;
        return { success: false, error: "Coupon not found", code: "NOT_FOUND" };
      }
    },
    {
      body: t.Object({
        status: t.Optional(
          t.Union([
            t.Literal("DRAFT"),
            t.Literal("ACTIVE"),
            t.Literal("PAUSED"),
            t.Literal("ARCHIVED"),
          ]),
        ),
        name: t.Optional(t.String({ minLength: 2, maxLength: 120 })),
      }),
    },
  )
  .post(
    "/membership/coupons/bulk",
    async ({ body }) => {
      const codes = await membershipCouponService.adminBulkGenerate(body.prefix, body.count, {
        name: body.name,
        discountPct: body.discountPct,
        planRestricted: body.planRestricted,
        status: body.status as "ACTIVE" | undefined,
      });
      return { success: true, data: { codes, count: codes.length } };
    },
    {
      body: t.Object({
        prefix: t.String({ minLength: 2, maxLength: 20 }),
        count: t.Number({ minimum: 1, maximum: 500 }),
        name: t.String({ minLength: 2, maxLength: 120 }),
        discountPct: t.Optional(t.Number({ minimum: 0, maximum: 100 })),
        planRestricted: t.Optional(t.Array(t.String())),
        status: t.Optional(t.Literal("ACTIVE")),
      }),
    },
  )
  .get("/membership/coupons/analytics", async () => {
    const data = await membershipCouponService.analytics();
    return { success: true, data };
  })
  .get("/membership/coupons/export", async ({ set }) => {
    const csv = await membershipCouponService.exportCsv();
    set.headers["content-type"] = "text/csv; charset=utf-8";
    set.headers["content-disposition"] = 'attachment; filename="membership-coupons.csv"';
    return csv;
  })
  .get("/support/tickets", async ({ query }) => {
    const data = await supportTicketService.adminList(query as Record<string, string>);
    return { success: true, data };
  })
  .get("/support/tickets/:id", async ({ params, set }) => {
    const ticket = await supportTicketService.adminGet(params.id);
    if (!ticket) {
      set.status = 404;
      return { success: false, error: "Ticket not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { ticket } };
  })
  .get("/support/analytics", async () => {
    const data = await supportTicketService.adminAnalytics();
    return { success: true, data };
  })
  .post(
    "/support/tickets/:id/respond",
    async ({ requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      const ticket = await supportTicketService.adminRespond(
        params.id,
        userId,
        body.resolution,
        body.internal === true,
      );
      if (!ticket) {
        set.status = 404;
        return { success: false, error: "Ticket not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Response recorded", data: { ticket } };
    },
    {
      body: t.Object({
        resolution: t.String({ minLength: 1, maxLength: 5000 }),
        internal: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    "/support/tickets/:id/escalate",
    async ({ requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      const ticket = await supportTicketService.adminEscalate(params.id, userId, body.note);
      if (!ticket) {
        set.status = 404;
        return { success: false, error: "Ticket not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Ticket escalated", data: { ticket } };
    },
    { body: t.Object({ note: t.Optional(t.String({ maxLength: 2000 })) }) },
  )
  .post(
    "/support/tickets/:id/merge",
    async ({ requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      const result = await supportTicketService.adminMerge(params.id, body.duplicateId, userId);
      if (result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Ticket not found", code: "NOT_FOUND" };
      }
      if (result.error === "SAME_TICKET") {
        set.status = 400;
        return { success: false, error: "Cannot merge ticket with itself", code: "VALIDATION_ERROR" };
      }
      return { success: true, message: "Tickets merged", data: result };
    },
    { body: t.Object({ duplicateId: t.String() }) },
  )
  .post(
    "/support/tickets/:id/resolve",
    async ({ requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      const ticket = await supportTicketService.adminResolve(params.id, userId, body.resolution);
      if (!ticket) {
        set.status = 404;
        return { success: false, error: "Ticket not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Ticket resolved", data: { ticket } };
    },
    { body: t.Object({ resolution: t.String({ minLength: 1, maxLength: 5000 }) }) },
  )
  // ===== Referrals =====
  .get("/referrals/analytics", async () => {
    const data = await referralService.adminAnalytics();
    return { success: true, data };
  })
  // ===== Fraud Intelligence =====
  .get("/fraud/overview", async () => {
    const data = await fraudAdminService.overview();
    return { success: true, data };
  })
  .get("/fraud/high-risk-users", async () => {
    const data = await fraudAdminService.highRiskUsers(30);
    return { success: true, data: { users: data } };
  })
  .get("/fraud/review-queue", async ({ query }) => {
    const data = await fraudAdminService.reviewQueue(query as Record<string, string>);
    return { success: true, data };
  })
  .get("/fraud/alerts", async ({ query }) => {
    const data = await fraudAdminService.alerts(query as Record<string, string>);
    return { success: true, data };
  })
  .get("/fraud/analytics/monthly", async () => {
    const data = await fraudAdminService.monthlyReport();
    return { success: true, data };
  })
  .get("/fraud/decisions", async ({ query }) => {
    const data = await fraudAdminService.decisionLog(query as Record<string, string>);
    return { success: true, data };
  })
  .post(
    "/fraud/commissions/:id/approve",
    async ({ requireAuth, params, body }) => {
      const { userId } = requireAuth();
      const commission = await referralFraudService.approveCommission(params.id, userId, body?.note);
      return { success: true, message: "Commission approved", data: { commission } };
    },
    { body: t.Optional(t.Object({ note: t.Optional(t.String()) })) },
  )
  .post(
    "/fraud/commissions/:id/reject",
    async ({ requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      if (!body.reason) {
        set.status = 400;
        return { success: false, error: "Reason required", code: "VALIDATION_ERROR" };
      }
      const commission = await referralFraudService.rejectCommission(params.id, userId, body.reason);
      return { success: true, message: "Commission rejected", data: { commission } };
    },
    { body: t.Object({ reason: t.String({ minLength: 3 }) }) },
  )
  .post(
    "/fraud/commissions/:id/freeze",
    async ({ requireAuth, params, body }) => {
      const { userId } = requireAuth();
      const commission = await referralFraudService.freezeCommission(params.id, userId, body?.reason);
      return { success: true, message: "Commission frozen", data: { commission } };
    },
    { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
  )
  .post(
    "/fraud/commissions/:id/unfreeze",
    async ({ requireAuth, params }) => {
      const { userId } = requireAuth();
      const commission = await referralFraudService.unfreezeCommission(params.id, userId);
      return { success: true, message: "Commission moved to review", data: { commission } };
    },
  )
  .post(
    "/fraud/users/:id/blacklist",
    async ({ requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      if (!body.reason) {
        set.status = 400;
        return { success: false, error: "Reason required", code: "VALIDATION_ERROR" };
      }
      await referralFraudService.blacklistUser(params.id, userId, body.reason);
      return { success: true, message: "User blacklisted" };
    },
    { body: t.Object({ reason: t.String({ minLength: 3 }) }) },
  )
  // ===== Loyalty / H-Coins =====
  .get("/hcoins/analytics", async () => {
    const data = await hcoinService.adminAnalytics();
    return { success: true, data };
  })
  .get("/hcoins/rules", async () => {
    const rules = await hcoinService.adminRules();
    return { success: true, data: { rules } };
  })
  .put(
    "/hcoins/rules/:id",
    async ({ params, body, set }) => {
      const rule = await hcoinService.adminUpdateRule(params.id, body);
      if (!rule) {
        set.status = 404;
        return { success: false, error: "Rule not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Rule updated", data: { rule } };
    },
    { body: t.Object({ coins: t.Optional(t.Number({ minimum: 0 })), isActive: t.Optional(t.Boolean()) }) },
  )
  .post(
    "/hcoins/grant",
    async ({ body, set }) => {
      const ok = await hcoinService.adminGrantPromo(body.userId, body.coins, body.note);
      if (!ok) {
        set.status = 400;
        return { success: false, error: "Could not grant coins", code: "INVALID_INPUT" };
      }
      return { success: true, message: `Granted ${body.coins} H-Coins` };
    },
    { body: t.Object({ userId: t.String(), coins: t.Number({ minimum: 1 }), note: t.Optional(t.String({ maxLength: 200 })) }) },
  )
  // ===== P2P transfer audit =====
  .get("/transfers", async ({ query }) => {
    const data = await transferService.adminList(query as Record<string, string>);
    return { success: true, data };
  })
  // ===== Gift cards =====
  .get("/giftcards", async ({ query }) => {
    const data = await giftCardService.adminList(query as Record<string, string>);
    return { success: true, data };
  })
  // ===== Enterprise invoicing =====
  .get("/invoices", async ({ query }) => {
    const data = await invoiceReportService.adminInvoices(query as Record<string, string>);
    return { success: true, data };
  })
  .get("/invoices/export.csv", async ({ query, set }) => {
    const csv = await invoiceReportService.adminInvoicesCsv((query as Record<string, string>).search);
    set.headers["content-type"] = "text/csv; charset=utf-8";
    set.headers["content-disposition"] = `attachment; filename="homigo-invoices-${new Date().toISOString().slice(0, 10)}.csv"`;
    return csv;
  })
  .get("/revenue-report", async () => {
    const data = await invoiceReportService.adminRevenueReport();
    return { success: true, data };
  })
  // ===== Enterprise Observability =====
  .get("/observability/health", async () => {
    const data = await observabilityService.getHealthDashboard();
    return { success: true, data };
  })
  .get("/observability/email-health", async () => {
    const data = await observabilityService.getEmailHealth();
    return { success: true, data };
  })
  .get("/observability/alerts", async ({ query }) => {
    const q = sanitizeQueryStrings(query as Record<string, string>);
    const data = await observabilityService.listAlerts({
      limit: Number(q.limit) || 50,
      resolved: q.resolved === "true" ? true : q.resolved === "false" ? false : undefined,
    });
    return { success: true, data: { alerts: data } };
  })
  .post("/observability/alerts/:source/:id/resolve", async ({ params, set }) => {
    if (params.source !== "ops" && params.source !== "finance") {
      set.status = 400;
      return { success: false, error: "Invalid alert source", code: "VALIDATION_ERROR" };
    }
    await observabilityService.resolveAlert(params.source, params.id);
    return { success: true, message: "Alert resolved" };
  })
  .post("/observability/alerts/evaluate", async () => {
    const data = await observabilityService.runAlertEvaluation();
    return { success: true, data };
  })
  .get("/observability/logs", async ({ query }) => {
    const data = await logAggregationService.search(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data };
  })
  .get("/observability/logs/export.json", async ({ query }) => {
    const data = await logAggregationService.exportJson(sanitizeQueryStrings(query as Record<string, string>));
    return { success: true, data: { logs: data } };
  })
  .get("/observability/logs/export.csv", async ({ query, set }) => {
    const csv = await logAggregationService.exportCsv(sanitizeQueryStrings(query as Record<string, string>));
    set.headers["content-type"] = "text/csv; charset=utf-8";
    set.headers["content-disposition"] = `attachment; filename="homigo-logs-${new Date().toISOString().slice(0, 10)}.csv"`;
    return csv;
  })
  .get("/observability/archival/strategy", async () => {
    const data = dataArchivalService.getStrategy();
    return { success: true, data };
  })
  .post("/observability/validation/run", async () => {
    const data = await productionValidationService.runFullValidation();
    return { success: true, data };
  })
  // ===== P3 Scoped Admin RBAC =====
  .get("/rbac/me", async ({ adminContext }) => {
    const admin = adminContext!;
    const permissions = await rbacService.getPermissions(admin.adminId);
    return {
      success: true,
      data: {
        adminId: admin.adminId,
        userId: admin.userId,
        role: admin.role,
        permissions: Array.from(permissions),
      },
    };
  })
  .get("/rbac/roles", async () => {
    const roles = await rbacService.listRoles();
    return { success: true, data: { roles } };
  })
  .get("/rbac/admins", async () => {
    const admins = await rbacService.listAdminUsers();
    return { success: true, data: { admins } };
  })
  .post(
    "/rbac/grant-role",
    async ({ body, adminContext, set }) => {
      const admin = adminContext!;
      try {
        await rbacService.grantRole(admin, body.userId, body.roleId);
        return { success: true, message: "Role granted" };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Grant failed";
        set.status = message.includes("Permission denied") ? 403 : 400;
        return { success: false, error: message, code: "RBAC_ERROR" };
      }
    },
    { body: t.Object({ userId: t.String(), roleId: t.String() }) },
  )
  .post(
    "/users/:id/force-logout",
    async ({ params, body, adminContext, set, request }) => {
      const admin = adminContext!;
      try {
        await rbacService.enforcePermission(admin, "USERS", "FORCE_LOGOUT");
        await tokenRevocationService.forceLogoutUser(
          params.id,
          "ADMIN_FORCE_LOGOUT",
          admin.adminId,
          {
            ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim(),
            userAgent: request.headers.get("user-agent") || undefined,
          },
        );
        return { success: true, message: "User signed out from all devices" };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Force logout failed";
        set.status = message.includes("Permission denied") ? 403 : 400;
        return { success: false, error: message, code: "FORCE_LOGOUT_FAILED" };
      }
    },
    { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
  )
  .post(
    "/rbac/revoke-role",
    async ({ body, adminContext, set }) => {
      const admin = adminContext!;
      try {
        await rbacService.revokeRole(admin, body.adminUserId);
        return { success: true, message: "Role revoked" };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Revoke failed";
        set.status = message.includes("Permission denied") ? 403 : 400;
        return { success: false, error: message, code: "RBAC_ERROR" };
      }
    },
    { body: t.Object({ adminUserId: t.String() }) },
  )
  .get("/workforce/analytics", async ({ adminContext, set }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "ANALYTICS", "READ");
      const { partnerOsService } = await import("../services/partner-os.service");
      const data = await partnerOsService.getWorkforceAnalytics();
      return { success: true, data };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed";
      set.status = 403;
      return { success: false, error: message };
    }
  })
  .get("/providers/:id/intelligence", async ({ params, adminContext, set }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "ANALYTICS", "READ");
      const { partnerOsService } = await import("../services/partner-os.service");
      const data = await partnerOsService.getProviderIntelligence(params.id);
      return { success: true, data };
    } catch (err) {
      set.status = 403;
      return { success: false, error: err instanceof Error ? err.message : "Failed" };
    }
  })
  .get("/documents/pending", async ({ adminContext, set }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "USERS", "READ");
      const { documentUploadService } = await import("../services/document-upload.service");
      const documents = await documentUploadService.listAllPending();
      return { success: true, data: { documents } };
    } catch (err) {
      set.status = 403;
      return { success: false, error: err instanceof Error ? err.message : "Failed" };
    }
  })
  .put("/providers/:id/documents/:docId/verify", async ({ params, adminContext, set, body }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "USERS", "APPROVE");
      const { documentUploadService } = await import("../services/document-upload.service");
      const doc = await documentUploadService.verifyDocument(params.docId, admin.adminId, body?.notes, {
        expiryDate: body?.expiryDate ? new Date(body.expiryDate) : undefined,
        issuer: body?.issuer,
        issueDate: body?.issueDate ? new Date(body.issueDate) : undefined,
      });
      return { success: true, data: { document: doc } };
    } catch (err) {
      set.status = 403;
      return { success: false, error: err instanceof Error ? err.message : "Failed" };
    }
  }, { body: t.Optional(t.Object({
    notes: t.Optional(t.String()),
    expiryDate: t.Optional(t.String()),
    issuer: t.Optional(t.String()),
    issueDate: t.Optional(t.String()),
  })) })
  .put("/providers/:id/documents/:docId/reject", async ({ params, adminContext, set, body }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "USERS", "APPROVE");
      if (!body?.reason?.trim()) {
        set.status = 400;
        return { success: false, error: "Rejection reason is required" };
      }
      const { documentUploadService } = await import("../services/document-upload.service");
      const doc = await documentUploadService.rejectDocument(params.docId, body.reason.trim());
      return { success: true, data: { document: doc } };
    } catch (err) {
      set.status = 403;
      return { success: false, error: err instanceof Error ? err.message : "Failed" };
    }
  }, { body: t.Object({ reason: t.String() }) })
  .get("/academy/modules", async ({ adminContext, set }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "SETTINGS", "READ");
      const data = await academyAdminService.listCatalog();
      return { success: true, data };
    } catch (err) {
      set.status = 403;
      return { success: false, error: err instanceof Error ? err.message : "Failed" };
    }
  })
  .post("/academy/modules", async ({ adminContext, set, body: payload }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "SETTINGS", "CREATE");
      const module = await academyAdminService.createModule(payload);
      return { success: true, data: { module } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      set.status = msg === "Title is required" ? 400 : 403;
      return { success: false, error: msg };
    }
  }, {
    body: t.Object({
      slug: t.String(),
      title: t.String(),
      contentType: t.String(),
      contentUrl: t.Optional(t.String()),
      contentBody: t.Optional(t.String()),
      sortOrder: t.Optional(t.Number()),
      isPublished: t.Optional(t.Boolean()),
      categoryIds: t.Optional(t.Array(t.String())),
    }),
  })
  .patch("/academy/modules/:id", async ({ adminContext, set, params, body: payload }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "SETTINGS", "UPDATE");
      const module = await academyAdminService.patchModule(params.id, payload);
      if (!module) {
        set.status = 404;
        return { success: false, error: "Module not found", code: "NOT_FOUND" };
      }
      return { success: true, data: { module } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed";
      set.status = msg === "Title is required" ? 400 : 403;
      return { success: false, error: msg };
    }
  }, {
    params: t.Object({ id: t.String() }),
    body: t.Object({
      title: t.Optional(t.String()),
      contentType: t.Optional(t.String()),
      contentUrl: t.Optional(t.Union([t.String(), t.Null()])),
      contentBody: t.Optional(t.Union([t.String(), t.Null()])),
      sortOrder: t.Optional(t.Number()),
      isPublished: t.Optional(t.Boolean()),
      categoryIds: t.Optional(t.Array(t.String())),
    }),
  })
  .get("/incentives/rules", async ({ adminContext, set }) => {
    const admin = adminContext!;
    try {
      await rbacService.enforcePermission(admin, "CAMPAIGNS", "READ");
      const rules = await prisma.partnerIncentiveRule.findMany({ orderBy: { createdAt: "asc" } });
      return { success: true, data: { rules } };
    } catch (err) {
      set.status = 403;
      return { success: false, error: err instanceof Error ? err.message : "Failed" };
    }
  })
  .use(adminPartnerAcquisitionRoutes)
  .use(adminPartnerReferralRoutes)
  .use(adminTrustSafetyRoutes)
  .use(adminIntelligenceRoutes)
  .use(adminAutomationRoutes);
