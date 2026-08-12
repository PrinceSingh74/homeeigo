import { bookingService } from "../../../services/booking.service";
import { walletService } from "../../../services/wallet.service";
import { subscriptionService } from "../../../services/subscription.service";
import { catalogService } from "../../../services/catalog.service";
import { providerService } from "../../../services/provider.service";
import { partnerOsService } from "../../../services/partner-os.service";
import { adminService } from "../../../services/admin.service";
import { financeDashboardService } from "../../../services/finance-dashboard.service";
import { fraudAdminService } from "../../../services/fraud-admin.service";
import { geoIntelligenceService } from "../../../services/geo-intelligence.service";
import { weatherService } from "../../../services/weather.service";
import { mapsService } from "../../../services/maps.service";
import { trackingService } from "../../../services/tracking.service";
import { notificationService } from "../../../services/notification.service";
import { supportTicketService } from "../../../services/support-ticket.service";
import { campaignService } from "../../../services/campaign.service";
import { refundOrchestratorService } from "../../../services/refund-orchestrator.service";
import type { ToolHandler, ToolRegistryEntry } from "../../types";
import { resolveProviderId, verifyBookingAccess, verifyBookingOwnership } from "../actor-resolver";
import { financialSandboxVerdict, isSandboxExecutableHighRiskTool } from "../financial-sandbox";

type CatalogEntry = Omit<ToolRegistryEntry, "handler">;

function handlerMap(): Record<string, ToolHandler> {
  return {
    // Customer reads
    "read.customer.getBooking": async ({ actor, arguments: args }) => {
      const bookingId = String(args.bookingId);
      if (!(await verifyBookingOwnership(actor.actorId, bookingId))) {
        throw new Error("BOOKING_ACCESS_DENIED");
      }
      return bookingService.getForUser(actor.actorId, bookingId);
    },
    "read.customer.getBookingStatus": async ({ actor, arguments: args }) => {
      const bookingId = String(args.bookingId);
      const booking = await bookingService.getForUser(actor.actorId, bookingId);
      return { bookingId, status: (booking as { status?: string }).status };
    },
    "read.customer.getBookings": async ({ actor, arguments: args }) =>
      bookingService.listForUser(actor.actorId, {
        page: String(args.page ?? 1),
        limit: String(args.limit ?? 20),
        status: args.status ? String(args.status) : undefined,
      }),
    "read.customer.getWallet": async ({ actor }) => walletService.balance(actor.actorId),
    "read.customer.getWalletTransactions": async ({ actor, arguments: args }) =>
      walletService.transactions(actor.actorId, {
        page: args.page ? String(args.page) : undefined,
        limit: args.limit ? String(args.limit) : undefined,
      }),
    "read.customer.getSubscription": async ({ actor }) => subscriptionService.mine(actor.actorId),
    "read.customer.getServices": async ({ arguments: args }) =>
      catalogService.list({
        category: args.category ? String(args.category) : undefined,
        city: args.city ? String(args.city) : undefined,
      }),
    "read.customer.getOffers": async () => walletService.offers(),

    // Partner reads
    "read.partner.getPartnerProfile": async ({ actor }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return providerService.me(providerId);
    },
    "read.partner.getPartnerJobs": async ({ actor, arguments: args }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return providerService.myBookings(providerId, {
        page: args.page ? String(args.page) : undefined,
        status: args.status ? String(args.status) : undefined,
      });
    },
    "read.partner.getPartnerPerformance": async ({ actor, arguments: args }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return partnerOsService.getProviderIntelligence(providerId, Number(args.days ?? 90));
    },
    "read.partner.getPartnerEarnings": async ({ actor, arguments: args }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return providerService.myEarningsSummary(providerId, Number(args.days ?? 30));
    },
    "read.partner.getPartnerDemand": async ({ actor }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return partnerOsService.getForecast(providerId);
    },
    "read.partner.getPartnerSchedule": async ({ actor }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return partnerOsService.getAttendance(providerId);
    },

    // Admin reads
    "read.admin.getProviders": async ({ arguments: args }) =>
      adminService.listProviders({
        page: args.page ? String(args.page) : undefined,
        status: args.status ? String(args.status) : undefined,
      }),
    "read.admin.getCustomers": async ({ arguments: args }) =>
      adminService.listUsers({
        page: args.page ? String(args.page) : undefined,
        search: args.search ? String(args.search) : undefined,
      }),
    "read.admin.getRevenue": async ({ arguments: args }) =>
      adminService.analytics({
        startDate: args.startDate ? String(args.startDate) : undefined,
        endDate: args.endDate ? String(args.endDate) : undefined,
      }),
    "read.admin.getFinanceSummary": async ({ arguments: args }) =>
      financeDashboardService.getOverview(Number(args.days ?? 30)),
    "read.admin.getFraudSummary": async () => fraudAdminService.overview(),
    "read.admin.getForecast": async ({ arguments: args }) =>
      geoIntelligenceService.demandForecast(Number(args.horizonHours ?? 24)),
    "read.admin.getDemand": async () => geoIntelligenceService.executiveKpis(),
    "read.admin.getSupply": async () => geoIntelligenceService.providerDensity(),
    "read.admin.getOperations": async () => adminService.dashboard(),

    // Common reads
    "read.common.getWeather": async ({ arguments: args }) => {
      if (args.city) return weatherService.getByCity(String(args.city));
      if (args.lat != null && args.lng != null) {
        return weatherService.getByCoords(Number(args.lat), Number(args.lng));
      }
      throw new Error("WEATHER_LOCATION_REQUIRED");
    },
    "read.common.getTraffic": async ({ arguments: args }) =>
      mapsService.eta(
        { lat: Number(args.fromLat), lng: Number(args.fromLng) },
        { lat: Number(args.toLat), lng: Number(args.toLng) },
      ),
    "read.common.getETA": async ({ arguments: args }) =>
      mapsService.eta(
        { lat: Number(args.fromLat), lng: Number(args.fromLng) },
        { lat: Number(args.toLat), lng: Number(args.toLng) },
      ),
    "read.common.getLocation": async ({ actor, arguments: args }) => {
      const bookingId = String(args.bookingId);
      const providerId = actor.actorRole === "PARTNER" ? await resolveProviderId(actor.actorId) : null;
      if (!(await verifyBookingAccess(bookingId, actor.actorId, actor.actorRole, providerId))) {
        throw new Error("BOOKING_ACCESS_DENIED");
      }
      return trackingService.getLatestLocation(bookingId);
    },
    "read.common.getNotifications": async ({ actor, arguments: args }) =>
      notificationService.list(actor.actorId, {
        page: Number(args.page ?? 1),
        limit: Number(args.limit ?? 20),
      }),
    "read.common.getSupportTickets": async ({ actor, arguments: args }) => {
      const providerId = actor.actorRole === "PARTNER" ? await resolveProviderId(actor.actorId) : undefined;
      return supportTicketService.listForUser(
        actor.actorId,
        {
          page: args.page ? String(args.page) : undefined,
          status: args.status ? String(args.status) : undefined,
        },
        providerId ?? undefined,
      );
    },

    // Writes
    "write.booking.createBooking": async ({ actor, arguments: args }) =>
      bookingService.create(actor.actorId, {
        serviceId: String(args.serviceId),
        scheduledDate: String(args.scheduledDate),
        addressId: String(args.addressId),
        description: args.description ? String(args.description) : undefined,
        couponCode: args.couponCode ? String(args.couponCode) : undefined,
      }),
    "write.booking.updateBooking": async ({ actor, arguments: args }) => {
      const bookingId = String(args.bookingId);
      if (!(await verifyBookingOwnership(actor.actorId, bookingId))) throw new Error("BOOKING_ACCESS_DENIED");
      return bookingService.update(actor.actorId, bookingId, {
        scheduledDate: args.scheduledDate ? String(args.scheduledDate) : undefined,
        description: args.description ? String(args.description) : undefined,
      });
    },
    "write.booking.rescheduleBooking": async ({ actor, arguments: args }) => {
      const bookingId = String(args.bookingId);
      if (!(await verifyBookingOwnership(actor.actorId, bookingId))) throw new Error("BOOKING_ACCESS_DENIED");
      return bookingService.update(actor.actorId, bookingId, {
        scheduledDate: String(args.scheduledDate),
      });
    },
    "write.booking.cancelBooking": async ({ actor, arguments: args }) => {
      const bookingId = String(args.bookingId);
      if (!(await verifyBookingOwnership(actor.actorId, bookingId))) throw new Error("BOOKING_ACCESS_DENIED");
      return bookingService.cancel(actor.actorId, bookingId, args.reason ? String(args.reason) : "Cancelled via AI tool", "CUSTOMER");
    },
    "write.support.createSupportTicket": async ({ actor, arguments: args }) => {
      const providerId = actor.actorRole === "PARTNER" ? await resolveProviderId(actor.actorId) : undefined;
      return supportTicketService.create(
        actor.actorId,
        {
          subject: String(args.subject),
          description: String(args.description),
          category: String(args.category),
          bookingId: args.bookingId ? String(args.bookingId) : undefined,
        },
        providerId ? { providerId } : undefined,
      );
    },
    "write.support.closeSupportTicket": async ({ actor, arguments: args }) =>
      supportTicketService.adminResolve(String(args.ticketId), actor.actorId, String(args.resolution)),
    "write.wallet.redeemCoupon": async ({ actor, arguments: args }) => {
      const code = String(args.couponCode).trim();
      const baseAmount = Number(args.baseAmount ?? 500);
      const validation = await campaignService.validateForUser(actor.actorId, code, baseAmount);
      if (!validation.ok) {
        return { couponCode: code, valid: false, error: validation.error };
      }
      return { couponCode: code, valid: true, discount: validation.discount, campaignId: validation.campaignId };
    },
    "write.notification.sendCustomerNotification": async ({ arguments: args }) =>
      notificationService.createForUser({
        userId: String(args.userId),
        type: args.type ? String(args.type) : "SYSTEM",
        title: String(args.title),
        message: String(args.message),
      }),
    "write.notification.sendPartnerNotification": async ({ arguments: args }) =>
      notificationService.createForUser({
        userId: String(args.userId),
        type: "SYSTEM",
        title: String(args.title),
        message: String(args.message),
      }),
    "write.partner.acceptJob": async ({ actor, arguments: args }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return bookingService.accept(
        providerId,
        String(args.bookingId),
        args.lat != null ? Number(args.lat) : 0,
        args.lng != null ? Number(args.lng) : 0,
      );
    },
    "write.partner.rejectJob": async ({ actor, arguments: args }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return bookingService.reject(providerId, String(args.bookingId), args.reason ? String(args.reason) : undefined);
    },
    "write.partner.updateAvailability": async ({ actor, arguments: args }) => {
      const providerId = await resolveProviderId(actor.actorId);
      if (!providerId) throw new Error("PROVIDER_NOT_FOUND");
      return providerService.setOnline(providerId, Boolean(args.online));
    },

    /**
     * Phase 5A — the first high-risk handler, and the template for the ones that follow.
     *
     * It contains no refund logic. Every rule about what may be refunded, how much, whether the
     * payment is in a refundable state, how the ledger is written and how a race is resolved
     * lives in `refundOrchestratorService` and stays there. Reimplementing any of it here would
     * create a second, quieter refund path that diverges from the audited one — which is the
     * failure this handler is shaped to avoid. What this function adds is the four things the
     * AI layer is responsible for: the sandbox gate, the approval requirement, the correlation
     * identity, and the translation of a rejection into a recorded failure.
     *
     * Correlation works through the idempotency key rather than a new column. The execution
     * engine derives `ai-approval:<approvalId>` and hands it here; passing it straight through
     * means `refund_requests.idempotency_key` carries the approval id, so a refund row resolves
     * to its approval, and the approval's `consumed_execution_id` resolves to the tool execution
     * that spent it. The chain is queryable in both directions without touching the financial
     * schema.
     *
     * That same key is what makes the call safe to repeat. The orchestrator looks it up first
     * and replays a COMPLETED refund instead of issuing a second one, so an approval that is
     * somehow presented twice cannot move money twice — the guarantee holds in the financial
     * service, not merely in the AI layer above it.
     */
    "high_risk.finance.refund": async ({ actor, arguments: args, executionId, approvalId, idempotencyKey }) => {
      const verdict = financialSandboxVerdict();
      if (!verdict.allowed) throw new Error(`SANDBOX_REFUSED:${verdict.reason}`);

      // Belt and braces. The engine will not reach a high-risk handler without consuming an
      // approval, but a handler that moves money should not depend on a caller upstream of it
      // having done that correctly.
      if (!approvalId) throw new Error("REFUND_REQUIRES_APPROVAL");
      if (actor.actorRole !== "ADMIN") throw new Error("REFUND_REQUIRES_ADMIN");

      const payload = (args.payload ?? args) as Record<string, unknown>;
      const paymentId = typeof payload.paymentId === "string" ? payload.paymentId.trim() : "";
      const amount = Number(payload.amount);
      const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";

      if (!paymentId) throw new Error("REFUND_INVALID_PAYMENT_ID");
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("REFUND_INVALID_AMOUNT");
      if (!reason) throw new Error("REFUND_REASON_REQUIRED");

      const result = await refundOrchestratorService.executeRefund({
        paymentId,
        amount,
        reason,
        actorUserId: actor.actorId,
        // Derived, not asserted. The service performs its own admin check, and that check stays
        // meaningful only if it is given the real value.
        isAdmin: actor.actorRole === "ADMIN",
        // "admin" is accurate — a human admin approved this — and it keeps the orchestrator's
        // own admin amount validation in force. Introducing an "ai" source would have meant
        // editing an authoritative financial service to add a path with no validation history.
        source: "admin",
        idempotencyKey,
        bookingId: typeof payload.bookingId === "string" ? payload.bookingId : undefined,
      });

      // The orchestrator reports business rejections by return value, not by throwing. Left
      // as-is they would surface as a successful tool call that quietly refunded nothing, so
      // they are raised here and recorded as failures.
      if ("error" in result) {
        // An unknown gateway outcome is not a failure and must not be recorded as one. The flag
        // is what lifts this execution to INDETERMINATE / OUTCOME_UNKNOWN, so the tool audit
        // agrees with the refund record instead of claiming nothing happened.
        if (result.indeterminate) {
          throw Object.assign(new Error("REFUND_OUTCOME_UNKNOWN"), { outcomeUnknown: true });
        }
        throw new Error(`REFUND_REJECTED:${result.error}`);
      }

      return {
        refundId: result.refundId,
        status: result.status,
        amount: result.amount,
        idempotencyKey: result.idempotencyKey,
        approvalId,
        executionId,
      };
    },
  };
}

export function registerToolHandlers(catalog: CatalogEntry[]): ToolRegistryEntry[] {
  const handlers = handlerMap();
  return catalog.map((tool) => ({
    ...tool,
    /**
     * High-risk stays unbound by default, and both gates must agree before it binds: the tool
     * has to be on the sandbox allowlist *and* the environment has to permit financial
     * execution right now. Outside a sandbox nothing binds, so production behaves exactly as
     * the Phase-5 freeze left it — every high-risk request terminates at NO_HANDLER.
     *
     * Binding is still not permission to run. The verdict is re-read inside the handler on
     * every call, because this runs once at registry construction and an environment can drift
     * underneath a long-lived process.
     */
    handler:
      tool.category === "HIGH_RISK"
        ? isSandboxExecutableHighRiskTool(tool.toolId) && financialSandboxVerdict().allowed
          ? handlers[tool.toolId]
          : undefined
        : handlers[tool.toolId],
  }));
}
