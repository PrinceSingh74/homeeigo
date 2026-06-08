import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { bookingService } from "../services/booking.service";
import { providerService } from "../services/provider.service";
import { matchingService } from "../services/matching.service";
import { invoiceReportService } from "../services/invoice-report.service";
import { parseBody } from "../lib/route-security";
import { providerMatchSchema, providerOnlineSchema, providerSearchSchema } from "../schemas/provider.schema";

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
  .get("/me/reviews", async ({ requireProvider, query }) => {
    const { providerId } = requireProvider();
    const data = await providerService.reviews(providerId, query as Record<string, string>);
    return { success: true, data };
  })
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
  .get("/nearby", async ({ query }) => {
    const data = await providerService.nearby({
      latitude: Number(query.latitude),
      longitude: Number(query.longitude),
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
  .get("/:id/availability", async ({ params, query }) => {
    const data = await providerService.availability(
      params.id,
      String(query.date),
      String(query.serviceId),
    );
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
      });
      if (result.error === "PROVIDER_UNAVAILABLE") {
        set.status = 400;
        return { success: false, error: "Provider is not available", code: "PROVIDER_UNAVAILABLE" };
      }
      if (result.error === "OVERLAPPING_BOOKING") {
        set.status = 409;
        return { success: false, error: "You have an overlapping booking", code: "OVERLAPPING_BOOKING" };
      }
      set.status = 201;
      return { success: true, data: result };
    },
    {
      body: t.Object({
        serviceId: t.String(),
        scheduledDate: t.String(),
        addressId: t.String(),
        description: t.Optional(t.String()),
      }),
    },
  );
