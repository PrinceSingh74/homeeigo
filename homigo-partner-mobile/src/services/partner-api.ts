import { getApiBaseUrl } from "@/lib/api-config";
import type {
  DemandForecast,
  DensityZone,
  GeoIntel,
  PartnerAcademy,
  PartnerAttendance,
  PartnerBookingsResponse,
  PartnerCompliance,
  PartnerDashboard,
  PartnerDocument,
  PartnerEarningsSummary,
  PartnerEntitlements,
  PartnerForecast,
  PartnerIncentives,
  PartnerIntelligence,
  PartnerInvoices,
  PartnerMembershipData,
  PartnerMembershipPlan,
  PartnerNotificationsResponse,
  PartnerPayoutsData,
  PartnerRankings,
  PartnerReview,
  PartnerRewards,
  PartnerReviewsResponse,
  PartnerServiceHistory,
  PartnerSupportTicket,
  PartnerSupportTicketDetail,
  PartnerTaxSummary,
  PartnerUser,
  PartnerWellbeing,
  ProviderProfile,
  RouteOptimizeResult,
  SurgeZone,
  WalletBalance,
  WalletTransactionsResponse,
  ZoneScoring,
} from "@/types/partner";

type ApiResponse<T> = { success: boolean; data?: T; error?: string };

let accessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(`${getApiBaseUrl()}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const res = await fetch(url.toString(), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const json = (await res.json()) as ApiResponse<T>;
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? res.statusText ?? "Request failed");
  }
  return json.data as T;
}

export type LoginPayload = {
  accessToken: string;
  refreshToken: string;
  user: PartnerUser;
};

export const partnerApi = {
  login: async (email: string, password: string) => {
    const { getDeviceId, getDeviceName } = await import("@/lib/device");
    const deviceId = await getDeviceId();
    return request<LoginPayload>("/api/auth/login", {
      method: "POST",
      body: { email, password, deviceId, deviceName: getDeviceName(), setAuthCookies: false },
    });
  },

  logout: (refreshToken: string) =>
    request<unknown>("/api/auth/logout", { method: "POST", body: { refreshToken, clearAuthCookies: false } }),

  me: () => request<{ user: PartnerUser }>("/api/user/me"),

  provider: () => request<{ provider: ProviderProfile }>("/api/providers/me").then((r) => r.provider),

  setOnline: (online: boolean) =>
    request<{ id: string; isOnline: boolean; onlineSince: string | null }>("/api/providers/me/online", {
      method: "PUT",
      body: { online },
    }),

  dashboard: () => request<PartnerDashboard>("/api/providers/me/dashboard"),

  earnings: (days = 30) => request<PartnerEarningsSummary>("/api/providers/me/earnings", { query: { days } }),

  listBookings: (query: { status?: string; page?: number; limit?: number; sortBy?: string } = {}) =>
    request<PartnerBookingsResponse>("/api/providers/me/bookings", { query }),

  acceptBooking: (bookingId: string, eta?: number) =>
    request<{ newlyAccepted?: boolean; booking: { id: string; status: string } }>(
      `/api/bookings/${bookingId}/accept`,
      { method: "POST", body: { eta } },
    ),

  rejectBooking: (bookingId: string, reason: string) =>
    request<unknown>(`/api/bookings/${bookingId}/reject`, { method: "POST", body: { reason } }),

  /**
   * Declares departure — the authoritative producer of `enRouteAt`, which the ETA
   * training label's duration is measured from. Idempotent: a repeat call returns
   * `newlyTransitioned: false` and leaves the timestamp untouched.
   */
  markEnRoute: (bookingId: string, latitude: number, longitude: number) =>
    request<{ newlyTransitioned: boolean; booking: { status: string; enRouteAt: string | null } }>(
      `/api/bookings/${bookingId}/en-route`,
      { method: "POST", body: { latitude, longitude } },
    ),

  /** Declares arrival. Races safely with the GPS geofence and the job-start fallback. */
  markArrived: (bookingId: string, latitude: number, longitude: number) =>
    request<{ newlyTransitioned: boolean; booking: { arrivedAt: string | null } }>(
      `/api/bookings/${bookingId}/arrived`,
      { method: "POST", body: { latitude, longitude } },
    ),

  startBooking: (bookingId: string, latitude: number, longitude: number) =>
    request<{ booking: { status: string } }>(`/api/bookings/${bookingId}/start`, {
      method: "POST",
      body: { latitude, longitude },
    }),

  completeBooking: (bookingId: string, latitude: number, longitude: number, notes?: string) =>
    request<{ booking: { status: string } }>(`/api/bookings/${bookingId}/complete`, {
      method: "POST",
      body: { latitude, longitude, notes },
    }),

  cancelBooking: (bookingId: string, reason: string) =>
    request<unknown>(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      body: { reason, cancelledBy: "provider" },
    }),

  walletBalance: () => request<WalletBalance>("/api/wallet/balance"),

  walletTransactions: (query: { page?: number; limit?: number } = {}) =>
    request<WalletTransactionsResponse>("/api/wallet/transactions", { query }),

  withdraw: (payload: { amount: number; bankAccountNumber: string; ifscCode: string; accountHolder: string }) =>
    request<{ withdrawal: { id: string; withdrawalNumber: string; amount: number; status: string } }>(
      "/api/wallet/withdraw",
      { method: "POST", body: payload },
    ),

  payouts: () => request<PartnerPayoutsData>("/api/providers/me/payouts"),

  reviews: (query: { page?: number; limit?: number } = {}) =>
    request<PartnerReviewsResponse>("/api/providers/me/reviews", { query }),

  respondToRating: (ratingId: string, response: string) =>
    request<{ rating: PartnerReview }>(`/api/ratings/${ratingId}/respond`, {
      method: "POST",
      body: { response },
    }),

  invoices: () => request<PartnerInvoices>("/api/providers/me/invoices"),

  taxSummary: () => request<PartnerTaxSummary>("/api/providers/me/tax-summary"),

  routeOptimize: () => request<RouteOptimizeResult>("/api/providers/me/route/optimize"),

  updateProfile: (body: { firstName?: string; lastName?: string; bio?: string }) =>
    request<{ user: Record<string, unknown> }>("/api/users/me", { method: "PUT", body }),

  updateSettings: (body: Record<string, unknown>) =>
    request<{ settings: Record<string, unknown> }>("/api/providers/me/settings", { method: "PUT", body }),

  updatePreferences: (body: Record<string, boolean>) =>
    request<unknown>("/api/users/preferences", { method: "PUT", body }),

  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    request<unknown>("/api/auth/change-password", { method: "POST", body }),

  sessions: () =>
    request<{
      sessions: Array<{
        id: string;
        deviceName: string | null;
        platform: string | null;
        lastActiveAt: string;
        isCurrent: boolean;
      }>;
    }>("/api/auth/sessions"),

  logoutOtherSessions: () =>
    request<{ revoked: number }>("/api/auth/sessions/others", { method: "DELETE" }),

  notifications: {
    list: (query: { page?: number; limit?: number; unreadOnly?: boolean } = {}) =>
      request<PartnerNotificationsResponse>("/api/notifications", {
        query: { ...query, ...(query.unreadOnly ? { isRead: "false" } : {}) },
      }),
    markRead: (id: string) => request<unknown>(`/api/notifications/${id}/read`, { method: "PUT" }),
    remove: (id: string) => request<unknown>(`/api/notifications/${id}`, { method: "DELETE" }),
  },

  subscriptions: {
    plans: () => request<{ plans: PartnerMembershipPlan[] }>("/api/subscriptions/plans").then((r) => r.plans),
    mine: () => request<PartnerMembershipData>("/api/subscriptions/me"),
    entitlements: () => request<PartnerEntitlements>("/api/subscriptions/entitlements"),
    createOrder: (planId: string) =>
      request<{
        razorpayOrderId: string;
        amount: number;
        currency: string;
        key: string;
        planName: string;
        checkoutMode?: "razorpay" | "dev_mock";
      }>("/api/subscriptions/order", { method: "POST", body: { planId } }),
    verify: (body: { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string }) =>
      request<unknown>("/api/subscriptions/verify", { method: "POST", body }),
    cancel: () => request<unknown>("/api/subscriptions/cancel", { method: "POST" }),
  },

  referrals: {
    summary: () =>
      request<{
        code: string | null;
        referralCount: number;
        totalEarned: number;
        balance: number;
      }>("/api/referrals/me"),
  },

  support: {
    tickets: () => request<{ tickets: PartnerSupportTicket[]; total: number }>("/api/support/tickets"),
    ticketById: (id: string) => request<{ ticket: PartnerSupportTicketDetail }>(`/api/support/tickets/${id}`),
    createTicket: (payload: { subject: string; description: string; category: string; priorityLevel?: string }) =>
      request<{ ticket: PartnerSupportTicket }>("/api/support/tickets", { method: "POST", body: payload }),
    reply: (id: string, body: string) =>
      request<unknown>(`/api/support/tickets/${id}/reply`, { method: "POST", body: { body } }),
  },

  geoIntel: {
    surge: () => request<GeoIntel<SurgeZone[]>>("/api/geo-intel/surge"),
    density: () => request<GeoIntel<DensityZone[]>>("/api/geo-intel/provider-density"),
    zoneScoring: () => request<GeoIntel<ZoneScoring>>("/api/geo-intel/zone-scoring"),
    demandForecast: (horizon = 24) => request<GeoIntel<DemandForecast>>("/api/geo-intel/demand-forecast", { query: { horizon } }),
  },

  weatherAlerts: (lat: number, lng: number) =>
    request<{
      available: boolean;
      severity?: string;
      alerts?: Array<{ type: string; level: string; message: string }>;
    }>(`/api/weather/alerts?lat=${lat}&lng=${lng}`),

  partnerOs: {
    attendance: () => request<PartnerAttendance>("/api/providers/me/attendance"),
    checkIn: () => request<unknown>("/api/providers/me/attendance/check-in", { method: "POST" }),
    checkOut: () => request<unknown>("/api/providers/me/attendance/check-out", { method: "POST" }),
    incentives: () => request<PartnerIncentives>("/api/providers/me/incentives"),
    forecast: () => request<PartnerForecast>("/api/providers/me/forecast"),
    intelligence: (days = 90) => request<PartnerIntelligence>("/api/providers/me/intelligence", { query: { days } }),
    rankings: () => request<PartnerRankings>("/api/providers/me/rankings"),
    academy: () => request<PartnerAcademy>("/api/providers/me/academy"),
    completeAcademyModule: (moduleId: string) =>
      request<unknown>(`/api/providers/me/academy/${moduleId}/complete`, { method: "POST" }),
    compliance: () => request<PartnerCompliance>("/api/providers/me/compliance"),
    wellbeing: () => request<PartnerWellbeing>("/api/providers/me/wellbeing"),
    rewards: () => request<PartnerRewards>("/api/providers/me/rewards"),
    serviceHistory: () => request<PartnerServiceHistory>("/api/providers/me/service-history"),
    documents: () => request<{ documents: PartnerDocument[] }>("/api/providers/me/documents"),
  },

  attendance: () => request<PartnerAttendance>("/api/providers/me/attendance"),
  checkIn: () => request<unknown>("/api/providers/me/attendance/check-in", { method: "POST" }),
  checkOut: () => request<unknown>("/api/providers/me/attendance/check-out", { method: "POST" }),
  incentives: () => request<PartnerIncentives>("/api/providers/me/incentives"),
};

export type { PartnerUser };
