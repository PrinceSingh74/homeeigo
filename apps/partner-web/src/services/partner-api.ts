import { apiRequest } from "@/lib/api-client";
import type {
  ApiResponse,
  JobActionResult,
  JobChatList,
  JobEvidenceItem,
  PartnerBookingsResponse,
  PartnerDashboard,
  PartnerEarningsSummary,
  PartnerEntitlements,
  PartnerMembershipData,
  PartnerMembershipPlan,
  PartnerNotificationsResponse,
  PartnerPayoutsData,
  PartnerReview,
  PartnerReviewsResponse,
  ProviderProfile,
  WalletBalance,
  WalletTransactionsResponse,
} from "@/types/partner";

type ListBookingsQuery = {
  status?: string;
  page?: number;
  limit?: number;
  sortBy?: "upcoming" | "recent";
};

// --- Geo-Intelligence envelopes (consumes /api/geo-intel/*; partner-allowed endpoints) ---
export type GeoIntel<T> = { success: boolean; data: T; confidence: number; freshness: string; source: string; cached: boolean; generatedAt: string };
export type SurgeZone = { zoneId: string; name: string; city: string | null; supply: number; activeBookings: number; weatherSurge: number; predictedSurge: number; demandDeltaPct: number | null };
export type DensityZone = { zoneId: string; name: string; city: string | null; centerLat: number; centerLng: number; providers: number; areaKm2: number; densityPerKm2: number };
export type ZoneScore = { zoneId: string; name: string; city: string | null; supply: number; demand24h: number; revenue24h: number; earningScore: number; demandScore: number; serviceHealth: number; riskScore: number; compositeScore: number };
export type ZoneScoring = { ranked: ZoneScore[]; bestEarning: ZoneScore[]; worstService: ZoneScore[]; highRisk: ZoneScore[] };
export type DemandPoint = { zone_id: string; hour: string; predicted: number; lo: number; hi: number };
export type DemandForecast = { horizonHours: number; points: DemandPoint[]; totalPredicted: number };
export type EtaResult = { etaMin: number; distanceKm: number; method: string; withTraffic?: boolean };

// --- Network coverage (shared source of truth: consumes /api/coverage/cities) ---
export type CityCoverageSummary = {
  slug: string;
  name: string;
  state: string;
  tier: number;
  status: "AVAILABLE" | "LIMITED" | "COMING_SOON";
  areaCount: number;
  pincodeCount: number;
  societyCount: number;
  activePartners: number;
  customers: number;
  servicesCompleted: number;
  fulfillmentRate: number;
  coverageScore: number;
};

export const partnerApi = {
  /* ----------------- Navigation telemetry (fire-and-forget) ----------- */
  navTelemetry: (body: { type: "session" | "reroute" | "arrival" | "pickup" | "drop"; latencyMs?: number; gpsAccuracy?: number; etaErrorMin?: number }) =>
    apiRequest<{ success: boolean }>("/api/partner/nav/telemetry", { auth: true, method: "POST", body }).catch(() => ({ success: false })),

  /* ----------------- Network coverage (public shared source) ---------- */
  coverage: {
    cities: () =>
      apiRequest<ApiResponse<{ cities: CityCoverageSummary[]; total: number }>>("/api/coverage/cities").then(
        (r) => r.data!,
      ),
  },

  /* ----------------- Geo-Intelligence (earnings/positioning) ---------- */
  geoIntel: {
    surge: () => apiRequest<GeoIntel<SurgeZone[]>>("/api/geo-intel/surge", { auth: true }),
    density: () => apiRequest<GeoIntel<DensityZone[]>>("/api/geo-intel/provider-density", { auth: true }),
    zoneScoring: () => apiRequest<GeoIntel<ZoneScoring>>("/api/geo-intel/zone-scoring", { auth: true }),
    demandForecast: (horizon = 24) => apiRequest<GeoIntel<DemandForecast>>("/api/geo-intel/demand-forecast", { auth: true, query: { horizon } }),
    eta: (fromLat: number, fromLng: number, toLat: number, toLng: number) =>
      apiRequest<GeoIntel<EtaResult>>("/api/geo-intel/eta", { auth: true, query: { fromLat, fromLng, toLat, toLng } }),
  },

  /* ----------------- Provider profile + online toggle ----------------- */
  me: () =>
    apiRequest<ApiResponse<{ provider: ProviderProfile }>>("/api/providers/me", {
      auth: true,
    }).then((r) => r.data!.provider),

  /** Weather warnings at the partner's current location (safety + ETA impact). */
  weatherAlerts: (lat: number, lng: number) =>
    apiRequest<
      ApiResponse<{
        available: boolean;
        severity?: "clear" | "mild" | "moderate" | "severe" | "extreme";
        alerts?: Array<{ type: string; level: "advisory" | "warning" | "severe"; message: string }>;
        vendorImpact?: { impact: "none" | "reduced" | "severe"; factor: number; reason: string };
        etaFactor?: number;
      }>
    >(`/api/weather/alerts?lat=${lat}&lng=${lng}`, { auth: true }).then((r) => r.data!),

  updateProfile: (body: {
    firstName?: string;
    lastName?: string;
    bio?: string;
    profileImage?: string;
  }) =>
    apiRequest<ApiResponse<{ user: Record<string, unknown> }>>("/api/users/me", {
      method: "PUT",
      auth: true,
      body,
    }),

  setOnline: (online: boolean) =>
    apiRequest<
      ApiResponse<{
        id: string;
        isOnline: boolean;
        onlineSince: string | null;
        operationalStatus?: string;
        operations?: import("@/types/partner").PartnerOperations;
      }>
    >("/api/providers/me/online", {
      method: "PUT",
      auth: true,
      body: { online },
    }).then((r) => r.data!),

  operations: () =>
    apiRequest<ApiResponse<import("@/types/partner").PartnerOperations>>("/api/providers/me/operations", {
      auth: true,
    }).then((r) => r.data!),

  pause: (reason?: string) =>
    apiRequest<ApiResponse<import("@/types/partner").PartnerOperations>>("/api/providers/me/pause", {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  resume: () =>
    apiRequest<ApiResponse<import("@/types/partner").PartnerOperations>>("/api/providers/me/resume", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  updateServiceArea: (body: {
    city?: string;
    serviceRegions?: string[];
    serviceRadiusKm?: number;
    baseLatitude?: number;
    baseLongitude?: number;
  }) =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/providers/me/service-area", {
      method: "PUT",
      auth: true,
      body,
    }).then((r) => r.data!),

  nearbyServiceZones: (lat?: number, lng?: number) =>
    apiRequest<ApiResponse<{ zones: Array<{ id: string; name: string; zoneType: string; city: string | null }> }>>(
      `/api/providers/me/service-area/zones${lat != null && lng != null ? `?lat=${lat}&lng=${lng}` : ""}`,
      { auth: true },
    ).then((r) => r.data!),

  /* ----------------- Dashboard + earnings + reviews ------------------- */
  dashboard: () =>
    apiRequest<ApiResponse<PartnerDashboard>>("/api/providers/me/dashboard", {
      auth: true,
    }).then((r) => r.data!),

  earnings: (days = 30) =>
    apiRequest<ApiResponse<PartnerEarningsSummary>>("/api/providers/me/earnings", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  reviews: (query: { page?: number; limit?: number; rating?: number } = {}) =>
    apiRequest<ApiResponse<PartnerReviewsResponse>>("/api/providers/me/reviews", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  /* ----------------- Bookings list (paginated, filterable) ------------ */
  listBookings: (query: ListBookingsQuery = {}) =>
    apiRequest<ApiResponse<PartnerBookingsResponse>>("/api/providers/me/bookings", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  /**
   * Partner AI assistant. Goes through the backend AI Gateway (`/api/ai/partner`), which
   * owns authentication, RBAC, prompt-injection screening, rate limiting, audit and cost
   * accounting. The browser never talks to a model provider and holds no provider key.
   */
  aiChat: (message: string, history?: Array<{ role: "user" | "assistant"; content: string }>) =>
    apiRequest<
      ApiResponse<{
        content: string;
        provider: string;
        model: string;
        fallbackUsed: boolean;
        requestId: string;
      }>
    >("/api/ai/partner", {
      method: "POST",
      auth: true,
      body: { message, history },
    }).then((r) => r.data!),

  /* ----------------- Booking lifecycle actions ------------------------ */
  acceptBooking: (bookingId: string, eta?: number) =>
    apiRequest<
      ApiResponse<{
        newlyAccepted?: boolean;
        booking: { id: string; status: string; provider?: { name?: string } };
      }>
    >(`/api/bookings/${bookingId}/accept`, {
      method: "POST",
      auth: true,
      body: { eta },
    }).then((r) => r.data!),

  rejectBooking: (bookingId: string, reason: string) =>
    apiRequest<ApiResponse<unknown>>(`/api/bookings/${bookingId}/reject`, {
      method: "POST",
      auth: true,
      body: { reason },
    }),

  /**
   * Declares departure. This is what makes `enRouteAt` authoritative — the GPS stream
   * only corroborates it now, so a partner on a flaky connection still records when
   * travel began. Safe to call twice: the server reports `newlyTransitioned: false`.
   */
  markEnRoute: (bookingId: string, latitude: number, longitude: number) =>
    apiRequest<
      ApiResponse<{
        newlyTransitioned: boolean;
        booking: { status: string; enRouteAt?: string | null };
      }>
    >(`/api/bookings/${bookingId}/en-route`, {
      method: "POST",
      auth: true,
      body: { latitude, longitude },
    }).then((r) => r.data!),

  /** Declares arrival. Races safely with the geofence and the job-start fallback. */
  markArrived: (bookingId: string, latitude: number, longitude: number) =>
    apiRequest<
      ApiResponse<{ newlyTransitioned: boolean; booking: { arrivedAt?: string | null } }>
    >(`/api/bookings/${bookingId}/arrived`, {
      method: "POST",
      auth: true,
      body: { latitude, longitude },
    }).then((r) => r.data!),

  /**
   * Dispatches the service-start PIN to the CUSTOMER (in-app + email + SMS).
   * The partner cannot start until the customer reads the PIN back in person.
   */
  requestStartOtp: (bookingId: string) =>
    apiRequest<
      ApiResponse<{
        alreadyVerified: boolean;
        channels: string[];
        sentTo: { email: string | null; phone: string | null };
        expiresInSec: number;
        resendInSec: number;
      }>
    >(`/api/bookings/${bookingId}/start-otp`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  startBooking: (bookingId: string, latitude: number, longitude: number, otp?: string) =>
    apiRequest<
      ApiResponse<{ booking: { status: string; startedAt?: string | null } }>
    >(`/api/bookings/${bookingId}/start`, {
      method: "POST",
      auth: true,
      body: { latitude, longitude, ...(otp ? { otp } : {}) },
    }).then((r) => r.data!),

  completeBooking: (
    bookingId: string,
    latitude: number,
    longitude: number,
    notes?: string,
    photos?: string[],
  ) =>
    apiRequest<
      ApiResponse<{
        booking: { status: string; completedAt?: string | null; totalDuration?: number };
      }>
    >(`/api/bookings/${bookingId}/complete`, {
      method: "POST",
      auth: true,
      body: {
        latitude,
        longitude,
        notes,
        ...(photos?.length ? { photos } : {}),
      },
    }).then((r) => r.data!),

  getJobActions: (bookingId: string) =>
    apiRequest<ApiResponse<JobActionResult>>(`/api/bookings/${bookingId}/actions`, {
      auth: true,
    }).then((r) => r.data!),

  listEvidence: (bookingId: string) =>
    apiRequest<ApiResponse<{ evidence: JobEvidenceItem[] }>>(
      `/api/bookings/${bookingId}/evidence`,
      { auth: true },
    ).then((r) => r.data!),

  uploadEvidence: (
    bookingId: string,
    body: {
      stage: "ARRIVAL" | "START" | "COMPLETION";
      mediaUrl?: string;
      photos?: string[];
      latitude?: number;
      longitude?: number;
      clientUploadId?: string;
      replace?: boolean;
    },
  ) =>
    apiRequest<ApiResponse<{ evidence: JobEvidenceItem }>>(
      `/api/bookings/${bookingId}/evidence`,
      { method: "POST", auth: true, body },
    ).then((r) => r.data!),

  listChat: (bookingId: string, query: { cursor?: string; limit?: number } = {}) =>
    apiRequest<ApiResponse<JobChatList>>(`/api/bookings/${bookingId}/chat`, {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  sendChat: (bookingId: string, body: string, clientMessageId?: string) =>
    apiRequest<ApiResponse<{ message: JobChatList["messages"][number]; created: boolean }>>(
      `/api/bookings/${bookingId}/chat`,
      {
        method: "POST",
        auth: true,
        body: { body, ...(clientMessageId ? { clientMessageId } : {}) },
      },
    ).then((r) => r.data!),

  markChatRead: (bookingId: string) =>
    apiRequest<ApiResponse<{ marked: number }>>(`/api/bookings/${bookingId}/chat/read`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  getContact: (bookingId: string) =>
    apiRequest<ApiResponse<{ phoneMasked: string | null; canCall: boolean }>>(
      `/api/bookings/${bookingId}/contact`,
      { auth: true },
    ).then((r) => r.data!),

  initiateCall: (bookingId: string) =>
    apiRequest<
      ApiResponse<{ dialUri: string; phoneMasked: string; expiresInSec: number }>
    >(`/api/bookings/${bookingId}/call`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  cancelBooking: (bookingId: string, reason: string) =>
    apiRequest<ApiResponse<unknown>>(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      auth: true,
      body: { reason, cancelledBy: "provider" },
    }),

  /* ----------------- Wallet + withdrawal ------------------------------ */
  walletBalance: () =>
    apiRequest<ApiResponse<WalletBalance>>("/api/wallet/balance", {
      auth: true,
    }).then((r) => r.data!),

  walletTransactions: (query: { page?: number; limit?: number } = {}) =>
    apiRequest<ApiResponse<WalletTransactionsResponse>>("/api/wallet/transactions", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  withdraw: (payload: {
    amount: number;
    bankAccountNumber: string;
    ifscCode: string;
    accountHolder: string;
    idempotencyKey?: string;
  }) =>
    apiRequest<
      ApiResponse<{
        withdrawal: {
          id: string;
          withdrawalNumber: string;
          amount: number;
          status: string;
          createdAt: string;
        };
      }>
    >("/api/wallet/withdraw", {
      method: "POST",
      auth: true,
      body: payload,
    }).then((r) => r.data!),

  payouts: () =>
    apiRequest<ApiResponse<PartnerPayoutsData>>("/api/providers/me/payouts", {
      auth: true,
    }).then((r) => r.data!),

  notifications: {
    list: (query: { page?: number; limit?: number; type?: string; unreadOnly?: boolean } = {}) =>
      apiRequest<ApiResponse<PartnerNotificationsResponse>>("/api/notifications", {
        auth: true,
        query: {
          ...query,
          ...(query.unreadOnly ? { isRead: "false" } : {}),
        },
      }).then((r) => r.data!),

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

    remove: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/notifications/${id}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  subscriptions: {
    plans: () =>
      apiRequest<ApiResponse<{ plans: PartnerMembershipPlan[] }>>("/api/subscriptions/plans").then(
        (r) => r.data!.plans,
      ),

    mine: () =>
      apiRequest<ApiResponse<PartnerMembershipData>>("/api/subscriptions/me", {
        auth: true,
      }).then((r) => r.data!),

    entitlements: () =>
      apiRequest<ApiResponse<PartnerEntitlements>>("/api/subscriptions/entitlements", {
        auth: true,
      }).then((r) => r.data!),

    createOrder: (planId: string) =>
      apiRequest<
        ApiResponse<{
          razorpayOrderId: string;
          amount: number;
          currency: string;
          key: string;
          planName: string;
          checkoutMode?: "razorpay" | "dev_mock";
        }>
      >("/api/subscriptions/order", {
        method: "POST",
        auth: true,
        body: { planId },
      }).then((r) => r.data!),

    verify: (body: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    }) =>
      apiRequest<ApiResponse<unknown>>("/api/subscriptions/verify", {
        method: "POST",
        auth: true,
        body,
      }),

    cancel: () =>
      apiRequest<ApiResponse<unknown>>("/api/subscriptions/cancel", {
        method: "POST",
        auth: true,
      }),
  },

  referrals: {
    summary: () =>
      apiRequest<
        ApiResponse<{
          code: string | null;
          referralCount: number;
          pending: number;
          qualified: number;
          commissionPerReferral: number;
          frozenBalance: number;
          riskScore: number;
          riskLevel: string;
          totalEarned: number;
          withdrawn: number;
          balance: number;
          frozen: number;
        }>
      >("/api/referrals/me", { auth: true }).then((r) => r.data!),
  },

  /* ----------------- Ratings respond ---------------------------------- */
  respondToRating: (ratingId: string, response: string) =>
    apiRequest<ApiResponse<{ rating: PartnerReview }>>(
      `/api/ratings/${ratingId}/respond`,
      {
        method: "POST",
        auth: true,
        body: { response },
      },
    ).then((r) => r.data!),

  /* ----------------- Invoices + tax ----------------------------------- */
  invoices: () =>
    apiRequest<ApiResponse<PartnerInvoices>>("/api/providers/me/invoices", {
      auth: true,
    }).then((r) => r.data!),
  taxSummary: () =>
    apiRequest<ApiResponse<PartnerTaxSummary>>("/api/providers/me/tax-summary", {
      auth: true,
    }).then((r) => r.data!),

  user: {
    me: () =>
      apiRequest<
        ApiResponse<{
          user: {
            notificationsEnabled?: boolean;
            emailNotifications?: boolean;
            pushNotifications?: boolean;
            smsNotifications?: boolean;
          };
        }>
      >("/api/users/me", { auth: true }).then((r) => r.data!.user),

    updatePreferences: (body: {
      notificationsEnabled?: boolean;
      emailNotifications?: boolean;
      pushNotifications?: boolean;
      smsNotifications?: boolean;
    }) =>
      apiRequest<ApiResponse<unknown>>("/api/users/preferences", {
        method: "PUT",
        auth: true,
        body,
      }),
  },

  security: {
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      apiRequest<ApiResponse<unknown>>("/api/auth/change-password", {
        method: "POST",
        auth: true,
        body,
      }),

    sessions: () =>
      apiRequest<
        ApiResponse<{
          sessions: Array<{
            id: string;
            deviceId: string;
            deviceName: string | null;
            platform: string | null;
            lastActiveAt: string;
            isCurrent: boolean;
          }>;
        }>
      >("/api/auth/sessions", { auth: true }).then((r) => r.data!),

    logoutOtherSessions: () =>
      apiRequest<ApiResponse<{ revoked: number }>>("/api/auth/sessions/others", {
        method: "DELETE",
        auth: true,
      }).then((r) => r.data!),

    logoutAllSessions: () =>
      apiRequest<ApiResponse<{ revoked: number }>>("/api/auth/sessions", {
        method: "DELETE",
        auth: true,
      }),

    revokeSession: (sessionId: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/auth/sessions/${sessionId}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  /* ----------------- Settings ----------------------------------------- */
  updateSettings: (body: {
    workingHoursStart?: string;
    workingHoursEnd?: string;
    workingDays?: string[];
    breakWindows?: Array<{ start: string; end: string }>;
    maxJobsPerDay?: number | null;
    maxConcurrentJobs?: number;
    paymentMethodPreference?: string;
    upiId?: string;
    bio?: string;
  }) =>
    apiRequest<ApiResponse<{ settings: Record<string, unknown> }>>("/api/providers/me/settings", {
      method: "PUT",
      auth: true,
      body,
    }).then((r) => r.data!.settings),

  /* ----------------- Support ------------------------------------------ */
  support: {
    createTicket: (payload: {
      subject: string;
      description: string;
      category: string;
      bookingId?: string;
      attachments?: string[];
      priorityLevel?: string;
    }) =>
      apiRequest<ApiResponse<{ ticket: PartnerSupportTicket }>>("/api/support/tickets", {
        method: "POST",
        auth: true,
        body: payload,
      }).then((r) => r.data!.ticket),
    tickets: (query: Record<string, string | number | undefined> = {}) =>
      apiRequest<ApiResponse<{ tickets: PartnerSupportTicket[]; total: number; page: number }>>(
        "/api/support/tickets",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    ticketById: (id: string) =>
      apiRequest<ApiResponse<{ ticket: PartnerSupportTicketDetail }>>(`/api/support/tickets/${id}`, {
        auth: true,
      }).then((r) => r.data!.ticket),
    reply: (id: string, body: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/support/tickets/${id}/reply`, {
        method: "POST",
        auth: true,
        body: { body },
      }),
  },

  // Phase 17.3 — optimised multi-stop route (reuses route-optimization.service; no new logic).
  routeOptimize: () =>
    apiRequest<ApiResponse<RouteOptimizeResult>>("/api/providers/me/route/optimize", { auth: true }).then((r) => r.data!),

  partnerOs: {
    attendance: () =>
      apiRequest<ApiResponse<PartnerAttendance>>("/api/providers/me/attendance", { auth: true }).then((r) => r.data!),
    checkIn: () =>
      apiRequest<ApiResponse<unknown>>("/api/providers/me/attendance/check-in", { method: "POST", auth: true }),
    checkOut: () =>
      apiRequest<ApiResponse<unknown>>("/api/providers/me/attendance/check-out", { method: "POST", auth: true }),
    incentives: () =>
      apiRequest<ApiResponse<PartnerIncentives>>("/api/providers/me/incentives", { auth: true }).then((r) => r.data!),
    forecast: () =>
      apiRequest<ApiResponse<PartnerForecast>>("/api/providers/me/forecast", { auth: true }).then((r) => r.data!),
    intelligence: (days = 90) =>
      apiRequest<ApiResponse<PartnerIntelligence>>("/api/providers/me/intelligence", {
        auth: true,
        query: { days },
      }).then((r) => r.data!),
    rankings: () =>
      apiRequest<ApiResponse<PartnerRankings>>("/api/providers/me/rankings", { auth: true }).then((r) => r.data!),
    academy: () =>
      apiRequest<ApiResponse<PartnerAcademy>>("/api/providers/me/academy", { auth: true }).then((r) => r.data!),
    completeAcademyModule: (moduleId: string, score?: number) =>
      apiRequest<ApiResponse<unknown>>(`/api/providers/me/academy/${moduleId}/complete`, {
        method: "POST",
        auth: true,
        body: { score },
      }),
    compliance: () =>
      apiRequest<ApiResponse<PartnerCompliance>>("/api/providers/me/compliance", { auth: true }).then((r) => r.data!),
    wellbeing: () =>
      apiRequest<ApiResponse<PartnerWellbeing>>("/api/providers/me/wellbeing", { auth: true }).then((r) => r.data!),
    rewards: () =>
      apiRequest<ApiResponse<PartnerRewards>>("/api/providers/me/rewards", { auth: true }).then((r) => r.data!),
    serviceHistory: () =>
      apiRequest<ApiResponse<PartnerServiceHistory>>("/api/providers/me/service-history", { auth: true }).then(
        (r) => r.data!,
      ),
    documents: () =>
      apiRequest<ApiResponse<{ documents: PartnerDocument[] }>>("/api/providers/me/documents", { auth: true }).then(
        (r) => r.data!,
      ),
  },
};

export type RouteStop = { bookingId: string; order: number; lat: number; lng: number; status: string | null; distanceFromPrevKm: number; etaFromPrevMin: number; cumulativeEtaMin: number };
export type RouteOptimizeResult = {
  sequence: RouteStop[];
  metrics: { stops: number; optimizedDistanceKm: number; optimizedEtaMin: number; naiveDistanceKm: number; naiveEtaMin: number; timeSavedMin: number; source: "google" | "haversine" };
  polyline: string | null;
};

export type PartnerSupportTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  description: string;
  category: string;
  priorityLevel: string;
  status: string;
  slaDueAt?: string | null;
  slaBreached?: boolean;
  resolution?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PartnerSupportTicketDetail = PartnerSupportTicket & {
  attachments: string[];
  bookingId?: string | null;
  messages: Array<{ id: string; body: string; authorRole: string; createdAt: string }>;
};

export type PartnerEarningInvoice = {
  id: string;
  invoiceNumber: string;
  service: string;
  gross: number;
  commission: number;
  net: number;
  date: string;
};
export type PartnerSettlement = {
  id: string;
  settlementNumber: string;
  amount: number;
  netAmount: number;
  status: string;
  date: string;
};
export type PartnerInvoices = {
  earnings: PartnerEarningInvoice[];
  settlements: PartnerSettlement[];
};
export type PartnerTaxSummary = {
  financialYear: number;
  grossEarnings: number;
  platformCommission: number;
  netEarnings: number;
  settledOut: number;
  estimatedTax: number;
  gstOnCommission?: number;
  tdsEstimate?: number;
};

export type PartnerAttendance = {
  checkIn: string | null;
  checkOut: string | null;
  isCheckedIn: boolean;
  workingHoursToday: number;
  weeklyAttendance: number;
  monthlyAttendance: number;
  workingHoursStart?: string | null;
  workingHoursEnd?: string | null;
  sessions: Array<{
    id: string;
    checkInAt: string;
    checkOutAt: string | null;
    source: string;
    durationHours: number | null;
  }>;
};

export type PartnerIncentives = {
  rules: Array<{
    id: string;
    code: string;
    name: string;
    period: string;
    metric: string;
    threshold: number;
    bonusAmount: number;
    current: number;
    eligible: boolean;
    progressPct: number;
    paid?: boolean;
    payoutStatus?: string | null;
    payoutAmount?: number | null;
  }>;
  streakDays: number;
  payouts: unknown[];
};

export type PartnerForecast = {
  todayProjection: number;
  weeklyProjection: number;
  monthlyProjection: number;
  inputs: Record<string, number>;
};

export type PartnerIntelligence = {
  periodDays: number;
  uniqueCustomers: number;
  returningCustomers: number;
  repeatCustomerRatePct: number;
};

export type PartnerRankings = {
  cityRank: number;
  cityTotal: number;
  areaRank: number;
  areaTotal: number;
  areaName?: string;
  city: string;
  compositeScore: number;
  categoryRanks: Array<{ category: string; rank: number; total: number; score: number }>;
};

export type PartnerAcademy = {
  modules: Array<{
    id: string;
    slug: string;
    title: string;
    contentType: string;
    contentUrl: string | null;
    body: string | null;
    completedAt: string | null;
    score: number | null;
  }>;
  certifications: string[];
  completedCount: number;
};

export type PartnerCompliance = {
  documents: Array<{
    id: string;
    documentType: string;
    documentName: string | null;
    isVerified: boolean;
    expiryDate: string | null;
    expiringSoon: boolean;
  }>;
  verification: Record<string, unknown>;
  complianceScore: number;
  expiringSoon: number;
  certifications: string[];
};

export type PartnerWellbeing = {
  sosPhone: string | null;
  insuranceUrl: string | null;
  communityUrl: string | null;
};

export type PartnerRewards = {
  badges: string[];
  milestones: Array<{ label: string; target: number; current: number; achieved: boolean; progressPct: number }>;
  referralCount: number;
  referralCode: string | null;
  incentiveEarnings: number;
};

export type PartnerServiceHistory = {
  completed: number;
  cancelled: number;
  rescheduled: number;
  upcoming: number;
};

export type PartnerDocument = {
  id: string;
  documentType: string;
  documentName: string | null;
  documentUrl: string;
  isVerified: boolean;
  uploadedAt: string;
};
