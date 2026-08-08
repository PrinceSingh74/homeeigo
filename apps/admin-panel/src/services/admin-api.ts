import { apiRequest, apiRequestBlob, apiRequestText } from "@/lib/api-client";
import type {
  AdminBooking,
  AdminCustomer,
  AdminListBookingsResponse,
  AdminListCustomersResponse,
  AdminListProvidersResponse,
  AdminProvider,
  AnalyticsData,
  ApiResponse,
  BanAction,
  DashboardData,
  VerifyAction,
} from "@/types/admin";

type ListQuery = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
};

// --- Geo-Intelligence envelope + data shapes (mirrors GeoIntelligenceService) ---
export type GeoIntel<T> = { success: boolean; data: T; confidence: number; freshness: string; source: string; cached: boolean; generatedAt: string };
export type ExecKpis = { gmv: number; bookingsToday: number; completionRate: number; cancellationRate: number; refundRate: number; onlineProviders: number; activeCustomers: number };
export type SurgeZone = { zoneId: string; name: string; city: string | null; supply: number; activeBookings: number; weatherSurge: number; predictedSurge: number; demandDeltaPct: number | null };
export type DensityZone = { zoneId: string; name: string; city: string | null; centerLat: number; centerLng: number; providers: number; areaKm2: number; densityPerKm2: number };
export type PendingPartnerDocument = {
  id: string;
  providerId: string;
  documentType: string;
  documentName: string | null;
  documentUrl: string;
  documentNumber: string;
  uploadStatus: string;
  uploadedAt: string;
  expiryDate: string | null;
  verificationNotes: string | null;
  provider: {
    id: string;
    businessName: string | null;
    user: { firstName: string | null; lastName: string | null; email: string | null };
  };
};
export type ZoneScore = { zoneId: string; name: string; city: string | null; supply: number; demand24h: number; revenue24h: number; earningScore: number; demandScore: number; serviceHealth: number; riskScore: number; compositeScore: number };
export type ZoneScoring = { ranked: ZoneScore[]; bestEarning: ZoneScore[]; worstService: ZoneScore[]; highRisk: ZoneScore[] };
export type FraudEvent = { provider_hash: string; booking_id: string | null; implied_kmh: number; jump_meters: number; lat: number; lng: number; ts: string };
export type FraudData = { suspiciousCount: number; riskScore: number; events: FraudEvent[] };
export type RevenueForecast = { realized24h: number; realized7d: number; forecastHourly: number; forecastDaily: number; forecastWeekly: number; forecastMonthly: number; completedLast24h: number };
export type DemandPoint = { zone_id: string; hour: string; predicted: number; lo: number; hi: number };
export type DemandForecast = { horizonHours: number; points: DemandPoint[]; totalPredicted: number };

// --- City Digital Twin ---
export type TwinEnvelope<T> = { success: boolean; data: T; confidence: number; freshness: string; source: string; generatedAt: string };
export type TwinLayers = {
  demand: { current: number; forecast1h: number; forecast6h: number; forecast24h: number };
  supply: { online: number; busy: number; available: number; density: number; shortageRisk: number };
  traffic: { congestionIndex: number; level: string };
  weather: { condition: string; description: string; severity: string; rain1hMm: number; weatherImpactScore: number; floodRisk: string; aqi: number | null } | null;
  revenue: { current24h: number; projectedDaily: number; projectedMonthly: number };
  eta: { inflationPct: number; slowZones: string[] };
  pricing: { currentSurge: number; predictedSurge: number; confidence: number };
  fraud: { events: number; pins: Array<{ lat: number; lng: number; implied_kmh: number }>; riskScore: number };
};
export type CityTwin = { city: string; zones: number; layers: TwinLayers };
export type TwinInsight = { text: string; confidence: number; severity: "info" | "warning" | "critical" };
export type TwinScenario = { demandDeltaPct?: number; providerDeltaPct?: number; trafficDeltaPct?: number; rainStart?: boolean; festival?: boolean };
export type TwinSimulation = {
  city: string; scenario: TwinScenario;
  baseline: { demand: number; supply: number; surge: number; revenue24h: number };
  projected: { demand: number; supply: number; available: number; surge: number };
  impact: { revenuePct: number; etaPct: number; supplyGapPct: number; customerPct: number; surgeShift: number };
};
export type CitySummary = { city: string; tier: number; demand: number; providers: number; surge: number };

/** Full partner command-center payload (GET /api/admin/providers/:id). */
export type ProviderDetail = {
  id: string;
  userId: string;
  profile: {
    name: string; email: string | null; phone: string | null;
    businessName: string | null; bio: string | null; profileImage: string | null;
    serviceCategories: string[]; serviceRegions: string[]; city: string | null;
    experienceYears: number | null; certifications: string[]; badges: string[];
    registeredAt: string; memberSince: string;
  };
  status: {
    isOnline: boolean; onlineSince: string | null; lastSeenAt: string | null;
    currentStatus: string | null; isActive: boolean; isBanned: boolean; bannedReason: string | null;
    workingHours: { start: number; end: number; days: string[] } | null;
  };
  verification: {
    isApproved: boolean; isVerified: boolean; registrationStatus: string | null;
    verificationDate: string | null; verificationNotes: string | null; approvalNotes: string | null;
    rejectionReason: string | null; backgroundCheckStatus: string | null; backgroundCheckDate: string | null;
    kyc: Record<string, string | null>;
    documents: Array<{ id: string; type: string; name: string | null; isVerified: boolean; uploadStatus: string | null; expiryDate: string | null; verifiedAt: string | null }>;
  };
  metrics: {
    rating: number; totalReviews: number; ratingBreakdown: unknown;
    totalBookings: number; completedBookings: number; cancelledBookings: number; rejectedBookings: number;
    completionRate: number; acceptanceRate: number; responseRate: number; cancellationRate: number;
    onTimeRate: number; avgResponseTime: number | null; avgCompletionTime: number | null;
  };
  earnings: {
    totalEarnings: number; thisMonthEarnings: number; thisWeekEarnings: number;
    walletBalance: number; commissionRate: number | null;
    pendingPayoutAmount: number; pendingPayoutCount: number;
    bank: { holder: string | null; bankName: string | null; accountNumberMasked: string | null; ifsc: string | null; upiId: string | null; preference: string | null };
  };
  location: { latitude: number; longitude: number; updatedAt: string | null } | null;
  recentBookings: Array<{ id: string; bookingNumber: string | null; status: string; serviceName: string | null; amount: number | null; scheduledDate: string | null; completedAt: string | null; createdAt: string }>;
  dispatchHistory: Array<{ id: string; status: string; dispatchedAt: string | null; respondedAt: string | null; responseMs: number | null; bookingNumber: string | null; serviceName: string | null }>;
};

// --- Hyperlocal Coverage Engine V1 (consumes /api/coverage/*) ---
export type CoverageRequestStatus = "NEW" | "REVIEWING" | "PLANNED" | "LAUNCHED" | "DECLINED";
export type CoverageRequestRow = {
  id: string;
  name: string;
  mobile: string;
  city: string | null;
  area: string;
  society: string | null;
  pincode: string | null;
  source: string;
  status: CoverageRequestStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};
export type CityStatus = "AVAILABLE" | "LIMITED" | "COMING_SOON";
export type ManagedCityRow = {
  slug: string;
  name: string;
  state: string;
  tier: number;
  status: CityStatus;
  areaCount: number;
  pincodeCount: number;
  societyCount: number;
  activePartners: number;
  customers: number;
  servicesCompleted: number;
  fulfillmentRate: number;
  coverageScore: number;
  /** Non-null when an admin has manually pinned this city's status. */
  managedStatus: CityStatus | null;
  note: string | null;
};
export type CoverageCityRow = {
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
  liveAreas: number;
  limitedAreas: number;
  comingSoonAreas: number;
  pendingRequests: number;
};
export type CoverageIntelligence = {
  totals: {
    cities: number;
    liveCities: number;
    areas: number;
    liveAreas: number;
    pincodes: number;
    societies: number;
    coveragePct: number;
    activePartners: number;
    avgCoverageScore: number;
  };
  cities: CoverageCityRow[];
  requests: { total: number; new: number; reviewing: number; planned: number; last30Days: number };
  demandHotspots: Array<{ label: string; requests: number; city: string | null }>;
  expansionOpportunities: Array<{
    citySlug: string;
    cityName: string;
    areaName: string;
    status: string;
    societies: number;
    demandSignals: number;
    priorityIndex: number;
  }>;
  generatedAt: string;
};

export type AdminNotification = {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
};

export type AdminReview = {
  id: string;
  customer: string;
  customerEmail: string;
  provider: string;
  service: string;
  bookingNumber: string;
  rating: number;
  reviewText: string | null;
  providerResponse: string | null;
  isPublic: boolean;
  isFlagged: boolean;
  createdAt: string;
};

export type AdminReviewsResponse = {
  reviews: AdminReview[];
  total: number;
  page: number;
  limit: number;
  stats: { averageRating: number | null; totalReviews: number };
};

export const adminApi = {
  dashboard: () =>
    apiRequest<ApiResponse<DashboardData>>("/api/admin/dashboard", {
      auth: true,
    }).then((r) => r.data!),

  // --- Reviews moderation ---
  reviews: {
    list: (query: Record<string, string | number> = {}) =>
      apiRequest<ApiResponse<AdminReviewsResponse>>("/api/admin/reviews", {
        auth: true,
        query,
      }).then((r) => r.data!),
    moderate: (id: string, patch: { isPublic?: boolean; isFlagged?: boolean }) =>
      apiRequest<ApiResponse<{ review: { id: string; isPublic: boolean; isFlagged: boolean } }>>(
        `/api/admin/reviews/${id}`,
        { method: "PATCH", auth: true, body: patch },
      ),
    remove: (id: string) =>
      apiRequest<ApiResponse<{ id: string }>>(`/api/admin/reviews/${id}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  // --- Admin's own notification feed (same per-user pipeline as customers) ---
  notifications: {
    list: (limit = 8) =>
      apiRequest<ApiResponse<{ notifications: AdminNotification[]; total: number; unreadCount: number }>>(
        "/api/notifications",
        { auth: true, query: { limit } },
      ).then((r) => r.data!),
    markAllRead: () =>
      apiRequest<ApiResponse<{ count: number }>>("/api/notifications/read-all", {
        method: "PUT",
        auth: true,
      }),
  },

  // --- Geo / Weather intelligence ---
  weatherOverview: () =>
    apiRequest<ApiResponse<WeatherOverview>>("/api/weather/admin/overview", { auth: true }).then((r) => r.data!),
  zoneAnalytics: () =>
    apiRequest<ApiResponse<ZoneAnalytics>>("/api/geo/geofences/analytics", { auth: true }).then((r) => r.data!),

  // --- Geo-Intelligence command layer (consumes /api/geo-intel/*) ---
  geoIntel: {
    execKpis: () => apiRequest<GeoIntel<ExecKpis>>("/api/geo-intel/exec-kpis", { auth: true }),
    surge: () => apiRequest<GeoIntel<SurgeZone[]>>("/api/geo-intel/surge", { auth: true }),
    density: () => apiRequest<GeoIntel<DensityZone[]>>("/api/geo-intel/provider-density", { auth: true }),
    zoneScoring: () => apiRequest<GeoIntel<ZoneScoring>>("/api/geo-intel/zone-scoring", { auth: true }),
    fraud: (limit = 50) => apiRequest<GeoIntel<FraudData>>("/api/geo-intel/fraud", { auth: true, query: { limit } }),
    revenueForecast: () => apiRequest<GeoIntel<RevenueForecast>>("/api/geo-intel/revenue-forecast", { auth: true }),
    demandForecast: (horizon = 24) => apiRequest<GeoIntel<DemandForecast>>("/api/geo-intel/demand-forecast", { auth: true, query: { horizon } }),
  },

  // --- Hyperlocal Coverage Intelligence (consumes /api/coverage/*) ---
  coverage: {
    intelligence: () =>
      apiRequest<ApiResponse<CoverageIntelligence>>("/api/coverage/intelligence", { auth: true }).then(
        (r) => r.data!,
      ),
    requests: (query: { status?: string; search?: string; page?: number; limit?: number } = {}) =>
      apiRequest<ApiResponse<{ requests: CoverageRequestRow[]; total: number; page: number; limit: number }>>(
        "/api/coverage/requests",
        { auth: true, query },
      ).then((r) => r.data!),
    updateRequest: (id: string, body: { status?: CoverageRequestStatus; notes?: string }) =>
      apiRequest<ApiResponse<{ request: CoverageRequestRow }>>(`/api/coverage/requests/${id}`, {
        method: "PATCH",
        auth: true,
        body,
      }).then((r) => r.data!),
    // Managed cities: live metrics + which have a manual status override.
    managedCities: () =>
      apiRequest<ApiResponse<{ cities: ManagedCityRow[]; total: number }>>("/api/coverage/admin/cities", {
        auth: true,
      }).then((r) => r.data!),
    // Set (status = one of the operational states) or clear (status = null) a city override.
    setCityStatus: (slug: string, body: { status: CityStatus | null; note?: string }) =>
      apiRequest<ApiResponse<{ city: ManagedCityRow }>>(`/api/coverage/cities/${slug}`, {
        method: "PATCH",
        auth: true,
        body,
      }).then((r) => r.data!),
  },

  // --- City Digital Twin (consumes /api/digital-twin/*) ---
  digitalTwin: {
    cities: () => apiRequest<TwinEnvelope<{ cities: CitySummary[] }> & { supported: { tier0: string[]; tier1: string[] } }>("/api/digital-twin/cities", { auth: true }),
    city: (name: string) => apiRequest<TwinEnvelope<CityTwin>>(`/api/digital-twin/${encodeURIComponent(name)}`, { auth: true }),
    insights: (name: string) => apiRequest<TwinEnvelope<{ city: string; insights: TwinInsight[] }>>(`/api/digital-twin/${encodeURIComponent(name)}/insights`, { auth: true }),
    simulate: (name: string, scenario: TwinScenario) => apiRequest<TwinEnvelope<TwinSimulation>>(`/api/digital-twin/${encodeURIComponent(name)}/simulate`, { auth: true, method: "POST", body: scenario }),
  },

  listUsers: (query: ListQuery = {}) =>
    apiRequest<ApiResponse<AdminListCustomersResponse>>("/api/admin/users", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  listProviders: (query: ListQuery = {}) =>
    apiRequest<ApiResponse<AdminListProvidersResponse>>("/api/admin/providers", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  getProviderDetail: (id: string) =>
    apiRequest<ApiResponse<ProviderDetail>>(`/api/admin/providers/${id}`, {
      auth: true,
    }).then((r) => r.data!),

  listBookings: (query: ListQuery = {}) =>
    apiRequest<ApiResponse<AdminListBookingsResponse>>("/api/admin/bookings", {
      auth: true,
      query: { ...query },
    }).then((r) => r.data!),

  getBookingDetail: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}`, {
      auth: true,
    }).then((r) => r.data!),

  adminCancelBooking: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/cancel`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  adminRescheduleBooking: (id: string, scheduledDate: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/reschedule`, {
      method: "POST",
      auth: true,
      body: { scheduledDate, reason },
    }).then((r) => r.data!),

  adminReassignBooking: (id: string, providerId: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/reassign`, {
      method: "POST",
      auth: true,
      body: { providerId, reason },
    }).then((r) => r.data!),

  adminForceDispatch: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/dispatch`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  adminCompleteBooking: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/complete`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  adminRepairBooking: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/repair`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  adminRefundBooking: (id: string, amount: number, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/refund`, {
      method: "POST",
      auth: true,
      body: { amount, reason },
    }).then((r) => r.data!),

  adminRetryBookingRefund: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/bookings/${id}/refund/retry`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  analytics: (query: { startDate?: string; endDate?: string } = {}) =>
    apiRequest<ApiResponse<AnalyticsData>>("/api/admin/analytics", {
      auth: true,
      query,
    }).then((r) => r.data!),

  /** Phase 1 ML data pipeline — consumes /api/analytics/* */
  dataPipeline: {
    health: () =>
      apiRequest<ApiResponse<{ pipeline: { freshness: number; totalDatasets: number; qualityScore: number; mlops: Record<string, unknown> } }>>(
        "/api/analytics/health",
        { auth: true },
      ).then((r) => r.data!),
    etlJobs: () =>
      apiRequest<ApiResponse<{ jobs: Array<Record<string, unknown>> }>>("/api/analytics/etl/jobs", { auth: true }).then((r) => r.data!),
    watermarks: () =>
      apiRequest<ApiResponse<{ watermarks: Array<Record<string, unknown>> }>>("/api/analytics/etl/watermarks", { auth: true }).then((r) => r.data!),
    forecast: (scope: string, granularity: string, horizon = 24) =>
      apiRequest<ApiResponse<{ forecasts: Array<Record<string, unknown>> }>>(
        `/api/analytics/forecast/${scope}/${granularity}`,
        { auth: true, query: { horizon } },
      ).then((r) => r.data!),
    surgePlanning: () =>
      apiRequest<ApiResponse<{ data: Record<string, unknown> }>>("/api/analytics/forecast/surge-planning", { auth: true }).then((r) => r.data!),
    capacityPlanning: (city?: string) =>
      apiRequest<ApiResponse<{ data: Record<string, unknown> }>>("/api/analytics/forecast/capacity", {
        auth: true,
        query: city ? { city } : {},
      }).then((r) => r.data!),
  },

  /** Phase 2 ETA Intelligence — label collection platform (no ML inference) */
  etaIntelligence: {
    dashboard: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/analytics/eta", { auth: true }).then((r) => r.data!),
    quality: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/analytics/eta/quality", { auth: true }).then((r) => r.data!),
    readiness: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/analytics/eta/readiness", { auth: true }).then((r) => r.data!),
    trips: (limit = 50, offset = 0) =>
      apiRequest<ApiResponse<{ trips: Array<Record<string, unknown>> }>>("/api/analytics/eta/trips", {
        auth: true,
        query: { limit, offset },
      }).then((r) => r.data!),
    google: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/analytics/eta/google", { auth: true }).then((r) => r.data!),
  },

  verifyProvider: (
    id: string,
    action: VerifyAction,
    notes?: string,
  ) =>
    apiRequest<
      ApiResponse<{
        provider: { id: string; isApproved: boolean; approvalNotes: string | null };
      }>
    >(`/api/admin/providers/${id}/verify`, {
      method: "PUT",
      auth: true,
      body: { action, notes },
    }).then((r) => r.data!),

  banUser: (id: string, action: BanAction, reason?: string) =>
    apiRequest<
      ApiResponse<{ user: { id: string; isBanned: boolean; bannedReason: string | null } }>
    >(`/api/admin/users/${id}/ban`, {
      method: "PUT",
      auth: true,
      body: { action, reason },
    }).then((r) => r.data!),

  processWithdrawal: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(
      `/api/admin/withdrawals/${id}/process`,
      { method: "POST", auth: true },
    ).then((r) => r.data!),

  approveWithdrawal: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/withdrawals/${id}/approve`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  rejectWithdrawal: (id: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/withdrawals/${id}/reject`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  settlements: () =>
    apiRequest<
      ApiResponse<{
        overview: Record<string, unknown>;
        batches: Array<Record<string, unknown>>;
      }>
    >("/api/admin/settlements", { auth: true }).then((r) => r.data!),

  chargebacks: () =>
    apiRequest<ApiResponse<{ chargebacks: Array<Record<string, unknown>> }>>("/api/admin/chargebacks", {
      auth: true,
    }).then((r) => r.data!),

  financeDashboard: (days = 30) =>
    apiRequest<
      ApiResponse<{ overview: Record<string, unknown>; trend: Array<{ date: string; amount: number }> }>
    >("/api/admin/finance/dashboard", { auth: true, query: { days } }).then((r) => r.data!),

  financeReconciliation: () =>
    apiRequest<
      ApiResponse<{
        runs: Array<Record<string, unknown>>;
        metrics: Record<string, unknown>;
      }>
    >("/api/admin/finance/reconciliation", { auth: true }).then((r) => r.data!),

  financeReconciliationIssues: (reconciliationId?: string) =>
    apiRequest<ApiResponse<{ issues: Array<Record<string, unknown>> }>>(
      "/api/admin/finance/reconciliation/issues",
      { auth: true, query: reconciliationId ? { reconciliationId } : {} },
    ).then((r) => r.data!),

  runFinanceReconciliation: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/reconciliation/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeSettlements: () =>
    apiRequest<ApiResponse<{ batches: Array<Record<string, unknown>> }>>("/api/admin/finance/settlements", {
      auth: true,
    }).then((r) => r.data!),

  financePayouts: () =>
    apiRequest<
      ApiResponse<{
        payouts: Array<Record<string, unknown>>;
        queue: Array<Record<string, unknown>>;
        batches: Array<Record<string, unknown>>;
      }>
    >("/api/admin/finance/payouts", { auth: true }).then((r) => r.data!),

  retryPayout: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/${id}/retry`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  processPayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/process`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  createPayoutBatch: (withdrawalIds: string[]) =>
    apiRequest<ApiResponse<{ batch: Record<string, unknown> }>>("/api/admin/finance/payouts/batch", {
      method: "POST",
      auth: true,
      body: { withdrawalIds },
    }).then((r) => r.data!),

  submitPayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/submit`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  approvePayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/approve`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  rejectPayoutBatch: (batchId: string, reason: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/payouts/batch/${batchId}/reject`, {
      method: "POST",
      auth: true,
      body: { reason },
    }).then((r) => r.data!),

  getPayoutBatch: (batchId: string) =>
    apiRequest<ApiResponse<{ batch: Record<string, unknown> }>>(`/api/admin/finance/payouts/batch/${batchId}`, {
      auth: true,
    }).then((r) => r.data!),

  runGatewayReconciliation: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/reconciliation/gateway/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeRefunds: () =>
    apiRequest<
      ApiResponse<{
        refunds: Array<Record<string, unknown>>;
        analytics: Record<string, unknown>;
        reasonCodes: string[];
      }>
    >("/api/admin/finance/refunds", { auth: true }).then((r) => r.data!),

  approveRefundRequest: (id: string, notes?: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/refunds/${id}/approve`, {
      method: "POST",
      auth: true,
      body: { notes },
    }).then((r) => r.data!),

  rejectRefundRequest: (id: string, notes: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/refunds/${id}/reject`, {
      method: "POST",
      auth: true,
      body: { notes },
    }).then((r) => r.data!),

  financeRisk: () =>
    apiRequest<
      ApiResponse<{ cases: Array<Record<string, unknown>>; holds: Array<Record<string, unknown>> }>
    >("/api/admin/finance/risk", { auth: true }).then((r) => r.data!),

  escalateFraudCase: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/risk/cases/${id}/escalate`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  liftFinancialHold: (userId: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/risk/holds/${userId}/lift`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeUnitEconomics: (days = 30) =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/analytics/unit-economics", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  financeCanonicalGmv: (days = 30) =>
    apiRequest<ApiResponse<CanonicalGmv>>("/api/admin/finance/gmv", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  financeIntelligence: (days = 30) =>
    apiRequest<ApiResponse<FinanceIntelligence>>("/api/admin/finance/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  cxIntelligence: (days = 30) =>
    apiRequest<ApiResponse<CustomerIntelligence>>("/api/admin/cx/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  growthIntelligence: (days = 30) =>
    apiRequest<ApiResponse<GrowthIntelligence>>("/api/admin/growth/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  riskIntelligence: (days = 30) =>
    apiRequest<ApiResponse<RiskIntelligence>>("/api/admin/risk/intelligence", {
      auth: true,
      query: { days },
    }).then((r) => r.data!),

  platformIntelligence: () =>
    apiRequest<ApiResponse<PlatformIntelligence>>("/api/admin/platform/intelligence", { auth: true }).then(
      (r) => r.data!,
    ),

  platformFlagUpdate: (payload: {
    key: string;
    enabled: boolean;
    rolloutPct?: number;
    description?: string;
    isKillSwitch?: boolean;
    reason?: string;
  }) =>
    apiRequest<ApiResponse<{ flag: PlatformFeatureFlag }>>("/api/admin/platform/flags", {
      auth: true,
      method: "PATCH",
      body: payload,
    }).then((r) => r.data!),

  recoveryStatus: () =>
    apiRequest<ApiResponse<RecoveryIntelligence>>("/api/admin/recovery/status", { auth: true }).then((r) => r.data!),

  recoverySimulate: (target: "database" | "redis" | "queue" | "api" | "region") =>
    apiRequest<ApiResponse<RecoverySimulation>>("/api/admin/recovery/simulate", {
      auth: true,
      method: "POST",
      body: { target },
    }).then((r) => r.data!),

  financeConfigGet: () =>
    apiRequest<ApiResponse<FinanceConfigBundle>>("/api/admin/finance/config", { auth: true }).then(
      (r) => r.data!,
    ),

  financeConfigHistory: (key?: string, limit = 50) =>
    apiRequest<ApiResponse<{ history: FinanceConfigHistoryRow[] }>>("/api/admin/finance/config/history", {
      auth: true,
      query: { key, limit },
    }).then((r) => r.data!),

  financeConfigUpdate: (payload: { key: string; value: number; reason?: string }) =>
    apiRequest<ApiResponse<{ config: FinanceConfigEntry }>>("/api/admin/finance/config", {
      auth: true,
      method: "PATCH",
      body: payload,
    }).then((r) => r.data!),

  runFinanceValidation: () =>
    apiRequest<
      ApiResponse<{
        status: string;
        score: number;
        checks: Array<{ name: string; status: string; details?: string }>;
        beforeScore: Record<string, number>;
        afterScore: Record<string, number>;
      }>
    >("/api/admin/finance/validation/run", { method: "POST", auth: true }).then((r) => r.data!),

  assignChargeback: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/assign`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  respondChargeback: (id: string, responseText: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/respond`, {
      method: "POST",
      auth: true,
      body: { responseText },
    }).then((r) => r.data!),

  closeChargeback: (id: string, outcome?: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/close`, {
      method: "POST",
      auth: true,
      body: { outcome },
    }).then((r) => r.data!),

  getChargebackDetail: (id: string) =>
    apiRequest<ApiResponse<{ chargeback: Record<string, unknown> }>>(`/api/admin/finance/chargebacks/${id}`, {
      auth: true,
    }).then((r) => r.data!),

  uploadChargebackEvidence: (id: string, fileBase64: string, fileName: string, description?: string) =>
    apiRequest<ApiResponse<{ evidence: Record<string, unknown> }>>(`/api/admin/finance/chargebacks/${id}/evidence`, {
      method: "POST",
      auth: true,
      body: { fileBase64, fileName, description },
    }).then((r) => r.data!),

  getChargebackEvidenceDownloadToken: (evidenceId: string) =>
    apiRequest<ApiResponse<{ token: string; expiresAt: string; downloadPath?: string }>>(
      `/api/admin/finance/chargebacks/evidence/${evidenceId}/download-token`,
      { method: "POST", auth: true },
    ).then((r) => r.data!),

  downloadChargebackEvidence: async (evidenceId: string, fileName: string) => {
    const tokenData = await apiRequest<ApiResponse<{ token: string; expiresAt: string }>>(
      `/api/admin/finance/chargebacks/evidence/${evidenceId}/download-token`,
      { method: "POST", auth: true },
    ).then((r) => r.data!);
    const blob = await apiRequestBlob(
      `/api/admin/finance/chargebacks/evidence/download/${tokenData.token}`,
      { auth: true },
    );
    if (blob.size < 100) {
      throw new Error("Downloaded file is empty or corrupt. Try uploading the evidence again.");
    }
    const typed = blob.type.includes("pdf")
      ? blob
      : new Blob([await blob.arrayBuffer()], { type: "application/pdf" });
    const href = URL.createObjectURL(typed);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName || "evidence.pdf";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },

  requestChargebackEvidence: (id: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/request-evidence`, {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  resolveChargeback: (id: string, outcome: "WON" | "LOST", notes?: string) =>
    apiRequest<ApiResponse<Record<string, unknown>>>(`/api/admin/finance/chargebacks/${id}/resolve`, {
      method: "POST",
      auth: true,
      body: { outcome, notes },
    }).then((r) => r.data!),

  getChargebackEvidencePackage: (id: string) =>
    apiRequest<ApiResponse<{ package: Record<string, unknown> }>>(
      `/api/admin/finance/chargebacks/${id}/evidence-package`,
      { auth: true },
    ).then((r) => r.data!),

  downloadChargebackLegalEvidencePack: async (chargebackId: string) => {
    const blob = await apiRequestBlob(`/api/admin/finance/chargebacks/${chargebackId}/evidence-certificate`, {
      auth: true,
    });
    if (blob.size < 500) {
      throw new Error("Evidence pack generation failed. Please retry.");
    }
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `HOMEEIGO-Legal-Evidence-${chargebackId.slice(-8)}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 60_000);
  },

  exportChargebackCase: (id: string) =>
    apiRequestText(`/api/admin/finance/chargebacks/${id}/export`, { auth: true }),

  runFinanceIntegrity: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/integrity/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeMigrations: () =>
    apiRequest<ApiResponse<{ latest: Record<string, unknown> | null; runs: Array<Record<string, unknown>> }>>(
      "/api/admin/finance/migrations",
      { auth: true },
    ).then((r) => r.data!),

  verifyMigrations: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/migrations/verify", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  financeChargebacks: () =>
    apiRequest<
      ApiResponse<{ chargebacks: Array<Record<string, unknown>>; analytics: Record<string, unknown> }>
    >("/api/admin/finance/chargebacks", { auth: true }).then((r) => r.data!),

  financeSettlementSync: () =>
    apiRequest<
      ApiResponse<{
        runs: Array<Record<string, unknown>>;
        metrics: Record<string, unknown>;
        discrepancies: Array<Record<string, unknown>>;
      }>
    >("/api/admin/finance/settlement-sync", { auth: true }).then((r) => r.data!),

  runSettlementSync: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/settlement-sync/run", {
      method: "POST",
      auth: true,
    }).then((r) => r.data!),

  resolveSettlementDiscrepancy: (id: string, notes?: string) =>
    apiRequest<ApiResponse<{ discrepancy: Record<string, unknown> }>>(
      `/api/admin/finance/settlement-sync/discrepancies/${id}/resolve`,
      { method: "POST", auth: true, body: { notes } },
    ).then((r) => r.data!),

  assignSettlementDiscrepancy: (id: string) =>
    apiRequest<ApiResponse<{ discrepancy: Record<string, unknown> }>>(
      `/api/admin/finance/settlement-sync/discrepancies/${id}/assign`,
      { method: "POST", auth: true },
    ).then((r) => r.data!),

  escalateSettlementDiscrepancy: (id: string, reason: string) =>
    apiRequest<ApiResponse<{ discrepancy: Record<string, unknown> }>>(
      `/api/admin/finance/settlement-sync/discrepancies/${id}/escalate`,
      { method: "POST", auth: true, body: { reason } },
    ).then((r) => r.data!),

  settlementHealthScore: () =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/finance/settlement-sync/health", {
      auth: true,
    }).then((r) => r.data!),

  financeGatewayReconciliationIssues: () =>
    apiRequest<ApiResponse<{ issues: Array<Record<string, unknown>> }>>(
      "/api/admin/finance/reconciliation/gateway/issues",
      { auth: true },
    ).then((r) => r.data!),

  financeReports: (period = "monthly", days?: number) =>
    apiRequest<
      ApiResponse<{ report: Record<string, unknown>; health: Record<string, unknown> }>
    >("/api/admin/finance/reports", { auth: true, query: { period, days } }).then((r) => r.data!),

  financeIntegrity: () =>
    apiRequest<
      ApiResponse<{
        latest: Record<string, unknown> | null;
        runs: Array<Record<string, unknown>>;
        alerts: Array<Record<string, unknown>>;
        dashboard?: Record<string, unknown>;
      }>
    >("/api/admin/finance/integrity", { auth: true }).then((r) => r.data!),

  accountDeletions: () =>
    apiRequest<ApiResponse<{ deletions: Array<Record<string, unknown>> }>>("/api/admin/account-deletions", {
      auth: true,
    }).then((r) => r.data!),

  financeLiabilities: () =>
    apiRequest<ApiResponse<{ current: Record<string, number>; snapshots: Record<string, Array<Record<string, unknown>>> }>>(
      "/api/admin/finance/liabilities",
      { auth: true },
    ).then((r) => r.data!),

  financeIntegrityValidate: () =>
    apiRequest<
      ApiResponse<{
        score: number;
        status: string;
        bySeverity: { info: number; warning: number; critical: number };
        issues: Array<{ category: string; level: string; severity: string; details: string; referenceId?: string }>;
      }>
    >("/api/admin/finance/integrity/validate", { auth: true }).then((r) => r.data!),

  adjustments: {
    list: (status?: string) =>
      apiRequest<ApiResponse<{ adjustments: AdminAdjustmentRow[] }>>("/api/admin/finance/adjustments", {
        auth: true,
        query: status ? { status } : {},
      }).then((r) => r.data!.adjustments),
    create: (body: AdminAdjustmentInput) =>
      apiRequest<ApiResponse<{ adjustment: AdminAdjustmentRow }>>("/api/admin/finance/adjustments", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.adjustment),
    approve: (id: string, notes?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/finance/adjustments/${id}/approve`, {
        method: "POST",
        auth: true,
        body: { notes },
      }),
    reject: (id: string, reason: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/finance/adjustments/${id}/reject`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
    execute: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/finance/adjustments/${id}/execute`, {
        method: "POST",
        auth: true,
      }),
  },

  backfill: {
    history: () =>
      apiRequest<ApiResponse<{ runs: AdminBackfillRun[] }>>("/api/admin/finance/backfill/history", {
        auth: true,
      }).then((r) => r.data!.runs),
    issues: (runId?: string) =>
      apiRequest<ApiResponse<{ issues: Array<Record<string, unknown>> }>>("/api/admin/finance/backfill/issues", {
        auth: true,
        query: runId ? { runId } : {},
      }).then((r) => r.data!.issues),
    run: (types?: string[]) =>
      apiRequest<ApiResponse<{ run: AdminBackfillRun }>>("/api/admin/finance/backfill/run", {
        method: "POST",
        auth: true,
        body: types && types.length ? { types } : {},
      }).then((r) => r.data!.run),
  },

  hcoinExpiry: {
    report: () =>
      apiRequest<ApiResponse<AdminHCoinExpiryReport>>("/api/admin/hcoins/expiry/report", {
        auth: true,
      }).then((r) => r.data!),
    updateConfig: (body: { enabled?: boolean; expiryDays?: number }) =>
      apiRequest<ApiResponse<{ config: Record<string, unknown> }>>("/api/admin/hcoins/expiry/config", {
        method: "PUT",
        auth: true,
        body,
      }),
    run: (dryRun = false) =>
      apiRequest<ApiResponse<{ coinsExpired: number; walletsAffected: number; rupeeValue: number; dryRun: boolean }>>(
        "/api/admin/hcoins/expiry/run",
        { method: "POST", auth: true, body: { dryRun } },
      ).then((r) => r.data!),
  },

  // ----------------------------------------------------------- services CRUD
  services: {
    list: (query: ListQuery = {}) =>
      apiRequest<
        ApiResponse<{ services: AdminServiceRow[]; total: number; page: number; limit: number }>
      >("/api/admin/services", { auth: true, query: { ...query } }).then((r) => r.data!),

    create: (body: ServiceInput) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>("/api/admin/services", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),

    update: (id: string, body: Partial<ServiceInput>) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>(`/api/admin/services/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!),

    setStatus: (id: string, isActive: boolean) =>
      apiRequest<ApiResponse<{ service: AdminServiceRow }>>(`/api/admin/services/${id}/status`, {
        method: "PATCH",
        auth: true,
        body: { isActive },
      }).then((r) => r.data!),

    remove: (id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/services/${id}`, {
        method: "DELETE",
        auth: true,
      }),
  },

  subscriptions: {
    listPlans: () =>
      apiRequest<ApiResponse<{ plans: AdminPlanRow[] }>>("/api/admin/subscriptions/plans", {
        auth: true,
      }).then((r) => r.data!.plans),

    createPlan: (body: AdminPlanInput) =>
      apiRequest<ApiResponse<{ plan: AdminPlanRow }>>("/api/admin/subscriptions/plans", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.plan),

    updatePlan: (id: string, body: Partial<AdminPlanInput> & { isActive?: boolean }) =>
      apiRequest<ApiResponse<{ plan: AdminPlanRow }>>(`/api/admin/subscriptions/plans/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.plan),

    subscribers: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ subscribers: AdminSubscriberRow[]; pagination: { page: number; limit: number; total: number; hasMore: boolean } }>>(
        "/api/admin/subscriptions/subscribers",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),

    revenue: () =>
      apiRequest<ApiResponse<AdminSubscriptionRevenue>>("/api/admin/subscriptions/revenue", {
        auth: true,
      }).then((r) => r.data!),

    analytics: (period = "monthly") =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/analytics", {
        auth: true,
        query: { period },
      }).then((r) => r.data!),

    cashbackDashboard: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/cashback/dashboard", {
        auth: true,
      }).then((r) => r.data!),

    queueAnalytics: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/queue/analytics", {
        auth: true,
      }).then((r) => r.data!),

    insights: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/insights", {
        auth: true,
      }).then((r) => r.data!),
  },

  membershipCoupons: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ coupons: AdminMembershipCouponRow[]; total: number; page: number }>>(
        "/api/admin/membership/coupons",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    create: (body: AdminMembershipCouponInput) =>
      apiRequest<ApiResponse<{ coupon: AdminMembershipCouponRow }>>("/api/admin/membership/coupons", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.coupon),
    update: (id: string, body: Partial<AdminMembershipCouponInput>) =>
      apiRequest<ApiResponse<{ coupon: AdminMembershipCouponRow }>>(`/api/admin/membership/coupons/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.coupon),
    analytics: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/coupons/analytics", {
        auth: true,
      }).then((r) => r.data!),
  },

  campaigns: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ campaigns: AdminCampaignRow[]; total: number; page: number }>>(
        "/api/admin/campaigns",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    create: (body: AdminCampaignInput) =>
      apiRequest<ApiResponse<{ campaign: AdminCampaignRow }>>("/api/admin/campaigns", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!.campaign),
    update: (id: string, body: Partial<AdminCampaignInput>) =>
      apiRequest<ApiResponse<{ campaign: AdminCampaignRow }>>(`/api/admin/campaigns/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.campaign),
    analytics: (campaignId?: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/campaigns/analytics", {
        auth: true,
        query: campaignId ? { campaignId } : {},
      }).then((r) => r.data!),
  },

  support: {
    tickets: (query: ListQuery & { priority?: string; assigned?: string; providerId?: string; bookingId?: string } = {}) =>
      apiRequest<ApiResponse<{ tickets: AdminSupportTicket[]; total: number; page: number }>>(
        "/api/admin/support/tickets",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    ticketById: (id: string) =>
      apiRequest<ApiResponse<{ ticket: AdminSupportTicketDetail }>>(
        `/api/admin/support/tickets/${id}`,
        { auth: true },
      ).then((r) => r.data!.ticket),
    analytics: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/support/analytics", {
        auth: true,
      }).then((r) => r.data!),
    respond: (id: string, resolution: string, internal = false) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/respond`, {
        method: "POST",
        auth: true,
        body: { resolution, internal },
      }),
    resolve: (id: string, resolution: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/resolve`, {
        method: "POST",
        auth: true,
        body: { resolution },
      }),
    escalate: (id: string, note?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/escalate`, {
        method: "POST",
        auth: true,
        body: { note },
      }),
    merge: (id: string, duplicateId: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/support/tickets/${id}/merge`, {
        method: "POST",
        auth: true,
        body: { duplicateId },
      }),
  },

  referrals: {
    analytics: () =>
      apiRequest<ApiResponse<AdminReferralAnalytics>>("/api/admin/referrals/analytics", {
        auth: true,
      }).then((r) => r.data!),
  },

  fraud: {
    overview: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/fraud/overview", {
        auth: true,
      }).then((r) => r.data!),
    highRiskUsers: () =>
      apiRequest<ApiResponse<{ users: AdminFraudUser[] }>>("/api/admin/fraud/high-risk-users", {
        auth: true,
      }).then((r) => r.data!.users),
    reviewQueue: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ commissions: AdminFrozenCommission[]; total: number }>>(
        "/api/admin/fraud/review-queue",
        { auth: true, query: { ...query } },
      ).then((r) => r.data!),
    alerts: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<{ alerts: AdminFraudAlert[]; total: number }>>("/api/admin/fraud/alerts", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
    monthlyReport: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/fraud/analytics/monthly", {
        auth: true,
      }).then((r) => r.data!),
    approveCommission: (id: string, note?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/commissions/${id}/approve`, {
        method: "POST",
        auth: true,
        body: { note },
      }),
    rejectCommission: (id: string, reason: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/commissions/${id}/reject`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
    freezeCommission: (id: string, reason?: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/commissions/${id}/freeze`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
    blacklistUser: (id: string, reason: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/fraud/users/${id}/blacklist`, {
        method: "POST",
        auth: true,
        body: { reason },
      }),
  },

  transfers: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<AdminTransfersResponse>>("/api/admin/transfers", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
  },

  giftCards: {
    list: (query: ListQuery = {}) =>
      apiRequest<ApiResponse<AdminGiftCardsResponse>>("/api/admin/giftcards", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
  },

  invoices: {
    list: (query: ListQuery & { search?: string } = {}) =>
      apiRequest<ApiResponse<AdminInvoicesResponse>>("/api/admin/invoices", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
    revenueReport: () =>
      apiRequest<ApiResponse<AdminRevenueReport>>("/api/admin/revenue-report", {
        auth: true,
      }).then((r) => r.data!),
  },

  hcoins: {
    analytics: () =>
      apiRequest<ApiResponse<AdminHCoinAnalytics>>("/api/admin/hcoins/analytics", {
        auth: true,
      }).then((r) => r.data!),
    updateRule: (id: string, body: { coins?: number; isActive?: boolean }) =>
      apiRequest<ApiResponse<{ rule: HCoinRule }>>(`/api/admin/hcoins/rules/${id}`, {
        method: "PUT",
        auth: true,
        body,
      }).then((r) => r.data!.rule),
    grant: (body: { userId: string; coins: number; note?: string }) =>
      apiRequest<ApiResponse<unknown>>("/api/admin/hcoins/grant", {
        method: "POST",
        auth: true,
        body,
      }),
  },

  observability: {
    health: () =>
      apiRequest<ApiResponse<ObservabilityHealth>>("/api/admin/observability/health", {
        auth: true,
      }).then((r) => r.data!),
    emailHealth: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/observability/email-health", {
        auth: true,
      }).then((r) => r.data!),
    alerts: (query: { limit?: number; resolved?: boolean } = {}) =>
      apiRequest<ApiResponse<{ alerts: ObservabilityAlert[] }>>("/api/admin/observability/alerts", {
        auth: true,
        query: {
          ...query,
          ...(query.resolved !== undefined ? { resolved: String(query.resolved) } : {}),
        },
      }).then((r) => r.data!.alerts),
    resolveAlert: (source: "ops" | "finance", id: string) =>
      apiRequest<ApiResponse<unknown>>(`/api/admin/observability/alerts/${source}/${id}/resolve`, {
        method: "POST",
        auth: true,
      }),
    evaluateAlerts: () =>
      apiRequest<ApiResponse<{ raised: number }>>("/api/admin/observability/alerts/evaluate", {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
    logs: (query: LogSearchQuery = {}) =>
      apiRequest<ApiResponse<LogSearchResult>>("/api/admin/observability/logs", {
        auth: true,
        query: { ...query },
      }).then((r) => r.data!),
    exportLogsCsv: (query: LogSearchQuery = {}) =>
      apiRequestText("/api/admin/observability/logs/export.csv", {
        auth: true,
        query: { ...query },
      }),
    runValidation: () =>
      apiRequest<ApiResponse<ProductionValidationReport>>("/api/admin/observability/validation/run", {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
    archivalStrategy: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/observability/archival/strategy", {
        auth: true,
      }).then((r) => r.data!),
  },

  compliance: {
    listRequests: (opts: { limit?: number; status?: string } = {}) =>
      apiRequest<ApiResponse<{ requests: ComplianceRequest[] }>>("/api/compliance/admin/requests", {
        auth: true,
        query: {
          ...(opts.limit ? { limit: opts.limit } : {}),
          ...(opts.status ? { status: opts.status } : {}),
        },
      }).then((r) => r.data!.requests),
    approve: (id: string) =>
      apiRequest<ApiResponse<{ request: ComplianceRequest }>>(
        `/api/compliance/admin/requests/${id}/approve`,
        { method: "POST", auth: true },
      ),
    reject: (id: string, reason: string) =>
      apiRequest<ApiResponse<{ request: ComplianceRequest }>>(
        `/api/compliance/admin/requests/${id}/reject`,
        { method: "POST", body: { reason }, auth: true },
      ),
    retentionReport: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/compliance/admin/retention/report", {
        auth: true,
      }).then((r) => r.data!),
  },

  // Phase 17.4 / 16.4 / 16.3 — operations map, heatmap, geofence management (existing APIs).
  opsMap: () => apiRequest<ApiResponse<OpsMapData>>("/api/admin/ops-map", { auth: true }).then((r) => r.data!),
  workforceAnalytics: () =>
    apiRequest<
      ApiResponse<{
        onlineProviders: number;
        totalProviders: number;
        activeJobs: number;
        attendanceCheckInsToday: number;
        avgAcceptanceRate: number;
        avgCompletionRate: number;
        generatedAt: string;
      }>
    >("/api/admin/workforce/analytics", { auth: true }).then((r) => r.data!),
  academyModules: () =>
    apiRequest<ApiResponse<{ modules: unknown[] }>>("/api/admin/academy/modules", { auth: true }).then((r) => r.data!),
  incentiveRules: () =>
    apiRequest<ApiResponse<{ rules: unknown[] }>>("/api/admin/incentives/rules", { auth: true }).then((r) => r.data!),

  pendingDocuments: () =>
    apiRequest<
      ApiResponse<{
        documents: PendingPartnerDocument[];
      }>
    >("/api/admin/documents/pending", { auth: true }).then((r) => r.data!),

  verifyPartnerDocument: (providerId: string, docId: string, notes?: string) =>
    apiRequest<ApiResponse<{ document: PendingPartnerDocument }>>(
      `/api/admin/providers/${providerId}/documents/${docId}/verify`,
      { method: "PUT", auth: true, body: notes ? { notes } : {} },
    ),

  rejectPartnerDocument: (providerId: string, docId: string, reason: string) =>
    apiRequest<ApiResponse<{ document: PendingPartnerDocument }>>(
      `/api/admin/providers/${providerId}/documents/${docId}/reject`,
      { method: "PUT", auth: true, body: { reason } },
    ),

  heatmap: (params: { gridSize?: number; days?: number } = {}) =>
    apiRequest<ApiResponse<HeatmapData>>("/api/admin/heatmap", { auth: true, query: { ...params } }).then((r) => r.data!),

  // --- Customer intelligence (CLV, churn, RFM) — real per-user analytics ---
  customerIntel: {
    profile: (userId: string) =>
      apiRequest<ApiResponse<CustomerIntel>>(`/api/customer-intel/${encodeURIComponent(userId)}`, {
        auth: true,
      }).then((r) => r.data!),
    match: (lat: number, lng: number) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/customer-intel/match", {
        auth: true,
        query: { lat, lng },
      }).then((r) => r.data!),
  },

  // --- MLOps / AI model registry (BigQuery-backed; may be empty if GCP unset) ---
  mlops: {
    registry: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/mlops/registry", { auth: true }).then((r) => r.data!),
    dataQuality: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/mlops/data-quality", { auth: true }).then((r) => r.data!),
    health: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/mlops/health", { auth: true }).then((r) => r.data!),
  },

  // --- RBAC: roles, admins, current permissions (real) ---
  rbac: {
    roles: () =>
      apiRequest<ApiResponse<{ roles: Array<Record<string, unknown>> }>>("/api/admin/rbac/roles", {
        auth: true,
      }).then((r) => r.data!),
    admins: () =>
      apiRequest<ApiResponse<{ admins: Array<Record<string, unknown>> }>>("/api/admin/rbac/admins", {
        auth: true,
      }).then((r) => r.data!),
    me: () =>
      apiRequest<ApiResponse<{ role?: string; permissions?: string[] }>>("/api/admin/rbac/me", {
        auth: true,
      }).then((r) => r.data!),
  },

  // --- Membership time-series (retention / churn per period) ---
  membershipTrends: (period = "monthly") =>
    apiRequest<ApiResponse<Record<string, unknown>>>("/api/admin/membership/analytics/trends", {
      auth: true,
      query: { period },
    }).then((r) => r.data!),

  geofences: {
    list: (query: { city?: string; activeOnly?: boolean } = {}) =>
      apiRequest<ApiResponse<{ geofences: Geofence[] }>>("/api/geo/geofences", { auth: true, query: { ...query } }).then((r) => r.data!.geofences),
    create: (body: GeofenceInput) =>
      apiRequest<ApiResponse<{ geofence: Geofence }>>("/api/geo/geofences", { method: "POST", auth: true, body }).then((r) => r.data!.geofence),
    update: (id: string, body: Partial<GeofenceInput> & { isActive?: boolean }) =>
      apiRequest<ApiResponse<{ geofence: Geofence }>>(`/api/geo/geofences/${id}`, { method: "PATCH", auth: true, body }).then((r) => r.data!.geofence),
    remove: (id: string) =>
      apiRequest<ApiResponse<{ ok: boolean }>>(`/api/geo/geofences/${id}`, { method: "DELETE", auth: true }).then((r) => r.data!),
    events: (query: { geofenceId?: string; eventType?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<{ events: GeofenceEvent[] }>>("/api/geo/geofence-events", { auth: true, query: { ...query } }).then((r) => r.data!.events),
  },

  aiBrain: {
    timeline: (days = 7) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/timeline", { auth: true, query: { days } }).then((r) => r.data!),
    memoryStats: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/memory/stats", { auth: true }).then((r) => r.data!),
    memories: (query: { type?: string; q?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/memory", { auth: true, query }).then((r) => r.data!),
    prompts: (category?: string) =>
      apiRequest<ApiResponse<{ prompts: Array<Record<string, unknown>>; categories: string[] }>>("/api/ai/prompts", {
        auth: true,
        query: category ? { category } : {},
      }).then((r) => r.data!),
    promptVersions: (promptId: string) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>(`/api/ai/prompt-versions/${promptId}`, { auth: true }).then((r) => r.data!),
    contextHistory: (limit = 20) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/context/history", { auth: true, query: { limit } }).then((r) => r.data!),
    health: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/health", { auth: true }).then((r) => r.data!),
    usage: (days = 7) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/usage", { auth: true, query: { days } }).then((r) => r.data!),
  },

  aiTools: {
    health: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/health").then((r) => r.data!),
    registry: () =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/registry", { auth: true }).then((r) => r.data!),
    list: (query: { category?: string; status?: string; source?: string } = {}) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools", { auth: true, query }).then((r) => r.data!),
    get: (toolId: string) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/ai/tools/${encodeURIComponent(toolId)}`, { auth: true }).then((r) => r.data!),
    execute: (body: { toolId: string; arguments?: Record<string, unknown>; idempotencyKey?: string; approvalId?: string }) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/execute", { auth: true, method: "POST", body }).then((r) => r.data!),
    history: (query: { toolId?: string; status?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/tools/history", { auth: true, query }).then((r) => r.data!),
    approvals: (query: { toolId?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/approvals", { auth: true, query }).then((r) => r.data!),
    decideApproval: (approvalId: string, body: { decision: "APPROVED" | "REJECTED"; reason?: string }) =>
      apiRequest<ApiResponse<Record<string, unknown>>>(`/api/ai/tools/approvals/${approvalId}/decide`, { auth: true, method: "POST", body }).then((r) => r.data!),
    policies: (query: { toolId?: string; decision?: string; limit?: number } = {}) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/policies", { auth: true, query }).then((r) => r.data!),
    denied: (limit = 50) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/tools/denied", { auth: true, query: { limit } }).then((r) => r.data!),
    highRisk: (limit = 50) =>
      apiRequest<ApiResponse<Array<Record<string, unknown>>>>("/api/ai/tools/high-risk", { auth: true, query: { limit } }).then((r) => r.data!),
    metrics: (days = 7) =>
      apiRequest<ApiResponse<Record<string, unknown>>>("/api/ai/tools/metrics", { auth: true, query: { days } }).then((r) => r.data!),
  },
};

export type CanonicalGmv = {
  periodDays: number;
  generatedAt: string;
  gmv: number;
  canonicalDefinition: string;
  basis: "payment";
  successfulPayments: number;
  reconciliation: {
    paymentBased: number;
    bookingBased: number;
    completedBookings: number;
    deltaPct: number;
    note: string;
  };
};

export type FinanceConfigEntry = {
  id: string;
  key: string;
  value: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FinanceConfigHistoryRow = {
  id: string;
  configKey: string;
  valueBefore: number | null;
  valueAfter: number;
  changedBy: string;
  reason: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type FinanceConfigBundle = {
  entries: FinanceConfigEntry[];
  resolved: {
    operatingExpenseMonthly: number | null;
    cashOnHand: number | null;
    gatewayFeePct: number;
    sources: {
      operatingExpenseMonthly: "db" | "env" | "missing";
      cashOnHand: "db" | "env" | "missing";
      gatewayFeePct: "db" | "env" | "default";
    };
    updatedAt: Record<string, string | null>;
    updatedBy: Record<string, string | null>;
  };
  keys: string[];
};

export type FinanceIntelligence = {
  periodDays: number;
  generatedAt: string;
  assumptions: FinanceConfigBundle["resolved"] & { source: "finance_config" };
  missingInputs: string[];
  canonicalGmv: CanonicalGmv;
  revenue: {
    grossRevenue: number;
    commissionRevenue: number;
    subscriptionRevenue: number;
    netRevenue: number;
    refunds: number;
  };
  cogs: { gatewayFees: number; gatewayFeePct: number; refunds: number; total: number };
  grossMargin: { grossProfit: number; grossMarginPct: number | null; basis: string };
  ebitda: {
    available: boolean;
    operatingExpenseMonthly: number | null;
    ebitda: number | null;
    ebitdaMarginPct: number | null;
    note?: string;
  };
  burnRate: {
    available: boolean;
    netMonthlyCashFlow: number | null;
    monthlyBurn: number | null;
    isProfitable: boolean | null;
    note?: string;
  };
  cashRunway: {
    available: boolean;
    cashOnHand: number | null;
    runwayMonths: number | null;
    status: "profitable" | "finite" | "input_required";
    note?: string;
  };
  forecast: {
    contributionForecastMonthly: number;
    contributionForecastAnnual: number;
    profitForecastMonthly: number | null;
    profitForecastAnnual: number | null;
    note?: string;
  };
  liabilities: { totalLiabilities: number; providerPayable: number };
};

export type CustomerIntelligence = {
  periodDays: number;
  generatedAt: string;
  nps: { score: number | null; source: string; sampleSize: number; definition: string };
  csat: { scorePct: number | null; source: string; sampleSize: number; definition: string };
  complaintTrend: Array<{ date: string; count: number }>;
  customerHappinessScore: number | null;
  serviceSatisfactionIndex: number | null;
  components: {
    avgRating: number | null;
    slaCompliancePct: number | null;
    repeatCustomerRatePct: number | null;
    ratingsCount: number;
    ticketsCount: number;
    surveyNpsCount: number;
    surveyCsatCount: number;
  };
};

export type GrowthIntelligence = {
  periodDays: number;
  generatedAt: string;
  cac: number;
  ltv: number;
  ltvCacRatio: number | null;
  roas: { value: number | null; marketingSpend: number; attributedRevenue: number; spendSource: string };
  paybackMonths: { value: number | null; monthlyArpu: number; grossMarginPct: number };
  campaignRoi: Array<{ code: string; name: string; revenue: number; cost: number; redemptions: number; roi: number | null; costConfigured: boolean }>;
  referralRoi: { roiPct: number | null; referredGmv: number; commissionPaid: number };
  attribution: { channels: Array<{ channel: string; revenue: number; touches: number }>; touchTablePopulated: boolean; note?: string };
  newCustomers: number;
};

export type RiskIntelligence = {
  periodDays: number;
  generatedAt: string;
  unifiedTrustScore: {
    score: number;
    breakdown: { customerTrust: number; partnerTrust: number; paymentRisk: number; fraudRisk: number; complianceRisk: number };
    definition: string;
  };
  fraudConfidence: { score: number; avgRiskScore: number; highRiskUsers: number; openAlerts: number };
  paymentRisk: { score: number; chargebackRatioPct: number; openExposure: number };
  complianceRisk: { score: number; openRequests: number; overdueRequests: number };
  financeHealthScore: number;
  riskTimeline: Array<{ id: string; type: string; severity: string; title: string; at: string }>;
};

export type PlatformFeatureFlag = {
  id: string;
  key: string;
  description: string | null;
  enabled: boolean;
  rolloutPct: number;
  environment: string;
  isKillSwitch: boolean;
};

export type PlatformIntelligence = {
  generatedAt: string;
  featureFlags: PlatformFeatureFlag[];
  killSwitches: PlatformFeatureFlag[];
  experiments: Array<{ key: string; description?: string; status: string; variants?: unknown[]; source?: string }>;
  experimentMetrics: string[];
  flagCount: number;
  enabledFlags: number;
};

export type RecoveryIntelligence = {
  generatedAt: string;
  backup: {
    health: string;
    totalBackups: number;
    lastSuccessAt: string | null;
    sizeBytes: number;
    successRatePct: number | null;
    retentionDeleted: number;
    backupDir: string;
  };
  disasterRecovery: {
    readinessScore: number;
    rtoTargetSeconds: number;
    rtoLastDrillSeconds: number | null;
    rpoTargetSeconds: number;
    rpoCurrentSeconds: number | null;
    lastRestoreValidation: string | null;
  };
};

export type RecoverySimulation = {
  target: string;
  simulatedAt: string;
  destructive: boolean;
  estimatedRtoSeconds: number;
  estimatedRpoSeconds: number;
  steps: string[];
};

export type CustomerIntel = {
  userId?: string;
  clv?: { lifetimeValue?: number; projectedRevenue?: number };
  churn?: { churn30?: number; churn60?: number; churn90?: number };
  rfm?: { recency?: number; frequency?: number; monetary?: number; segment?: string };
  health?: { score?: number; tier?: string };
  [key: string]: unknown;
};

export type OpsMapProvider = { providerId: string; name: string; lat: number; lng: number; status: "ONLINE" | "BUSY" | "OFFLINE"; lastUpdate: string };
export type OpsMapBooking = { bookingId: string; providerId: string | null; status: string; lat: number; lng: number; eta: number | null };
export type OpsMapAlert = { type: string; severity: "warning" | "critical"; bookingId?: string; providerId?: string; message: string };
export type OpsMapData = {
  providers: OpsMapProvider[];
  bookings: OpsMapBooking[];
  geofences: Array<{ id: string; name: string; centerLat: number; centerLng: number; radiusMeters: number; zoneType: string }>;
  heatmap: HeatmapCell[];
  alerts: OpsMapAlert[];
  metrics: { onlineProviders: number; busyProviders: number; totalProviders: number; activeBookings: number; averageEtaMin: number; serviceGaps: number; alerts: number };
};
export type HeatmapCell = { lat: number; lng: number; demand: number; completed: number; cancelled: number; cancellationRate: number; revenue: number; supplyOnline: number; supplyTotal: number; demandScore: number; supplyGap: number };
export type HeatmapData = { gridSize: number; days: number; cells: HeatmapCell[]; totals: { demand: number; revenue: number; supplyOnline: number; cells: number } };
export type Geofence = { id: string; name: string; zoneType: string; shape?: string; polygon?: Array<{ lat: number; lng: number }> | null; city: string | null; state: string | null; centerLat: number; centerLng: number; radiusMeters: number; serviceCategories: string[]; surgeMultiplier?: number; isActive: boolean; createdAt: string };
export type GeofenceInput = { name: string; centerLat: number; centerLng: number; radiusMeters: number; city?: string; state?: string; serviceCategories?: string[]; zoneType?: string; shape?: string; polygon?: Array<{ lat: number; lng: number }> };
export type GeofenceEvent = { id: string; geofenceId: string; userId: string | null; providerId: string | null; eventType: string; latitude: number; longitude: number; createdAt: string; geofence?: { name: string; city: string | null } };

export type AdminAdjustmentRow = {
  id: string;
  reference: string;
  type: string;
  direction: string;
  amount: number;
  targetUserId: string | null;
  debitAccountCode: string | null;
  creditAccountCode: string | null;
  reason: string;
  supportingNotes: string | null;
  status: string;
  makerId: string;
  approverId: string | null;
  rejectedReason: string | null;
  journalId: string | null;
  createdAt: string;
  executedAt: string | null;
};

export type AdminAdjustmentInput = {
  type: "CREDIT" | "DEBIT" | "CORRECTION" | "WRITE_OFF" | "LIABILITY_ADJUSTMENT" | "LEDGER_FIX";
  direction: "CREDIT" | "DEBIT";
  amount: number;
  reason: string;
  supportingNotes?: string;
  targetUserId?: string;
  debitAccountCode?: string;
  creditAccountCode?: string;
};

export type AdminBackfillRun = {
  id: string;
  types: string;
  status: string;
  recordsScanned: number;
  recordsBackfilled: number;
  recordsSkipped: number;
  recordsFailed: number;
  createdAt: string;
  completedAt: string | null;
};

export type AdminHCoinExpiryReport = {
  config: { enabled: boolean; expiryDays: number; lastRunAt: string | null };
  runs: Array<{ id: string; coinsExpired: number; walletsAffected: number; rupeeValue: number; createdAt: string }>;
  totals: { coinsExpired: number; breakageRevenue: number };
};

export type AdminInvoiceRow = {
  id: string;
  invoiceNumber: string;
  customer: string;
  email: string;
  service: string;
  amount: number;
  refunded: number;
  status: string;
  date: string;
};
export type AdminInvoicesResponse = {
  invoices: AdminInvoiceRow[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
};
export type AdminRevenueReport = {
  streams: { bookings: number; subscriptions: number; giftCards: number };
  counts: { bookings: number; subscriptions: number; giftCards: number };
  grossRevenue: number;
  refunds: number;
  netRevenue: number;
};
export type AdminGiftCardsResponse = {
  cards: { id: string; code: string; amount: number; balance: number; status: string; recipient: string; createdAt: string }[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
  stats: { issued: number; redeemed: number; refunded: number; outstanding: number; count: number };
};
export type AdminTransfersResponse = {
  transfers: { id: string; sender: string; recipient: string; amount: number; status: string; createdAt: string }[];
  pagination: { page: number; limit: number; total: number; hasMore: boolean };
  totals: { completedCount: number; completedVolume: number };
};
export type HCoinRule = {
  id: string;
  event: string;
  label: string;
  coins: number;
  isActive: boolean;
};
export type AdminHCoinAnalytics = {
  totalIssued: number;
  totalRedeemed: number;
  outstanding: number;
  liabilityRupees: number;
  holders: number;
  rules: HCoinRule[];
};

export type AdminFraudUser = {
  userId: string;
  name: string;
  email: string;
  score: number;
  level: string;
  factors: string[];
  isBanned: boolean;
};

export type AdminFrozenCommission = {
  id: string;
  referrerId: string;
  referrer: string;
  email: string;
  amount: number;
  status: string;
  riskScore: number | null;
  frozenAt: string | null;
  createdAt: string;
};

export type AdminFraudAlert = {
  id: string;
  userId: string | null;
  user: string | null;
  email?: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  status: string;
  createdAt: string;
};

export type AdminReferralAnalytics = {
  totalReferrals: number;
  qualified: number;
  pending: number;
  totalCommission: number;
  totalWithdrawn: number;
  leaderboard: { rank: number; name: string; referrals: number; earned: number }[];
  fraudFlags: { userId: string; name: string; email: string; pendingReferrals: number; reason: string }[];
};

export type AdminPlanRow = {
  id: string;
  name: string;
  tier: string;
  interval: "MONTHLY" | "QUARTERLY" | "YEARLY";
  price: number;
  currency: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  benefits: { id: string; label: string }[];
  _count?: { subscriptions: number };
};
export type AdminPlanInput = {
  name: string;
  interval: "MONTHLY" | "QUARTERLY" | "YEARLY";
  price: number;
  description?: string;
  benefits?: string[];
  sortOrder?: number;
};
export type AdminSubscriberRow = {
  id: string;
  status: string;
  startsAt: string | null;
  expiresAt: string | null;
  autoRenew: boolean;
  cancelledAt: string | null;
  plan: { name: string; interval: string; price: number };
  user: { firstName: string | null; lastName: string | null; email: string };
};
export type AdminSubscriptionRevenue = {
  totalRevenue: number;
  monthRevenue: number;
  activeSubscribers: number;
  invoiceCount: number;
};

export type AdminCampaignRow = {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  premiumOnly: boolean;
  discountPct: number | null;
  discountAmount: number | null;
  redemptionCount: number;
  maxRedemptions: number | null;
  startsAt: string | null;
  expiresAt: string | null;
};

export type AdminMembershipCouponRow = {
  id: string;
  code: string;
  name: string;
  status: string;
  discountPct: number | null;
  redemptionCount: number;
  planRestricted: string[];
  expiresAt: string | null;
};

export type AdminMembershipCouponInput = {
  code: string;
  name: string;
  discountPct?: number;
  planRestricted?: string[];
  maxRedemptions?: number;
  perUserLimit?: number;
  status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
};

export type AdminCampaignInput = {
  code: string;
  name: string;
  description?: string;
  type: "COUPON" | "PROMOTION" | "BUNDLE" | "OFFER";
  premiumOnly?: boolean;
  discountPct?: number;
  discountAmount?: number;
  minOrderAmount?: number;
  maxRedemptions?: number;
  startsAt?: string;
  expiresAt?: string;
  status?: "DRAFT" | "ACTIVE" | "DISABLED" | "EXPIRED";
};

export type AdminSupportTicket = {
  id: string;
  ticketNumber: string;
  subject: string;
  category: string;
  priorityLevel: string;
  status: string;
  slaDueAt: string | null;
  slaBreached: boolean;
  responseTimeMs: number | null;
  user: string | null;
  email?: string;
  providerName?: string | null;
  source?: "customer" | "partner";
  bookingNumber?: string | null;
  createdAt: string;
};

export type AdminSupportTicketDetail = AdminSupportTicket & {
  description: string;
  providerName?: string | null;
  bookingId?: string | null;
  bookingNumber?: string | null;
  attachments: string[];
  messages: Array<{
    id: string;
    body: string;
    authorRole: string;
    isInternal: boolean;
    createdAt: string;
  }>;
};

export type AdminServiceRow = {
  id: string;
  name: string;
  slug: string;
  description: string;
  detailedDescription: string | null;
  category: string;
  subcategory: string | null;
  basePrice: number;
  minPrice: number | null;
  maxPrice: number | null;
  estimatedDuration: number;
  icon: string | null;
  isActive: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  bookingCount: number;
  availableCities: string[];
  createdAt: string;
};

export type ServiceInput = {
  name: string;
  description: string;
  category: string;
  basePrice: number;
  estimatedDuration: number;
  subcategory?: string;
  detailedDescription?: string;
  minPrice?: number;
  maxPrice?: number;
  icon?: string;
  isActive?: boolean;
  isFeatured?: boolean;
  availableCities?: string[];
};

export type AdminCustomerRow = AdminCustomer;
export type AdminProviderRow = AdminProvider;
export type AdminBookingRow = AdminBooking;

export type ObservabilityAlert = {
  id: string;
  source: "ops" | "finance";
  alertType: string;
  severity: string;
  message: string;
  metadata: unknown;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
};

export type ObservabilityHealth = {
  timestamp: string;
  instanceId: string;
  wsInstanceId: string;
  sentry: { enabled: boolean };
  serviceHealth: {
    database: { status: string; latencyMs?: number };
    redis: { status: string; topology: string; connectedClients: number; hitRate: number };
    websocket: { status: string; totalConnections: number; totalRooms: number; redisFanout: boolean };
    queue: { status: string; assignmentBacklog: number };
    payments: { status: string; pending: number };
    finance: { status: string; lastIntegrityStatus: string; openAlerts: number };
  };
  alerts: { opsOpen: number; financeOpen: number };
  logs: { total: number; last24h: number };
  tracing: { bufferSize: number; domainCounts: Record<string, number> };
};

export type ComplianceRequest = {
  id: string;
  userId: string;
  requestType: string;
  status: string;
  submittedAt: string;
  dueDateAt: string;
  completedAt?: string | null;
  rejectionReason?: string | null;
  user?: { email?: string; firstName?: string; lastName?: string };
};

export type LogSearchQuery = {
  requestId?: string;
  traceId?: string;
  userId?: string;
  bookingId?: string;
  paymentId?: string;
  category?: string;
  level?: string;
  search?: string;
  cursor?: string;
  limit?: number;
  startDate?: string;
  endDate?: string;
};

export type LogSearchResult = {
  logs: Array<{
    id: string;
    level: string;
    category: string;
    message: string;
    requestId: string | null;
    traceId: string | null;
    userId: string | null;
    bookingId: string | null;
    paymentId: string | null;
    createdAt: string;
  }>;
  nextCursor: string | null;
  hasMore: boolean;
};

export type ProductionValidationReport = {
  status: "PASS" | "FAIL";
  score: number;
  checks: Array<{ domain: string; name: string; status: string; details?: string }>;
  reports: Record<string, unknown>;
  beforeScore: Record<string, number>;
  afterScore: Record<string, number>;
};

export type WeatherCity = {
  city: string;
  available: boolean;
  tempC?: number;
  humidity?: number;
  windSpeedKmh?: number;
  rain1hMm?: number;
  condition?: string;
  description?: string;
  severity?: "clear" | "mild" | "moderate" | "severe" | "extreme";
  surgeMultiplier?: number;
  etaFactor?: number;
  vendorImpact?: { impact: "none" | "reduced" | "severe"; factor: number; reason: string };
  alerts?: Array<{ type: string; level: "advisory" | "warning" | "severe"; message: string }>;
};
export type WeatherOverview = {
  available: boolean;
  reason?: string;
  generatedAt?: string;
  citiesTracked?: number;
  citiesWithData?: number;
  severeAreas?: number;
  cities: WeatherCity[];
};

export type ZoneAnalyticsRow = {
  id: string; name: string; city: string | null; zoneType: string; shape: string;
  surgeMultiplier: number; supply: number; demand: number; revenue: number; utilization: number;
  completed: number; cancelled: number;
};
export type ZoneAnalytics = {
  zones: ZoneAnalyticsRow[];
  totals: { zones: number; supply: number; demand: number; revenue: number };
};
