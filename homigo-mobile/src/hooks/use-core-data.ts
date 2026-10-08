import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { coreApi } from "@/services/core/api";
import { parityApi } from "@/services/core/parity-api";
import { offlineApiMutate } from "@/lib/offline/offline-mutate";
import { mutateWithOfflineFallback } from "@/lib/offline/sender";
import { AuthApiError, getErrorMessage } from "@/lib/auth/errors";
import { useAppStore, type SavedBooking, collapseCustomerBookingStatus, customerTimelineFromBackendStatus } from "@/lib/store";
import { useAuthStore } from "@/stores/auth-store";
import { getCachedDeviceCoordinates, type DeviceCoordinates } from "@/hooks/use-device-coordinates";
import type {
  BackendAddress,
  BackendBooking,
  BackendNotification,
  BackendRating,
  BackendRefund,
  BackendTracking,
} from "@/types/backend";

export const qk = {
  services: ["services"] as const,
  featured: ["services", "featured"] as const,
  serviceDetail: (id: string) => ["services", "detail", id] as const,
  statsOverview: ["stats", "overview"] as const,
  coverageCities: ["coverage", "cities"] as const,
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
    status: collapseCustomerBookingStatus(b.status),
    createdAt: now,
    updatedAt: now,
    backendStatus: b.status,
    imageKey: b.serviceIcon ?? undefined,
    serviceColor: "#7C3AED",
    proName: b.providerName ?? (b.status === "pending" ? "Matching a pro" : "Assigned Pro"),
    instructions: b.description ?? undefined,
    paymentStatus: b.paymentStatus,
    timeline: customerTimelineFromBackendStatus(b.status, now),
  };
}

export function useStatsOverview(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.statsOverview,
    queryFn: () => coreApi.stats.overview(),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useCoverageCities(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.coverageCities,
    queryFn: () => coreApi.coverage.cities(),
    staleTime: 5 * 60_000,
    enabled: opts?.enabled ?? true,
  });
}

/** Full hyperlocal detail for one city — areas, pincodes, societies, services. */
export function useCityCoverage(slug: string | null) {
  return useQuery({
    queryKey: ["coverage", "city", slug ?? ""] as const,
    queryFn: () => coreApi.coverage.cityDetail(slug!),
    staleTime: 2 * 60_000,
    enabled: Boolean(slug),
  });
}

/** Debounced hyperlocal search — society / area / pincode (same endpoint as web). */
export function useCoverageSearch(rawQuery: string) {
  const [query, setQuery] = useState(rawQuery);

  useEffect(() => {
    const id = setTimeout(() => setQuery(rawQuery.trim()), 250);
    return () => clearTimeout(id);
  }, [rawQuery]);

  const result = useQuery({
    queryKey: ["coverage", "search", query] as const,
    queryFn: () => coreApi.coverage.search(query),
    staleTime: 60_000,
    enabled: query.length >= 2,
    placeholderData: keepPreviousData,
  });

  return { ...result, debouncedQuery: query };
}

/**
 * The bookable slots for one service and one day, as decided by the server (Wave 4).
 *
 * Kept briefly fresh because capacity is shared: a slot someone else takes should stop being
 * offered quickly.
 */
export function useAvailabilityQuery(params: {
  serviceId: string | null | undefined;
  date: string | null | undefined;
  providerId?: string | null;
  /** Rescheduling: the booking being moved (it must not block its own new time). */
  excludeBookingId?: string | null;
}) {
  return useQuery({
    queryKey: [
      "bookings",
      "availability",
      params.serviceId,
      params.date,
      params.providerId ?? null,
      params.excludeBookingId ?? null,
    ],
    queryFn: () =>
      parityApi.bookings.availability({
        serviceId: params.serviceId!,
        date: params.date!,
        providerId: params.providerId ?? undefined,
        excludeBookingId: params.excludeBookingId ?? undefined,
      }),
    enabled: !!params.serviceId && !!params.date,
    staleTime: 30_000,
  });
}

export function useServicesQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.services,
    queryFn: () => coreApi.services.list(""),
    staleTime: 60_000,
    enabled: opts?.enabled ?? true,
  });
}

/** One service by id — for a request that is not in the loaded catalogue page. */
export function useServiceDetailQuery(id: string | null, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.serviceDetail(id ?? ""),
    queryFn: () => coreApi.services.details(id!),
    staleTime: 60_000,
    retry: 1,
    enabled: Boolean(id) && (opts?.enabled ?? true),
  });
}

/** Reviews customers left for this service. Empty until a real rating exists; never a placeholder. */
export function useServiceReviewsQuery(id: string | null) {
  return useQuery({
    queryKey: [...qk.serviceDetail(id ?? ""), "reviews"] as const,
    queryFn: () => coreApi.services.reviews(id!),
    staleTime: 5 * 60_000,
    retry: 1,
    enabled: Boolean(id),
  });
}

export function useFeaturedServicesQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.featured,
    queryFn: () => coreApi.services.featured(),
    staleTime: 2 * 60_000,
    enabled: opts?.enabled ?? true,
  });
}

export function useProvidersQuery(
  serviceId: string,
  coordsOrOpts?: DeviceCoordinates | { enabled?: boolean },
  maybeOpts?: { enabled?: boolean },
) {
  const coords = coordsOrOpts && "latitude" in coordsOrOpts ? coordsOrOpts : undefined;
  const opts = coordsOrOpts && "enabled" in coordsOrOpts ? coordsOrOpts : maybeOpts;
  // No real location → no "near you" search (never a default city).
  const resolved = coords ?? getCachedDeviceCoordinates();
  return useQuery({
    queryKey: [...qk.providers, serviceId, resolved?.latitude ?? null, resolved?.longitude ?? null],
    queryFn: () =>
      coreApi.providers.search({
        serviceId,
        latitude: resolved!.latitude,
        longitude: resolved!.longitude,
        radius: 10,
        page: 1,
        limit: 8,
      }),
    enabled: (opts?.enabled ?? true) && !!serviceId && resolved != null,
    staleTime: 30_000,
  });
}

export function useMatchedProvidersQuery(
  serviceId: string,
  enabled = true,
  coords?: DeviceCoordinates,
  scheduledDate?: string,
) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const resolved = coords ?? getCachedDeviceCoordinates();
  return useQuery({
    queryKey: [...qk.providers, "match", serviceId, resolved?.latitude ?? null, resolved?.longitude ?? null, scheduledDate ?? ""],
    queryFn: () =>
      coreApi.providers.match({
        serviceId,
        latitude: resolved!.latitude,
        longitude: resolved!.longitude,
        scheduledDate: scheduledDate ?? new Date().toISOString(),
        maxResults: 10,
        maxDistanceKm: 25,
      }),
    staleTime: 30_000,
    enabled: !!serviceId && isAuthenticated && enabled && resolved != null,
  });
}

export function useBookingsQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  const syncServerBookings = useAppStore((s) => s.syncServerBookings);
  const query = useQuery({
    queryKey: qk.bookings,
    queryFn: () => coreApi.bookings.listMine("?status=all&limit=20&page=1"),
    staleTime: 15_000,
    // Inherits the client's status-aware retry policy (no retry on a settled 4xx).
    enabled: isAuthenticated,
    refetchInterval: (queryRef) => {
      const data = queryRef.state.data as { bookings?: BackendBooking[] } | undefined;
      // Every non-terminal backend status keeps the safety-net poll alive (assigned / en_route
      // were missing, so polling stopped while the partner was travelling).
      const hasActive = (data?.bookings ?? []).some((b) =>
        ["pending", "accepted", "assigned", "en_route", "in_progress"].includes(b.status),
      );
      return hasActive ? 8_000 : false;
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
      addBooking(mapBackendBookingToSaved(data.booking));
      return data.booking;
    },
    enabled: !!bookingId,
    staleTime: 8_000,
    // Inherits the client's status-aware retry policy (no retry on a settled 4xx).
  });
}

export function useCreateBookingMutation() {
  const qc = useQueryClient();
  const addBooking = useAppStore((s) => s.addBooking);
  const showToast = useAppStore((s) => s.showToast);

  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const result = await offlineApiMutate<{ booking: BackendBooking }>({
        path: "/api/bookings",
        method: "POST",
        body: payload,
        auth: true,
      });
      if (result.queued) return { queued: true as const, queueId: result.queueId };
      return { queued: false as const, booking: result.data.booking };
    },
    onSuccess: (result) => {
      if (result.queued) {
        showToast("Booking saved — will confirm when you're back online");
        return;
      }
      if (result.booking) addBooking(mapBackendBookingToSaved(result.booking));
      void qc.invalidateQueries({ queryKey: qk.bookings });
      // PENDING = created, no partner has accepted yet. "Confirmed" is a promise the server has not made.
      showToast("Booking placed — finding your pro");
    },
    onError: (error) => showToast(getErrorMessage(error)),
  });
}

/**
 * Live refund/fee preview for cancelling a booking. Fetched only while the
 * confirm sheet is open so the customer sees the real number BEFORE deciding.
 */
/**
 * §45 / O6 — what moving this booking costs, before the customer commits.
 *
 * The number is the SERVER's. The client renders it and never derives the percentage itself; a
 * client that did would disagree with the server the moment the policy version changes.
 */
export function useRescheduleQuoteQuery(bookingId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["bookings", "reschedule-quote", bookingId ?? ""] as const,
    queryFn: () => coreApi.bookings.rescheduleQuote(bookingId!),
    enabled: Boolean(bookingId) && enabled,
    // Short: the fee flips from FREE to LATE_FEE as the two-hour boundary passes.
    staleTime: 30_000,
  });
}

export function useCancellationQuoteQuery(bookingId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ["bookings", "cancellation-quote", bookingId ?? ""] as const,
    queryFn: () => coreApi.bookings.cancellationQuote(bookingId!),
    enabled: Boolean(bookingId) && enabled,
    staleTime: 30_000,
  });
}

/**
 * §53 — the customer reporting that the professional never arrived.
 *
 * A separate mutation from cancel on purpose: different status, different money, different
 * consequences for the partner. Folding it into cancel would record the customer as the one who
 * called it off.
 */
export function useReportProviderNoShowMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (bookingId: string) => coreApi.bookings.reportProviderNoShow(bookingId),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: qk.bookings });
      const refund = data?.refundAmount ?? 0;
      showToast(
        refund > 0
          ? `Reported. ₹${refund} is being returned in full — you have not been charged.`
          : "Reported. You have not been charged.",
      );
    },
    onError: () => showToast("Could not report this. Please try again."),
  });
}

export function useCancelBookingMutation() {
  const qc = useQueryClient();
  const updateBookingStatus = useAppStore((s) => s.updateBookingStatus);
  const getBookingById = useAppStore((s) => s.getBookingById);
  const showToast = useAppStore((s) => s.showToast);

  return useMutation({
    mutationFn: async (bookingId: string) => {
      const result = await offlineApiMutate<{ booking: BackendBooking }>({
        path: `/api/bookings/${bookingId}/cancel`,
        method: "POST",
        body: { reason: "Cancelled by user", cancelledBy: "user" },
        auth: true,
      });
      if (result.queued) return { queued: true as const, bookingId };
      return { queued: false as const, booking: result.data.booking };
    },
    onMutate: async (bookingId) => {
      const prevBooking = getBookingById(bookingId);
      updateBookingStatus(bookingId, "cancelled");
      return { prevBooking };
    },
    onSuccess: (result) => {
      if (result.queued) {
        showToast("Cancellation queued — will sync when online");
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.bookings });
      showToast("Booking cancelled");
    },
    onError: (error, bookingId, ctx) => {
      if (ctx?.prevBooking) updateBookingStatus(bookingId, ctx.prevBooking.status);
      showToast(getErrorMessage(error));
    },
  });
}

export function useAddressesQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: qk.addresses,
    queryFn: () => coreApi.users.addresses(),
    staleTime: 60_000,
    enabled: isAuthenticated,
  });
}

export function useCreateAddressMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const result = await offlineApiMutate<{ address: BackendAddress }>({
        path: "/api/users/addresses",
        method: "POST",
        body: payload,
        auth: true,
      });
      if (result.queued) return { queued: true as const, queueId: result.queueId };
      return { queued: false as const, address: result.data.address };
    },
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: qk.addresses });
      showToast(result.queued ? "Address saved — will sync when online" : "Address added");
    },
    onError: (error) => showToast(getErrorMessage(error)),
  });
}

export function useWalletBalanceQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: qk.walletBalance,
    queryFn: () => coreApi.wallet.balance(),
    staleTime: 20_000,
    enabled: isAuthenticated,
  });
}

export function useWalletTransactionsQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: qk.walletTx,
    queryFn: () => coreApi.wallet.transactions("?limit=20&page=1"),
    staleTime: 20_000,
    enabled: isAuthenticated,
  });
}

export function useWalletOffersQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: qk.walletOffers,
    queryFn: () => coreApi.wallet.offers(),
    staleTime: 60_000,
    enabled: isAuthenticated,
  });
}

export function useAddMoneyMutation() {
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: (amount: number) => coreApi.wallet.addMoney(amount),
    onError: (error) => showToast(getErrorMessage(error)),
  });
}

export function useNotificationsQuery(options?: { enabled?: boolean }) {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: qk.notifications,
    queryFn: () => coreApi.notifications.list("?limit=20&page=1"),
    staleTime: 10_000,
    enabled: isAuthenticated && (options?.enabled ?? true),
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

export function upsertNotificationInCache(
  queryClient: QueryClient,
  incoming: BackendNotification,
) {
  const prev = queryClient.getQueryData<{
    notifications: BackendNotification[];
    unreadCount?: number;
  }>(qk.notifications);
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
  queryClient: QueryClient,
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
    // Offline-aware: if the device is offline the mark-read is queued and replayed on reconnect
    // (idempotent — safe to retry). See lib/offline.
    mutationFn: (id: string) =>
      mutateWithOfflineFallback({ path: `/api/notifications/${id}/read`, method: "PUT", auth: true }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

export function useMarkAllNotificationsReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    // One server-side statement — the old per-id loop only covered the loaded
    // page, so older unread rows kept the badge lit forever.
    mutationFn: () =>
      mutateWithOfflineFallback({ path: "/api/notifications/read-all", method: "PUT", auth: true }),
    onSettled: () => void qc.invalidateQueries({ queryKey: qk.notifications }),
  });
}

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
  });
}

export function useSubmitRatingMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: async (payload: Parameters<typeof coreApi.ratings.submit>[0]) => {
      const result = await offlineApiMutate<{ rating: BackendRating }>({
        path: "/api/ratings",
        method: "POST",
        body: payload,
        auth: true,
      });
      if (result.queued) return { queued: true as const, bookingId: payload.bookingId };
      return { queued: false as const, rating: result.data.rating };
    },
    onSuccess: (result, variables) => {
      if (result.queued) {
        showToast("Review saved — will submit when online");
        return;
      }
      void qc.invalidateQueries({ queryKey: qk.ratings });
      void qc.invalidateQueries({ queryKey: qk.bookings });
      void qc.invalidateQueries({ queryKey: qk.bookingDetail(variables.bookingId) });
      showToast("Thanks for your review!");
    },
    onError: (error) => showToast(getErrorMessage(error)),
  });
}

export function useCreatePaymentOrderMutation() {
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ bookingId, amount }: { bookingId: string; amount?: number }) =>
      coreApi.payments.createOrder(bookingId, amount),
    onError: (error) => showToast(getErrorMessage(error)),
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
        if (error instanceof AuthApiError && (error.code === "ALREADY_SETTLED" || error.status === 409)) {
          return { paymentId: "", status: "already_settled", bookingId: "" };
        }
        throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.bookings });
      void qc.invalidateQueries({ queryKey: qk.walletBalance });
      showToast("Payment verified successfully");
    },
    onError: (error) => showToast(getErrorMessage(error)),
  });
}

export function usePaymentsHistoryQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: qk.payments,
    queryFn: () => coreApi.payments.history("?limit=20&page=1"),
    staleTime: 20_000,
    enabled: isAuthenticated,
  });
}

export function useRefundPaymentMutation() {
  const qc = useQueryClient();
  const showToast = useAppStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({
      paymentId,
      reason,
      amount,
    }: {
      paymentId: string;
      reason: string;
      amount: number;
    }) => coreApi.payments.refund(paymentId, { reason, amount }),
    onSuccess: (data: { refund: BackendRefund }) => {
      void qc.invalidateQueries({ queryKey: qk.payments });
      void qc.invalidateQueries({ queryKey: qk.walletBalance });
      void qc.invalidateQueries({ queryKey: qk.walletTx });
      void qc.invalidateQueries({ queryKey: qk.bookings });
      showToast(data.refund.status === "processed" ? "Refund processed" : "Refund request submitted");
    },
    onError: (error) => showToast(getErrorMessage(error)),
  });
}

export function useProviderDetailQuery(providerId?: string) {
  return useQuery({
    queryKey: providerId ? qk.providerDetail(providerId) : ["providers", "detail", "none"],
    queryFn: () => coreApi.providers.details(providerId!),
    enabled: !!providerId,
    staleTime: 60_000,
  });
}

export function useProviderReviewsQuery(providerId?: string, query = "?limit=20&page=1") {
  return useQuery({
    queryKey: providerId ? [...qk.providerReviews(providerId), query] : ["providers", "reviews", "none"],
    queryFn: () => coreApi.providers.reviews(providerId!, query),
    enabled: !!providerId,
    staleTime: 30_000,
  });
}

export function useUserRatingsQuery() {
  const isAuthenticated = useAuthStore((s) => s.status === "authenticated");
  return useQuery({
    queryKey: qk.ratings,
    queryFn: () => coreApi.users.ratings("?limit=20&page=1"),
    staleTime: 30_000,
    enabled: isAuthenticated,
  });
}
