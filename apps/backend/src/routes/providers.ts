import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { bookingService } from "../services/booking.service";
import { catalogService } from "../services/catalog.service";
import { providerService } from "../services/provider.service";
import { matchingService } from "../services/matching.service";
import { routeOptimizationService } from "../services/route-optimization.service";
import { invoiceReportService } from "../services/invoice-report.service";
import prisma from "../lib/prisma";
import { parseBody } from "../lib/route-security";
import { providerMatchSchema, providerOnlineSchema, providerSearchSchema, providerPauseSchema, providerServiceAreaSchema } from "../schemas/provider.schema";
import { partnerOperationsService } from "../services/partner-operations.service";
import { partnerPresenceService } from "../services/partner-presence.service";
import {
  partnerLocationPingSchema,
  partnerPresenceHeartbeatSchema,
} from "../schemas/partner-presence.schema";
import {
  dispatchEligibilityBlockCode,
  evaluateDispatchEligibility,
  loadProviderEligibilitySnapshot,
} from "../services/dispatch-eligibility.service";
import { capabilityTablesPresent } from "../services/provider-capability.service";
import { buildServiceSkillBoard } from "../services/partner-service-skills.service";

export const providersRoutes = new Elysia({ prefix: "/api/providers" })
  .use(authPlugin)
  /* ----------------------------------------------------------------- */
  /* Partner-self "me" endpoints — require role=PROVIDER                */
  /* These come BEFORE /:id so the router doesn't capture "me" as an id */
  /* ----------------------------------------------------------------- */
  .get("/me", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const data = await providerService.me(providerId);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { provider: data } };
  })
  .get("/me/services", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const provider = await prisma.provider.findUnique({
      where: { id: providerId },
      select: { serviceCategories: true },
    });
    const data = await catalogService.partnerEligible(provider?.serviceCategories ?? []);
    return { success: true, data };
  })
  .get("/me/service-skills", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const board = await buildServiceSkillBoard(providerId, await capabilityTablesPresent());
    if (!board) {
      set.status = 404;
      return { success: false as const, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true as const, data: board };
  })
  // Phase 17.3 — optimise the provider's active multi-stop route (reuses maps.service /
  // existing ETA; no new routing engine). Uses the provider's live location + active jobs.
  .get("/me/route/optimize", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const loc = await prisma.location.findUnique({ where: { providerId } });
    if (!loc) {
      set.status = 409;
      return { success: false, error: "No live provider location yet", code: "NO_LOCATION" };
    }
    const bookings = await prisma.booking.findMany({
      where: { providerId, status: { in: ["ACCEPTED", "ASSIGNED", "EN_ROUTE", "IN_PROGRESS"] } },
      select: { id: true, scheduledDate: true, status: true, tracking: { select: { status: true } }, address: { select: { latitude: true, longitude: true } } },
    });
    const jobs = bookings
      .filter((b) => b.address)
      .map((b) => ({
        bookingId: b.id,
        lat: b.address!.latitude,
        lng: b.address!.longitude,
        status: b.tracking?.status ?? b.status,
        scheduledDate: b.scheduledDate,
      }));
    const result = await routeOptimizationService.optimize({ lat: loc.latitude, lng: loc.longitude }, jobs);
    return { success: true, data: result };
  })
  .put(
    "/me/online",
    async ({ requireProvider, body: raw }) => {
      const { providerId } = requireProvider();
      const body = parseBody(providerOnlineSchema, raw);
      const data = await providerService.setOnline(providerId, body.online);
      return { success: true, message: body.online ? "You are online" : "You are offline", data };
    },
    { body: t.Object({ online: t.Boolean() }) },
  )
  .post(
    "/me/pause",
    async ({ requireProvider, body: raw }) => {
      const { providerId } = requireProvider();
      const body = parseBody(providerPauseSchema, raw ?? {});
      const data = await partnerOperationsService.pause(providerId, body.reason);
      return { success: true, message: "New offers are paused", data };
    },
    { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) },
  )
  .post("/me/resume", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const data = await partnerOperationsService.resume(providerId);
    return { success: true, message: "You are available for jobs again", data };
  })
  .get("/me/operations", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const data = await partnerOperationsService.snapshot(providerId);
    return { success: true, data };
  })
  .get("/me/presence", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const data = await partnerPresenceService.getSnapshot(providerId);
    return { success: true, data };
  })
  /**
   * Why the partner is or isn't receiving offers right now. Read-only projection of the
   * same engine dispatch uses — never a second implementation the two could drift apart on.
   */
  .get("/me/dispatch-eligibility", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const snapshot = await loadProviderEligibilitySnapshot(providerId);
    if (!snapshot) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    const result = evaluateDispatchEligibility(snapshot);
    return {
      success: true,
      data: {
        providerId,
        eligible: result.eligible,
        blockedBy: dispatchEligibilityBlockCode(result),
        reasons: result.reasons,
        checks: result.checks,
        evaluatedAt: new Date().toISOString(),
      },
    };
  })
  .post(
    "/me/presence/heartbeat",
    async ({ requireProvider, body: raw, request }) => {
      const auth = requireProvider();
      const body = parseBody(partnerPresenceHeartbeatSchema, raw);
      const requestId = request.headers.get("x-request-id") ?? undefined;
      const correlationId = request.headers.get("x-correlation-id") ?? undefined;
      const result = await partnerPresenceService.heartbeat(
        {
          providerId: auth.providerId,
          userId: auth.userId,
          requestId,
          correlationId,
          ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? request.headers.get("x-real-ip")
            ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        },
        body,
      );
      return { success: true, data: result };
    },
    {
      body: t.Object({
        sessionId: t.String(),
        deviceId: t.String(),
        timestamp: t.Union([t.String(), t.Date()]),
        appState: t.Optional(t.Union([t.Literal("foreground"), t.Literal("background"), t.Literal("inactive")])),
        platform: t.Optional(t.Union([t.Literal("ios"), t.Literal("android"), t.Literal("web")])),
        appVersion: t.Optional(t.String()),
        availabilityTelemetry: t.Optional(t.String()),
        location: t.Optional(
          t.Object({
            latitude: t.Number(),
            longitude: t.Number(),
            accuracy: t.Optional(t.Number()),
            capturedAt: t.Union([t.String(), t.Date()]),
            sequence: t.Optional(t.Number()),
            // The device's own word on the fix (Android `mocked`); null/absent = unknown.
            mocked: t.Optional(t.Union([t.Boolean(), t.Null()])),
          }),
        ),
      }),
    },
  )
  /**
   * GPS on its own cadence, decoupled from the liveness beat so the app can throttle
   * location for battery without also going presence-stale.
   */
  .post(
    "/me/location/ping",
    async ({ requireProvider, body: raw, request }) => {
      const auth = requireProvider();
      const body = parseBody(partnerLocationPingSchema, raw);
      const result = await partnerPresenceService.locationPing(
        {
          providerId: auth.providerId,
          userId: auth.userId,
          requestId: request.headers.get("x-request-id") ?? undefined,
          correlationId: request.headers.get("x-correlation-id") ?? undefined,
          ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
            ?? request.headers.get("x-real-ip")
            ?? undefined,
          userAgent: request.headers.get("user-agent") ?? undefined,
        },
        body,
      );
      return { success: true, data: result };
    },
    {
      body: t.Object({
        sessionId: t.String(),
        deviceId: t.String(),
        location: t.Object({
          latitude: t.Number(),
          longitude: t.Number(),
          accuracy: t.Optional(t.Number()),
          capturedAt: t.Union([t.String(), t.Date()]),
          sequence: t.Optional(t.Number()),
          mocked: t.Optional(t.Union([t.Boolean(), t.Null()])),
        }),
      }),
    },
  )
  .put(
    "/me/service-area",
    async ({ requireProvider, body: raw }) => {
      const { providerId } = requireProvider();
      const body = parseBody(providerServiceAreaSchema, raw);
      const data = await partnerOperationsService.updateServiceArea(providerId, body);
      return { success: true, message: "Service area saved", data };
    },
    {
      body: t.Object({
        city: t.Optional(t.String()),
        serviceRegions: t.Optional(t.Array(t.String())),
        serviceRadiusKm: t.Optional(t.Number()),
        baseLatitude: t.Optional(t.Number()),
        baseLongitude: t.Optional(t.Number()),
      }),
    },
  )
  .get("/me/service-area/zones", async ({ requireProvider, query, set }) => {
    const { providerId } = requireProvider();
    const lat = query.lat ? Number(query.lat) : undefined;
    const lng = query.lng ? Number(query.lng) : undefined;
    if (lat == null || lng == null || Number.isNaN(lat) || Number.isNaN(lng)) {
      const me = await prisma.provider.findUnique({
        where: { id: providerId },
        select: { baseLatitude: true, baseLongitude: true },
      });
      if (me?.baseLatitude == null || me.baseLongitude == null) {
        set.status = 400;
        return { success: false, error: "Provide coordinates to load nearby zones", code: "VALIDATION_ERROR" };
      }
      const data = await partnerOperationsService.nearbyZones(me.baseLatitude, me.baseLongitude);
      return { success: true, data: { zones: data } };
    }
    const data = await partnerOperationsService.nearbyZones(lat, lng);
    return { success: true, data: { zones: data } };
  })
  .put(
    "/me/settings",
    async ({ requireProvider, body }) => {
      const { providerId } = requireProvider();
      const data = await providerService.updateSettings(providerId, body);
      return { success: true, message: "Settings updated", data: { settings: data } };
    },
    {
      body: t.Object({
        workingHoursStart: t.Optional(t.String()),
        workingHoursEnd: t.Optional(t.String()),
        workingDays: t.Optional(t.Array(t.String())),
        breakWindows: t.Optional(t.Array(t.Object({ start: t.String(), end: t.String() }))),
        maxJobsPerDay: t.Optional(t.Union([t.Number(), t.Null()])),
        maxConcurrentJobs: t.Optional(t.Number()),
        paymentMethodPreference: t.Optional(t.String()),
        upiId: t.Optional(t.String()),
        bio: t.Optional(t.String({ maxLength: 2000 })),
      }),
    },
  )
  .get("/me/bookings", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const data = await providerService.myBookings(providerId, {
      status: query.status as string | undefined,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      sortBy: query.sortBy as string | undefined,
    });
    return { success: true, data };
  })
  .get("/me/dashboard", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const data = await providerService.myDashboard(providerId);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .get("/me/earnings", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const days = query.days ? Math.max(1, Math.min(365, Number(query.days))) : 30;
    const data = await providerService.myEarningsSummary(providerId, days);
    return { success: true, data };
  })
  .get("/me/withdrawals", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { earningsService } = await import("../services/earnings.service");
    const withdrawals = await earningsService.listProviderWithdrawals(providerId);
    return { success: true, data: { withdrawals } };
  })
  .get("/me/payouts", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { earningsService } = await import("../services/earnings.service");
    const finance = await earningsService.getPartnerFinanceCenter(providerId);
    return { success: true, data: finance };
  })
  .get("/me/invoices", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const data = await invoiceReportService.partnerInvoices(providerId);
    return { success: true, data };
  })
  .get("/me/tax-summary", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const data = await invoiceReportService.partnerTaxSummary(providerId);
    return { success: true, data };
  })
  .get("/me/earnings/:id/invoice", async ({ requireProvider, params, set }) => {
    const { providerId } = requireProvider();
    const html = await invoiceReportService.partnerEarningHtml(providerId, params.id);
    if (!html) {
      set.status = 404;
      return { success: false, error: "Invoice not found", code: "NOT_FOUND" };
    }
    set.headers["content-type"] = "text/html; charset=utf-8";
    return html;
  })
  /**
   * Phase 13 P2: what THIS job paid the partner — gross, commission, the derived bonus / adjustment
   * and net, exactly as the earning invoice itemises them (`lib/earning-settlement.ts`). The row is
   * written when the job completes; until then (and for a job that earned nothing, or one this
   * partner does not hold) the answer is 404 and the client says earnings are shown after completion
   * — nothing is estimated.
   */
  .get("/me/bookings/:bookingId/earning", async ({ requireProvider, params, set }) => {
    const { providerId } = requireProvider();
    const earning = await invoiceReportService.partnerBookingEarning(providerId, params.bookingId);
    if (!earning) {
      set.status = 404;
      return { success: false, error: "No earning is recorded for this job yet", code: "EARNING_NOT_FOUND" };
    }
    return { success: true, data: { earning } };
  })
  .get("/me/reviews", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const data = await providerService.reviews(providerId, query as Record<string, string>);
    return { success: true, data };
  })
  .get("/me/attendance", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getAttendance(providerId);
    return { success: true, data };
  })
  .post("/me/attendance/check-in", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.checkIn(providerId);
    return { success: true, data };
  })
  .post("/me/attendance/check-out", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.checkOut(providerId);
    if (data.error) return { success: false, error: "No open attendance session", code: data.error };
    return { success: true, data };
  })
  .get("/me/incentives", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getIncentives(providerId);
    return { success: true, data };
  })
  .get("/me/forecast", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getForecast(providerId);
    return { success: true, data };
  })
  /**
   * Ranked zone opportunities for the authenticated partner.
   *
   * Server-authoritative: the UI receives scores and reasons, and computes none of them. The
   * partner is resolved from the session by `requireProvider()` — never from a query, body or
   * header — so one partner cannot request another's ranking.
   *
   * Gated by `PARTNER_ZONE_RECOMMENDATIONS`, which is fail-closed: a missing flag row, a disabled
   * flag or a lookup failure all return 404 rather than exposing the capability. 404 rather than
   * 403 because an ungated capability should not advertise its own existence.
   */
  /**
   * Grounded earnings-opportunity plan for a target amount.
   *
   * Server-authoritative and READ-ONLY: no transaction is opened and no financial record is
   * touched. Partner identity comes from the session via `requireProvider()`, so one partner can
   * never request another's plan, and `target` only sets the goal being measured against — it
   * cannot widen what data is read.
   *
   * Gated by `PARTNER_EARNINGS_COACH`, fail-closed: a missing or disabled flag returns 404.
   */
  /**
   * Advisory shift plan — when to work, where to start, and what the trade-offs are.
   *
   * READ-ONLY and advisory by construction: the planning service holds no database handle and
   * calls no mutator, so this endpoint cannot change availability, a shift or a booking. Partner
   * identity comes from the session; `target` only tunes the optional earnings context.
   *
   * Gated by `PARTNER_SHIFT_PLANNING`, fail-closed: a missing or disabled flag returns 404.
   */
  /**
   * Performance nudges — partner-self comparison over the platform's own metric definitions.
   *
   * READ-ONLY: computes and returns. Sending is deliberately NOT here — a nudge existing is not a
   * reason to notify anyone, and any future automated path must run through notification
   * governance in SHADOW first.
   *
   * Gated by `PARTNER_PERFORMANCE_NUDGES`, fail-closed.
   */
  .get("/me/intel/nudges", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const { isFeatureEnabled } = await import("../services/feature-flag.service");
    if (!(await isFeatureEnabled("PARTNER_PERFORMANCE_NUDGES", providerId))) {
      set.status = 404;
      return { success: false, error: "Not found", code: "NOT_FOUND" };
    }
    const { performanceNudgesService } = await import("../services/performance-nudges.service");
    const data = await performanceNudgesService.compute(providerId);
    return { success: true, data };
  })

  .get("/me/intel/shift-plan", async ({ requireProvider, query, set }) => {
    const { providerId } = requireProvider();
    const { isFeatureEnabled } = await import("../services/feature-flag.service");
    if (!(await isFeatureEnabled("PARTNER_SHIFT_PLANNING", providerId))) {
      set.status = 404;
      return { success: false, error: "Not found", code: "NOT_FOUND" };
    }
    const target = query.target === undefined ? undefined : Number(query.target);
    if (target !== undefined && (!Number.isFinite(target) || target < 0)) {
      set.status = 400;
      return { success: false, error: "target must be a non-negative number", code: "VALIDATION_ERROR" };
    }
    const { shiftPlanningService } = await import("../services/shift-planning.service");
    const data = await shiftPlanningService.plan(providerId, { targetAmount: target });
    return { success: true, data };
  }, {
    query: t.Object({ target: t.Optional(t.String()) }),
  })

  .get("/me/intel/earnings-coach", async ({ requireProvider, query, set }) => {
    const { providerId } = requireProvider();
    const { isFeatureEnabled } = await import("../services/feature-flag.service");
    if (!(await isFeatureEnabled("PARTNER_EARNINGS_COACH", providerId))) {
      set.status = 404;
      return { success: false, error: "Not found", code: "NOT_FOUND" };
    }
    const target = Number(query.target ?? 0);
    if (!Number.isFinite(target) || target < 0) {
      set.status = 400;
      return { success: false, error: "target must be a non-negative number", code: "VALIDATION_ERROR" };
    }
    const { earningsCoachService } = await import("../services/earnings-coach.service");
    const data = await earningsCoachService.plan(providerId, target);
    return { success: true, data };
  }, {
    query: t.Object({ target: t.Optional(t.String()) }),
  })

  .get("/me/intel/zones", async ({ requireProvider, query, set }) => {
    const { providerId } = requireProvider();
    const { isFeatureEnabled } = await import("../services/feature-flag.service");
    if (!(await isFeatureEnabled("PARTNER_ZONE_RECOMMENDATIONS", providerId))) {
      set.status = 404;
      return { success: false, error: "Not found", code: "NOT_FOUND" };
    }
    const { zoneRecommendationService } = await import("../services/zone-recommendation.service");
    const limit = query.limit ? Number(query.limit) : undefined;
    const data = await zoneRecommendationService.recommend(providerId, { limit });
    return { success: true, data };
  }, {
    query: t.Object({ limit: t.Optional(t.String()) }),
  })

  .get("/me/intelligence", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const days = query.days ? Math.max(7, Math.min(365, Number(query.days))) : 90;
    const data = await partnerOsService.getProviderIntelligence(providerId, days);
    return { success: true, data };
  })
  .get("/me/rankings", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getRankings(providerId);
    return { success: true, data };
  })
  .get("/me/score", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const { partnerScoreService } = await import("../services/partner-score.service");
    const data = await partnerScoreService.getCurrent(providerId);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .get("/me/score/history", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const { partnerScoreService } = await import("../services/partner-score.service");
    const data = await partnerScoreService.getHistory(providerId, query as Record<string, string | undefined>);
    return { success: true, data };
  })
  .get("/me/career", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const { partnerCareerService } = await import("../services/partner-career.service");
    const data = await partnerCareerService.getCurrent(providerId);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .get("/me/career/history", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const { partnerCareerService } = await import("../services/partner-career.service");
    const data = await partnerCareerService.getHistory(providerId, query as Record<string, string | undefined>);
    return { success: true, data };
  })
  .get("/me/lifecycle", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const { partnerLifecycleService } = await import("../services/partner-lifecycle.service");
    const data = await partnerLifecycleService.getCurrent(providerId);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .get("/me/lifecycle/history", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const { partnerLifecycleService } = await import("../services/partner-lifecycle.service");
    const data = await partnerLifecycleService.getHistory(providerId, query as Record<string, string | undefined>);
    return { success: true, data };
  })
  .get("/me/network", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerReferralService } = await import("../services/partner-referral.service");
    const data = await partnerReferralService.partnerDashboard(providerId);
    return { success: true, data };
  })
  .post(
    "/me/network/invite",
    async ({ requireProvider, body, set }) => {
      const { providerId } = requireProvider();
      const { partnerReferralService } = await import("../services/partner-referral.service");
      try {
        const data = await partnerReferralService.invite({
          referrerProviderId: providerId,
          name: body.name,
          phone: body.phone,
          email: body.email,
          city: body.city,
          skillInterest: body.skillInterest,
          campaign: body.campaign,
        });
        return { success: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed";
        const [code, detail] = message.includes(":") ? message.split(":", 2) : ["INTERNAL", message];
        set.status = code === "CONFLICT" ? 409 : code === "VALIDATION" ? 400 : 500;
        return { success: false, error: detail ?? message, code: code === "INTERNAL" ? "INTERNAL_ERROR" : code };
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2, maxLength: 120 }),
        phone: t.String({ minLength: 10, maxLength: 20 }),
        email: t.Optional(t.String()),
        city: t.Optional(t.String()),
        skillInterest: t.Optional(t.String()),
        campaign: t.Optional(t.String()),
      }),
    },
  )
  .post("/me/lifecycle/pause", async ({ requireProvider, body, set }) => {
    const { providerId } = requireProvider();
    const { partnerLifecycleService } = await import("../services/partner-lifecycle.service");
    const result = await partnerLifecycleService.transition({
      providerId,
      to: "PAUSED",
      actorType: "PARTNER",
      actorId: providerId,
      reasonCode: "PARTNER_REQUEST",
      reasonText: typeof body?.reason === "string" ? body.reason : "Partner requested pause",
    });
    if ("error" in result && result.error) {
      set.status = result.error === "INVALID_TRANSITION" ? 409 : 400;
      return { success: false, error: result.error, code: result.error, allowed: "allowed" in result ? result.allowed : undefined };
    }
    return { success: true, data: result.data };
  }, { body: t.Optional(t.Object({ reason: t.Optional(t.String()) })) })
  .post("/me/lifecycle/resume", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const { partnerLifecycleService } = await import("../services/partner-lifecycle.service");
    const result = await partnerLifecycleService.transition({
      providerId,
      to: "ACTIVE",
      actorType: "PARTNER",
      actorId: providerId,
      reasonCode: "PARTNER_REQUEST",
      reasonText: "Partner resumed partnership",
    });
    if ("error" in result && result.error) {
      set.status = result.error === "INVALID_TRANSITION" ? 409 : 400;
      return { success: false, error: result.error, code: result.error };
    }
    return { success: true, data: result.data };
  })
  .get("/me/academy", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getAcademy(providerId);
    return { success: true, data };
  })
  .post("/me/academy/:moduleId/complete", async ({ requireProvider, params, body }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const result = await partnerOsService.completeAcademyModule(providerId, params.moduleId, body?.score);
    if ("error" in result) return { success: false, error: "Module not found", code: result.error };
    return { success: true, data: result };
  }, { params: t.Object({ moduleId: t.String() }), body: t.Optional(t.Object({ score: t.Optional(t.Number()) })) })
  .get("/me/compliance", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getCompliance(providerId);
    return { success: true, data };
  })
  .get("/me/wellbeing", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getWellbeing(providerId);
    return { success: true, data };
  })
  .patch(
    "/me/safety/emergency-contact",
    async ({ requireProvider, body }) => {
      const { providerId } = requireProvider();
      const { partnerOsService } = await import("../services/partner-os.service");
      const data = await partnerOsService.updateEmergencyContact(providerId, body);
      return { success: true, data };
    },
    {
      body: t.Object({
        emergencyContactName: t.Optional(t.String()),
        emergencyContactPhone: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/me/safety/sos",
    async ({ requireProvider, requireAuth, body }) => {
      const { providerId } = requireProvider();
      const { userId } = requireAuth();
      const { partnerSafetyService } = await import("../services/partner-safety.service");
      const result = await partnerSafetyService.triggerSos({
        providerId,
        userId,
        bookingId: body?.bookingId,
        latitude: body?.latitude,
        longitude: body?.longitude,
        accuracy: body?.accuracy,
      });
      return {
        success: true,
        data: {
          incidentId: result.incident.id,
          status: result.incident.status,
          created: result.created,
          hasLocation: result.incident.latitude != null,
        },
      };
    },
    {
      body: t.Optional(
        t.Object({
          bookingId: t.Optional(t.String()),
          latitude: t.Optional(t.Number()),
          longitude: t.Optional(t.Number()),
          accuracy: t.Optional(t.Number()),
        }),
      ),
    },
  )
  .post(
    "/me/safety/report",
    async ({ requireProvider, requireAuth, body }) => {
      const { providerId } = requireProvider();
      const { userId } = requireAuth();
      const { partnerSafetyService } = await import("../services/partner-safety.service");
      const incident = await partnerSafetyService.reportIssue({
        providerId,
        userId,
        type: body.type,
        bookingId: body.bookingId,
        notes: body.notes,
      });
      return { success: true, data: { incidentId: incident.id, status: incident.status } };
    },
    {
      body: t.Object({
        type: t.Union([
          t.Literal("ACCIDENT"),
          t.Literal("THREAT"),
          t.Literal("MEDICAL"),
          t.Literal("CUSTOMER_SAFETY"),
          t.Literal("PARTNER_SAFETY"),
          t.Literal("LOCATION_DANGER"),
          t.Literal("OTHER"),
        ]),
        bookingId: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    },
  )
  .get("/me/safety/incidents", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerSafetyService } = await import("../services/partner-safety.service");
    const items = await partnerSafetyService.partnerHistory(providerId);
    return { success: true, data: { incidents: items } };
  })
  .get("/me/rewards", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getRewards(providerId);
    return { success: true, data };
  })
  .get("/me/service-history", async ({ requireProvider }) => {
    const { providerId } = requireProvider();
    const { partnerOsService } = await import("../services/partner-os.service");
    const data = await partnerOsService.getServiceHistory(providerId);
    return { success: true, data };
  })
  .get("/me/documents", async ({ requireProvider, requireAuth }) => {
    const { providerId } = requireProvider();
    const { userId } = requireAuth();
    const { documentUploadService } = await import("../services/document-upload.service");
    const documents = await documentUploadService.listDocuments(providerId, userId);
    return { success: true, data: { documents } };
  })
  .patch(
    "/me/documents/:documentId",
    async ({ requireProvider, requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      void requireProvider();
      const { documentUploadService } = await import("../services/document-upload.service");
      const { sanitizeUserInput } = await import("../utils/sanitizer");
      try {
        const doc = await documentUploadService.setDocumentMeta(
          params.documentId,
          { userId },
          {
            expiryDate: body.expiryDate ? new Date(body.expiryDate) : body.expiryDate === null ? null : undefined,
            issuer: body.issuer != null ? sanitizeUserInput(body.issuer, 120) : undefined,
            issueDate: body.issueDate ? new Date(body.issueDate) : body.issueDate === null ? null : undefined,
          },
        );
        return { success: true, data: { document: doc } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed";
        set.status = msg.startsWith("FORBIDDEN") ? 403 : msg.startsWith("NOT_FOUND") ? 404 : msg.startsWith("DOCUMENT_LOCKED") ? 409 : 400;
        return { success: false, error: msg.replace(/^[A-Z_]+:/, ""), code: msg.split(":")[0] };
      }
    },
    {
      params: t.Object({ documentId: t.String() }),
      body: t.Object({
        expiryDate: t.Optional(t.Union([t.String(), t.Null()])),
        issuer: t.Optional(t.String()),
        issueDate: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )
  .post(
    "/me/documents",
    async ({ requireProvider, requireAuth, body, set }) => {
      const { providerId } = requireProvider();
      const { userId } = requireAuth();
      const { documentUploadService } = await import("../services/document-upload.service");
      const { sanitizeUserInput } = await import("../utils/sanitizer");
      try {
        const base64 = body.file.includes(",") ? body.file.split(",")[1]! : body.file;
        const buffer = Buffer.from(base64, "base64");
        const result = await documentUploadService.uploadDocument(
          providerId,
          userId,
          buffer,
          sanitizeUserInput(body.fileName || `${body.documentType}.pdf`, 255),
          sanitizeUserInput(body.documentType, 80),
          {
            expiryDate: body.expiryDate ? new Date(body.expiryDate) : null,
            issuer: body.issuer ? sanitizeUserInput(body.issuer, 120) : null,
            issueDate: body.issueDate ? new Date(body.issueDate) : null,
          },
        );
        return { success: true, data: { documentId: result.documentId } };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed";
        set.status = msg.startsWith("FORBIDDEN") ? 403 : 400;
        return { success: false, error: msg.replace(/^[A-Z_]+:/, ""), code: "UPLOAD_FAILED" };
      }
    },
    {
      body: t.Object({
        file: t.String(),
        documentType: t.String(),
        fileName: t.Optional(t.String()),
        expiryDate: t.Optional(t.String()),
        issuer: t.Optional(t.String()),
        issueDate: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/search",
    async ({ body: raw }) => {
      const body = parseBody(providerSearchSchema, raw);
      const data = await providerService.search(body);
      return { success: true, data };
    },
    {
      body: t.Object({
        serviceId: t.String(),
        latitude: t.Number(),
        longitude: t.Number(),
        radius: t.Optional(t.Number()),
        minRating: t.Optional(t.Number()),
        minCompletionRate: t.Optional(t.Number()),
        page: t.Optional(t.Number()),
        limit: t.Optional(t.Number()),
      }),
    },
  )
  .post(
    "/match",
    async ({ requireAuth, body: raw }) => {
      const { userId } = requireAuth();
      const body = parseBody(providerMatchSchema, raw);
      const providers = await matchingService.findBestProviders({
        serviceId: body.serviceId,
        customerId: userId,
        latitude: body.latitude,
        longitude: body.longitude,
        scheduledDate: body.scheduledDate,
        maxResults: body.maxResults,
        maxDistanceKm: body.maxDistanceKm,
      });
      return { success: true, data: { providers, total: providers.length } };
    },
    {
      body: t.Object({
        serviceId: t.String(),
        latitude: t.Number(),
        longitude: t.Number(),
        scheduledDate: t.String(),
        maxResults: t.Optional(t.Number()),
        maxDistanceKm: t.Optional(t.Number()),
      }),
    },
  )
  .get("/nearby", async ({ query, set }) => {
    // Validated here because the service builds a bounding box from these, and `Number(undefined)`
    // is NaN: a request with no or malformed coordinates reached Prisma as `lte: NaN` and came back
    // as a 500 carrying the Prisma invocation text. This route is public, so that was the most
    // exposed 500 in the API. Found in Pass 6 by the authenticated GET sweep.
    const latitude = Number(query.latitude);
    const longitude = Number(query.longitude);
    if (
      query.latitude === undefined || query.longitude === undefined ||
      !Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    ) {
      set.status = 400;
      return {
        success: false,
        error: "latitude and longitude are required and must be valid coordinates",
        code: "VALIDATION_ERROR",
      };
    }
    const data = await providerService.nearby({
      latitude,
      longitude,
      radius: query.radius ? Number(query.radius) : undefined,
      serviceId: query.serviceId,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { success: true, data };
  })
  .get("/:id/reviews", async ({ params, query }) => {
    const data = await providerService.reviews(params.id, query as Record<string, string>);
    return { success: true, data };
  })
  // Public by design (customers browse before signing in) — the payload is therefore limited to
  // what a booking decision needs; operational counters stay behind the partner's own session.
  .get("/:id/availability", async ({ params, query, set }) => {
    const date = typeof query.date === "string" ? query.date : "";
    const serviceId = typeof query.serviceId === "string" ? query.serviceId : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(`${date}T00:00:00`).getTime())) {
      set.status = 400;
      return { success: false, error: "date must be YYYY-MM-DD", code: "INVALID_DATE" };
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(serviceId)) {
      set.status = 400;
      return { success: false, error: "serviceId is required", code: "INVALID_SERVICE_ID" };
    }
    const data = await providerService.availability(params.id, date, serviceId);
    return { success: true, data };
  })
  .get("/:id", async ({ params, set }) => {
    const provider = await providerService.byId(params.id);
    if (!provider) {
      set.status = 404;
      return { success: false, error: "Provider not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { provider } };
  })
  .post(
    "/:id/book",
    async ({ requireAuth, params, body, set }) => {
      const { userId } = requireAuth();
      const result = await bookingService.create(userId, {
        serviceId: body.serviceId,
        providerId: params.id,
        scheduledDate: body.scheduledDate,
        addressId: body.addressId,
        description: body.description,
        couponCode: body.couponCode,
        packagePrice: body.packagePrice,
        variantId: body.variantId,
        quantity: body.quantity,
        audience: body.audience,
        professionalPreference: body.professionalPreference,
        addonIds: body.addonIds,
        addonQuantities: body.addonQuantities,
        paymentMethod: body.paymentMethod,
        // The same rule as POST /api/bookings: the customer books the price they were quoted.
        quoteToken: body.quoteToken,
      });
      // Without a valid quote the answer carries the current one, so the caller can show it and retry.
      if (result.error === "QUOTE_REQUIRED" || result.error === "QUOTE_EXPIRED" || result.error === "QUOTE_MISMATCH" || result.error === "QUOTE_INVALID" || result.error === "PRICE_CHANGED") {
        set.status = result.error === "QUOTE_EXPIRED" || result.error === "PRICE_CHANGED" ? 409 : 400;
        return {
          success: false,
          error: result.error === "QUOTE_REQUIRED" ? "Review the current price before booking" : "The price for this booking needs to be reviewed again",
          code: result.error,
          quote: "quote" in result ? result.quote : undefined,
        };
      }
      if (result.error === "PROVIDER_UNAVAILABLE") {
        set.status = 400;
        return { success: false, error: "Provider is not available", code: "PROVIDER_UNAVAILABLE" };
      }
      if (result.error === "OVERLAPPING_BOOKING") {
        set.status = 409;
        return { success: false, error: "You have an overlapping booking", code: "OVERLAPPING_BOOKING" };
      }
      // Any other rejection (invalid selection, coupon, validation) is a client error —
      // it used to fall through as 201 "success" with the error inside data.
      if (result.error) {
        set.status = result.error === "UPGRADE_REQUIRED" ? 403 : 400;
        return { success: false, error: "Booking could not be created", code: result.error };
      }
      set.status = 201;
      return { success: true, data: result };
    },
    {
      body: t.Object({
        serviceId: t.String(),
        scheduledDate: t.String(),
        couponCode: t.Optional(t.String()),
        packagePrice: t.Optional(t.Number()),
        variantId: t.Optional(t.String()),
        quantity: t.Optional(t.Number()),
        audience: t.Optional(t.String()),
        professionalPreference: t.Optional(t.String()),
        addonIds: t.Optional(t.Array(t.String())),
        addonQuantities: t.Optional(t.Record(t.String(), t.Number())),
        paymentMethod: t.Optional(t.String()),
        quoteToken: t.Optional(t.String({ maxLength: 2048 })),
        addressId: t.String(),
        description: t.Optional(t.String()),
      }),
    },
  );
