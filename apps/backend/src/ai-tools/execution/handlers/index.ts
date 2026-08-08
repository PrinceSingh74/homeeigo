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
import type { ToolHandler, ToolRegistryEntry } from "../../types";
import { resolveProviderId, verifyBookingAccess, verifyBookingOwnership } from "../actor-resolver";

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
  };
}

export function registerToolHandlers(catalog: CatalogEntry[]): ToolRegistryEntry[] {
  const handlers = handlerMap();
  return catalog.map((tool) => ({
    ...tool,
    handler: tool.category === "HIGH_RISK" ? undefined : handlers[tool.toolId],
  }));
}
