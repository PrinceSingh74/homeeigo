import { getApiBaseUrl } from "@/lib/api-config";
import type {
  BookingExecutionView,
  BookingRequirementsView,
  BookingSafetyView,
  CapabilityWriteRow,
  DeclareCertificationBody,
  DeclareEquipmentBody,
  DeclareInsuranceBody,
  DeclareLanguageBody,
  DeclareSkillBody,
  EditCapabilityBody,
  PartnerCapabilityProfile,
  PartnerCaseView,
  PartnerServiceSkillBoard,
  RequirementGateResult,
} from "@/types/partner";
import {
  classifyRefreshResponse,
  createRefreshCoordinator,
  sendWithAuthRetry,
  type RefreshOutcome,
} from "@/lib/auth-refresh";
import { recordServerDate } from "@/lib/server-clock";
import type {
  DemandForecast,
  DensityZone,
  PartnerAcademy,
  PartnerAttendance,
  PartnerBooking,
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
  PartnerScorecard,
  PartnerCareer,
  PartnerLifecycle,
  PartnerReviewsResponse,
  PartnerServiceHistory,
  PartnerSupportTicket,
  PartnerSupportTicketDetail,
  PartnerTaxSummary,
  PartnerUser,
  PartnerWellbeing,
  PartnerOperations,
  ProviderProfile,
  RouteOptimizeResult,
  SurgeZone,
  WalletBalance,
  WalletTransactionsResponse,
  ZoneScoring,
} from "@/types/partner";

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  retryAfter?: unknown;
};

let accessToken: string | null = null;

export function setApiAccessToken(token: string | null) {
  accessToken = token;
}

export function getApiAccessToken(): string | null {
  return accessToken;
}

/**
 * Session hooks wired by the auth store (kept as callbacks so this module does not import the
 * store — the store already imports this module).
 */
export type AuthSessionBridge = {
  getRefreshToken: () => string | null;
  /** Persist the rotated pair (SecureStore via the auth store's persist storage). */
  onTokensRefreshed: (tokens: { accessToken: string; refreshToken: string; sessionId: string | null }) => void;
  /** The server refused the refresh token: clear credentials, close sockets, go to login. */
  onSessionRejected: () => void | Promise<void>;
};

let sessionBridge: AuthSessionBridge | null = null;

export function configureAuthSession(bridge: AuthSessionBridge | null) {
  sessionBridge = bridge;
}

async function performTokenRefresh(): Promise<RefreshOutcome> {
  const refreshToken = sessionBridge?.getRefreshToken() ?? null;
  if (!refreshToken) return { kind: "rejected" };
  const { getDeviceId, getDeviceName } = await import("@/lib/device");
  // Same deviceId as login: the backend revokes the session on a device mismatch.
  const deviceId = await getDeviceId();
  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken, deviceId, deviceName: getDeviceName(), setAuthCookies: false }),
    });
  } catch {
    return { kind: "unavailable" };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  const verdict = classifyRefreshResponse(res.status, body);
  if (verdict.kind !== "ok") return verdict;
  accessToken = verdict.accessToken;
  sessionBridge?.onTokensRefreshed({
    accessToken: verdict.accessToken,
    refreshToken: verdict.refreshToken,
    sessionId: verdict.sessionId,
  });
  return { kind: "refreshed", accessToken: verdict.accessToken };
}

/** ONE refresh at a time for the whole app (HTTP 401s and WebSocket 4401 closes share it). */
const refreshCoordinator = createRefreshCoordinator(performTokenRefresh);

/**
 * Refresh the access token (joining any refresh already in flight). Used by the WebSocket clients
 * on close code 4401 and by bootstrap. On `rejected` the session is torn down here, once.
 */
export async function refreshAccessTokenOnce(): Promise<RefreshOutcome> {
  const outcome = await refreshCoordinator.refresh();
  if (outcome.kind === "rejected") await sessionBridge?.onSessionRejected();
  return outcome;
}

/** Paths that must never trigger a refresh (they ARE the auth flow). */
const NO_REFRESH_PATHS = ["/api/auth/login", "/api/auth/refresh", "/api/auth/logout"];

/**
 * 401s that reject the PRESENCE session named in the heartbeat body, not the access token. Refreshing
 * on them is self-sustaining: refresh rotates the session, revoking the id the heartbeat just sent,
 * so the retry is rejected again and every beat mints and revokes a refresh token. The heartbeat hook
 * owns their recovery (re-read the snapshot, beat again).
 */
const PRESENCE_SESSION_CODES = new Set(["INVALID_SESSION", "STALE_SESSION", "DEVICE_MISMATCH"]);
const presenceSessionRejects = new WeakSet<Response>();

export class PartnerApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly retryAfter: number | null;

  constructor(
    message: string,
    opts: { status: number; code?: string | null; retryAfter?: number | null },
  ) {
    super(message);
    this.name = "PartnerApiError";
    this.status = opts.status;
    this.code = opts.code ?? null;
    this.retryAfter = opts.retryAfter ?? null;
  }
}

type RequestOpts = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

function parseRetryAfter(res: Response, json: { retryAfter?: unknown }): number | null {
  if (typeof json.retryAfter === "number" && Number.isFinite(json.retryAfter) && json.retryAfter > 0) {
    return json.retryAfter;
  }
  const header = res.headers.get("Retry-After");
  if (header && /^\d+$/.test(header)) {
    const n = Number(header);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  const url = new URL(`${getApiBaseUrl()}${path}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  const target = url.toString();
  const send = async (token: string | null): Promise<Response> => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const startedAt = Date.now();
    const response = await fetch(target, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    recordServerDate(response.headers.get("Date"), startedAt, Date.now());
    if (response.status === 401) {
      const code = await response
        .clone()
        .json()
        .then((j: { code?: string } | null) => j?.code ?? "")
        .catch(() => "");
      if (PRESENCE_SESSION_CODES.has(code)) presenceSessionRejects.add(response);
    }
    return response;
  };

  const res = await sendWithAuthRetry<Response>({
    send,
    isUnauthorized: (r) => r.status === 401 && !presenceSessionRejects.has(r),
    getAccessToken: () => accessToken,
    refresh: () => refreshCoordinator.refresh(),
    onSessionRejected: async () => {
      await sessionBridge?.onSessionRejected();
    },
    allowRefresh: !NO_REFRESH_PATHS.includes(path),
  });
  let json: ApiResponse<T> = { success: false };
  try {
    json = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new PartnerApiError(res.statusText || "Request failed", {
      status: res.status,
      retryAfter: parseRetryAfter(res, {}),
    });
  }
  if (!res.ok || !json.success) {
    throw new PartnerApiError(json.error ?? res.statusText ?? "Request failed", {
      status: res.status,
      code: typeof json.code === "string" ? json.code : null,
      retryAfter: parseRetryAfter(res, json),
    });
  }
  return json.data as T;
}

export type PresenceFreshness = "FRESH" | "STALE" | "EXPIRED";

export type PresenceLocation = {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  capturedAt: string | null;
  receivedAt: string | null;
  transportLagSeconds: number | null;
  source: string | null;
  sequence: number | null;
};

export type PresenceSnapshot = {
  providerId: string;
  sessionId: string | null;
  deviceId: string | null;
  lastHeartbeatAt: string | null;
  lastSeenAt?: string | null;
  presenceFreshness: PresenceFreshness;
  locationFreshness: PresenceFreshness;
  presenceAgeSeconds: number | null;
  locationAgeSeconds: number | null;
  operationallyLive: boolean;
  location: PresenceLocation | null;
  appState?: string | null;
  platform?: string | null;
  appVersion?: string | null;
  heartbeatIntervalSeconds: number;
};

export type PresenceHeartbeatResult = {
  accepted: boolean;
  duplicate?: boolean;
  snapshot: PresenceSnapshot;
};

export type PresenceLocationFix = {
  latitude: number;
  longitude: number;
  accuracy?: number;
  capturedAt: string;
  sequence?: number;
};

export type PresenceHeartbeatBody = {
  sessionId: string;
  deviceId: string;
  timestamp: string;
  appState?: "foreground" | "background" | "inactive";
  platform?: "ios" | "android" | "web";
  appVersion?: string;
  availabilityTelemetry?: string;
  location?: PresenceLocationFix;
};

export type DispatchEligibilityChecks = {
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

export type DispatchEligibility = {
  providerId: string;
  eligible: boolean;
  blockedBy: string | null;
  reasons: string[];
  checks: DispatchEligibilityChecks;
  evaluatedAt: string;
};

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

  operations: () => request<PartnerOperations>("/api/providers/me/operations"),

  pause: (reason?: string) =>
    request<PartnerOperations>("/api/providers/me/pause", { method: "POST", body: { reason } }),

  resume: () => request<PartnerOperations>("/api/providers/me/resume", { method: "POST" }),

  /** Phase 1 presence — liveness evidence (server derives partner id from JWT). */
  presenceSnapshot: () => request<PresenceSnapshot>("/api/providers/me/presence"),

  presenceHeartbeat: (body: PresenceHeartbeatBody) =>
    request<PresenceHeartbeatResult>("/api/providers/me/presence/heartbeat", {
      method: "POST",
      body,
    }),

  locationPing: (body: { sessionId: string; deviceId: string; location: PresenceLocationFix }) =>
    request<PresenceHeartbeatResult>("/api/providers/me/location/ping", {
      method: "POST",
      body,
    }),

  /**
   * Live job tracking over HTTP (routes/tracking.ts). Used by the background location task, where
   * the `/ws/tracking` socket is not kept open. The server accepts it only for ACCEPTED / ASSIGNED /
   * EN_ROUTE / IN_PROGRESS bookings of this partner (400 INVALID_STATUS otherwise). There is no
   * timestamp field, so only a FRESH fix may be sent — never replay queued fixes through this.
   */
  trackingLocation: (body: {
    bookingId: string;
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
  }) => request<unknown>("/api/tracking/location", { method: "POST", body }),

  dispatchEligibility: () => request<DispatchEligibility>("/api/providers/me/dispatch-eligibility"),

  updateServiceArea: (body: {
    city?: string;
    serviceRegions?: string[];
    serviceRadiusKm?: number;
    baseLatitude?: number;
    baseLongitude?: number;
  }) => request<Record<string, unknown>>("/api/providers/me/service-area", { method: "PUT", body }),

  dashboard: () => request<PartnerDashboard>("/api/providers/me/dashboard"),

  earnings: (days = 30) => request<PartnerEarningsSummary>("/api/providers/me/earnings", { query: { days } }),

  listBookings: (query: { status?: string; page?: number; limit?: number; sortBy?: string } = {}) =>
    request<PartnerBookingsResponse>("/api/providers/me/bookings", { query }),

  getBooking: async (bookingId: string) => {
    const data = await request<{ booking: PartnerBooking }>(`/api/bookings/${bookingId}`);
    const b = data.booking;
    const addr = b.address;
    return {
      ...b,
      amount: b.amount ?? b.finalAmount,
      completedAt: b.completedAt ?? null,
      enRouteAt: b.enRouteAt ?? null,
      arrivedAt: b.arrivedAt ?? null,
      startedAt: b.startedAt ?? null,
      service: {
        id: b.service?.id ?? "",
        name: b.service?.name ?? "Service",
        icon: b.service?.icon ?? null,
        basePrice: b.service?.basePrice ?? null,
      },
      address: {
        fullAddress: addr?.fullAddress ?? "",
        latitude: addr?.latitude ?? null,
        longitude: addr?.longitude ?? null,
      },
    } satisfies PartnerBooking;
  },

  acceptBooking: (bookingId: string, eta?: number) =>
    request<{ newlyAccepted?: boolean; booking: { id: string; status: string } }>(
      `/api/bookings/${bookingId}/accept`,
      {
        method: "POST",
        body:
          typeof eta === "number" && Number.isFinite(eta) && eta >= 1
            ? { eta: Math.round(eta) }
            : {},
      },
    ),

  rejectBooking: (bookingId: string, reason: string) =>
    request<unknown>(`/api/bookings/${bookingId}/reject`, { method: "POST", body: { reason } }),

  /**
   * Partner AI assistant, via the backend AI Gateway (`/api/ai/partner`).
   *
   * The gateway owns auth, RBAC, prompt-injection screening, rate limiting, audit and
   * cost accounting. The app never holds a model-provider key and never calls a provider
   * directly — that is the single-entry rule this platform is built on.
   */
  aiChat: (message: string) =>
    request<{
      content: string;
      provider: string;
      model: string;
      fallbackUsed: boolean;
      mode?: "llm" | "deterministic_fallback";
      intent?: string;
      basis?: string[];
      recommendation?: string | null;
    }>(
      "/api/ai/partner",
      { method: "POST", body: { message } },
    ),

  /**
   * Declares departure — the authoritative producer of `enRouteAt`, which the ETA
   * training label's duration is measured from. Idempotent: a repeat call returns
   * `newlyTransitioned: false` and leaves the timestamp untouched.
   */
  markEnRoute: (bookingId: string, latitude: number | null, longitude: number | null) =>
    request<{ newlyTransitioned: boolean; booking: { status: string; enRouteAt: string | null } }>(
      `/api/bookings/${bookingId}/en-route`,
      {
        method: "POST",
        body: {
          ...(typeof latitude === "number" && Number.isFinite(latitude) ? { latitude } : {}),
          ...(typeof longitude === "number" && Number.isFinite(longitude) ? { longitude } : {}),
        },
      },
    ),

  /** Declares arrival. Races safely with the GPS geofence and the job-start fallback. */
  markArrived: (bookingId: string, latitude: number, longitude: number) =>
    request<{ newlyTransitioned: boolean; booking: { arrivedAt: string | null } }>(
      `/api/bookings/${bookingId}/arrived`,
      { method: "POST", body: { latitude, longitude } },
    ),

  startOtp: (bookingId: string) =>
    request<{
      alreadyVerified: boolean;
      channels: string[];
      sentTo: { email: string | null; phone: string | null };
      expiresInSec: number;
      resendInSec: number;
    }>(`/api/bookings/${bookingId}/start-otp`, { method: "POST" }),

  startBooking: (bookingId: string, latitude: number, longitude: number, otp?: string) =>
    request<{ booking: { status: string } }>(`/api/bookings/${bookingId}/start`, {
      method: "POST",
      body: { latitude, longitude, ...(otp ? { otp } : {}) },
    }),

  /**
   * W2-D1: `completedChecklist` is the partner's actual submission — only the items they ticked, as
   * the exact frozen strings — matched item by item server-side. Pass `undefined` (key omitted) when
   * the service has no checklist. The server answers `QUALITY_CHECKLIST_REQUIRED` (409) while any
   * frozen item is missing; the missing items are then readable from `getQuality(...).history`.
   *
   * `professionalConfirmation` is sent only as `true`, and only when the partner ticked the
   * confirmation row (`lib/professional-confirmation.ts`); where the frozen policy requires it and it
   * is absent the server answers `QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED` (409).
   */
  completeBooking: (
    bookingId: string,
    latitude: number | null,
    longitude: number | null,
    notes?: string,
    photos?: string[],
    completedChecklist?: string[],
    professionalConfirmation?: true,
  ) =>
    request<{ booking: { status: string } }>(`/api/bookings/${bookingId}/complete`, {
      method: "POST",
      body: {
        ...(typeof latitude === "number" && Number.isFinite(latitude) ? { latitude } : {}),
        ...(typeof longitude === "number" && Number.isFinite(longitude) ? { longitude } : {}),
        ...(notes ? { notes } : {}),
        ...(photos?.length ? { photos } : {}),
        ...(completedChecklist ? { completedChecklist } : {}),
        ...(professionalConfirmation === true ? { professionalConfirmation: true } : {}),
      },
    }),

  /* ---- Phase 10 §6 — requirement state ---- */
  getRequirements: (bookingId: string) => request<BookingRequirementsView>(`/api/bookings/${bookingId}/requirements`),
  /** What the partner FOUND on site; the server decides the gate. Proximity enforced like arrival. */
  checkRequirement: (bookingId: string, code: string, outcome: "SATISFIED" | "FAILED", latitude: number, longitude: number, note?: string) =>
    request<{ code: string; state: string; changed: boolean; gate: RequirementGateResult }>(
      `/api/bookings/${bookingId}/requirements/${encodeURIComponent(code)}/check`,
      { method: "POST", body: { outcome, latitude, longitude, ...(note ? { note } : {}) } },
    ),

  /* ---- Phase 10 §9 — safety ---- */
  getSafety: (bookingId: string) => request<BookingSafetyView>(`/api/bookings/${bookingId}/safety`),
  reportProhibitedCondition: (bookingId: string, condition: string, note?: string) =>
    request<{ holdId: number | null; changed: boolean }>(`/api/bookings/${bookingId}/safety/prohibited-condition`, { method: "POST", body: { condition, ...(note ? { note } : {}) } }),

  /* ---- Phase 10 §10/§11 — quality verdict, completion axis, cases ---- */
  /** The latest recorded quality verdict for this job (partner view: verdict + reason codes). */
  getQuality: (bookingId: string) =>
    request<{
      enforced: boolean;
      latest: { verdict: string; reasonCodes: string[]; at: string } | null;
      history: Array<{ sequence: number; verdict: string; reasonCodes: string[]; byAdmin: boolean; at: string; missingChecklistItems: string[] }>;
    }>(`/api/bookings/${bookingId}/quality`),
  /** The customer-confirmation axis: state, confirm-by, verdict summary and warranty window. */
  getCompletion: (bookingId: string) =>
    request<{
      enforced: boolean;
      bookingStatus: string;
      completedAt: string | null;
      completion: { state: string; confirmBy: string; resolvedAt: string | null; resolvedByType: string | null; caseId: string | null } | null;
      verdict: { verdict: string; reasonCodes: string[]; at: string } | null;
      warranty: { state: string; startsAt: string; expiresAt: string } | null;
    }>(`/api/bookings/${bookingId}/completion`),
  /** The customer's reported issues on this job (partnerView: description + outcome, read-only). */
  getCases: (bookingId: string) =>
    request<{ available: boolean; cases: PartnerCaseView[]; categories: string[] }>(`/api/bookings/${bookingId}/cases`),
  /**
   * An `Image` source for a case photo the server stores privately (`hasStoredMedia`). The media
   * route is authenticated, so the source carries the same bearer token `request` sends — and only
   * ever to this app's own API base. `null` when there is no token to send. An `Image` cannot use
   * the 401 → refresh → retry that `request` does: pass the store's current token so the source is
   * rebuilt after a refresh, and fall back to a text indicator when the image fails to load.
   */
  caseEvidenceImageSource: (bookingId: string, caseId: string, evidenceId: number, token: string | null = accessToken) =>
    token
      ? {
          uri: `${getApiBaseUrl()}/api/bookings/${encodeURIComponent(bookingId)}/cases/${encodeURIComponent(caseId)}/evidence/${evidenceId}/media`,
          headers: { Authorization: `Bearer ${token}` },
        }
      : null,

  /* ---- Phase 10 §8 — execution steps ---- */
  getExecution: (bookingId: string) => request<BookingExecutionView>(`/api/bookings/${bookingId}/execution`),
  executionAction: (bookingId: string, code: string, action: string, body?: Record<string, string>) =>
    request<{ state: string; changed: boolean }>(`/api/bookings/${bookingId}/execution/${encodeURIComponent(code)}/${action}`, { method: "POST", body: body ?? {} }),

  getJobActions: (bookingId: string) =>
    request<{
      stage: string;
      availableActions: string[];
      primaryAction: string | null;
      requiredGates: string[];
      disabledReasons: Record<string, string>;
      requirementGate?: { ok: boolean; blocking: number; message: string } | null;
      safetyGate?: { ok: boolean; blocking: number; message: string } | null;
      paymentExempt?: boolean;
    }>(`/api/bookings/${bookingId}/actions`),

  listEvidence: (bookingId: string) =>
    request<{
      evidence: Array<{
        id: string;
        stage: string;
        mediaUrl?: string | null;
        mediaAccessUrl?: string | null;
        capturedAt: string;
        isCurrent: boolean;
      }>;
    }>(`/api/bookings/${bookingId}/evidence`),

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
  ) => request<{ evidence: { id: string } }>(`/api/bookings/${bookingId}/evidence`, { method: "POST", body }),

  listChat: (bookingId: string, query: { cursor?: string; limit?: number } = {}) =>
    request<{
      conversationId: string;
      messages: Array<{
        id: string;
        senderUserId: string;
        body: string;
        createdAt: string;
      }>;
      nextCursor: string | null;
    }>(`/api/bookings/${bookingId}/chat`, { query }),

  sendChat: (bookingId: string, body: string, clientMessageId?: string) =>
    request<{ message: { id: string; body: string }; created: boolean }>(
      `/api/bookings/${bookingId}/chat`,
      { method: "POST", body: { body, ...(clientMessageId ? { clientMessageId } : {}) } },
    ),

  markChatRead: (bookingId: string) =>
    request<{ marked: number }>(`/api/bookings/${bookingId}/chat/read`, { method: "POST" }),

  getContact: (bookingId: string) =>
    request<{ phoneMasked: string | null; canCall: boolean }>(`/api/bookings/${bookingId}/contact`),

  initiateCall: (bookingId: string) =>
    request<{ dialUri: string; phoneMasked: string; expiresInSec: number }>(
      `/api/bookings/${bookingId}/call`,
      { method: "POST" },
    ),

  cancelBooking: (bookingId: string, reason: string) =>
    request<unknown>(`/api/bookings/${bookingId}/cancel`, {
      method: "POST",
      body: { reason, cancelledBy: "provider" },
    }),

  walletBalance: () => request<WalletBalance>("/api/wallet/balance"),

  walletTransactions: (query: { page?: number; limit?: number } = {}) =>
    request<WalletTransactionsResponse>("/api/wallet/transactions", { query }),

  withdraw: (payload: {
    amount: number;
    bankAccountNumber: string;
    ifscCode: string;
    accountHolder: string;
    idempotencyKey?: string;
  }) =>
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
    preferences: () =>
      request<{
        channels: Array<{
          channel: "IN_APP" | "PUSH" | "EMAIL" | "SMS";
          available: boolean;
          reason?: string;
        }>;
        matrix: Array<{
          category: "TRANSACTIONAL" | "SECURITY" | "OPTIONAL";
          channel: "IN_APP" | "PUSH" | "EMAIL" | "SMS";
          enabled: boolean;
          editable: boolean;
          mandatory: boolean;
          available: boolean;
          unavailableReason?: string;
        }>;
      }>("/api/notifications/preferences"),
    setPreference: (body: {
      channel: "IN_APP" | "PUSH" | "EMAIL" | "SMS";
      category: "TRANSACTIONAL" | "SECURITY" | "OPTIONAL";
      enabled: boolean;
    }) => request<unknown>("/api/notifications/preferences", { method: "PUT", body }),
  },

  /**
   * Device push-token lifecycle. Hits the SAME endpoints the customer app already uses —
   * the server derives userId from the auth token and never trusts a client-supplied id,
   * so a partner can only ever register/revoke a device against their own account.
   */
  devices: {
    registerPushToken: (body: {
      deviceId: string;
      expoPushToken: string;
      platform: "IOS" | "ANDROID" | "WEB";
      deviceName?: string;
      appVersion?: string;
      osVersion?: string;
    }) => request<{ device: { id: string; deviceId: string; platform: string } }>("/api/users/me/devices/push-token", {
      method: "PUT",
      body,
    }),
    revoke: (deviceId: string) =>
      request<unknown>(`/api/users/me/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" }),
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

  network: {
    dashboard: () =>
      request<{
        code: string;
        shareUrl: string;
        rewardPerQualified: number;
        jobTarget: number;
        counts: Record<string, number>;
        totalRewarded: number;
        referrals: Array<{
          id: string;
          name: string;
          status: string;
          jobs: number;
          jobTarget: number;
          qualificationLabel: string;
          nextMilestone: string;
          rewardAmount: number | null;
        }>;
      }>("/api/providers/me/network"),
    invite: (body: { name: string; phone: string }) =>
      request<{ inviteUrl: string; shareUrl: string }>("/api/providers/me/network/invite", { method: "POST", body }),
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
    surge: () => request<SurgeZone[]>("/api/geo-intel/surge"),
    density: () => request<DensityZone[]>("/api/geo-intel/provider-density"),
    zoneScoring: () => request<ZoneScoring>("/api/geo-intel/zone-scoring"),
    demandForecast: (horizon = 24) => request<DemandForecast>("/api/geo-intel/demand-forecast", { query: { horizon } }),
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
    score: () => request<PartnerScorecard>("/api/providers/me/score"),
    scoreHistory: () =>
      request<{ items: Array<{ previousScore: number | null; newScore: number | null; delta: number | null; reasons: Array<{ detail: string }>; calculatedAt: string }> }>(
        "/api/providers/me/score/history",
      ),
    career: () => request<PartnerCareer>("/api/providers/me/career"),
    lifecycle: () => request<PartnerLifecycle>("/api/providers/me/lifecycle"),
    academy: () => request<PartnerAcademy>("/api/providers/me/academy"),
    completeAcademyModule: (moduleId: string) =>
      request<unknown>(`/api/providers/me/academy/${moduleId}/complete`, { method: "POST" }),
    compliance: () => request<PartnerCompliance>("/api/providers/me/compliance"),
    wellbeing: () => request<PartnerWellbeing>("/api/providers/me/wellbeing"),
    updateEmergencyContact: (body: { emergencyContactName?: string; emergencyContactPhone?: string }) =>
      request<{ emergencyContactName: string | null; emergencyContactPhone: string | null }>(
        "/api/providers/me/safety/emergency-contact",
        { method: "PATCH", body },
      ),
    triggerSos: (body?: { bookingId?: string; latitude?: number; longitude?: number }) =>
      request<{ incidentId: string; status: string; created: boolean; hasLocation: boolean }>(
        "/api/providers/me/safety/sos",
        { method: "POST", body: body ?? {} },
      ),
    reportSafety: (body: { type: string; notes?: string }) =>
      request<{ incidentId: string; status: string }>("/api/providers/me/safety/report", { method: "POST", body }),
    safetyIncidents: () =>
      request<{ incidents: Array<{ id: string; type: string; status: string; createdAt: string }> }>(
        "/api/providers/me/safety/incidents",
      ),
    rewards: () => request<PartnerRewards>("/api/providers/me/rewards"),
    serviceHistory: () => request<PartnerServiceHistory>("/api/providers/me/service-history"),
    documents: () => request<{ documents: PartnerDocument[] }>("/api/providers/me/documents"),
  },

  /**
   * Phase 11 — capability self-service (`routes/provider-capabilities.ts`). A partner can only
   * DECLARE: the bodies carry fact fields, and status / verifier / source are set by the server. An
   * administrator verifies; a VERIFIED or REVOKED row answers 409 `CAPABILITY_LOCKED` to any change.
   * Before the capability tables are deployed every route answers 503 `NOT_DEPLOYED`.
   */
  capabilities: {
    /** Own profile (every row with `validity` / `nearExpiry`) plus the active `skillCatalogue`. */
    profile: () => request<PartnerCapabilityProfile>("/api/providers/me/capabilities"),
    /** Keyed by skill: declaring one again updates its level while it is still a claim. */
    declareSkill: (body: DeclareSkillBody) =>
      request<{ row: CapabilityWriteRow; changed: boolean }>("/api/providers/me/capabilities/skills", { method: "POST", body }),
    declareCertification: (body: DeclareCertificationBody) =>
      request<{ row: CapabilityWriteRow; changed: boolean }>("/api/providers/me/capabilities/certifications", { method: "POST", body }),
    /** Keyed by equipment type. On a VERIFIED row only `operational` may differ (same ownership, no note). */
    declareEquipment: (body: DeclareEquipmentBody) =>
      request<{ row: CapabilityWriteRow; changed: boolean }>("/api/providers/me/capabilities/equipment", { method: "POST", body }),
    declareInsurance: (body: DeclareInsuranceBody) =>
      request<{ row: CapabilityWriteRow; changed: boolean }>("/api/providers/me/capabilities/insurance", { method: "POST", body }),
    /** Keyed by language code (ISO 639-1, two letters). */
    declareLanguage: (body: DeclareLanguageBody) =>
      request<{ row: CapabilityWriteRow; changed: boolean }>("/api/providers/me/capabilities/languages", { method: "POST", body }),
    /** Edit the facts of an own certification / insurance claim; the row goes back to DECLARED. */
    edit: (kind: "certifications" | "insurance", rowId: number, body: EditCapabilityBody) =>
      request<{ row: CapabilityWriteRow }>(`/api/providers/me/capabilities/${kind}/${rowId}`, { method: "PATCH", body }),
    /** Withdraw an own claim — DECLARED rows only (a language only while its source is SELF). */
    remove: (kind: "skills" | "certifications" | "equipment" | "insurance" | "languages", rowId: number) =>
      request<{ deleted: true }>(`/api/providers/me/capabilities/${kind}/${rowId}`, { method: "DELETE" }),
  },

  /**
   * The professional's services by lane (performing / pending / suspended / revoked / available).
   * Every `performing` card carries `readiness` — whether matching would offer them that service's
   * jobs right now, and what is missing if not (`lib/service-readiness.ts`).
   */
  serviceSkills: () => request<PartnerServiceSkillBoard>("/api/providers/me/service-skills"),
  /** Ask to perform a catalogue service. Always REQUESTED; an administrator approves it. */
  requestServiceSkill: (serviceId: string, note?: string) =>
    request<{ row: CapabilityWriteRow; changed: boolean }>("/api/providers/me/capabilities/services", {
      method: "POST",
      body: { serviceId, ...(note ? { note } : {}) },
    }),
  /** Withdraw an own request that is still awaiting approval (409 CAPABILITY_LOCKED otherwise). */
  withdrawServiceSkill: (capabilityId: number) =>
    request<{ deleted: true }>(`/api/providers/me/capabilities/services/${capabilityId}`, { method: "DELETE" }),

  attendance: () => request<PartnerAttendance>("/api/providers/me/attendance"),
  checkIn: () => request<unknown>("/api/providers/me/attendance/check-in", { method: "POST" }),
  checkOut: () => request<unknown>("/api/providers/me/attendance/check-out", { method: "POST" }),
  incentives: () => request<PartnerIncentives>("/api/providers/me/incentives"),
};

export type { PartnerUser };
