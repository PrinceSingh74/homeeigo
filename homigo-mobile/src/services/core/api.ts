import type { ApiResponse } from "@/types/auth";
import type { BookingRequirementsView } from "@/types/backend";
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
  BackendServiceDetail,
  BackendTracking,
  BackendWalletTransaction,
  BackendWithdrawal,
} from "@/types/backend";
import { normalizeBackendAddress } from "@/lib/addresses";
import type { CasePhotoPart, CaseReportability } from "@/lib/case-report";

/** A photo upload outlasts the API client's default request window on a slow connection. */
const CASE_PHOTO_UPLOAD_TIMEOUT_MS = 120_000;
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
      apiRequest<ApiResponse<{ service: BackendServiceDetail }>>(`/api/services/${id}`).then((r) => r.data!),
    /** Public reviews of one service: real ratings only, reviewer reduced to a first name and an initial. */
    reviews: (id: string, limit = 5) =>
      apiRequest<
        ApiResponse<{
          reviews: { id: string; name: string; rating: number; reviewText: string | null; createdAt: string; providerResponse: string | null }[];
          total: number;
          ratingCount: number;
          averageRating: number | null;
        }>
      >(`/api/services/${id}/reviews?limit=${limit}`).then((r) => r.data!),
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
    /** Phase 10 §6 — the booking's gated requirements, their state and what blocks the start. */
    requirements: (id: string) =>
      apiRequest<ApiResponse<BookingRequirementsView>>(`/api/bookings/${id}/requirements`, { auth: true }).then((r) => r.data!),
    /** Phase 10 §9 — safety information and any safety hold (customer projection). */
    safety: (id: string) =>
      apiRequest<ApiResponse<{
        gate: { ok: boolean; message: string };
        safety: { warnings: string[]; customerRequirements: string[]; chemicalRestrictions?: string[]; information: string | null; medicalDisclaimer: string | null; emergencyProtocol: string | null } | null;
        holds: Array<{ condition: string }>;
      }>>(`/api/bookings/${id}/safety`, { auth: true }).then((r) => r.data!),
    /** Phase 10 §8 — the booking's work steps (titles + states only for the customer). */
    execution: (id: string) =>
      apiRequest<ApiResponse<{ enforced: boolean; steps: Array<{ code: string; stepNumber: number; title: string; mandatory: boolean; state: string }> }>>(`/api/bookings/${id}/execution`, { auth: true }).then((r) => r.data!),
    /** Phase 10 §10 — the latest quality verdict, in plain words (customer projection). */
    quality: (id: string) =>
      apiRequest<ApiResponse<{
        enforced: boolean;
        latest: { verdict: string; label: string; reasons: string[]; at: string } | null;
      }>>(`/api/bookings/${id}/quality`, { auth: true }).then((r) => r.data!),
    /** Phase 10 §10 — the confirmation axis: state, confirm-by, verdict summary and warranty window. */
    completion: (id: string) =>
      apiRequest<ApiResponse<{
        enforced: boolean;
        bookingStatus: string;
        completedAt: string | null;
        completion: { state: "PENDING_CUSTOMER" | "CONFIRMED" | "AUTO_CONFIRMED" | "ISSUE_REPORTED"; confirmBy: string; resolvedAt: string | null; canConfirm: boolean } | null;
        verdict: { verdict: string; label: string; reasons: string[]; at: string } | null;
        warranty: { state: string; startsAt: string; expiresAt: string } | null;
      }>>(`/api/bookings/${id}/completion`, { auth: true }).then((r) => r.data!),
    /** The customer confirms the completed job (owner only; replay is a 200 with changed=false). */
    confirmCompletion: (id: string) =>
      apiRequest<ApiResponse<{ changed: boolean; completion: { state: string } }>>(
        `/api/bookings/${id}/confirm-completion`,
        { method: "POST", auth: true },
      ).then((r) => r.data!),
    /** Phase 10 §11 — the customer's cases on this booking (customerView). */
    cases: (id: string) =>
      apiRequest<ApiResponse<{
        available: boolean;
        cases: Array<{
          id: string; caseNumber: string; bookingId: string; type: string; category: string; state: string;
          description: string | null; createdAt: string; closedAt: string | null;
          eligibility: { warrantyCovers: boolean; proofRequired: boolean; proofMissing: boolean; reasonCodes: string[] };
          resolution: { action: string | null; status: string | null; refundPaise: number | null; followUpBookingId: string | null } | null;
          /** `hasStoredMedia`: the photo's bytes are behind the authenticated case media route. Absent on an older backend. */
          evidence: Array<{ id: number; kind: string; jobEvidenceId: string | null; mediaUrl: string | null; note: string | null; hasStoredMedia?: boolean; createdAt: string }>;
          timeline: Array<{ state: string; at: string }>;
        }>;
        categories: string[];
        /** Whether an issue can be reported now (bookingCaseService.reportability). Absent on an older backend. */
        report?: CaseReportability;
      }>>(`/api/bookings/${id}/cases`, { auth: true }).then((r) => r.data!),
    /** Phase 10 §11 — report an issue on a completed booking (idempotent per booking + category). */
    reportCase: (id: string, payload: { category: string; description?: string }) =>
      apiRequest<ApiResponse<{ replayed: boolean; case: { id: string; caseNumber: string; state: string } }>>(
        `/api/bookings/${id}/cases`,
        { method: "POST", auth: true, body: payload },
      ).then((r) => r.data!),
    /** Phase 10 §11 — add a note to the customer's own open case (the server refuses a closed one). */
    addCaseNote: (id: string, caseId: string, note: string) =>
      apiRequest<ApiResponse<{ case: { id: string } }>>(
        `/api/bookings/${id}/cases/${encodeURIComponent(caseId)}/evidence`,
        { method: "POST", auth: true, body: { evidence: [{ kind: "NOTE", note }] } },
      ).then((r) => r.data!),
    /**
     * Phase 10 §11 — one photo on the customer's own open case: multipart, field `file`. `apiRequest`
     * only sends JSON, so this sends the form itself with the same bearer and one refresh-and-retry.
     * No Content-Type is set (the runtime writes the boundary), and the window is longer than the
     * API client's default because a photo on a slow connection outlasts it.
     * Throws AuthApiError carrying the server's `code` (VALIDATION_ERROR, CASE_CLOSED, …).
     */
    addCasePhoto: async (id: string, caseId: string, file: CasePhotoPart): Promise<void> => {
      const { useAuthStore } = await import("@/stores/auth-store");
      const { getApiBaseUrl } = await import("@/lib/api-config");
      const { AuthApiError } = await import("@/lib/auth/errors");
      const url = `${getApiBaseUrl()}/api/bookings/${id}/cases/${encodeURIComponent(caseId)}/evidence/photo`;
      const send = async (): Promise<Response> => {
        const body = new FormData();
        // React Native's FormData takes a { uri, name, type } file part; the DOM typing does not know it.
        body.append("file", file as unknown as Blob);
        const token = useAuthStore.getState().accessToken;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), CASE_PHOTO_UPLOAD_TIMEOUT_MS);
        try {
          return await fetch(url, { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {}, body, signal: controller.signal });
        } catch (error) {
          const aborted = error instanceof Error && error.name === "AbortError";
          throw new AuthApiError(
            aborted ? "The upload took too long. Check your connection and try again." : "The photo couldn't be sent. Check your connection and try again.",
            0,
            aborted ? "TIMEOUT" : "NETWORK_ERROR",
          );
        } finally {
          clearTimeout(timer);
        }
      };
      let res = await send();
      if (res.status === 401 && (await useAuthStore.getState().refreshSession())) res = await send();
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: string; code?: string } | null;
      if (!res.ok || !json?.success) throw new AuthApiError(json?.error ?? "The photo couldn't be added", res.status, json?.code);
    },
    /** READY = "it is in place now, please check again". A customer can never mark a partner check satisfied. */
    requirementAction: (id: string, code: string, action: "READY" | "ATTEST", note?: string) =>
      apiRequest<ApiResponse<{ code: string; state: string; changed: boolean }>>(
        `/api/bookings/${id}/requirements/${encodeURIComponent(code)}/customer`,
        { method: "POST", auth: true, body: { action, ...(note ? { note } : {}) } },
      ).then((r) => r.data!),
    /**
     * Owner-only service-start PIN (Urban-Company style). "active" carries the
     * plaintext PIN the customer shares in person with the partner at the door.
     */
    startPin: (id: string) =>
      apiRequest<
        ApiResponse<{
          state: "verified" | "waiting" | "active";
          pin: string | null;
          expiresAt: string | null;
          verifiedAt: string | null;
        }>
      >(`/api/bookings/${id}/start-pin`, { auth: true }).then((r) => r.data!),
    /** Booking-scoped chat — same conversation as customer web + partner clients. */
    listChat: (id: string, query: { cursor?: string; limit?: number } = {}) => {
      const qs = new URLSearchParams();
      if (query.cursor) qs.set("cursor", query.cursor);
      if (query.limit != null) qs.set("limit", String(query.limit));
      const suffix = qs.toString() ? `?${qs}` : "";
      return apiRequest<
        ApiResponse<{
          messages: Array<{
            id: string;
            body: string;
            senderUserId: string;
            createdAt: string;
            clientMessageId?: string | null;
          }>;
          nextCursor: string | null;
        }>
      >(`/api/bookings/${id}/chat${suffix}`, { auth: true }).then((r) => r.data!);
    },
    sendChat: (id: string, body: string, clientMessageId?: string) =>
      apiRequest<
        ApiResponse<{
          message: {
            id: string;
            body: string;
            senderUserId: string;
            createdAt: string;
            clientMessageId?: string | null;
          };
          created: boolean;
        }>
      >(`/api/bookings/${id}/chat`, {
        method: "POST",
        auth: true,
        body: { body, clientMessageId },
      }).then((r) => r.data!),
    markChatRead: (id: string) =>
      apiRequest<ApiResponse<{ ok: boolean }>>(`/api/bookings/${id}/chat/read`, {
        method: "POST",
        auth: true,
      }).then((r) => r.data!),
    partnerContact: (id: string) =>
      apiRequest<ApiResponse<{ phoneMasked: string | null; canCall: boolean }>>(
        `/api/bookings/${id}/partner-contact`,
        { auth: true },
      ).then((r) => r.data!),
    partnerCall: (id: string) =>
      apiRequest<
        ApiResponse<{ dialUri: string; phoneMasked: string; expiresInSec: number }>
      >(`/api/bookings/${id}/partner-call`, { method: "POST", auth: true }).then((r) => r.data!),
    cancel: (id: string, reason: string, cancelledBy: "user" | "provider") =>
      apiRequest<ApiResponse<{ booking: BackendBooking }>>(`/api/bookings/${id}/cancel`, {
        method: "POST",
        body: { reason, cancelledBy },
        auth: true,
      }).then((r) => r.data!),
    /** §53 — the customer reporting that nobody turned up. Never charges them. */
    reportProviderNoShow: (id: string) =>
      apiRequest<
        ApiResponse<{ status: string; feeAmount: number; refundAmount: number; refundStatus: string }>
      >(`/api/bookings/${id}/provider-no-show`, { method: "POST", body: {}, auth: true }).then((r) => r.data!),
    /** §45 / O6 — what moving this booking costs, from the server's frozen policy. */
    rescheduleQuote: (id: string) =>
      apiRequest<
        ApiResponse<{
          quote: {
            version: string;
            disposition: "FREE" | "LATE_FEE" | "NOT_PERMITTED";
            feeBps: number;
            feeAmountPaise: number;
            feeAmount: number;
            hoursUntilAppointment: number | null;
            message: string;
          };
        }>
      >(`/api/bookings/${id}/reschedule-quote`, { auth: true }).then((r) => r.data!),
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
          /**
           * Optional on purpose: `/api/ai/conversations/latest` does not send it today (only the
           * list endpoint does), so readers must fall back to the newest message's `createdAt`.
           */
          updatedAt?: string | null;
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
      apiRequest<ApiResponse<{ refunded: number; walletBalance: number; refundedTo?: "ORIGINAL_PAYMENT" }>>(`/api/giftcards/${id}/void`, {
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
