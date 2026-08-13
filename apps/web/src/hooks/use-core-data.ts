"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useEffect } from "react";
import { coreApi } from "@/services/core/api";
import { AuthApiError, getErrorMessage } from "@/lib/auth/errors";
import { useAppStore } from "@/stores/app-store";
import { useAuthStore } from "@/stores/auth-store";
import type {
  BackendAddress,
  BackendBooking,
  BackendNotification,
  BackendTracking,
} from "@/types/backend";
import type { SavedBooking } from "@/lib/bookings";

export const qk = {
  services: ["services"] as const,
  featured: ["services", "featured"] as const,
  statsOverview: ["stats", "overview"] as const,
  bookings: ["bookings"] as const,
  bookingDetail: (id: string) => ["bookings", "detail", id] as const,
  tracking: (bookingId: string) => ["tracking", bookingId] as const,
  walletBalance: ["wallet", "balance"] as const,
  walletTx: ["wallet", "transactions"] as const,
  walletOffers: ["wallet", "offers"] as const,
  notifications: ["notifications"] as const,
  payments: ["payments"] as const,
  providers: ["providers"] as const,
  providerDetail: (id: string) => ["providers", "detail", id] as const,
  providerReviews: (id: string) => ["providers", "reviews", id] as const,
  providerAvailability: (id: string, date: string, serviceId: string) =>
    ["providers", "availability", id, date, serviceId] as const,
  ratings: ["ratings"] as const,
  ratingByBooking: (bookingId: string) => ["ratings", "byBooking", bookingId] as const,
  addresses: ["users", "addresses"] as const,
};

export function mapBackendBookingToSaved(b: BackendBooking): SavedBooking {
  const now = new Date().toISOString();
  const date = b.scheduledDate ? new Date(b.scheduledDate) : new Date();
  return {
    id: b.id,
    serviceId: b.serviceId ?? "service",
    serviceTitle: b.serviceName ?? "Service",
    serviceName: b.serviceName ?? "Service",
    packageName: "Standard",
    dateLabel: date.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }),
    timeLabel: date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    address: "Selected address",
    total: b.finalAmount ?? b.amount ?? 0,
    addons: b.addons,
    status:
      b.status === "pending" || b.status === "accepted"
        ? "confirmed"
        : b.status === "cancelled_by_user" || b.status === "cancelled_by_provider"
          ? "cancelled"
          : b.status === "completed"
            ? "completed"
            : b.status === "in_progress"
              ? "in_progress"
              : "confirmed",
    createdAt: now,
    updatedAt: now,
    backendStatus: b.status,
    imagePath: b.serviceIcon ?? undefined,
    serviceColor: "#7C3AED",
    proName: b.providerName ?? "Assigned Pro",
    instructions: b.description ?? undefined,
    paymentStatus: b.paymentStatus,
    timeline: [
      { id: "1", label: "Booking confirmed", at: now, done: true },
      { id: "2", label: "Pro assigned", at: now, done: true },
      { id: "3", label: "On the way", at: "", done: false },
      { id: "4", label: "Service completed", at: "", done: false },
    ],
  };
}

export function useStatsOverview() {
  return useQuery({
    queryKey: qk.statsOverview,
    queryFn: () => coreApi.stats.overview(),
    staleTime: 5 * 60_000, // marketing stats — no need to refetch per navigation
  });
}

export function useServicesQuery() {
  return useQuery({
    queryKey: qk.services,
    // Full catalog (backend caps limit at 100). The default page size of 20 would
    // hide marketplace services from the book page's service picker.
    queryFn: () => coreApi.services.list("?limit=100"),
    staleTime: 10 * 60_000, // catalog changes rarely; was refetching every nav
  });
}

export function useFeaturedServicesQuery() {
  return useQuery({
    queryKey: qk.featured,
    queryFn: () => coreApi.services.featured(),
    staleTime: 10 * 60_000,
  });
}

export function useProvidersQuery(serviceId: string) {
  return useQuery({
    queryKey: [...qk.providers, serviceId],
    queryFn: () =>
      coreApi.providers.search({
        serviceId,
        latitude: 19.076,
        longitude: 72.8777,
        radius: 10,
        page: 1,
        limit: 8,
      }),
    staleTime: 30_000,
    enabled: !!serviceId,
  });
}

/**
 * Smart-matched providers ranked by the backend composite scoring algorithm
 * (rating + distance + availability + response + completion = 0-100).
 * Requires auth, so use only on authenticated screens.
 */
export function useMatchedProvidersQuery(serviceId: string) {
  return useQuery({
    queryKey: [...qk.providers, "match", serviceId],
    queryFn: () =>
      coreApi.providers.match({
        serviceId,
        latitude: 19.076,
        longitude: 72.8777,
        scheduledDate: new Date().toISOString(),
        maxResults: 10,
        maxDistanceKm: 25,
      }),
    staleTime: 30_000,
    enabled: !!serviceId,
  });
}

export function useBookingsQuery(options?: { enabled?: boolean }) {
  const syncServerBookings = useAppStore((s) => s.syncServerBookings);
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const enabled = (options?.enabled ?? true) && isAuthenticated;
  const query = useQuery({
    queryKey: qk.bookings,
    queryFn: () => coreApi.bookings.listMine("?status=all&limit=20&page=1"),
    // Freshness comes from the WS bridge (booking events invalidate this key)
    // + the 30s refetchInterval below while a booking is active.
    staleTime: 60_000,
    enabled,
    retry: 2,
    refetchInterval: (queryRef) => {
      const data = queryRef.state.data as { bookings?: BackendBooking[] } | undefined;
      const hasActive = (data?.bookings ?? []).some(
        (b) => b.status === "pending" || b.status === "accepted" || b.status === "in_progress",
      );
      return hasActive ? 30_000 : false;
    },
  });
  useEffect(() => {
    const serverBookings = query.data?.bookings;
    // Only reconcile on a successful fetch — never wipe the store on loading/error.
    if (!serverBookings) return;
    syncServerBookings(serverBookings.map(mapBackendBookingToSaved));
  }, [syncServerBookings, query.data?.bookings]);
  return query;
}

export function useBookingDetailQuery(bookingId?: string) {
  const addBooking = useAppStore((s) => s.addBooking);
  return useQuery({
    queryKey: bookingId ? qk.bookingDetail(bookingId) : ["bookings", "detail", "none"],
    queryFn: async () => {
      const data = await coreApi.bookings.byId(bookingId!);
      const booking = data.booking;
      addBooking(mapBackendBookingToSaved(booking));
      return booking;
    },
    enabled: !!bookingId,
    staleTime: 8_000,
    retry: 2,
  });
}

/**
 * Customer's service-start PIN for a booking. Polls while the job hasn't
 * started so the PIN appears the moment the partner requests it at the door;
 * stops polling once verified.
 */
export function useStartPinQuery(bookingId?: string, enabled = true) {
  return useQuery({
    queryKey: ["bookings", "start-pin", bookingId ?? "none"],
    queryFn: () => coreApi.bookings.startPin(bookingId!),
    enabled: !!bookingId && enabled,
    staleTime: 5_000,
    retry: 1,
    refetchInterval: (queryRef) => {
      const state = queryRef.state.data?.state;
      return state === "verified" ? false : 10_000;
    },
    // The customer often has the partner's screen (or another tab) focused
    // while testing/doing the handoff — keep polling so the PIN is already
    // on screen the moment they look back.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
}

export function useRefreshBookingFromServerMutation() {
  const qc = useQueryClient();
  const addBooking = useAppStore((s) => s.addBooking);
  return useMutation({
    mutationFn: async (bookingId: string) => {
      const data = await coreApi.bookings.byId(bookingId);
      return data.booking;
    },
    onSuccess: (booking) => {
      addBooking(mapBackendBookingToSaved(booking));
      void qc.invalidateQueries({ queryKey: qk.bookings });
      void qc.invalidateQueries({ queryKey: qk.bookingDetail(booking.id) });
    },
  });
}

export function useBookingPriceQuoteQuery(
  payload: {
    serviceId: string;
    couponCode?: string;
    packagePrice?: number;
    addonIds?: string[];
  } | null,
) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const isAuthReady = useAuthStore((s) => s.status !== "idle" && s.status !== "initializing");
  return useQuery({
    queryKey: ["bookings", "price-quote", payload],
    queryFn: () => coreApi.bookings.priceQuote(payload!),
    enabled: isAuthReady && isAuthenticated && !!payload?.serviceId,
    staleTime: 15_000,
  });
}

export function useCreateBookingMutation() {
  const qc = useQueryClient();
  const addBooking = useAppStore((s) => s.addBooking);
  const showToast = useAppStore((s) => s.showToast);

  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => coreApi.bookings.create(payload),
    onSuccess: (data) => {
      if (data.booking) addBooking(mapBackendBookingToSaved(data.booking));
      qc.invalidateQueries({ queryKey: qk.bookings });
      showToast("Booking confirmed successfully", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useCreatePaymentOrderMutation() {
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ bookingId, amount }: { bookingId: string; amount?: number }) =>
      coreApi.payments.createOrder(bookingId, amount),
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useVerifyPaymentMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: async (payload: {
      razorpayOrderId: string;
      razorpayPaymentId: string;
      razorpaySignature: string;
    }) => {
      try {
        return await coreApi.payments.verify(payload);
      } catch (error) {
        // Backend returns 409 ALREADY_SETTLED if payment is already verified
        // (e.g. via webhook reconciliation race). Treat as success.
        if (error instanceof AuthApiError && (error.code === "ALREADY_SETTLED" || error.status === 409)) {
          return { paymentId: "", status: "already_settled", bookingId: "" };
        }
        throw error;
      }
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: qk.bookings });
      void qc.invalidateQueries({ queryKey: qk.walletBalance });
      if (data.status === "already_settled") {
        showToast("Payment already confirmed", "success");
      } else {
        showToast("Payment verified successfully", "success");
      }
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

async function updateBookingWithRetry(
  bookingId: string,
  payload: Record<string, unknown>,
  maxAttempts = 4,
) {
  const { AuthApiError } = await import("@/lib/auth/errors");
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await coreApi.bookings.update(bookingId, payload);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof AuthApiError &&
        error.status === 429 &&
        (error.code === "POOL_BUSY" || error.code === "RATE_LIMIT_EXCEEDED");
      if (!retryable || attempt === maxAttempts - 1) throw error;
      const waitSec = Math.min(8, error.retryAfter ?? 2 + attempt);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
    }
  }
  throw lastError;
}

export function useUpdateBookingMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ bookingId, payload }: { bookingId: string; payload: Record<string, unknown> }) =>
      updateBookingWithRetry(bookingId, payload),
    onSuccess: (data) => {
      if (data.booking) {
        void qc.invalidateQueries({ queryKey: qk.bookings });
        void qc.invalidateQueries({ queryKey: qk.bookingDetail(data.booking.id) });
      }
      showToast("Booking updated", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useAddressesQuery() {
  return useQuery({
    queryKey: qk.addresses,
    queryFn: () => coreApi.users.addresses(),
    // Address mutations invalidate this key; no need to refetch per nav.
    staleTime: 5 * 60_000,
  });
}

export function useCreateAddressMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => coreApi.users.createAddress(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.addresses });
      showToast("Address added", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useUpdateAddressMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Record<string, unknown> }) =>
      coreApi.users.updateAddress(id, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.addresses });
      showToast("Address updated", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useDeleteAddressMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (id: string) => coreApi.users.deleteAddress(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.addresses });
      const prev = qc.getQueryData<{ addresses: BackendAddress[] }>(qk.addresses);
      if (prev?.addresses) {
        qc.setQueryData(qk.addresses, {
          ...prev,
          addresses: prev.addresses.filter((a) => a.id !== id),
        });
      }
      return { prev };
    },
    onError: (error, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.addresses, ctx.prev);
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: () => showToast("Address removed", "success"),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.addresses }),
  });
}

export function useSetDefaultAddressMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (id: string) => coreApi.users.setDefaultAddress(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.addresses });
      showToast("Default address updated", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useUpdatePreferencesMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (payload: Record<string, unknown>) => coreApi.users.preferences(payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["users", "me"] });
      showToast("Preferences updated", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useWalletOffersQuery() {
  return useQuery({
    queryKey: qk.walletOffers,
    queryFn: () => coreApi.wallet.offers(),
    staleTime: 60_000,
  });
}

export function useAddMoneyMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (amount: number) => coreApi.wallet.addMoney(amount),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.walletBalance });
      void qc.invalidateQueries({ queryKey: qk.walletTx });
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useCancellationQuoteQuery(bookingId?: string, enabled = false) {
  return useQuery({
    queryKey: ["bookings", "cancel-quote", bookingId],
    queryFn: () => coreApi.bookings.cancellationQuote(bookingId!),
    enabled: !!bookingId && enabled,
    staleTime: 30_000,
  });
}

export function useCancelBookingMutation() {
  const qc = useQueryClient();
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const getBookingById = useAppStore((s) => s.getBookingById);
  const showToast = useAppStore((s) => s.showToast);

  return useMutation({
    mutationFn: (bookingId: string) => coreApi.bookings.cancel(bookingId, "Cancelled by user", "user"),
    onMutate: async (bookingId) => {
      const prevBooking = getBookingById(bookingId);
      updateBookingStatus(bookingId, "cancelled");
      return { prevBooking };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.bookings });
      const refund = data?.booking?.refundAmount ?? 0;
      const msg = data?.booking?.refundMessage;
      if (refund > 0) {
        showToast(
          msg ?? `Booking cancelled — ₹${refund} refund initiated.`,
          "success",
        );
      } else {
        showToast("Booking cancelled", "success");
      }
    },
    onError: (error, bookingId, ctx) => {
      if (ctx?.prevBooking) {
        updateBookingStatus(bookingId, ctx.prevBooking.status);
      }
      showToast(getErrorMessage(error), "error");
    },
  });
}

export function useWalletBalanceQuery(options?: { enabled?: boolean }) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const enabled = (options?.enabled ?? true) && isAuthenticated;
  return useQuery({
    queryKey: qk.walletBalance,
    queryFn: () => coreApi.wallet.balance(),
    // Top-ups/payments invalidate this key via their mutations.
    staleTime: 2 * 60_000,
    enabled,
  });
}

export function useWalletTransactionsQuery() {
  return useQuery({
    queryKey: qk.walletTx,
    queryFn: () => coreApi.wallet.transactions("?limit=20&page=1"),
    staleTime: 2 * 60_000,
  });
}

export function usePaymentsHistoryQuery() {
  return useQuery({
    queryKey: qk.payments,
    queryFn: () => coreApi.payments.history("?limit=20&page=1"),
    staleTime: 2 * 60_000,
  });
}

export function useUserRatingsQuery() {
  return useQuery({
    queryKey: qk.ratings,
    queryFn: () => apiUserRatings(),
    staleTime: 30_000,
  });
}

async function apiUserRatings() {
  return coreApi.users.ratings("?limit=20&page=1");
}

export function useNotificationsQuery(options?: { enabled?: boolean }) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const isAuthReady = useAuthStore((s) => s.status !== "idle" && s.status !== "initializing");
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => coreApi.notifications.list("?limit=20&page=1"),
    // New notifications arrive over WS (bridge invalidates this key).
    staleTime: 60_000,
    enabled: isAuthReady && isAuthenticated && (options?.enabled ?? true),
    retry: (failureCount, error) => {
      if (error instanceof AuthApiError && error.status === 401) return false;
      return failureCount < 2;
    },
  });
}

export function useUnreadNotificationCount() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const { data } = useNotificationsQuery();
  if (!isAuthenticated) return 0;
  return data?.unreadCount ?? 0;
}

export function upsertNotificationInCache(queryClient: ReturnType<typeof useQueryClient>, incoming: BackendNotification) {
  const prev = queryClient.getQueryData<{ notifications: BackendNotification[]; unreadCount?: number }>(qk.notifications);
  const notifications = prev?.notifications ?? [];
  const existing = notifications.find((n) => n.id === incoming.id);
  if (existing) {
    const prevTs = Date.parse(existing.createdAt);
    const nextTs = Date.parse(incoming.createdAt);
    if (!Number.isNaN(prevTs) && !Number.isNaN(nextTs) && nextTs < prevTs) return;
  }
  const next = existing
    ? notifications.map((n) => (n.id === incoming.id ? incoming : n))
    : [incoming, ...notifications];
  queryClient.setQueryData(qk.notifications, {
    ...(prev ?? {}),
    notifications: next,
    unreadCount: next.filter((n) => !n.isRead).length,
  });
}

export function upsertTrackingInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  bookingId: string,
  trackingPatch: Partial<BackendTracking>,
) {
  const key = qk.tracking(bookingId);
  const prev = queryClient.getQueryData<{ tracking: BackendTracking }>(key);
  const prevTs = Date.parse(prev?.tracking?.locationUpdatedAt ?? "");
  const nextTs = Date.parse((trackingPatch.locationUpdatedAt as string | undefined) ?? "");
  if (!Number.isNaN(prevTs) && !Number.isNaN(nextTs) && nextTs < prevTs) return;
  queryClient.setQueryData(key, {
    tracking: {
      ...(prev?.tracking ?? { bookingId, id: bookingId, status: "in_progress" }),
      ...trackingPatch,
    } as BackendTracking,
  });
}

export function useMarkNotificationReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => coreApi.notifications.markRead(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<{ notifications: BackendNotification[]; unreadCount?: number }>(qk.notifications);
      if (prev?.notifications) {
        const next = prev.notifications.map((n) => (n.id === id ? { ...n, isRead: true } : n));
        qc.setQueryData(qk.notifications, {
          ...prev,
          notifications: next,
          unreadCount: next.filter((n) => !n.isRead).length,
        });
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.notifications, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useMarkAllNotificationsReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    // Single server-side statement — a per-id loop only covers the loaded page
    // and leaves older unread rows keeping the badge lit.
    mutationFn: () => coreApi.notifications.markAllRead(),
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<{ notifications: BackendNotification[]; unreadCount?: number }>(qk.notifications);
      if (prev?.notifications) {
        qc.setQueryData(qk.notifications, {
          ...prev,
          notifications: prev.notifications.map((n) => ({ ...n, isRead: true })),
          unreadCount: 0,
        });
      }
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.notifications, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useDeleteNotificationMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => coreApi.notifications.delete(id),
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.notifications });
      const prev = qc.getQueryData<{ notifications: BackendNotification[]; unreadCount?: number }>(qk.notifications);
      if (prev?.notifications) {
        const next = prev.notifications.filter((n) => n.id !== id);
        qc.setQueryData(qk.notifications, {
          ...prev,
          notifications: next,
          unreadCount: next.filter((n) => !n.isRead).length,
        });
      }
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData(qk.notifications, ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

/* -------------------------------------------------------------------------- */
/* Ratings                                                                     */
/* -------------------------------------------------------------------------- */

export function useRatingByBookingQuery(bookingId?: string) {
  return useQuery({
    queryKey: bookingId ? qk.ratingByBooking(bookingId) : ["ratings", "byBooking", "none"],
    queryFn: async () => {
      try {
        const data = await coreApi.ratings.byBooking(bookingId!);
        return data.rating ?? null;
      } catch (error) {
        if (error instanceof AuthApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: !!bookingId,
    staleTime: 30_000,
    retry: (failureCount, error) => {
      if (error instanceof AuthApiError && error.status === 404) return false;
      return failureCount < 2;
    },
  });
}

export function useSubmitRatingMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (payload: Parameters<typeof coreApi.ratings.submit>[0]) =>
      coreApi.ratings.submit(payload),
    onSuccess: (data, variables) => {
      qc.setQueryData(qk.ratingByBooking(variables.bookingId), data.rating);
      void qc.invalidateQueries({ queryKey: qk.ratings });
      void qc.invalidateQueries({ queryKey: qk.bookings });
      void qc.invalidateQueries({ queryKey: qk.bookingDetail(variables.bookingId) });
      showToast("Thanks for your review!", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useUpdateRatingMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({
      ratingId,
      payload,
    }: {
      ratingId: string;
      payload: { rating?: number; reviewText?: string; photos?: string[] };
    }) => coreApi.ratings.update(ratingId, payload),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.ratings });
      showToast("Review updated", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useProviderRatingResponseMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ ratingId, response }: { ratingId: string; response: string }) =>
      coreApi.ratings.respond(ratingId, response),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: qk.ratings });
      void qc.invalidateQueries({ queryKey: ["providers", "reviews"] });
      showToast("Response posted", "success");
      return variables;
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

/* -------------------------------------------------------------------------- */
/* Payments — refund                                                           */
/* -------------------------------------------------------------------------- */

/** Customer refunds go via booking cancellation or support — not the admin payment refund API. */
export function useRefundSupportTicketMutation() {
  const showToast = useAppStore((s) => s.showToast);
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      paymentId,
      reason,
      amount,
    }: {
      paymentId: string;
      reason: string;
      amount: number;
    }) =>
      coreApi.support.createTicket({
        subject: `Refund request — payment ${paymentId.slice(0, 8)}`,
        category: "Payment & refunds",
        description: `Requested refund: ₹${amount}. Reason: ${reason}. Payment ID: ${paymentId}`,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["support"] });
      showToast("Refund request submitted to support. We'll respond within 24 hours.", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

/* -------------------------------------------------------------------------- */
/* Provider profile, reviews, availability, booking                            */
/* -------------------------------------------------------------------------- */

export function useProviderDetailQuery(providerId?: string) {
  return useQuery({
    queryKey: providerId ? qk.providerDetail(providerId) : ["providers", "detail", "none"],
    queryFn: () => coreApi.providers.details(providerId!),
    enabled: !!providerId,
    staleTime: 60_000,
    retry: 2,
  });
}

export function useProviderReviewsQuery(providerId?: string, query = "?limit=20&page=1") {
  return useQuery({
    queryKey: providerId
      ? [...qk.providerReviews(providerId), query]
      : ["providers", "reviews", "none"],
    queryFn: () => coreApi.providers.reviews(providerId!, query),
    enabled: !!providerId,
    staleTime: 30_000,
    retry: 2,
  });
}

export function useProviderAvailabilityQuery(
  providerId?: string,
  date?: string,
  serviceId?: string,
) {
  const enabled = !!providerId && !!date && !!serviceId;
  return useQuery({
    queryKey:
      enabled && providerId && date && serviceId
        ? qk.providerAvailability(providerId, date, serviceId)
        : ["providers", "availability", "none"],
    queryFn: () => coreApi.providers.availability(providerId!, date!, serviceId!),
    enabled,
    staleTime: 15_000,
    retry: 2,
  });
}

export function useBookProviderMutation() {
  const qc = useQueryClient();
  const addBooking = useAppStore((s) => s.addBooking);
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({
      providerId,
      payload,
    }: {
      providerId: string;
      payload: {
        serviceId: string;
        scheduledDate: string;
        addressId: string;
        description?: string;
      };
    }) => coreApi.providers.book(providerId, payload),
    onSuccess: (data) => {
      if (data.booking) addBooking(mapBackendBookingToSaved(data.booking));
      void qc.invalidateQueries({ queryKey: qk.bookings });
      showToast("Booking confirmed", "success");
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

