import { apiRequest } from "@/lib/api-client";
import { PartnerApiError } from "@/lib/api-error";
import { parseExecutionPolicyCopy, parseExecutionQuality, type BookingExecutionQuality, type ExecutionPolicyCopy } from "@/lib/completion-checklist";
import type {
  ApiResponse,
  BookingRequirementsView,
  CapabilityKind,
  DeclareCertificationBody,
  DeclareEquipmentBody,
  DeclareInsuranceBody,
  DeclareLanguageBody,
  DeclareSkillBody,
  EditCapabilityBody,
  ProviderCapabilityProfile,
  ProviderCertificationRow,
  ProviderEquipmentRow,
  ProviderInsuranceRow,
  ProviderLanguageRow,
  ProviderSkillRow,
  ServiceReadiness,
  JobActionResult,
  NoShowReportResult,
  RequirementGateResult,
  JobChatList,
  JobEvidenceItem,
  PartnerBooking,
  PartnerBookingsResponse,
  PartnerDashboard,
  PartnerEarningsSummary,
  PartnerEntitlements,
  PartnerJobEarning,
  PartnerMembershipData,
  PartnerMembershipPlan,
  PartnerNotificationsResponse,
  PartnerPayoutsData,
  PartnerReview,
  PartnerReviewsResponse,
  ProviderProfile,
  WalletTransactionsResponse,
} from "@/types/partner";

type ListBookingsQuery = {
  status?: string;
  page?: number;
  limit?: number;
  sortBy?: "upcoming" | "recent";
};

// --- Canonical notification preferences (Section 09) ---
export type NotificationChannelName = "IN_APP" | "PUSH" | "EMAIL" | "SMS";
export type NotificationCategoryName = "TRANSACTIONAL" | "SECURITY" | "OPTIONAL";

export type NotificationChannelAvailability = {
  channel: NotificationChannelName;
  available: boolean;
  unavailableReason?: string;
  reason?: "no_registered_device" | "no_email_on_file" | "no_phone_on_file" | "provider_not_configured";
};

export type NotificationPreferenceCell = {
  category: NotificationCategoryName;
  channel: NotificationChannelName;
  enabled: boolean;
  editable: boolean;
  mandatory: boolean;
  available: boolean;
  unavailableReason?: NotificationChannelAvailability["reason"];
  source: "EXPLICIT_PREFERENCE" | "CATEGORY_DEFAULT" | "SYSTEM_DEFAULT" | "MANDATORY_CATEGORY";
};

export type NotificationPreferenceMatrix = {
  preferences: Array<{
    channel: NotificationChannelName;
    category: NotificationCategoryName;
    enabled: boolean;
    language: string | null;
  }>;
  channels: NotificationChannelAvailability[];
  matrix: NotificationPreferenceCell[];
};

// --- Geo-Intelligence envelopes (consumes /api/geo-intel/*; partner-allowed endpoints) ---
export type GeoIntel<T> = { success: boolean; data: T; confidence: number; freshness: string; source: string; cached: boolean; generatedAt: string };
export type SurgeZone = { zoneId: string; name: string; city: string | null; supply: number; activeBookings: number; weatherSurge: number; predictedSurge: number; demandDeltaPct: number | null };
export type DensityZone = { zoneId: string; name: string; city: string | null; centerLat: number; centerLng: number; providers: number; areaKm2: number; densityPerKm2: number };
export type ZoneScore = {
  zoneId: string;
  name: string;
  city: string | null;
  supply: number;
  demand24h: number;
  revenue24h: number;
  earningScore: number;
  demandScore: number;
  serviceHealth: number;
  riskScore: number;
  compositeScore: number;
  opportunityScore?: number;
  gap?: number;
  interpretation?: string;
  recommendation?: string | null;
  skillGaps?: Array<{ skill: string; demand: number; supply: number; gap: number }>;
};
export type ZoneScoring = {
  ranked: ZoneScore[];
  bestEarning: ZoneScore[];
  bestOpportunity?: ZoneScore[];
  worstService: ZoneScore[];
  highRisk: ZoneScore[];
};
export type DemandPoint = { zone_id: string; hour: string; predicted: number; lo: number; hi: number };
/**
 * The backend states whether the forecast window has already passed.
 *
 * `ML.FORECAST` projects from the end of the model's training data, so a warehouse forecast can
 * describe hours that are months old. `stale` and `forecastWindow` come from the API; the page
 * must not render the points as a forecast of the coming day when `stale` is true.
 */
export type DemandForecast = {
  horizonHours: number;
  points: DemandPoint[];
  totalPredicted: number;
  stale?: boolean;
  forecastWindow?: { from: string | null; to: string | null };
  expiredByHours?: number | null;
  limitations?: string[];
};
/**
 * X-84: the forecast source (the data warehouse) did not answer. A state, not an error — and it
 * carries no forecast numbers, so nothing can be rendered as a prediction.
 */
export type DemandForecastUnavailable = {
  success: true;
  available: false;
  reasonCode: "FORECAST_SOURCE_UNAVAILABLE";
  cause: string;
  reason: string;
  data: null;
  confidence: null;
  freshness: null;
  source: "unavailable";
  cached: false;
  generatedAt: string;
};
export type DemandForecastResponse = (GeoIntel<DemandForecast> & { available?: true }) | DemandForecastUnavailable;
export type EtaResult = { etaMin: number; distanceKm: number; method: string; withTraffic?: boolean };

export type PresenceFreshness = "FRESH" | "STALE" | "EXPIRED";

export type PartnerPresenceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string | null;
  receivedAt: string | null;
  transportLagSeconds: number | null;
  source: string | null;
  sequence: number | null;
  /** The device's own word on the fix: true = flagged mock-location by the OS, false = not, null = unknown (web always null). */
  mocked: boolean | null;
};

export type PartnerPresenceSnapshot = {
  providerId: string;
  sessionId: string | null;
  deviceId: string | null;
  lastHeartbeatAt: string | null;
  lastSeenAt: string | null;
  presenceFreshness: PresenceFreshness;
  locationFreshness: PresenceFreshness;
  presenceAgeSeconds: number | null;
  locationAgeSeconds: number | null;
  operationallyLive: boolean;
  location: PartnerPresenceLocation | null;
  appState: string | null;
  platform: string | null;
  appVersion: string | null;
  heartbeatIntervalSeconds: number;
};

export type PartnerPresenceHeartbeatBody = {
  sessionId: string;
  deviceId: string;
  timestamp: string;
  appState?: "foreground" | "background" | "inactive";
  platform?: "ios" | "android" | "web";
  appVersion?: string;
  availabilityTelemetry?: string;
  location?: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    capturedAt: string;
    sequence?: number;
    /** Android `LocationObjectCoords.mocked`; the browser has no such flag, so the web never sends it (undefined = unknown). */
    mocked?: boolean | null;
  };
};

export type PartnerPresenceHeartbeatResult = {
  accepted: boolean;
  duplicate?: boolean;
  snapshot: PartnerPresenceSnapshot;
};

export type PartnerLocationPingBody = {
  sessionId: string;
  deviceId: string;
  location: {
    latitude: number;
    longitude: number;
    accuracy?: number;
    capturedAt: string;
    sequence?: number;
    /** As on the heartbeat: the web never sends it. */
    mocked?: boolean | null;
  };
};

export type PartnerDispatchEligibility = {
  providerId: string;
  eligible: boolean;
  blockedBy: string | null;
  reasons: string[];
  checks: {
    lifecycle: boolean;
    availability: boolean;
    presence: boolean;
    location: boolean;
    capacity: boolean;
    schedule: boolean;
    geo: boolean;
    skill: boolean;
    risk: boolean;
    payment: boolean;
    conflict: boolean;
  };
  evaluatedAt: string;
};

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
  /**
   * null = UNMEASURED. GET /api/coverage/cities returns null rather than inventing a figure, and
   * falls back to an empty aggregate map if the read fails — so these arrive null in practice, not
   * only in theory. Declaring them non-null here hid that from `tsc`.
   */
  activePartners: number | null;
  customers: number | null;
  servicesCompleted: number | null;
  fulfillmentRate: number | null;
  coverageScore: number;
};

/** Omit unset ETA so Accept does not POST `{"eta":null}` (TypeBox: "Expected number"). */
function acceptEtaBody(eta?: number): { eta?: number } {
  if (typeof eta !== "number" || !Number.isFinite(eta)) return {};
  const n = Math.round(eta);
  if (n < 1 || n > 480) return {};
  return { eta: n };
}

function optionalGeoBody(
  latitude: number | null | undefined,
  longitude: number | null | undefined,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...extra };
  if (typeof latitude === "number" && Number.isFinite(latitude)) body.latitude = latitude;
  if (typeof longitude === "number" && Number.isFinite(longitude)) body.longitude = longitude;
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null || value === "") delete body[key];
  }
  return body;
}

export type PartnerServiceSkillCard = {
  serviceId: string;
  name: string;
  slug: string;
  category: string;
  lane: "performing" | "pending" | "suspended" | "revoked" | "available";
  capabilityId: number | null;
  source: string | null;
  requestedAt: string | null;
  requestNote: string | null;
  /** Performing lane only, and only from a backend that reports it — absent means unknown, not ready. */
  readiness?: ServiceReadiness;
};

export type PartnerServiceSkillBoard = {
  approvalWorkflow: boolean;
  performing: PartnerServiceSkillCard[];
  pending: PartnerServiceSkillCard[];
  suspended: PartnerServiceSkillCard[];
  revoked: PartnerServiceSkillCard[];
  available: PartnerServiceSkillCard[];
};

function payoutsAsWalletHistory(
  finance: PartnerPayoutsData,
  query: { page?: number; limit?: number },
): WalletTransactionsResponse {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const credits = (finance.analytics?.daily ?? []).map((d) => ({
    id: `earn-${d.period}`,
    type: "credit" as const,
    amount: d.amount,
    description: `Earnings ${d.period}`,
    status: "posted",
    createdAt: d.period,
  }));
  const debits = (finance.withdrawals ?? []).map((w) => ({
    id: w.id,
    transactionNumber: w.reference,
    type: "debit" as const,
    amount: w.amount,
    description: `Payout ${w.reference}`,
    status: w.status,
    createdAt: w.requestedAt ?? w.settlementDate ?? "",
  }));
  const rows = [...credits, ...debits].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const start = Math.max(0, (page - 1) * limit);
  return { transactions: rows.slice(start, start + limit), total: rows.length, page, limit };
}

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
    // zone-scoring is ADMIN-only. Partners must not call it (403). Surge, density and
    // demand-forecast are the partner-allowed reads.
    demandForecast: (horizon = 24) => apiRequest<DemandForecastResponse>("/api/geo-intel/demand-forecast", { auth: true, query: { horizon } }),
    eta: (fromLat: number, fromLng: number, toLat: number, toLng: number) =>
      apiRequest<GeoIntel<EtaResult>>("/api/geo-intel/eta", { auth: true, query: { fromLat, fromLng, toLat, toLng } }),
    /** Server-side driving route (Google → OSRM). Avoids client Directions billing errors. */
    route: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
      apiRequest<
        ApiResponse<{
          polyline: string | null;
          distanceKm: number;
          durationMin: number;
          etaMinutes: number;
          source: string;
        }>
      >("/api/geo/route", {
        auth: true,
        query: { fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng },
      }).then((r) => r.data!),
  },

  /* ----------------- Provider profile + online toggle ----------------- */
  me: () =>
    apiRequest<ApiResponse<{ provider: ProviderProfile }>>("/api/providers/me", {
      auth: true,
    }).then((r) => r.data!.provider),

  myServices: () =>
    apiRequest<
      ApiResponse<{
        services: Array<{
          id: string;
          name: string;
          slug: string;
          category: string;
          estimatedDuration: number;
          requiredSkills: string[];
          inspectionRequired: boolean;
          materialPolicy: string | null;
          equipmentPolicy: string | null;
          materials: string | null;
          equipment: string | null;
          qualityChecklist: string[];
          proofRequired: boolean;
          beforeAfterPhotos: boolean;
          trainingRequired: boolean;
          certifications: string[];
        }>;
      }>
    >("/api/providers/me/services", { auth: true }).then((r) => r.data!),

  serviceSkills: () =>
    apiRequest<ApiResponse<PartnerServiceSkillBoard>>("/api/providers/me/service-skills", { auth: true }).then((r) => r.data!),

  requestServiceSkill: (serviceId: string, note?: string) =>
    apiRequest<ApiResponse<{ row: { id?: number }; changed: boolean }>>("/api/providers/me/capabilities/services", {
      method: "POST",
      auth: true,
      body: { serviceId, ...(note ? { note } : {}) },
    }).then((r) => r.data!),

  withdrawServiceSkill: (capabilityId: number) =>
    apiRequest<ApiResponse<{ deleted: true }>>(`/api/providers/me/capabilities/services/${capabilityId}`, {
      method: "DELETE",
      auth: true,
    }).then((r) => r.data!),

  /* ---- Phase 11 — capability self-service (`/api/providers/me/capabilities`) ----
   * A partner only DECLARES; an admin verifies. Keyed kinds (skills, equipment, languages) are
   * changed by declaring the same key again; certifications and insurance are edited with PATCH.
   * A VERIFIED / REVOKED row answers 409 CAPABILITY_LOCKED.
   */
  capabilities: {
    profile: () =>
      apiRequest<ApiResponse<ProviderCapabilityProfile>>("/api/providers/me/capabilities", { auth: true }).then((r) => r.data!),
    declareSkill: (body: DeclareSkillBody) =>
      apiRequest<ApiResponse<{ row: ProviderSkillRow; changed: boolean }>>("/api/providers/me/capabilities/skills", { method: "POST", auth: true, body }).then((r) => r.data!),
    declareCertification: (body: DeclareCertificationBody) =>
      apiRequest<ApiResponse<{ row: ProviderCertificationRow; changed: boolean }>>("/api/providers/me/capabilities/certifications", { method: "POST", auth: true, body }).then((r) => r.data!),
    declareEquipment: (body: DeclareEquipmentBody) =>
      apiRequest<ApiResponse<{ row: ProviderEquipmentRow; changed: boolean }>>("/api/providers/me/capabilities/equipment", { method: "POST", auth: true, body }).then((r) => r.data!),
    declareInsurance: (body: DeclareInsuranceBody) =>
      apiRequest<ApiResponse<{ row: ProviderInsuranceRow; changed: boolean }>>("/api/providers/me/capabilities/insurance", { method: "POST", auth: true, body }).then((r) => r.data!),
    declareLanguage: (body: DeclareLanguageBody) =>
      apiRequest<ApiResponse<{ row: ProviderLanguageRow; changed: boolean }>>("/api/providers/me/capabilities/languages", { method: "POST", auth: true, body }).then((r) => r.data!),
    edit: (kind: "certifications" | "insurance", rowId: number, body: EditCapabilityBody) =>
      apiRequest<ApiResponse<{ row: ProviderCertificationRow | ProviderInsuranceRow }>>(`/api/providers/me/capabilities/${kind}/${rowId}`, { method: "PATCH", auth: true, body }).then((r) => r.data!),
    withdraw: (kind: CapabilityKind, rowId: number) =>
      apiRequest<ApiResponse<{ deleted: true }>>(`/api/providers/me/capabilities/${kind}/${rowId}`, { method: "DELETE", auth: true }).then((r) => r.data!),
  },

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

  presenceSnapshot: () =>
    apiRequest<ApiResponse<PartnerPresenceSnapshot>>("/api/providers/me/presence", { auth: true }).then(
      (r) => r.data!,
    ),

  presenceHeartbeat: (body: PartnerPresenceHeartbeatBody) =>
    apiRequest<ApiResponse<PartnerPresenceHeartbeatResult>>("/api/providers/me/presence/heartbeat", {
      method: "POST",
      auth: true,
      body,
    }).then((r) => r.data!),

  locationPing: (body: PartnerLocationPingBody) =>
    apiRequest<ApiResponse<PartnerPresenceHeartbeatResult>>("/api/providers/me/location/ping", {
      method: "POST",
      auth: true,
      body,
    }).then((r) => r.data!),

  dispatchEligibility: () =>
    apiRequest<ApiResponse<PartnerDispatchEligibility>>("/api/providers/me/dispatch-eligibility", {
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

  /** One job from GET /api/bookings/:id. List caches omit jobs outside the last page. */
  getBooking: (bookingId: string) =>
    apiRequest<ApiResponse<{ booking: PartnerBooking }>>(`/api/bookings/${bookingId}`, {
      auth: true,
    }).then((r) => {
      const b = r.data!.booking;
      const addr = b.address;
      return {
        ...b,
        // The customer's note: present only while this partner holds the job, otherwise null.
        description: b.description ?? null,
        amount: b.amount ?? b.finalAmount,
        completedAt: b.completedAt ?? null,
        enRouteAt: b.enRouteAt ?? null,
        arrivedAt: b.arrivedAt ?? null,
        startedAt: b.startedAt ?? null,
        service: {
          id: b.service?.id ?? "",
          name: b.service?.name ?? "Service",
          icon: b.service?.icon ?? null,
          basePrice: b.service?.basePrice ?? 0,
        },
        address: {
          ...addr,
          fullAddress: addr?.fullAddress ?? "",
          latitude: addr?.latitude ?? null,
          longitude: addr?.longitude ?? null,
        },
      } satisfies PartnerBooking;
    }),

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
        mode?: "llm" | "deterministic_fallback";
        intent?: string;
        basis?: string[];
        recommendation?: string | null;
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
      body: acceptEtaBody(eta),
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
  markEnRoute: (bookingId: string, latitude: number | null, longitude: number | null) =>
    apiRequest<
      ApiResponse<{
        newlyTransitioned: boolean;
        booking: { status: string; enRouteAt?: string | null };
      }>
    >(`/api/bookings/${bookingId}/en-route`, {
      method: "POST",
      auth: true,
      body: optionalGeoBody(latitude, longitude),
    }).then((r) => r.data!),

  /**
   * Declares arrival. Races safely with the geofence and the job-start fallback.
   * `null` coordinates mean the device has no position: the server refuses unless the customer or
   * an admin has vouched for this partner on this booking.
   */
  markArrived: (bookingId: string, latitude: number | null, longitude: number | null) =>
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

  startBooking: (bookingId: string, latitude: number | null, longitude: number | null, otp?: string) =>
    apiRequest<
      ApiResponse<{ booking: { status: string; startedAt?: string | null } }>
    >(`/api/bookings/${bookingId}/start`, {
      method: "POST",
      auth: true,
      body: { latitude, longitude, ...(otp ? { otp } : {}) },
    }).then((r) => r.data!),

  /**
   * The frozen execution policy of ONE booking, from `GET /api/bookings/:id` (partner projection:
   * `data.booking.execution`) for the job page: the quality checklist the completion UI needs (a
   * service without a quality policy answers with an empty checklist) and (X-30) the frozen
   * materials / equipment copy.
   */
  getBookingExecutionBrief: (bookingId: string): Promise<{ quality: BookingExecutionQuality; policy: ExecutionPolicyCopy }> =>
    apiRequest<ApiResponse<{ booking: { execution?: unknown } }>>(`/api/bookings/${bookingId}`, { auth: true }).then((r) => ({
      quality: parseExecutionQuality(r),
      policy: parseExecutionPolicyCopy(r),
    })),

  /**
   * `completedChecklist` is the partner's ACTUAL submission — only the items ticked in the UI, as
   * the exact strings of the booking's frozen checklist. The server matches item by item and refuses
   * with `QUALITY_CHECKLIST_REQUIRED` when any is missing; the key is omitted when the booking has
   * no checklist (see `checklistCompletionFields`).
   */
  completeBooking: (
    bookingId: string,
    latitude: number | null,
    longitude: number | null,
    notes?: string,
    photos?: string[],
    completedChecklist?: string[],
    /** The partner's attestation — pass `true` only when they ticked it (`professionalConfirmationField`). */
    professionalConfirmation?: true,
  ) =>
    apiRequest<
      ApiResponse<{
        booking: { status: string; completedAt?: string | null; totalDuration?: number };
      }>
    >(`/api/bookings/${bookingId}/complete`, {
      method: "POST",
      auth: true,
      body: optionalGeoBody(latitude, longitude, {
        notes,
        ...(photos?.length ? { photos } : {}),
        ...(completedChecklist !== undefined ? { completedChecklist } : {}),
        ...(professionalConfirmation === true ? { professionalConfirmation: true } : {}),
      }),
    }).then((r) => r.data!),

  /* ---- Phase 10 §6 — requirement state ---- */
  getRequirements: (bookingId: string) =>
    apiRequest<ApiResponse<BookingRequirementsView>>(`/api/bookings/${bookingId}/requirements`, { auth: true }).then((r) => r.data!),

  /**
   * Records what the partner FOUND on site. The server decides whether the gate passes and answers
   * with the new state and the START gate; GPS proximity is enforced exactly like arrival.
   */
  checkRequirement: (bookingId: string, code: string, outcome: "SATISFIED" | "FAILED", latitude: number | null, longitude: number | null, note?: string) =>
    apiRequest<ApiResponse<{ code: string; state: string; changed: boolean; gate: RequirementGateResult }>>(
      `/api/bookings/${bookingId}/requirements/${encodeURIComponent(code)}/check`,
      { method: "POST", auth: true, body: { outcome, latitude, longitude, ...(note ? { note } : {}) } },
    ).then((r) => r.data!),

  getJobActions: (bookingId: string) =>
    apiRequest<ApiResponse<JobActionResult>>(`/api/bookings/${bookingId}/actions`, {
      auth: true,
    }).then((r) => r.data!),

  /**
   * §52 — the partner waited at the door and nobody came. The server decides whether the fee applies
   * (see `noShow` on the actions answer); `message` and `feeNote` are its words.
   */
  reportCustomerNoShow: (bookingId: string) =>
    apiRequest<ApiResponse<Omit<NoShowReportResult, "message">>>(`/api/bookings/${bookingId}/no-show`, {
      method: "POST",
      auth: true,
      body: {},
    }).then((r): NoShowReportResult => ({ ...r.data!, message: r.message ?? "" })),

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
  // NOTE: there is deliberately no `walletBalance` client here. `/api/wallet/balance` is the
  // CUSTOMER wallet (users.wallet_balance); partner balance comes from `/me/payouts`.
  walletTransactions: (query: { page?: number; limit?: number } = {}) =>
    apiRequest<ApiResponse<PartnerPayoutsData>>("/api/providers/me/payouts", {
      auth: true,
    }).then((r) => payoutsAsWalletHistory(r.data!, query)),

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

    /**
     * The canonical preference matrix — one cell per (channel, category), resolved server-side
     * through the same function the notification router uses.
     */
    preferences: () =>
      apiRequest<ApiResponse<NotificationPreferenceMatrix>>("/api/notifications/preferences", {
        auth: true,
      }).then((r) => r.data!),

    setPreference: (body: {
      channel: NotificationChannelName;
      category: NotificationCategoryName;
      enabled: boolean;
    }) =>
      apiRequest<ApiResponse<unknown>>("/api/notifications/preferences", {
        method: "PUT",
        auth: true,
        body,
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

  network: {
    dashboard: () =>
      apiRequest<ApiResponse<PartnerNetworkDashboard>>("/api/providers/me/network", { auth: true }).then((r) => r.data!),
    invite: (body: {
      name: string;
      phone: string;
      email?: string;
      city?: string;
      skillInterest?: string;
    }) =>
      apiRequest<ApiResponse<PartnerNetworkInviteResult>>("/api/providers/me/network/invite", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),
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

  /**
   * Phase 13 P2: what THIS job paid the partner, as the server itemises it. `null` is the server's
   * 404 (`EARNING_NOT_FOUND`): the job is not completed, earned nothing, or is not this partner's —
   * the page then says earnings are shown after completion and estimates nothing.
   */
  getBookingEarning: (bookingId: string): Promise<PartnerJobEarning | null> =>
    apiRequest<ApiResponse<{ earning: PartnerJobEarning }>>(`/api/providers/me/bookings/${encodeURIComponent(bookingId)}/earning`, {
      auth: true,
    })
      .then((r) => r.data?.earning ?? null)
      .catch((err: unknown) => {
        if (err instanceof PartnerApiError && err.status === 404) return null;
        throw err;
      }),

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
    score: () =>
      apiRequest<ApiResponse<PartnerScorecard>>("/api/providers/me/score", { auth: true }).then((r) => r.data!),
    scoreHistory: (page = 1) =>
      apiRequest<ApiResponse<PartnerScoreHistoryPage>>("/api/providers/me/score/history", {
        auth: true,
        query: { page, limit: 20 },
      }).then((r) => r.data!),
    career: () =>
      apiRequest<ApiResponse<PartnerCareer>>("/api/providers/me/career", { auth: true }).then((r) => r.data!),
    careerHistory: (page = 1) =>
      apiRequest<ApiResponse<PartnerCareerHistoryPage>>("/api/providers/me/career/history", {
        auth: true,
        query: { page, limit: 20 },
      }).then((r) => r.data!),
    lifecycle: () =>
      apiRequest<ApiResponse<PartnerLifecycle>>("/api/providers/me/lifecycle", { auth: true }).then((r) => r.data!),
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
    triggerSos: (body?: { bookingId?: string; latitude?: number; longitude?: number; accuracy?: number }) =>
      apiRequest<ApiResponse<{ incidentId: string; status: string; created: boolean; hasLocation: boolean }>>(
        "/api/providers/me/safety/sos",
        { method: "POST", auth: true, body: body ?? {} },
      ).then((r) => r.data!),
    reportSafety: (body: { type: string; bookingId?: string; notes?: string }) =>
      apiRequest<ApiResponse<{ incidentId: string; status: string }>>("/api/providers/me/safety/report", {
        method: "POST",
        auth: true,
        body,
      }).then((r) => r.data!),
    safetyIncidents: () =>
      apiRequest<ApiResponse<{ incidents: Array<{ id: string; type: string; status: string; severity: string; createdAt: string }> }>>(
        "/api/providers/me/safety/incidents",
        { auth: true },
      ).then((r) => r.data!.incidents),
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
    setDocumentMeta: (documentId: string, body: { expiryDate?: string | null; issuer?: string; issueDate?: string | null }) =>
      apiRequest<ApiResponse<{ document: PartnerDocument }>>(`/api/providers/me/documents/${documentId}`, {
        method: "PATCH",
        auth: true,
        body,
      }).then((r) => r.data!),
    updateEmergencyContact: (body: { emergencyContactName?: string; emergencyContactPhone?: string }) =>
      apiRequest<ApiResponse<{ emergencyContactName: string | null; emergencyContactPhone: string | null }>>(
        "/api/providers/me/safety/emergency-contact",
        { method: "PATCH", auth: true, body },
      ).then((r) => r.data!),
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
  basis?: {
    todayProjection?: { method?: string; predictive?: boolean; source?: string; freshness?: string };
    weeklyProjection?: { method?: string; predictive?: boolean; state?: string };
    monthlyProjection?: { method?: string; predictive?: boolean; state?: string };
  };
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

export type PartnerScoreComponent = { value: number | null; weight: number };
export type PartnerScorecard = {
  policyVersion: string;
  overallScore: number | null;
  band: "EXCELLENT" | "GOOD" | "HEALTHY" | "NEEDS_ATTENTION" | "AT_RISK" | "INSUFFICIENT_DATA";
  components: {
    quality: PartnerScoreComponent;
    reliability: PartnerScoreComponent;
    completion: PartnerScoreComponent;
    onTime: PartnerScoreComponent;
    customerSatisfaction: PartnerScoreComponent;
    compliance: PartnerScoreComponent;
    safety: PartnerScoreComponent;
  };
  sample: { completedJobs: number; ratings: number; arrivals: number; assignments: number };
  calculatedAt: string;
  trends: Record<string, { delta: number | null; insufficient: boolean }>;
};
export type PartnerScoreHistoryPage = {
  items: Array<{
    id: string;
    previousScore: number | null;
    newScore: number | null;
    previousBand: string | null;
    newBand: string;
    delta: number | null;
    reasons: Array<{ code: string; component: string; delta: number; detail: string; evidenceCount: number }>;
    calculatedAt: string;
  }>;
  page: number;
  total: number;
};
export type PartnerCareerRequirement = {
  id: string;
  label: string;
  current: number;
  target: number;
  met: boolean;
  unit: string;
};
export type PartnerCareer = {
  currentLevel: "STARTER" | "PROFESSIONAL" | "EXPERT" | "ELITE";
  nextLevel: "STARTER" | "PROFESSIONAL" | "EXPERT" | "ELITE" | null;
  progressPct: number;
  remainingRequirements: PartnerCareerRequirement[];
  requirements: PartnerCareerRequirement[];
  qualificationState: string;
  benefitsActive: boolean;
  careerPriorityBoost: number;
  badges: Array<{ code: string; label: string; awardedAt: string; reason: string }>;
};
export type PartnerCareerHistoryPage = {
  items: Array<{
    id: string;
    previousLevel: string | null;
    newLevel: string;
    reason: string;
    createdAt: string;
  }>;
  page: number;
  total: number;
};
export type PartnerLifecycle = {
  lifecycleState: string;
  allowedTransitions: string[];
  dispatchEligible: boolean;
  availability: { isOnline: boolean; pausedAt: string | null; currentStatus: string };
  isApproved: boolean;
  isActive: boolean;
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
  status: "VERIFIED" | "EXPIRING" | "ACTION_REQUIRED" | "RESTRICTED";
  explanation: string;
  restricted: boolean;
  restrictionReason: string | null;
  documents: Array<{
    id: string;
    documentType: string;
    documentName: string | null;
    issuer?: string | null;
    isVerified: boolean;
    expiryDate: string | null;
    expiryState?: string;
    daysToExpiry?: number | null;
    cta?: string;
    category?: string;
    expiringSoon: boolean;
  }>;
  verification: Record<string, unknown>;
  complianceScore: number;
  expiringSoon: number;
  certifications: string[];
  insurance?: Array<Record<string, unknown>>;
};

export type PartnerWellbeing = {
  sosPhone: string | null;
  insuranceUrl: string | null;
  communityUrl: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
};

export type PartnerRewards = {
  badges: string[];
  milestones: Array<{ label: string; target: number; current: number; achieved: boolean; progressPct: number }>;
  referralCount: number;
  referralCode: string | null;
  incentiveEarnings: number;
};

export type PartnerNetworkReferral = {
  id: string;
  name: string;
  status: string;
  jobs: number;
  jobTarget: number;
  qualificationLabel: string;
  nextMilestone: string;
  rewardAmount: number | null;
  invitedAt: string;
  registeredAt: string | null;
  qualifiedAt: string | null;
  rewardedAt: string | null;
};

export type PartnerNetworkDashboard = {
  code: string;
  shareUrl: string;
  rewardPerQualified: number;
  jobTarget: number;
  counts: {
    invited: number;
    registered: number;
    verified: number;
    training: number;
    active: number;
    firstJob: number;
    qualified: number;
    rewarded: number;
  };
  totalRewarded: number;
  referrals: PartnerNetworkReferral[];
};

export type PartnerNetworkInviteResult = {
  referralId: string;
  leadId: string;
  status: string;
  code: string;
  shareUrl: string;
  inviteUrl: string;
  expiresAt: string;
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
