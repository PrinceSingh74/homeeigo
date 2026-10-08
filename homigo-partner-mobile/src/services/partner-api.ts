/**
 * The partner app's API client.
 *
 * Every method here was checked against the backend route that answers it (method, path, body
 * schema, response builder) on 2026-10-07; the types live in `@/types/partner` and mirror the
 * backend. Conventions:
 *   - a method returns the envelope's `data`; where the screen needs the server's own sentence the
 *     result also carries `message` (the envelope's top-level `message`, null when none was sent);
 *   - every failure throws `PartnerApiError` (`@/lib/api-error`): `status`, `code`, the server's
 *     sentence as `message`, the refusal's `data` block, `retryAfter`. No HTTP answer at all is
 *     `status: 0`, `code: "NETWORK_ERROR"`;
 *   - nothing is synthesised: there is no derived ledger, no estimate, no fallback row.
 */
import { getApiBaseUrl } from "@/lib/api-config";
import { apiErrorFromResponse, networkError, PartnerApiError } from "@/lib/api-error";
import {
  classifyRefreshResponse,
  createRefreshCoordinator,
  sendWithAuthRetry,
  type RefreshOutcome,
} from "@/lib/auth-refresh";
import { evidenceImageSourceFor, type EvidenceImageSource } from "@/lib/evidence-photo";
import { recordServerDate } from "@/lib/server-clock";
import type {
  ApiEnvelope,
  AuthSessionsResponse,
  BookingExecutionView,
  BookingRequirementsView,
  BookingSafetyView,
  CapabilityWriteRow,
  CreatedSupportTicket,
  CreateSupportTicketBody,
  DeclareCertificationBody,
  DeclareEquipmentBody,
  DeclareInsuranceBody,
  DeclareLanguageBody,
  DeclareSkillBody,
  DemandForecast,
  DemandForecastResult,
  DensityZone,
  EditCapabilityBody,
  EmergencyContact,
  ExecutionStepAction,
  ExecutionStepActionBody,
  ExecutionStepActionResult,
  GeoEta,
  GeoIntel,
  JobActionResult,
  JobChatList,
  JobChatMessage,
  JobEvidenceItem,
  JobEvidenceStage,
  JobEvidenceUploadResult,
  NoShowReportResult,
  PartnerAcademy,
  PartnerAttendance,
  PartnerBooking,
  PartnerBookingsResponse,
  PartnerCancelResult,
  PartnerCapabilityProfile,
  PartnerCareer,
  PartnerCareerHistoryPage,
  PartnerCaseView,
  PartnerCompliance,
  PartnerDashboard,
  PartnerDocument,
  PartnerEarningsCoach,
  PartnerEarningsSummary,
  PartnerEntitlements,
  PartnerForecast,
  PartnerIncentives,
  PartnerIntelligence,
  PartnerInvoices,
  PartnerJobEarning,
  PartnerLifecycle,
  PartnerMembershipData,
  PartnerMembershipPlan,
  PartnerNetworkDashboard,
  PartnerNetworkInviteResult,
  PartnerNotificationsResponse,
  PartnerNudges,
  PartnerOperations,
  PartnerPayoutsData,
  PartnerRankings,
  PartnerReviewsResponse,
  PartnerRewards,
  PartnerSafetyIncident,
  PartnerScoreHistoryPage,
  PartnerScorecard,
  PartnerServiceHistory,
  PartnerServiceSkillBoard,
  PartnerShiftPlan,
  PartnerSupportTicket,
  PartnerSupportTicketDetail,
  PartnerTaxSummary,
  PartnerUser,
  PartnerUserProfile,
  PartnerWellbeing,
  PartnerWithdrawal,
  PartnerZoneRecommendations,
  ProviderProfile,
  RatingResponseResult,
  RequirementGateResult,
  RouteOptimizeResult,
  SafetyReportType,
  ServiceAreaResult,
  ServiceAreaZone,
  SetOnlineResult,
  SurgeZone,
  UploadDocumentBody,
  WithdrawRequest,
  WithdrawResult,
} from "@/types/partner";

export { PartnerApiError };

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

type RequestOpts = {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  /** Sent as the `Idempotency-Key` header. Only for routes that read it — see `newIdempotencyKey`. */
  idempotencyKey?: string;
};

/** Sends the request (with the single 401 → refresh → retry). Throws only for "no HTTP answer". */
async function sendRequest(path: string, opts: RequestOpts): Promise<Response> {
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
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(target, {
        method: opts.method ?? "GET",
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch (cause) {
      // Offline, DNS, TLS, timeout: the server said nothing. Distinguishable from any refusal.
      throw networkError(cause);
    }
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

  return sendWithAuthRetry<Response>({
    send,
    isUnauthorized: (r) => r.status === 401 && !presenceSessionRejects.has(r),
    getAccessToken: () => accessToken,
    refresh: () => refreshCoordinator.refresh(),
    onSessionRejected: async () => {
      await sessionBridge?.onSessionRejected();
    },
    allowRefresh: !NO_REFRESH_PATHS.includes(path),
  });
}

/** The whole parsed success body. Throws `PartnerApiError` on a refusal or an unreadable body. */
async function requestBody(path: string, opts: RequestOpts = {}): Promise<Record<string, unknown>> {
  const res = await sendRequest(path, opts);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  const ok = res.ok && typeof json === "object" && json !== null && (json as { success?: unknown }).success === true;
  if (!ok) throw apiErrorFromResponse(res.status, res.statusText, json, res.headers.get("Retry-After"));
  return json as Record<string, unknown>;
}

/**
 * `data` plus the server's success sentence. Use where the screen should show what the server said
 * ("Arrival already recorded", "No-show recorded", "Recorded as missing — the customer has been told").
 */
export async function requestEnvelope<T>(path: string, opts: RequestOpts = {}): Promise<ApiEnvelope<T>> {
  const json = await requestBody(path, opts);
  return { data: json.data as T, message: typeof json.message === "string" && json.message ? json.message : null };
}

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  return (await requestEnvelope<T>(path, opts)).data;
}

/** A route that answers with a document instead of the JSON envelope (the earning invoice). */
async function requestText(path: string): Promise<string> {
  const res = await sendRequest(path, {});
  if (!res.ok) {
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    throw apiErrorFromResponse(res.status, res.statusText, json, res.headers.get("Retry-After"));
  }
  return res.text();
}

const withMessage = <T extends object>(e: ApiEnvelope<T>): T & { message: string | null } => ({ ...e.data, message: e.message });

/** A coordinate to send: the finite number, else null (the server then decides without a position). */
const coord = (v: number | null | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** `null` for the server's 404 with this code; every other failure is rethrown. */
async function nullOn404<T>(promise: Promise<T>, code: string): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof PartnerApiError && err.status === 404 && err.code === code) return null;
    throw err;
  }
}

/**
 * A fresh `Idempotency-Key`. Two booking routes read the header themselves — execution step actions
 * and requirement checks — and stamp it into the audit trail (replay safety there comes from the
 * step / requirement state: a repeat answers `changed: false`). Generate one per user action and
 * pass the SAME key when retrying that action.
 */
export function newIdempotencyKey(scope: string): string {
  return `m-${scope}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  /** The OS's word that the fix is mocked (Android). Sent only when the OS said so; never defaulted. */
  mocked?: boolean;
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

/**
 * `GET /api/providers/me/dispatch-eligibility`. `reasons` / `blockedBy` codes: NOT_FOUND, NOT_ACTIVE,
 * NOT_AVAILABLE, STALE_PRESENCE, STALE_LOCATION, LOCATION_INVALID, NO_CAPACITY, SCHEDULE_BLOCKED,
 * OUTSIDE_SERVICE_AREA, SKILL_MISMATCH, RISK_BLOCKED, PAYMENT_NOT_READY, CONFLICT,
 * ACCOUNT_RESTRICTED, APPROVAL_PENDING.
 */
export type DispatchEligibility = {
  providerId: string;
  eligible: boolean;
  blockedBy: string | null;
  reasons: string[];
  checks: DispatchEligibilityChecks;
  evaluatedAt: string;
};

/** `POST /api/auth/login` → `data.user`. No `role`, no `isEmailVerified` here — read `partnerApi.me()`. */
export type LoginUser = {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  profileImage: string | null;
  /** The CUSTOMER wallet of this login — not partner money. */
  walletBalance: number;
  isPhoneVerified: boolean;
};

/** `POST /api/auth/login` → `data`. Refusals: 401 INVALID_CREDENTIALS; 403 ACCOUNT_BANNED / FORBIDDEN / PARTNER_NOT_APPROVED (its `message` is the reason). */
export type LoginPayload = {
  userId: string;
  accessToken: string;
  refreshToken: string;
  sessionId?: string | null;
  /** Seconds. */
  expiresIn: number;
  user: LoginUser;
};

/** `POST /api/bookings/:id/arrived` result. A blocked requirement gate does NOT refuse arrival: it rides here with `ok: false`. */
export type ArrivedResult = {
  newlyTransitioned: boolean;
  booking: { arrivedAt: string | null };
  /** The ARRIVAL requirement gate; null when the gate tables are not deployed. */
  requirementGate: RequirementGateResult | null;
  /** "Arrival recorded" | "Arrival already recorded". */
  message: string | null;
};

export type StartOtpResult = {
  alreadyVerified: boolean;
  /** "app" | "email" | "sms" */
  channels: string[];
  /** Always nulls: the partner is never told the customer's address or number. */
  sentTo: { email: string | null; phone: string | null };
  expiresInSec: number;
  resendInSec: number;
};

/** `GET /api/bookings/:id/contact`. Calling is not available: `canCall` is false and there is no number to dial. */
export type BookingContact = {
  phoneMasked: string | null;
  canCall: boolean;
  callUnavailableReason?: "CALL_RELAY_UNAVAILABLE";
  alternative?: "CHAT";
};

export type NotificationChannelName = "IN_APP" | "PUSH" | "EMAIL" | "SMS";
export type NotificationCategoryName = "TRANSACTIONAL" | "SECURITY" | "OPTIONAL";

export const partnerApi = {
  /* ------------------------------------------------------------------ */
  /* Session and account                                                  */
  /* ------------------------------------------------------------------ */

  /** POST /api/auth/login */
  login: async (email: string, password: string) => {
    const { getDeviceId, getDeviceName } = await import("@/lib/device");
    const deviceId = await getDeviceId();
    return request<LoginPayload>("/api/auth/login", {
      method: "POST",
      body: { email, password, deviceId, deviceName: getDeviceName(), setAuthCookies: false },
    });
  },

  /** POST /api/auth/logout */
  logout: (refreshToken: string) =>
    request<unknown>("/api/auth/logout", { method: "POST", body: { refreshToken, clearAuthCookies: false } }),

  /** GET /api/user/me — the only read that carries `role`. `email` may be null (raw column); see `userProfile`. */
  me: () => request<{ user: PartnerUser }>("/api/user/me"),

  /** GET /api/users/me — decrypted email / phone, `isEmailVerified`, preference flags. */
  userProfile: () => request<{ user: PartnerUserProfile }>("/api/users/me").then((r) => r.user),

  /** PUT /api/users/me — `bio` max 500; `profileImage` must be a URL. */
  updateProfile: (body: { firstName?: string; lastName?: string; bio?: string; profileImage?: string }) =>
    request<{ user: PartnerUserProfile }>("/api/users/me", { method: "PUT", body }).then((r) => r.user),

  /** PUT /api/users/preferences */
  updatePreferences: (body: {
    darkMode?: boolean;
    notificationsEnabled?: boolean;
    emailNotifications?: boolean;
    pushNotifications?: boolean;
    smsNotifications?: boolean;
    /** Max 10 characters. */
    preferredLanguage?: string;
  }) => request<{ optedOutChannels: unknown; resetChannels: unknown }>("/api/users/preferences", { method: "PUT", body }),

  security: {
    /**
     * POST /api/auth/change-password. `newPassword`: 8–128 characters with upper, lower, digit and
     * special, different from the last 5. SUCCESS REVOKES EVERY SESSION, THIS ONE INCLUDED — sign
     * the partner out and ask them to log in again. Refusals: 401 INVALID_CREDENTIALS (wrong
     * current password); 400 INVALID_INPUT (weak or reused; `details` lists why).
     */
    changePassword: (body: { currentPassword: string; newPassword: string }) =>
      request<undefined>("/api/auth/change-password", { method: "POST", body }).then(() => undefined),

    /**
     * POST /api/auth/forgot-password (public). Always succeeds, whether or not the account exists;
     * the email carries a LINK token (not an OTP), valid `expiresIn` seconds. 429
     * RATE_LIMIT_EXCEEDED carries `retryAfter`.
     */
    forgotPassword: (email: string) =>
      requestEnvelope<{ expiresIn: number }>("/api/auth/forgot-password", { method: "POST", body: { email } }).then(withMessage),

    /** POST /api/auth/reset-password (public) with the token from the emailed link. Revokes all sessions. 400 INVALID_INPUT on a bad / expired token or a weak password. */
    resetPassword: (body: { token: string; newPassword: string }) =>
      request<undefined>("/api/auth/reset-password", { method: "POST", body }).then(() => undefined),

    /**
     * POST /api/auth/send-verification-email. The email carries a link token valid until
     * `expiresAt`. Refusals: 400 EMAIL_ALREADY_VERIFIED; 429 RATE_LIMIT_EXCEEDED (`retryAfter`).
     * A verified email is required to withdraw (403 EMAIL_NOT_VERIFIED on `withdraw`).
     */
    sendVerificationEmail: () =>
      request<{ message: string; email: string | null; sentAt: string; expiresAt: string }>("/api/auth/send-verification-email", { method: "POST" }),

    /** POST /api/auth/verify-email (public) with the token from the emailed link (min 10 chars) — not an OTP. 400 INVALID_VERIFICATION_TOKEN / EMAIL_ALREADY_VERIFIED. */
    verifyEmail: (token: string) =>
      request<{ emailVerified: true; emailVerifiedAt: string; email: string | null }>("/api/auth/verify-email", { method: "POST", body: { token } }),

    /** GET /api/auth/sessions?deviceId= — `isCurrent` marks this device's session. */
    sessions: async () => {
      const { getDeviceId } = await import("@/lib/device");
      return request<AuthSessionsResponse>("/api/auth/sessions", { query: { deviceId: await getDeviceId() } });
    },

    /** DELETE /api/auth/sessions/:id. 403 CANNOT_DELETE_CURRENT for this device's own session (use logout). An unknown id still succeeds. */
    revokeSession: async (sessionId: string) => {
      const { getDeviceId } = await import("@/lib/device");
      await request<undefined>(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE", query: { deviceId: await getDeviceId() } });
    },

    /**
     * DELETE /api/auth/sessions/others?deviceId= — signs out every OTHER device. The device id is
     * always sent: without one the server cannot tell which session is this one and revokes all.
     */
    revokeOtherSessions: async () => {
      const { getDeviceId } = await import("@/lib/device");
      return request<{ revoked: number }>("/api/auth/sessions/others", { method: "DELETE", query: { deviceId: await getDeviceId() } });
    },
  },

  /* ------------------------------------------------------------------ */
  /* Provider profile, availability, presence                             */
  /* ------------------------------------------------------------------ */

  /** GET /api/providers/me */
  provider: () => request<{ provider: ProviderProfile }>("/api/providers/me").then((r) => r.provider),

  /** PUT /api/providers/me/online. `message` is "You are online" / "You are offline". 403 ACCOUNT_RESTRICTED; 409 with a readiness blocker's code. */
  setOnline: (online: boolean) =>
    requestEnvelope<SetOnlineResult>("/api/providers/me/online", { method: "PUT", body: { online } }).then(withMessage),

  /** GET /api/providers/me/operations */
  operations: () => request<PartnerOperations>("/api/providers/me/operations"),

  /** POST /api/providers/me/pause */
  pause: (reason?: "break" | "personal" | "travel" | "other") =>
    request<PartnerOperations>("/api/providers/me/pause", { method: "POST", body: reason ? { reason } : {} }),

  /** POST /api/providers/me/resume. `operations` is the fresh snapshot; `message` is the server's sentence ("You are available for jobs again"). */
  resume: () =>
    requestEnvelope<PartnerOperations>("/api/providers/me/resume", { method: "POST" }).then((e) => ({ operations: e.data, message: e.message })),

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
    /** The OS's word that the fix is mocked (Android); absent when it said nothing. */
    mocked?: boolean;
    altitude?: number;
    speed?: number;
  }) => request<unknown>("/api/tracking/location", { method: "POST", body }),

  /** GET /api/providers/me/dispatch-eligibility — would the dispatcher offer this partner a job right now, and if not, why. */
  dispatchEligibility: () => request<DispatchEligibility>("/api/providers/me/dispatch-eligibility"),

  /**
   * PUT /api/providers/me/service-area. `city` 1–80; `serviceRegions` ≤ 20 entries; `serviceRadiusKm`
   * 1–50; latitude and longitude must be sent together. Refusals: 400 INVALID_RADIUS /
   * VALIDATION_ERROR / OUTSIDE_SERVICE_AREA.
   */
  updateServiceArea: (body: {
    city?: string;
    serviceRegions?: string[];
    serviceRadiusKm?: number;
    baseLatitude?: number;
    baseLongitude?: number;
  }) => request<ServiceAreaResult>("/api/providers/me/service-area", { method: "PUT", body }),

  /**
   * GET /api/providers/me/service-area/zones — up to 16 service zones near a point. Without
   * coordinates the server uses the partner's saved base; 400 VALIDATION_ERROR when there is
   * neither, 400 OUTSIDE_SERVICE_AREA outside the served country.
   */
  serviceAreaZones: (lat?: number | null, lng?: number | null) =>
    request<{ zones: ServiceAreaZone[] }>("/api/providers/me/service-area/zones", {
      query: typeof lat === "number" && typeof lng === "number" ? { lat, lng } : {},
    }).then((r) => r.zones),

  /** PUT /api/providers/me/settings — `bio` max 2000. */
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
    request<{
      settings: {
        id: string;
        workingHoursStart: string | null;
        workingHoursEnd: string | null;
        workingDays: string[];
        breakWindows: unknown;
        maxJobsPerDay: number | null;
        maxConcurrentJobs: number;
        paymentMethodPreference: string;
        upiId: string | null;
        bio: string | null;
      };
    }>("/api/providers/me/settings", { method: "PUT", body }).then((r) => r.settings),

  /* ------------------------------------------------------------------ */
  /* Dashboard, earnings, reviews                                         */
  /* ------------------------------------------------------------------ */

  /** GET /api/providers/me/dashboard */
  dashboard: () => request<PartnerDashboard>("/api/providers/me/dashboard"),

  /** GET /api/providers/me/earnings?days= (1..365) */
  earnings: (days = 30) => request<PartnerEarningsSummary>("/api/providers/me/earnings", { query: { days } }),

  /** GET /api/providers/me/reviews — `rating` filters to exactly that many stars. */
  reviews: (query: { page?: number; limit?: number; rating?: number } = {}) =>
    request<PartnerReviewsResponse>("/api/providers/me/reviews", { query }),

  /** POST /api/ratings/:id/respond — `response` 3–1000 characters; a second reply overwrites the first. 404 NOT_FOUND if the rating is not this partner's. */
  respondToRating: (ratingId: string, response: string) =>
    request<{ rating: RatingResponseResult }>(`/api/ratings/${encodeURIComponent(ratingId)}/respond`, {
      method: "POST",
      body: { response },
    }).then((r) => r.rating),

  /* ------------------------------------------------------------------ */
  /* Bookings                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * GET /api/providers/me/bookings. `status`: pending (live offers only) | accepted | in_progress |
   * completed | cancelled | active | all — or a raw lowercase status (customer_no_show, expired, …).
   * See `BOOKING_LIST_FILTER`. `sortBy`: "upcoming" (scheduledDate asc) | "recent" (createdAt desc).
   */
  listBookings: (query: { status?: string; page?: number; limit?: number; sortBy?: "upcoming" | "recent" } = {}) =>
    request<PartnerBookingsResponse>("/api/providers/me/bookings", { query }),

  /**
   * GET /api/bookings/:id — the booking exactly as the server sends it (nothing stripped, nothing
   * filled in). 404 NOT_FOUND when the job is not this partner's (any more): a reassigned partner
   * gets 404, not 403. The fresh answer is authoritative — see `lib/job-stage.ts`.
   */
  getBooking: (bookingId: string) =>
    request<{ booking: PartnerBooking }>(`/api/bookings/${encodeURIComponent(bookingId)}`).then((r) => r.booking),

  /**
   * POST /api/bookings/:id/accept. `eta` is whole minutes 1–480, omitted otherwise. `message`:
   * "Booking accepted" | "Booking already accepted". Refusals (400): PROVIDER_UNAVAILABLE,
   * ALREADY_CLAIMED, INVALID_STATUS, PAYMENT_NOT_SETTLED, CAPACITY_LIMIT, ACCOUNT_RESTRICTED,
   * STALE_LOCATION, STALE_PRESENCE, or a matching rejection code; 404 NOT_FOUND.
   */
  acceptBooking: (bookingId: string, eta?: number) =>
    requestEnvelope<{ newlyAccepted: boolean; booking: { id: string; status: "accepted"; provider: { name?: string } } }>(
      `/api/bookings/${bookingId}/accept`,
      {
        method: "POST",
        body: typeof eta === "number" && Number.isFinite(eta) && Math.round(eta) >= 1 && Math.round(eta) <= 480 ? { eta: Math.round(eta) } : {},
      },
    ).then(withMessage),

  /** POST /api/bookings/:id/reject — `reason` 3–500 characters. Returns the server's sentence. */
  rejectBooking: (bookingId: string, reason: string) =>
    requestEnvelope<undefined>(`/api/bookings/${bookingId}/reject`, { method: "POST", body: { reason } }).then((e) => ({ message: e.message })),

  /**
   * POST /api/bookings/:id/cancel as the partner. Body is `{ reason }` only (3–500 characters) — the
   * server works out who is cancelling. A partner may cancel up to and including IN_PROGRESS.
   * Refusals: 404 NOT_FOUND; 400 INVALID_STATUS.
   */
  cancelBooking: (bookingId: string, reason: string) =>
    requestEnvelope<PartnerCancelResult>(`/api/bookings/${bookingId}/cancel`, { method: "POST", body: { reason } }).then(withMessage),

  /**
   * POST /api/bookings/:id/en-route. Declares departure — the authoritative producer of `enRouteAt`.
   * Idempotent: a repeat returns `newlyTransitioned: false`. Coordinates are optional.
   */
  markEnRoute: (bookingId: string, latitude: number | null, longitude: number | null) =>
    requestEnvelope<{ newlyTransitioned: boolean; booking: { status: "en_route"; enRouteAt: string | null } }>(
      `/api/bookings/${bookingId}/en-route`,
      {
        method: "POST",
        body: {
          ...(coord(latitude) !== null ? { latitude: coord(latitude) } : {}),
          ...(coord(longitude) !== null ? { longitude: coord(longitude) } : {}),
        },
      },
    ).then(withMessage),

  /**
   * POST /api/bookings/:id/arrived. Always sends `{ latitude, longitude }`; `null` means the device
   * has no position — the server then refuses unless the customer or an admin has vouched for this
   * partner on this booking. Refusals: 400 INVALID_STATUS / OUTSIDE_SERVICE_AREA / LOCATION_INVALID /
   * LOCATION_REQUIRED; 409 LOCATION_UNCONFIRMED / LOCATION_MISMATCH; 404 NOT_FOUND (no `data`).
   */
  markArrived: (bookingId: string, latitude: number | null, longitude: number | null, mocked?: boolean | null): Promise<ArrivedResult> =>
    requestEnvelope<Omit<ArrivedResult, "message">>(`/api/bookings/${bookingId}/arrived`, {
      method: "POST",
      // `mocked` is the OS's word on the fix sent (Android), only when it said something; the server-held fix decides.
      body: { latitude: coord(latitude), longitude: coord(longitude), ...(typeof mocked === "boolean" ? { mocked } : {}) },
    }).then(withMessage),

  /**
   * POST /api/bookings/:id/start-otp — sends the start PIN to the CUSTOMER. Refusals: 429
   * RESEND_COOLDOWN / RATE_LIMITED with `error.data.retryAfterSec`; 400 INVALID_STATUS; 404.
   */
  startOtp: (bookingId: string) => requestEnvelope<StartOtpResult>(`/api/bookings/${bookingId}/start-otp`, { method: "POST" }).then(withMessage),

  /**
   * POST /api/bookings/:id/start. Always sends `{ latitude, longitude }` (null when absent) and the
   * 6-digit `otp` when given. Refusals, in the server's order:
   *   409 SAFETY_HOLD_ACTIVE            data.blocking: SafetyBlocking[]
   *   400 OTP_REQUIRED | OTP_NOT_REQUESTED | OTP_EXPIRED | OTP_LOCKED | OTP_INVALID
   *                                     data.attemptsLeft (a number only on OTP_INVALID)
   *   400 OUTSIDE_SERVICE_AREA | LOCATION_INVALID | LOCATION_REQUIRED
   *   409 LOCATION_UNCONFIRMED | LOCATION_MISMATCH
   *   403 PAYMENT_NOT_SETTLED
   *   409 REQUIREMENT_GATE_BLOCKED      data.blocking: BlockingRequirement[]
   *   403 FORBIDDEN                     (catch-all, including a wrong status)
   */
  startBooking: (bookingId: string, latitude: number | null, longitude: number | null, otp?: string, mocked?: boolean | null) =>
    requestEnvelope<{ booking: { status: "in_progress"; startedAt: string | null } }>(`/api/bookings/${bookingId}/start`, {
      method: "POST",
      body: { latitude: coord(latitude), longitude: coord(longitude), ...(otp ? { otp } : {}), ...(typeof mocked === "boolean" ? { mocked } : {}) },
    }).then(withMessage),

  /**
   * POST /api/bookings/:id/complete.
   *
   * `completedChecklist` is the partner's actual submission — only the items they ticked, as the
   * exact frozen strings — matched item by item server-side; pass `undefined` (key omitted) when the
   * service has no checklist. `professionalConfirmation` is sent only as `true`, and only when the
   * partner ticked the confirmation row. `photos` are data-URL images under the evidence rules
   * (`lib/evidence-photo.ts`: at most 4, 8 MB each).
   *
   * Refusals (409 unless noted), each with `error.data`:
   *   QUALITY_PROOF_REQUIRED | QUALITY_CHECKLIST_REQUIRED | QUALITY_PROFESSIONAL_CONFIRMATION_REQUIRED
   *                              { verdictId, verdict }
   *   SAFETY_HOLD_ACTIVE         { blocking: SafetyBlocking[], … }
   *   EXECUTION_GATE_BLOCKED     { blocking: [{ code, stepNumber, state, reason }], … }
   *   QUALITY_VERDICT_BLOCKED    { verdict, reasonCodes, blocking }
   *   400 INVALID_STATUS; the evidence refusals (EVIDENCE_REFUSALS); 403 FORBIDDEN; 500 COMPLETE_FAILED.
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
    requestEnvelope<{ booking: { status: "completed"; completedAt: string | null; totalDuration: number } }>(`/api/bookings/${bookingId}/complete`, {
      method: "POST",
      body: {
        ...(coord(latitude) !== null ? { latitude: coord(latitude) } : {}),
        ...(coord(longitude) !== null ? { longitude: coord(longitude) } : {}),
        ...(notes ? { notes } : {}),
        ...(photos?.length ? { photos } : {}),
        ...(completedChecklist ? { completedChecklist } : {}),
        ...(professionalConfirmation === true ? { professionalConfirmation: true } : {}),
      },
    }).then(withMessage),

  /** GET /api/bookings/:id/actions — the authority for the job's CTAs, gates and no-show preview. 404 for a partner who is only offered the job. */
  getJobActions: (bookingId: string) => request<JobActionResult>(`/api/bookings/${bookingId}/actions`),

  /**
   * POST /api/bookings/:id/no-show — "the customer is not available". The server decides whether a
   * fee applies; `message` and `feeNote` are its words. Refusals carry
   * `error.data: { waitedMinutes, graceMinutes }`: 400 GRACE_NOT_ELAPSED / BEFORE_APPOINTMENT /
   * NO_ARRIVAL_EVIDENCE / ARRIVAL_IN_FUTURE / BOOKING_NOT_AWAITING_CUSTOMER / INVALID_STATUS;
   * 403 FORBIDDEN; 404 NOT_FOUND.
   */
  reportCustomerNoShow: (bookingId: string): Promise<NoShowReportResult> =>
    requestEnvelope<Omit<NoShowReportResult, "message">>(`/api/bookings/${bookingId}/no-show`, { method: "POST", body: {} }).then(
      (e) => ({ ...e.data, message: e.message ?? "" }),
    ),

  /**
   * GET /api/providers/me/bookings/:bookingId/earning — what THIS job paid the partner, itemised by
   * the server. `null` is the server's 404 `EARNING_NOT_FOUND`: not completed yet, or nothing was
   * earned. Nothing is estimated in its place.
   */
  getBookingEarning: (bookingId: string): Promise<PartnerJobEarning | null> =>
    nullOn404(
      request<{ earning: PartnerJobEarning }>(`/api/providers/me/bookings/${encodeURIComponent(bookingId)}/earning`).then((r) => r.earning),
      "EARNING_NOT_FOUND",
    ),

  /* ---- Phase 10 §6 — requirement state ---- */
  getRequirements: (bookingId: string) => request<BookingRequirementsView>(`/api/bookings/${bookingId}/requirements`),

  /**
   * POST /api/bookings/:id/requirements/:code/check — what the partner FOUND on site; the server
   * decides the gate. Always sends `{ latitude, longitude }` (null when absent); proximity is
   * enforced like arrival. Sends an `Idempotency-Key` (the route reads it) — pass the same key when
   * retrying one action. `message`: "Check recorded" | "Recorded as missing — the customer has been
   * told". Refusals: 404 NOT_FOUND / REQUIREMENT_NOT_FOUND; 409 INVALID_STATUS /
   * REQUIREMENT_STATE_CONFLICT / LOCATION_UNCONFIRMED / LOCATION_MISMATCH; 403
   * REQUIREMENT_TRANSITION_FORBIDDEN; 400 REQUIREMENT_NOT_GATED / OUTSIDE_SERVICE_AREA /
   * LOCATION_INVALID / LOCATION_REQUIRED; 503 REQUIREMENT_GATE_UNAVAILABLE.
   */
  checkRequirement: (
    bookingId: string,
    code: string,
    outcome: "SATISFIED" | "FAILED",
    latitude: number | null,
    longitude: number | null,
    /** Max 500 characters. */
    note?: string,
    idempotencyKey: string = newIdempotencyKey(`req-${code}`),
    mocked?: boolean | null,
  ) =>
    requestEnvelope<{ code: string; state: "UNRESOLVED" | "SATISFIED" | "FAILED"; changed: boolean; gate: RequirementGateResult }>(
      `/api/bookings/${bookingId}/requirements/${encodeURIComponent(code)}/check`,
      { method: "POST", body: { outcome, latitude: coord(latitude), longitude: coord(longitude), ...(note ? { note } : {}), ...(typeof mocked === "boolean" ? { mocked } : {}) }, idempotencyKey },
    ).then(withMessage),

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
  /** The customer-confirmation axis: state, confirm-by, verdict summary and warranty window. `bookingStatus` is the UPPERCASE enum here. */
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

  /**
   * POST /api/bookings/:id/execution/:code/:action. Sends an `Idempotency-Key` (the route reads it);
   * pass the same key when retrying one action — a repeat by the same partner answers
   * `changed: false`. See `ExecutionStepActionBody` for what each action needs. Refusals: 404
   * NOT_FOUND / STEP_NOT_FOUND; 409 BOOKING_NOT_IN_PROGRESS / DEPENDENCY_INCOMPLETE /
   * SAFETY_REQUIREMENT_UNMET / STEP_STATE_CONFLICT / STEP_NOT_STARTABLE / STEP_NOT_IN_PROGRESS /
   * SAFETY_HOLD_ACTIVE (`data.blocking`); 400 EVIDENCE_REQUIRED (`data.detail`:
   * ["NOTE"|"PHOTO"|"BEFORE"|"AFTER"]) / REASON_REQUIRED; 403 STEP_NOT_SKIPPABLE /
   * STEP_TRANSITION_FORBIDDEN; 503 EXECUTION_UNAVAILABLE.
   */
  executionAction: (
    bookingId: string,
    code: string,
    action: ExecutionStepAction | Lowercase<ExecutionStepAction>,
    body?: ExecutionStepActionBody,
    idempotencyKey: string = newIdempotencyKey(`step-${code}-${action}`),
  ) =>
    request<ExecutionStepActionResult>(`/api/bookings/${bookingId}/execution/${encodeURIComponent(code)}/${action}`, {
      method: "POST",
      body: body ?? {},
      idempotencyKey,
    }),

  /* ---- Evidence ---- */

  /** GET /api/bookings/:id/evidence — this partner's own rows (stage asc, newest first within a stage); `[]` for an offer. */
  listEvidence: (bookingId: string) => request<{ evidence: JobEvidenceItem[] }>(`/api/bookings/${bookingId}/evidence`).then((r) => r.evidence),

  /**
   * POST /api/bookings/:id/evidence. `mediaUrl` and each `photos[]` entry is a
   * `data:image/…;base64,…` built by `checkEvidencePhoto` (`lib/evidence-photo.ts`) — a link is
   * refused. The server is idempotent on (booking, stage, clientUploadId): reuse the id when
   * retrying the same pick (`evidenceUploadId`). `replace: true` retires the stage's current photos.
   * The position on the row is the server's own; the app sends none. Refusals: `EVIDENCE_REFUSALS`.
   */
  uploadEvidence: (
    bookingId: string,
    body: {
      stage: JobEvidenceStage;
      clientUploadId: string;
      mediaUrl?: string;
      photos?: string[];
      replace?: boolean;
    },
  ) => request<{ evidence: JobEvidenceUploadResult }>(`/api/bookings/${bookingId}/evidence`, { method: "POST", body }).then((r) => r.evidence),

  /**
   * The `Image` source for an evidence row: its `mediaAccessUrl` on this app's API base, with the
   * bearer header (the media route answers only the signed-in partner). `null` when the row has no
   * stored photo or there is no token. Like `caseEvidenceImageSource`, pass the store's current
   * token so the source is rebuilt after a refresh.
   */
  evidenceImageSource: (evidence: Pick<JobEvidenceItem, "mediaAccessUrl">, token: string | null = accessToken): EvidenceImageSource | null =>
    evidenceImageSourceFor(evidence.mediaAccessUrl, getApiBaseUrl(), token),

  /* ---- Chat and contact ---- */

  /** GET /api/bookings/:id/chat — oldest first; `limit` 1–100 (default 50). 403 CHAT_CLOSED once the job is not active. */
  listChat: (bookingId: string, query: { cursor?: string; limit?: number } = {}) =>
    request<JobChatList>(`/api/bookings/${bookingId}/chat`, { query }),

  /** POST /api/bookings/:id/chat. Refusals: 403 CHAT_CLOSED / FORBIDDEN; 429 RATE_LIMITED; 400 VALIDATION_ERROR. */
  sendChat: (bookingId: string, body: string, clientMessageId?: string) =>
    request<{ message: JobChatMessage; created: boolean }>(
      `/api/bookings/${bookingId}/chat`,
      { method: "POST", body: { body, ...(clientMessageId ? { clientMessageId } : {}) } },
    ),

  markChatRead: (bookingId: string) =>
    request<{ marked: number }>(`/api/bookings/${bookingId}/chat/read`, { method: "POST" }),

  /** GET /api/bookings/:id/contact — the masked number only. There is no call route a partner can use: message the customer in chat. */
  getContact: (bookingId: string) => request<BookingContact>(`/api/bookings/${bookingId}/contact`),

  /* ------------------------------------------------------------------ */
  /* Money — real endpoints only. A partner has no ledger endpoint.       */
  /* ------------------------------------------------------------------ */

  /** GET /api/providers/me/payouts — balances, withdrawals (display labels) and earnings-by-period aggregates. */
  getPayouts: () => request<PartnerPayoutsData>("/api/providers/me/payouts"),

  /** GET /api/providers/me/withdrawals — the latest 20 withdrawals with raw statuses, failure reasons and payout attempts. */
  getWithdrawals: () => request<{ withdrawals: PartnerWithdrawal[] }>("/api/providers/me/withdrawals").then((r) => r.withdrawals),

  /** GET /api/providers/me/invoices — up to 100 earnings (one per paid job) and 50 settlements. */
  getInvoices: () => request<PartnerInvoices>("/api/providers/me/invoices"),

  /**
   * GET /api/providers/me/earnings/:id/invoice — `:id` is the EARNING id (`PartnerEarningInvoice.id`
   * / `PartnerJobEarning.earningId`). The answer is a complete printable HTML DOCUMENT (text/html,
   * no JSON envelope, no PDF): render it in a WebView or hand it to a print / share sheet. It needs
   * the bearer token, so its URL cannot simply be opened in a browser. 404 NOT_FOUND "Invoice not found".
   */
  getEarningInvoice: (earningId: string) => requestText(`/api/providers/me/earnings/${encodeURIComponent(earningId)}/invoice`),

  /** GET /api/providers/me/tax-summary — read the caveats on `PartnerTaxSummary` before showing it. */
  getTaxSummary: () => request<PartnerTaxSummary>("/api/providers/me/tax-summary"),

  /**
   * POST /api/wallet/withdraw (HTTP 201) — the one `/api/wallet` route that is partner money. Send
   * an `idempotencyKey` and reuse it on a retry: the same key returns the same withdrawal.
   * Refusals: 403 EMAIL_NOT_VERIFIED (verify with `security.sendVerificationEmail`); 400
   * VALIDATION_ERROR (`details`); 400 INSUFFICIENT_BALANCE — the route reports EVERY other failure
   * under this code too, so its sentence may not be the real cause.
   */
  withdraw: (payload: WithdrawRequest) =>
    requestEnvelope<{ withdrawal: WithdrawResult }>("/api/wallet/withdraw", { method: "POST", body: payload }).then((e) => ({
      withdrawal: e.data.withdrawal,
      message: e.message,
    })),

  /** GET /api/providers/me/route/optimize — 409 NO_LOCATION without a live location. */
  routeOptimize: () => request<RouteOptimizeResult>("/api/providers/me/route/optimize"),

  /* ------------------------------------------------------------------ */
  /* AI assistant                                                         */
  /* ------------------------------------------------------------------ */

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

  /* ------------------------------------------------------------------ */
  /* Notifications                                                        */
  /* ------------------------------------------------------------------ */

  notifications: {
    /** GET /api/notifications — `type` is a substring match; `unreadOnly` sends `isRead=false`. */
    list: (query: { page?: number; limit?: number; type?: string; unreadOnly?: boolean } = {}) =>
      request<PartnerNotificationsResponse>("/api/notifications", {
        query: { page: query.page, limit: query.limit, type: query.type, ...(query.unreadOnly ? { isRead: "false" } : {}) },
      }),
    /** PUT /api/notifications/:id/read */
    markRead: (id: string) => request<undefined>(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "PUT" }).then(() => undefined),
    /** PUT /api/notifications/read-all → how many were marked. */
    markAllRead: () => request<{ count: number }>("/api/notifications/read-all", { method: "PUT" }),
    /** DELETE /api/notifications/:id */
    remove: (id: string) => request<undefined>(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" }).then(() => undefined),
    preferences: () =>
      request<{
        channels: Array<{
          channel: NotificationChannelName;
          available: boolean;
          reason?: string;
        }>;
        matrix: Array<{
          category: NotificationCategoryName;
          channel: NotificationChannelName;
          enabled: boolean;
          editable: boolean;
          mandatory: boolean;
          available: boolean;
          unavailableReason?: string;
        }>;
      }>("/api/notifications/preferences"),
    setPreference: (body: { channel: NotificationChannelName; category: NotificationCategoryName; enabled: boolean }) =>
      request<unknown>("/api/notifications/preferences", { method: "PUT", body }),
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

  /* ------------------------------------------------------------------ */
  /* Membership, referrals, network                                       */
  /* ------------------------------------------------------------------ */

  /** The CUSTOMER membership programme (a partner login may call it; nothing in it is partner-specific). */
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
    /** GET /api/referrals/me — the CUSTOMER referral programme of this login. The partner programme is `network`. */
    summary: () =>
      request<{
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
      }>("/api/referrals/me"),
  },

  network: {
    /** GET /api/providers/me/network */
    dashboard: () => request<PartnerNetworkDashboard>("/api/providers/me/network"),
    /** POST /api/providers/me/network/invite — `name` 2–120, `phone` 10–20 characters. */
    invite: (body: { name: string; phone: string; email?: string; city?: string; skillInterest?: string }) =>
      request<PartnerNetworkInviteResult>("/api/providers/me/network/invite", { method: "POST", body }),
  },

  /* ------------------------------------------------------------------ */
  /* Support                                                              */
  /* ------------------------------------------------------------------ */

  support: {
    /** GET /api/support/tickets. `status`: open | in_progress | resolved | closed; `closed` applies only without `status`. */
    tickets: (query: { page?: number; limit?: number; status?: string; closed?: boolean; category?: string; search?: string } = {}) =>
      request<{ tickets: PartnerSupportTicket[]; total: number; page: number }>("/api/support/tickets", { query }),
    /** GET /api/support/tickets/:id — 404 NOT_FOUND. */
    ticketById: (id: string) =>
      request<{ ticket: PartnerSupportTicketDetail }>(`/api/support/tickets/${encodeURIComponent(id)}`).then((r) => r.ticket),
    /** POST /api/support/tickets → a SHORT row (id, number, priority, SLA, status); read `ticketById` for the rest. */
    createTicket: (payload: CreateSupportTicketBody) =>
      request<{ ticket: CreatedSupportTicket }>("/api/support/tickets", { method: "POST", body: payload }).then((r) => r.ticket),
    /** POST /api/support/tickets/:id/reply — `body` 1–5000 characters. Replying to a resolved ticket reopens it; 400 CLOSED on a closed one. */
    reply: (id: string, body: string) =>
      request<{ message: { id: string; ticketId: string; authorRole: string; body: string; createdAt: string } }>(
        `/api/support/tickets/${encodeURIComponent(id)}/reply`,
        { method: "POST", body: { body } },
      ).then((r) => r.message),
  },

  /* ------------------------------------------------------------------ */
  /* Geo-intelligence and weather                                         */
  /* ------------------------------------------------------------------ */

  /**
   * `/api/geo-intel/*` — each answer carries its own `confidence`, `freshness`, `source`, `cached`
   * and `generatedAt` next to `data`. There is NO `zoneScoring` here: `/api/geo-intel/zone-scoring`
   * is admin-only (403 for a partner). The partner's zone read is `partnerOs.intel.zones()`.
   */
  geoIntel: {
    surge: () => requestBody("/api/geo-intel/surge").then((b) => b as unknown as GeoIntel<SurgeZone[]>),
    density: () => requestBody("/api/geo-intel/provider-density").then((b) => b as unknown as GeoIntel<DensityZone[]>),
    /** Either the forecast or `{ available: false, … }` — a state, not an error. Check `data.stale` before calling it a forecast of the coming hours. */
    demandForecast: (horizon = 24): Promise<DemandForecastResult> =>
      requestBody("/api/geo-intel/demand-forecast", { query: { horizon } }).then((b) =>
        b.available === false
          ? { available: false, reasonCode: "FORECAST_SOURCE_UNAVAILABLE", cause: String(b.cause ?? ""), reason: String(b.reason ?? ""), data: null, generatedAt: String(b.generatedAt ?? "") }
          : ({ ...(b as unknown as GeoIntel<DemandForecast>), available: true } as DemandForecastResult),
      ),
    eta: (fromLat: number, fromLng: number, toLat: number, toLng: number) =>
      requestBody("/api/geo-intel/eta", { query: { fromLat, fromLng, toLat, toLng } }).then((b) => b as unknown as GeoIntel<GeoEta>),
  },

  /** GET /api/weather/alerts. `{ available: false }` when the weather source is not configured or did not answer — never invented weather. */
  weatherAlerts: (lat: number, lng: number) =>
    request<{
      available: boolean;
      reason?: string;
      alerts?: Array<{ type: string; level: string; message: string }>;
    }>("/api/weather/alerts", { query: { lat, lng } }),

  /* ------------------------------------------------------------------ */
  /* Partner OS                                                           */
  /* ------------------------------------------------------------------ */

  partnerOs: {
    attendance: () => request<PartnerAttendance>("/api/providers/me/attendance"),
    /** POST …/attendance/check-in — also sets the partner online. */
    checkIn: () => request<{ session: unknown; alreadyCheckedIn: boolean }>("/api/providers/me/attendance/check-in", { method: "POST" }),
    /** POST …/attendance/check-out — throws `NO_OPEN_SESSION` when there is none. */
    checkOut: () => request<{ session: unknown }>("/api/providers/me/attendance/check-out", { method: "POST" }),
    incentives: () => request<PartnerIncentives>("/api/providers/me/incentives"),
    forecast: () => request<PartnerForecast>("/api/providers/me/forecast"),
    /** GET /api/providers/me/intelligence?days= (7..365, default 90) — repeat-customer statistics only. */
    intelligence: (days = 90) => request<PartnerIntelligence>("/api/providers/me/intelligence", { query: { days } }),
    /**
     * `/api/providers/me/intel/*` — four feature-flagged reads. Each returns `null` when its flag is
     * off (the server's 404 NOT_FOUND; all four are off unless enabled): show "not available", not
     * an empty result. Every answer is a state first — read the types before rendering a number.
     */
    intel: {
      nudges: () => nullOn404(request<PartnerNudges>("/api/providers/me/intel/nudges"), "NOT_FOUND"),
      /** `target` is a non-negative rupee amount (400 VALIDATION_ERROR otherwise). */
      shiftPlan: (target?: number) => nullOn404(request<PartnerShiftPlan>("/api/providers/me/intel/shift-plan", { query: { target } }), "NOT_FOUND"),
      earningsCoach: (target?: number) => nullOn404(request<PartnerEarningsCoach>("/api/providers/me/intel/earnings-coach", { query: { target } }), "NOT_FOUND"),
      /** `limit` 1–50 (default 10). */
      zones: (limit?: number) => nullOn404(request<PartnerZoneRecommendations>("/api/providers/me/intel/zones", { query: { limit } }), "NOT_FOUND"),
    },
    /** `null` when the server has no ranking for this partner. */
    rankings: () => request<PartnerRankings | null>("/api/providers/me/rankings").then((r) => r ?? null),
    score: () => request<PartnerScorecard>("/api/providers/me/score"),
    scoreHistory: (page = 1, limit = 20) => request<PartnerScoreHistoryPage>("/api/providers/me/score/history", { query: { page, limit } }),
    career: () => request<PartnerCareer>("/api/providers/me/career"),
    careerHistory: (page = 1, limit = 20) => request<PartnerCareerHistoryPage>("/api/providers/me/career/history", { query: { page, limit } }),
    lifecycle: () => request<PartnerLifecycle>("/api/providers/me/lifecycle"),
    academy: () => request<PartnerAcademy>("/api/providers/me/academy"),
    completeAcademyModule: (moduleId: string, score?: number) =>
      request<{ progress: unknown }>(`/api/providers/me/academy/${encodeURIComponent(moduleId)}/complete`, {
        method: "POST",
        body: typeof score === "number" ? { score } : {},
      }),
    compliance: () => request<PartnerCompliance>("/api/providers/me/compliance"),
    wellbeing: () => request<PartnerWellbeing>("/api/providers/me/wellbeing"),
    rewards: () => request<PartnerRewards>("/api/providers/me/rewards"),
    /** Four counts only (completed, cancelled, rescheduled, upcoming) — there are no rows behind it. */
    serviceHistory: () => request<PartnerServiceHistory>("/api/providers/me/service-history"),
  },

  /* ------------------------------------------------------------------ */
  /* Safety                                                               */
  /* ------------------------------------------------------------------ */

  safety: {
    /** PATCH /api/providers/me/safety/emergency-contact — the server keeps at most 100 / 20 characters. */
    updateEmergencyContact: (body: { emergencyContactName?: string; emergencyContactPhone?: string }) =>
      request<EmergencyContact>("/api/providers/me/safety/emergency-contact", { method: "PATCH", body }),
    /** POST /api/providers/me/safety/sos — one incident per partner + booking: a repeat returns `created: false`. */
    triggerSos: (body: { bookingId?: string; latitude?: number; longitude?: number; accuracy?: number } = {}) =>
      request<{ incidentId: string; status: string; created: boolean; hasLocation: boolean }>("/api/providers/me/safety/sos", { method: "POST", body }),
    /** POST /api/providers/me/safety/report — `notes` are cut to 500 characters; a `bookingId` that is not the partner's is dropped silently. */
    report: (body: { type: SafetyReportType; bookingId?: string; notes?: string }) =>
      request<{ incidentId: string; status: string }>("/api/providers/me/safety/report", { method: "POST", body }),
    /** GET /api/providers/me/safety/incidents — the latest 20. */
    incidents: () => request<{ incidents: PartnerSafetyIncident[] }>("/api/providers/me/safety/incidents").then((r) => r.incidents),
  },

  /* ------------------------------------------------------------------ */
  /* Documents                                                            */
  /* ------------------------------------------------------------------ */

  documents: {
    /** GET /api/providers/me/documents — metadata only; the file itself is not listed. */
    list: () => request<{ documents: PartnerDocument[] }>("/api/providers/me/documents").then((r) => r.documents),
    /**
     * POST /api/providers/me/documents. There is no "renew" route: a renewal is a NEW upload of the
     * same `documentType` (a verified document cannot be edited — 409 DOCUMENT_LOCKED). Every
     * failure answers `UPLOAD_FAILED` (400, or 403); its sentence says why (size, type).
     */
    upload: (body: UploadDocumentBody) => request<{ documentId: string }>("/api/providers/me/documents", { method: "POST", body }),
    /** PATCH /api/providers/me/documents/:id — expiry / issuer / issue date of an UNVERIFIED document. 409 DOCUMENT_LOCKED once verified; 404 NOT_FOUND. */
    updateMeta: (documentId: string, body: { expiryDate?: string | null; issuer?: string; issueDate?: string | null }) =>
      request<{ document: PartnerDocument & Record<string, unknown> }>(`/api/providers/me/documents/${encodeURIComponent(documentId)}`, {
        method: "PATCH",
        body,
      }).then((r) => r.document),
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
    /** Withdraw an own claim — DECLARED or REJECTED rows (a language only while its source is SELF); 409 `CAPABILITY_LOCKED` otherwise. */
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
};

export type { PartnerUser };
