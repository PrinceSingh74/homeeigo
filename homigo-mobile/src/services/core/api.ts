import type { ApiResponse } from "@/types/auth";
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
  BackendRefund,
  BackendService,
  BackendTracking,
  BackendWalletTransaction,
  BackendWithdrawal,
} from "@/types/backend";
import { normalizeBackendAddress } from "@/lib/addresses";
import { apiRequest } from "@/services/auth/api-client";

export type StatsOverview = {
  completedBookings: number;
  activeProviders: number;
  availableServices: number;
  customers: number;
  averageRating: number | null;
  reviewCount: number;
};

export type CityCoverageSummary = {
  slug: string;
  name: string;
  state: string;
  tier: number;
  status: CoverageStatus;
  areaCount: number;
  pincodeCount: number;
  societyCount: number;
  activePartners: number;
  customers: number;
  servicesCompleted: number;
  fulfillmentRate: number;
  coverageScore: number;
};

/** Cancellation refund preview — mirrors the backend cancellation-policy tiers. */
export type CancellationQuote = {
  paidAmount: number;
  feeAmount: number;
  feePercent: number;
  refundAmount: number;
  message: string;
  refundMethodHint: string;
};

export type CoverageStatus = "AVAILABLE" | "LIMITED" | "COMING_SOON";

export type AreaCoverage = {
  id: string;
  name: string;
  status: CoverageStatus;
  pincodes: string[];
  societyCount: number;
  activePartners: number;
  density: string;
  avgArrivalMins: number;
};

export type PincodeCoverage = {
  pincode: string;
  areaName: string;
  status: CoverageStatus;
  partnerCount: number;
};

export type SocietyCoverage = {
  id: string;
  name: string;
  areaName: string;
  status: CoverageStatus;
  partnerCount: number;
  avgResponseMins: number;
  rating: number;
  availableServices: string[];
};

export type CityCoverageDetail = {
  summary: CityCoverageSummary;
  areas: AreaCoverage[];
  pincodes: PincodeCoverage[];
  societies: SocietyCoverage[];
  services: Array<{ name: string; slug: string; availability?: unknown }>;
  responseEngine: {
    avgArrivalMins: number;
    acceptanceRate: number;
    completionRate: number;
    cancellationRate: number;
  };
  generatedAt: string;
};

export type CoverageSearchResult = {
  type: "CITY" | "AREA" | "PINCODE" | "SOCIETY";
  covered: boolean;
  status: CoverageStatus;
  citySlug: string;
  cityName: string;
  label: string;
  sublabel: string;
  partnersNearby: number;
  expectedArrivalMins: number;
  availableToday: boolean;
};

export const coreApi = {
  stats: {
    overview: () =>
      apiRequest<ApiResponse<StatsOverview>>("/api/stats/overview").then((r) => r.data!),
  },

  coverage: {
    cities: () =>
      apiRequest<ApiResponse<{ cities: CityCoverageSummary[]; total: number }>>(
        "/api/coverage/cities",
      ).then((r) => r.data!),
    cityDetail: (slug: string) =>
      apiRequest<ApiResponse<CityCoverageDetail>>(
        `/api/coverage/cities/${encodeURIComponent(slug)}`,
      ).then((r) => r.data!),
    search: (q: string) =>
      apiRequest<ApiResponse<{ results: CoverageSearchResult[]; query: string }>>(
        `/api/coverage/search?q=${encodeURIComponent(q)}`,
      ).then((r) => r.data!),
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
      apiRequest<ApiResponse<{ booking: BackendBooking }>>(`/api/bookings/${id}/cancel`, {
        method: "POST",
        body: { reason, cancelledBy },
        auth: true,
      }).then((r) => r.data!),
    /** Exact refund/fee for cancelling this booking, per the live policy tiers. */
    cancellationQuote: (id: string) =>
      apiRequest<ApiResponse<{ quote: CancellationQuote }>>(
        `/api/bookings/${id}/cancellation-quote`,
        { auth: true },
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
    registerPushToken: (payload: {
      deviceId: string;
      expoPushToken: string;
      platform: "IOS" | "ANDROID" | "WEB";
      deviceName?: string;
      appVersion?: string;
      osVersion?: string;
    }) =>
      apiRequest<ApiResponse<{ device: Record<string, unknown> }>>("/api/users/me/devices/push-token", {
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
      const { getApiBaseUrl } = await import("@/lib/api-config");
      let token = useAuthStore.getState().accessToken;
      if (!token) {
        const refreshed = await useAuthStore.getState().refreshSession();
        if (!refreshed) throw new Error("Export failed — sign in again");
        token = useAuthStore.getState().accessToken;
      }
      const res = await fetch(`${getApiBaseUrl()}/api/users/me/export?format=${format}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Export failed");
      if (format === "zip") return res.blob();
      return res.json();
    },
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
      >("/api/ai/chat", { method: "POST", body: payload, auth: true }).then((r) => r.data!),

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
      apiRequest<
        ApiResponse<{ razorpayOrderId: string; amount: number; currency: string; key?: string }>
      >(
        "/api/wallet/add-money",
        { method: "POST", body: { amount, paymentMethod }, auth: true },
      ).then((r) => r.data!),
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
      apiRequest<
        ApiResponse<
          | { paymentId: string; status: string; bookingId?: string }
          | { walletTransactionId: string; status: string; balance: number }
        >
      >("/api/payments/verify", {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    history: (query = "") =>
      apiRequest<ApiResponse<{ payments: Array<Record<string, unknown>>; total: number; page: number }>>(
        `/api/payments/history${query}`,
        { auth: true },
      ).then((r) => r.data!),
    refund: (paymentId: string, payload: { reason: string; amount: number }) =>
      apiRequest<ApiResponse<{ refund: BackendRefund }>>(`/api/payments/${paymentId}/refund`, {
        method: "POST",
        body: payload,
        auth: true,
      }).then((r) => r.data!),
    byId: (paymentId: string) =>
      apiRequest<ApiResponse<{ payment: Record<string, unknown> }>>(`/api/payments/${paymentId}`, {
        auth: true,
      }).then((r) => r.data!),
  },

  ratings: {
    /** Platform-wide recent public reviews for the home "Loved by customers" rail. */
    recent: (limit = 12) =>
      apiRequest<
        ApiResponse<{
          reviews: Array<{
            id: string;
            name: string;
            rating: number;
            reviewText: string | null;
            service: string;
            createdAt: string;
          }>;
          total: number;
          averageRating: number | null;
        }>
      >(`/api/ratings/recent?limit=${limit}`).then((r) => r.data!),
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
    entitlements: () =>
      apiRequest<ApiResponse<Entitlements>>("/api/subscriptions/entitlements", { auth: true }).then(
        (r) => r.data!,
      ),
    insights: () =>
      apiRequest<ApiResponse<MembershipInsights>>("/api/subscriptions/insights", { auth: true }).then(
        (r) => r.data!,
      ),
    cashbackHistory: () =>
      apiRequest<ApiResponse<CashbackHistoryResponse>>("/api/subscriptions/cashback/history?limit=10", {
        auth: true,
      }).then((r) => r.data!),
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

export interface CashbackHistoryResponse {
  cashbacks: Array<{
    id: string;
    bookingNumber: string;
    amount: number;
    cashbackPct: number;
    createdAt: string;
  }>;
  summary: { totalCredited: number; count: number };
}

export interface MembershipInsights {
  entitlements: Entitlements;
  recentBenefitUsage: Array<{ benefitType: string; count: number; amount: number }>;
  recentCashback: CashbackHistoryResponse["cashbacks"];
  cashbackSummary: CashbackHistoryResponse["summary"];
}
