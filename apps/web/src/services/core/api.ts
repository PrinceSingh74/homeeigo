import type { ApiResponse } from "@/types/auth";
import { resolveApiBase } from "@/lib/api-base";
import type {
  BackendAddress,
  BackendAvailabilitySlot,
  BackendBooking,
  BackendMatchedProvider,
  BackendNotification,
  BackendProvider,
  BackendProviderAvailability,
  BackendProviderDetail,
  BackendProviderReview,
  BackendRating,
  BackendService,
  BackendTracking,
  BackendWalletTransaction,
  BackendWithdrawal,
} from "@/types/backend";
import { normalizeBackendAddress } from "@/lib/addresses";
import { apiRequest } from "@/services/auth/api-client";
import type {
  CityCoverageDetail,
  CityCoverageSummary,
  CoverageRequestPayload,
  CoverageSearchResult,
} from "@/lib/coverage/coverage-types";

// Phase 16 — geolocation response shapes (mirror apps/backend maps.service / matching).
export type GeoPrediction = { placeId: string; description: string; mainText: string; secondaryText: string };
export type GeoAddress = {
  formattedAddress: string;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
};
export type NearbyProvider = {
  providerId: string;
  name: string;
  rating: number;
  totalReviews: number;
  distance: number;
  eta: number;
  isOnline: boolean;
  availability: boolean;
  profileImage: string | null;
};

export type StatsOverview = {
  completedBookings: number;
  activeProviders: number;
  availableServices: number;
  customers: number;
  averageRating: number | null;
  reviewCount: number;
};

export const coreApi = {
  stats: {
    overview: () =>
      apiRequest<ApiResponse<StatsOverview>>("/api/stats/overview").then((r) => r.data!),
  },

  ai: {
    chat: (payload: {
      message: string;
      conversationId?: string;
      history?: Array<{ role: "user" | "assistant"; content: string }>;
    }) =>
      apiRequest<
        ApiResponse<{
          conversationId: string;
          reply: string;
          quickActions: string[];
          suggestedServiceId?: string;
          suggestedService?: { id: string; name: string; basePrice: number };
        }>
      >("/api/ai/chat", { method: "POST", auth: true, body: payload }).then((r) => r.data!),

    latestConversation: () =>
      apiRequest<
        ApiResponse<{
          id: string;
          title: string | null;
          messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }>;
        } | null>
      >("/api/ai/conversations/latest", { auth: true }).then((r) => r.data),

    deleteConversation: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/ai/conversations/${id}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  services: {
    list: (query = "") =>
      apiRequest<ApiResponse<{ services: BackendService[]; total: number; page: number; limit: number }>>(
        `/api/services${query}`,
      ).then((r) => r.data!),
    featured: () =>
      apiRequest<ApiResponse<{ services: BackendService[]; total: number }>>("/api/services/featured").then(
        (r) => r.data!,
      ),
    search: (payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ services: BackendService[]; total: number; searchTime?: number }>>(
        "/api/services/search",
        { method: "POST", body: payload },
      ).then((r) => r.data!),
    details: (id: string) =>
      apiRequest<ApiResponse<{ service: BackendService }>>(`/api/services/${id}`).then((r) => r.data!),
    byCategory: (category: string, query = "") =>
      apiRequest<ApiResponse<{ services: BackendService[]; total: number }>>(
        `/api/services/category/${encodeURIComponent(category)}${query}`,
      ).then((r) => r.data!),
  },

  providers: {
    search: (payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ providers: BackendProvider[]; total: number; page: number }>>(
        "/api/providers/search",
        { method: "POST", body: payload },
      ).then((r) => r.data!),
    match: (payload: {
      serviceId: string;
      latitude: number;
      longitude: number;
      scheduledDate: string;
      maxResults?: number;
      maxDistanceKm?: number;
    }) =>
      apiRequest<ApiResponse<{ providers: BackendMatchedProvider[]; total: number }>>(
        "/api/providers/match",
        { method: "POST", body: payload, auth: true },
      ).then((r) => r.data!),
    nearby: (query = "") =>
      apiRequest<ApiResponse<{ providers: BackendProvider[] }>>(`/api/providers/nearby${query}`, {
        auth: true,
      }).then((r) => r.data!),
    details: (id: string) =>
      apiRequest<ApiResponse<{ provider: BackendProviderDetail }>>(`/api/providers/${id}`, {
        auth: true,
      }).then((r) => r.data!),
    reviews: (id: string, query = "") =>
      apiRequest<
        ApiResponse<{
          reviews: BackendProviderReview[];
          total: number;
          page: number;
          averageRating?: number;
          breakdown?: Record<string, number>;
        }>
      >(`/api/providers/${id}/reviews${query}`, { auth: true }).then((r) => r.data!),
    availability: (id: string, date: string, serviceId: string) =>
      apiRequest<
        ApiResponse<
          BackendProviderAvailability | { date: string; slots: BackendAvailabilitySlot[] }
        >
      >(
        `/api/providers/${id}/availability?date=${encodeURIComponent(date)}&serviceId=${encodeURIComponent(serviceId)}`,
        { auth: true },
      ).then((r) => r.data!),
    book: (id: string, payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ booking: BackendBooking }>>(`/api/providers/${id}/book`, {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
  },

  bookings: {
    listMine: (query = "", auth = true) =>
      apiRequest<ApiResponse<{ bookings: BackendBooking[]; total: number; page: number; limit: number }>>(
        `/api/users/bookings${query}`,
        { auth },
      ).then((r) => r.data!),
    upcoming: () =>
      apiRequest<ApiResponse<{ bookings: BackendBooking[]; total: number }>>("/api/bookings/upcoming", {
        auth: true,
      }).then((r) => r.data!),
    priceQuote: (payload: {
      serviceId: string;
      couponCode?: string;
      packagePrice?: number;
      addonIds?: string[];
    }) =>
      apiRequest<
        ApiResponse<{
          quote: {
            serviceBasePrice: number;
            packagePrice: number;
            addonTotal: number;
            baseAmount: number;
            membershipDiscount: number;
            campaignDiscount: number;
            freeDeliveryDiscount: number;
            discount: number;
            discountedBase: number;
            taxes: number;
            finalAmount: number;
            couponCode?: string;
            couponError?: string;
          };
        }>
      >("/api/bookings/price-quote", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    create: (payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ booking: BackendBooking }>>("/api/bookings", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    byId: (id: string) =>
      apiRequest<ApiResponse<{ booking: BackendBooking }>>(`/api/bookings/${id}`, {
        auth: true,
      }).then((r) => r.data!),
    cancel: (id: string, reason: string, cancelledBy: "user" | "provider") =>
      apiRequest<
        ApiResponse<{
          booking: {
            id: string;
            status?: string;
            refundAmount?: number;
            refundStatus?: string;
            cancellationFee?: number;
            refundMessage?: string;
          };
        }>
      >(`/api/bookings/${id}/cancel`, {
        method: "POST",
        body: { reason, cancelledBy },
        auth: true,
      }).then((r) => r.data!),
    cancellationQuote: (id: string) =>
      apiRequest<
        ApiResponse<{
          quote: {
            paidAmount: number;
            feeAmount: number;
            feePercent: number;
            refundAmount: number;
            message: string;
            refundMethodHint: string;
          };
        }>
      >(`/api/bookings/${id}/cancellation-quote`, { auth: true }).then((r) => r.data!),
    cancellationPolicy: () =>
      apiRequest<ApiResponse<{ tiers: Array<Record<string, unknown>> }>>(
        "/api/bookings/cancellation-policy",
        { auth: false },
      ).then((r) => r.data!),
    update: (id: string, payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ booking: BackendBooking }>>(`/api/bookings/${id}`, {
        method: "PUT",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
  },

  users: {
    me: () =>
      apiRequest<ApiResponse<{ user: Record<string, unknown> }>>("/api/users/me", { auth: true }).then(
        (r) => r.data!,
      ),
    updateMe: (payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ user: Record<string, unknown> }>>("/api/users/me", {
        method: "PUT",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    ratings: (query = "") =>
      apiRequest<ApiResponse<{ ratings: Array<Record<string, unknown>>; total: number; page: number }>>(
        `/api/users/ratings${query}`,
        { auth: true },
      ).then((r) => r.data!),
    addresses: () =>
      apiRequest<ApiResponse<{ addresses: BackendAddress[] }>>("/api/users/addresses", {
        auth: true,
      }).then((r) => ({
        addresses: (r.data?.addresses ?? []).map((a) =>
          normalizeBackendAddress(a as unknown as Record<string, unknown>),
        ),
      })),
    createAddress: (payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ address: BackendAddress }>>("/api/users/addresses", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    updateAddress: (id: string, payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ address: BackendAddress }>>(`/api/users/addresses/${id}`, {
        method: "PUT",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    deleteAddress: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/users/addresses/${id}`, {
        method: "DELETE",
        auth: true,
      }),
    setDefaultAddress: (id: string) =>
      apiRequest<ApiResponse<{ address: BackendAddress }>>(`/api/users/addresses/${id}/set-default`, {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
    preferences: (payload: Record<string, unknown>) =>
      apiRequest<ApiResponse<{ preferences: Record<string, unknown> }>>("/api/users/preferences", {
        method: "PUT",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    deleteAccount: (reason?: string) =>
      apiRequest<ApiResponse<{ deletionScheduledAt: string; restoreUntil: string }>>("/api/users/me", {
        method: "DELETE",
        body: { confirm: true, reason },
        auth: true,
      }).then((r) => r.data!),
    exportData: async (format: "json" | "zip" = "json") => {
      const { useAuthStore } = await import("@/stores/auth-store");
      let token = useAuthStore.getState().accessToken;
      if (!token) {
        const refreshed = await useAuthStore.getState().refreshSession();
        if (!refreshed) throw new Error("Export failed — sign in again");
        token = useAuthStore.getState().accessToken;
      }
      const base = (resolveApiBase()).replace(/\/$/, "");
      const res = await fetch(`${base}/api/users/me/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error("Export failed");
      if (format === "zip") return res.blob();
      return res.json();
    },
  },

  // Phase 16 — geolocation (proxies the server-side Google integration; key never client-side).
  weather: {
    alerts: (lat: number, lng: number) =>
      apiRequest<
        ApiResponse<{
          available: boolean;
          severity?: "clear" | "mild" | "moderate" | "severe" | "extreme";
          alerts?: Array<{ type: string; level: "advisory" | "warning" | "severe"; message: string }>;
          vendorImpact?: { impact: "none" | "reduced" | "severe"; factor: number; reason: string };
          etaFactor?: number;
        }>
      >(`/api/weather/alerts?lat=${lat}&lng=${lng}`, { auth: true }).then((r) => r.data!),
    current: (lat: number, lng: number) =>
      apiRequest<ApiResponse<{ available: boolean; weather?: Record<string, unknown>; alerts?: unknown[] }>>(
        `/api/weather/current?lat=${lat}&lng=${lng}`,
        { auth: true },
      ).then((r) => r.data!),
  },
  // Hyperlocal Coverage Engine V1 — public coverage intelligence (no auth needed).
  coverage: {
    cities: () =>
      apiRequest<ApiResponse<{ cities: CityCoverageSummary[]; total: number }>>(
        "/api/coverage/cities",
      ).then((r) => r.data!),
    cityDetail: (slug: string) =>
      apiRequest<ApiResponse<CityCoverageDetail>>(
        `/api/coverage/cities/${encodeURIComponent(slug)}`,
      ).then((r) => r.data!),
    search: (q: string, limit = 12) =>
      apiRequest<ApiResponse<{ results: CoverageSearchResult[]; query: string }>>(
        `/api/coverage/search?q=${encodeURIComponent(q)}&limit=${limit}`,
      ).then((r) => r.data!),
    request: (payload: CoverageRequestPayload) =>
      apiRequest<ApiResponse<{ id: string; duplicate: boolean }>>("/api/coverage/requests", {
        method: "POST",
        body: payload,
      }).then((r) => r.data!),
  },

  geo: {
    config: () =>
      apiRequest<ApiResponse<{ mapsConfigured: boolean }>>("/api/geo/config", { auth: true }).then((r) => r.data!),
    autocomplete: (q: string, opts?: { lat?: number; lng?: number; session?: string }) => {
      const p = new URLSearchParams({ q });
      if (opts?.lat != null && opts?.lng != null) {
        p.set("lat", String(opts.lat));
        p.set("lng", String(opts.lng));
      }
      if (opts?.session) p.set("session", opts.session);
      return apiRequest<ApiResponse<{ available: boolean; predictions: GeoPrediction[] }>>(
        `/api/geo/autocomplete?${p.toString()}`,
        { auth: true },
      ).then((r) => r.data!);
    },
    reverse: (lat: number, lng: number) =>
      apiRequest<ApiResponse<{ available: boolean; address: GeoAddress | null }>>(
        `/api/geo/reverse?lat=${lat}&lng=${lng}`,
        { auth: true },
      ).then((r) => r.data!),
    place: (placeId: string) =>
      apiRequest<ApiResponse<GeoAddress | null>>(`/api/geo/place/${encodeURIComponent(placeId)}`, { auth: true }).then(
        (r) => r.data,
      ),
    eta: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
      apiRequest<ApiResponse<{ etaMinutes: number; distanceKm: number; source: "google" | "haversine"; withTraffic: boolean }>>(
        `/api/geo/eta?fromLat=${from.lat}&fromLng=${from.lng}&toLat=${to.lat}&toLng=${to.lng}`,
        { auth: true },
      ).then((r) => r.data!),
    nearbyProviders: (payload: { serviceId: string; latitude: number; longitude: number; scheduledDate?: string; maxDistanceKm?: number }) =>
      apiRequest<ApiResponse<{ providers: NearbyProvider[]; count: number }>>("/api/geo/nearby-providers", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
  },
  wallet: {
    balance: () =>
      apiRequest<
        ApiResponse<{
          balance: number;
          currency: string;
          lastTransaction?: BackendWalletTransaction;
        }>
      >("/api/wallet/balance", { auth: true }).then((r) => r.data!),
    transactions: (query = "") =>
      apiRequest<ApiResponse<{ transactions: BackendWalletTransaction[]; total: number; page: number }>>(
        `/api/wallet/transactions${query}`,
        { auth: true },
      ).then((r) => r.data!),
    offers: () =>
      apiRequest<ApiResponse<{ offers: Array<Record<string, unknown>> }>>("/api/wallet/offers", { auth: true }).then(
        (r) => r.data!,
      ),
    addMoney: (amount: number, paymentMethod = "razorpay") =>
      apiRequest<ApiResponse<{ razorpayOrderId: string; amount: number; currency: string; key: string }>>(
        "/api/wallet/add-money",
        { method: "POST", body: { amount, paymentMethod }, auth: true },
      ).then((r) => r.data!),
    // Phase 18 — wallet checkout (wallet-only / wallet+Razorpay split) for a booking.
    checkout: {
      quote: (bookingId: string) =>
        apiRequest<
          ApiResponse<{
            bookingId: string;
            bookingAmount: number;
            taxes: number;
            finalAmount: number;
            walletBalance: number;
            walletApplicable: number;
            razorpayRequired: number;
            remainderDue: number;
            fullyPayableFromWallet: boolean;
            alreadyPaid: boolean;
          }>
        >("/api/wallet/checkout/quote", { method: "POST", body: { bookingId }, auth: true }).then((r) => r.data!),
      payFull: (bookingId: string) =>
        apiRequest<ApiResponse<{ ok: boolean; alreadyPaid: boolean; amountPaid: number; balance: number }>>(
          "/api/wallet/checkout/pay",
          { method: "POST", body: { bookingId }, auth: true },
        ).then((r) => r.data!),
      splitInitiate: (bookingId: string, walletAmount: number) =>
        apiRequest<
          ApiResponse<
            | { mode: "wallet_only"; status: "SUCCESS"; amountPaid: number; balance: number }
            | { mode: "split"; razorpayOrderId: string; razorpayAmount: number; walletAmount: number; finalAmount: number; key: string }
          >
        >("/api/wallet/checkout/split/initiate", { method: "POST", body: { bookingId, walletAmount }, auth: true }).then(
          (r) => r.data!,
        ),
      splitVerify: (payload: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
        apiRequest<ApiResponse<{ ok: boolean; status: string; bookingId: string; walletApplied: number; razorpayApplied: number; balance: number }>>(
          "/api/wallet/checkout/split/verify",
          { method: "POST", body: payload, auth: true },
        ).then((r) => r.data!),
    },
    withdraw: (payload: {
      amount: number;
      bankAccountNumber: string;
      ifscCode: string;
      accountHolder: string;
    }) =>
      apiRequest<ApiResponse<{ withdrawal: BackendWithdrawal }>>("/api/wallet/withdraw", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    paymentMethods: () =>
      apiRequest<ApiResponse<{ methods: SavedPaymentMethod[] }>>("/api/wallet/payment-methods", {
        auth: true,
      }).then((r) => r.data!.methods),
    addPaymentMethod: (payload: {
      type: "CARD" | "UPI" | "BANK";
      label: string;
      last4?: string;
      network?: string;
      upiHandle?: string;
      setDefault?: boolean;
    }) =>
      apiRequest<ApiResponse<{ method: SavedPaymentMethod }>>("/api/wallet/payment-methods", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!.method),
    deletePaymentMethod: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/wallet/payment-methods/${id}`, {
        method: "DELETE",
        auth: true,
      }),
    setDefaultPaymentMethod: (id: string) =>
      apiRequest<ApiResponse<{ method: SavedPaymentMethod }>>(
        `/api/wallet/payment-methods/${id}/set-default`,
        { method: "POST", auth: true },
      ).then((r) => r.data!.method),
  },

  payments: {
    createOrder: (bookingId: string, amount?: number, currency = "INR") =>
      apiRequest<
        ApiResponse<{
          razorpayOrderId: string;
          amount: number;
          currency: string;
          key: string;
          notes?: Record<string, string>;
        }>
      >("/api/payments/create-order", {
        method: "POST",
        body: { bookingId, amount, currency },
        auth: true,
      }).then((r) => r.data!),
    verify: (payload: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
      apiRequest<ApiResponse<{ paymentId: string; status: string; bookingId: string }>>("/api/payments/verify", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    history: (query = "") =>
      apiRequest<ApiResponse<{ payments: Array<Record<string, unknown>>; total: number; page: number }>>(
        `/api/payments/history${query}`,
        { auth: true },
      ).then((r) => r.data!),
    byId: (paymentId: string) =>
      apiRequest<ApiResponse<{ payment: Record<string, unknown> }>>(`/api/payments/${paymentId}`, {
        auth: true,
      }).then((r) => r.data!),
  },

  ratings: {
    byBooking: (bookingId: string) =>
      apiRequest<ApiResponse<{ rating: BackendRating }>>(`/api/ratings/${bookingId}`, {
        auth: true,
      }).then((r) => r.data!),
    submit: (payload: {
      bookingId: string;
      rating: number;
      reviewText?: string;
      photos?: string[];
      tipAmount?: number;
      liked?: string[];
      couldImprove?: string[];
    }) =>
      apiRequest<ApiResponse<{ rating: BackendRating }>>("/api/ratings", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    update: (
      ratingId: string,
      payload: { rating?: number; reviewText?: string; photos?: string[] },
    ) =>
      apiRequest<ApiResponse<unknown>>(`/api/ratings/${ratingId}`, {
        method: "PUT",
        body: payload,
        auth: true,
      }),
    respond: (ratingId: string, response: string) =>
      apiRequest<ApiResponse<{ rating: BackendRating }>>(`/api/ratings/${ratingId}/respond`, {
        method: "POST",
        body: { response },
        auth: true,
      }).then((r) => r.data!),
  },

  notifications: {
    list: (query = "") =>
      apiRequest<ApiResponse<{ notifications: BackendNotification[]; total: number; page: number; unreadCount: number }>>(
        `/api/notifications${query}`,
        { auth: true },
      ).then((r) => r.data!),
    markRead: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/notifications/${id}/read`, {
        method: "PUT",
        auth: true,
      }),
    markAllRead: () =>
      apiRequest<ApiResponse<{ count: number }>>("/api/notifications/read-all", {
        method: "PUT",
        auth: true,
      }),
    delete: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/notifications/${id}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  tracking: {
    get: (bookingId: string) =>
      apiRequest<ApiResponse<{ tracking: BackendTracking }>>(`/api/tracking/${bookingId}`, {
        auth: true,
      }).then((r) => r.data!),
  },

  subscriptions: {
    plans: () =>
      apiRequest<ApiResponse<{ plans: MembershipPlan[] }>>("/api/subscriptions/plans").then(
        (r) => r.data!.plans,
      ),
    mine: () =>
      apiRequest<ApiResponse<MySubscription>>("/api/subscriptions/me", { auth: true }).then(
        (r) => r.data!,
      ),
    order: (planId: string) =>
      apiRequest<ApiResponse<{ razorpayOrderId: string; amount: number; currency: string; key: string; planName: string }>>(
        "/api/subscriptions/order",
        { method: "POST", auth: true, body: { planId } },
      ).then((r) => r.data!),
    verify: (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
      apiRequest<ApiResponse<{ subscriptionId: string; expiresAt: string }>>(
        "/api/subscriptions/verify",
        { method: "POST", auth: true, body },
      ).then((r) => r.data!),
    cancel: () =>
      apiRequest<ApiResponse<unknown>>("/api/subscriptions/cancel", { method: "POST", auth: true }),
    invoices: () =>
      apiRequest<ApiResponse<{ invoices: SubscriptionInvoice[] }>>("/api/subscriptions/invoices", {
        auth: true,
      }).then((r) => r.data!.invoices),
    entitlements: () =>
      apiRequest<ApiResponse<Entitlements>>("/api/subscriptions/entitlements", { auth: true }).then(
        (r) => r.data!,
      ),
    benefitUsage: () =>
      apiRequest<ApiResponse<{ usage: BenefitUsageRow[]; entitlements: Entitlements }>>(
        "/api/subscriptions/benefit-usage",
        { auth: true },
      ).then((r) => r.data!),
    cashbackHistory: (query = "") =>
      apiRequest<ApiResponse<CashbackHistoryResponse>>(`/api/subscriptions/cashback/history${query}`, {
        auth: true,
      }).then((r) => r.data!),
    insights: () =>
      apiRequest<ApiResponse<MembershipInsights>>("/api/subscriptions/insights", { auth: true }).then(
        (r) => r.data!,
      ),
    coupons: () =>
      apiRequest<
        ApiResponse<{
          coupons: Array<{
            id: string;
            code: string;
            name: string;
            discountPct: number | null;
            discountAmount: number | null;
            expiresAt: string | null;
            usedAt: string | null;
            eligible: boolean;
          }>;
        }>
      >("/api/subscriptions/coupons", { auth: true }).then((r) => r.data!.coupons),
  },

  referrals: {
    summary: () =>
      apiRequest<ApiResponse<ReferralSummary>>("/api/referrals/me", { auth: true }).then((r) => r.data!),
    history: () =>
      apiRequest<ApiResponse<{ referrals: ReferralHistoryItem[] }>>("/api/referrals/history", {
        auth: true,
      }).then((r) => r.data!.referrals),
    leaderboard: () =>
      apiRequest<ApiResponse<{ leaderboard: ReferralLeaderEntry[] }>>("/api/referrals/leaderboard", {
        auth: true,
      }).then((r) => r.data!.leaderboard),
    withdraw: (amount: number) =>
      apiRequest<ApiResponse<{ balance: number; walletBalance: number }>>("/api/referrals/withdraw", {
        method: "POST",
        auth: true,
        body: { amount },
      }).then((r) => r.data!),
  },

  hcoins: {
    summary: () =>
      apiRequest<ApiResponse<HCoinSummary>>("/api/hcoins/me", { auth: true }).then((r) => r.data!),
    history: () =>
      apiRequest<ApiResponse<{ transactions: HCoinTxn[] }>>("/api/hcoins/history", {
        auth: true,
      }).then((r) => r.data!.transactions),
    redeem: (coins: number) =>
      apiRequest<ApiResponse<{ coinBalance: number; walletBalance: number; rupees: number }>>("/api/hcoins/redeem", {
        method: "POST",
        auth: true,
        body: { coins },
      }).then((r) => r.data!),
  },

  transfers: {
    initiate: (recipient: string, amount: number, note?: string) =>
      apiRequest<ApiResponse<{ transferId: string; recipient: string; otpSent: boolean; devOtp?: string }>>(
        "/api/wallet/transfer/initiate",
        { method: "POST", auth: true, body: { recipient, amount, note } },
      ).then((r) => r.data!),
    confirm: (transferId: string, otp: string) =>
      apiRequest<ApiResponse<{ amount: number; recipient: string; senderBalance: number }>>(
        "/api/wallet/transfer/confirm",
        { method: "POST", auth: true, body: { transferId, otp } },
      ).then((r) => r.data!),
    history: () =>
      apiRequest<ApiResponse<TransferHistory>>("/api/wallet/transfers", { auth: true }).then((r) => r.data!),
  },

  compliance: {
    requestExport: () =>
      apiRequest<ApiResponse<{ requestId: string; dueDateAt: string; slaDaysRemaining: number }>>(
        "/api/compliance/export",
        { method: "POST", auth: true },
      ).then((r) => r.data!),
    requestDeletion: (reason?: string) =>
      apiRequest<
        ApiResponse<{
          requestId: string;
          gracePeriodEndsAt: string;
          message: string;
        }>
      >("/api/compliance/delete", {
        method: "POST",
        auth: true,
        body: reason ? { reason } : {},
      }).then((r) => r.data!),
    myRequests: (limit = 20) =>
      apiRequest<
        ApiResponse<{
          requests: Array<{
            id: string;
            requestType: string;
            status: string;
            submittedAt: string;
            dueDateAt: string;
            slaDaysRemaining?: number;
          }>;
        }>
      >(`/api/compliance/requests?limit=${limit}`, { auth: true }).then((r) => r.data!.requests),
    exportDownload: (exportId: string) =>
      apiRequest<
        ApiResponse<{
          exportId: string;
          status: string;
          downloadUrl: string | null;
          expiresAt: string | null;
        }>
      >(`/api/compliance/export/${exportId}`, { auth: true }).then((r) => r.data!),
  },

  support: {
    createTicket: (payload: {
      subject: string;
      description: string;
      category: string;
      bookingId?: string;
      attachments?: string[];
    }) =>
      apiRequest<ApiResponse<{ ticket: SupportTicket }>>("/api/support/tickets", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!.ticket),
    tickets: (query = "") =>
      apiRequest<ApiResponse<{ tickets: SupportTicket[]; total: number; page: number }>>(
        `/api/support/tickets${query}`,
        { auth: true },
      ).then((r) => r.data!),
    ticketById: (id: string) =>
      apiRequest<ApiResponse<{ ticket: SupportTicketDetail }>>(`/api/support/tickets/${id}`, {
        auth: true,
      }).then((r) => r.data!.ticket),
    reply: (id: string, body: string) =>
      apiRequest<ApiResponse<{ message: SupportTicketMessage }>>(`/api/support/tickets/${id}/reply`, {
        method: "POST",
        auth: true,
        body: { body },
      }),
  },

  giftCards: {
    denominations: () =>
      apiRequest<ApiResponse<{ denominations: number[] }>>("/api/giftcards/denominations", {
        auth: true,
      }).then((r) => r.data!.denominations),
    myCards: () =>
      apiRequest<ApiResponse<{ cards: GiftCard[] }>>("/api/giftcards/me", { auth: true }).then(
        (r) => r.data!.cards,
      ),
    order: (amount: number, opts?: { recipientEmail?: string; recipientPhone?: string; message?: string }) =>
      apiRequest<ApiResponse<{ razorpayOrderId: string; amount: number; currency: string; key: string }>>(
        "/api/giftcards/order",
        { method: "POST", auth: true, body: { amount, ...opts } },
      ).then((r) => r.data!),
    verify: (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
      apiRequest<ApiResponse<{ code: string; amount: number; sentTo: string | null }>>(
        "/api/giftcards/verify",
        { method: "POST", auth: true, body },
      ).then((r) => r.data!),
    redeem: (code: string, amount?: number) =>
      apiRequest<ApiResponse<{ amount: number; walletBalance: number; remaining: number }>>("/api/giftcards/redeem", {
        method: "POST",
        auth: true,
        body: { code, amount },
      }).then((r) => r.data!),
    void: (id: string) =>
      apiRequest<ApiResponse<{ refunded: number; walletBalance: number }>>(`/api/giftcards/${id}/void`, {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
  },
};

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  category: string;
  priorityLevel: string;
  status: string;
  slaDueAt: string | null;
  firstResponseAt?: string | null;
  responseTimeMs?: number | null;
  slaBreached?: boolean;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketMessage {
  id: string;
  body: string;
  authorRole: string;
  createdAt: string;
}

export interface SupportTicketDetail extends SupportTicket {
  bookingId: string | null;
  attachments: string[];
  messages: SupportTicketMessage[];
}

export interface SavedPaymentMethod {
  id: string;
  type: "card" | "upi" | "bank";
  label: string;
  last4: string | null;
  network: string | null;
  upiHandle: string | null;
  isDefault: boolean;
  createdAt: string;
}

export interface GiftCard {
  id: string;
  code: string;
  amount: number;
  balance: number;
  status: "ACTIVE" | "REDEEMED" | "EXPIRED";
  role: "purchased" | "received";
  recipient: string | null;
  message: string | null;
  createdAt: string;
  expiresAt: string | null;
}

export interface TransferItem {
  id: string;
  direction: "sent" | "received";
  counterparty: string;
  amount: number;
  note: string | null;
  createdAt: string;
}
export interface TransferHistory {
  transfers: TransferItem[];
  limits: { min: number; maxPerTxn: number; maxDaily: number };
}

export interface HCoinSummary {
  balance: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  coinValue: number;
  minRedeem: number;
  redeemableValue: number;
}
export interface HCoinTxn {
  id: string;
  type: "EARN" | "REDEEM";
  amount: number;
  reason: string;
  description: string;
  balanceAfter: number;
  createdAt: string;
}

export interface ReferralSummary {
  code: string | null;
  referralCount: number;
  pending: number;
  qualified: number;
  commissionPerReferral: number;
  totalEarned: number;
  withdrawn: number;
  balance: number;
}
export interface ReferralHistoryItem {
  id: string;
  refereeName: string;
  status: "PENDING" | "QUALIFIED";
  amount: number;
  createdAt: string;
  qualifiedAt: string | null;
}
export interface ReferralLeaderEntry {
  rank: number;
  name: string;
  referrals: number;
  earned: number;
}

export type MembershipInterval = "MONTHLY" | "QUARTERLY" | "YEARLY";
export interface MembershipPlan {
  id: string;
  name: string;
  tier: string;
  interval: MembershipInterval;
  price: number;
  currency: string;
  description: string | null;
  benefits: { id: string; label: string }[];
}
export interface UserSubscription {
  id: string;
  status: "PENDING" | "ACTIVE" | "CANCELLED" | "EXPIRED";
  startsAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  plan: MembershipPlan;
}
export interface MySubscription {
  active: UserSubscription | null;
  history: UserSubscription[];
}
export interface SubscriptionInvoice {
  id: string;
  amount: number;
  invoiceNumber: string;
  periodStart: string;
  periodEnd: string;
  createdAt: string;
}

export interface Entitlements {
  hasMembership: boolean;
  tier: string | null;
  planName: string | null;
  expiresAt: string | null;
  discountPct: number;
  cashbackPct: number;
  premiumAccess: boolean;
  priorityBooking: boolean;
  prioritySupport: boolean;
  freeDelivery: boolean;
  benefits: { type: string; value: number | null; label: string }[];
}

export interface BenefitUsageRow {
  benefitType: string;
  period: string;
  count: number;
  amount: number;
  lastUsedAt: string;
}

export interface CashbackHistoryResponse {
  cashbacks: Array<{
    id: string;
    bookingId: string;
    bookingNumber: string;
    amount: number;
    cashbackPct: number;
    settledAmount: number;
    status: string;
    createdAt: string;
  }>;
  total: number;
  page: number;
  summary: { totalCredited: number; count: number };
}

export interface MembershipInsights {
  entitlements: Entitlements;
  recentBenefitUsage: BenefitUsageRow[];
  recentCashback: CashbackHistoryResponse["cashbacks"];
  cashbackSummary: CashbackHistoryResponse["summary"];
}
