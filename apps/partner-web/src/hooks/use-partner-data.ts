"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { getErrorMessage, PartnerApiError } from "@/lib/api-error";
import { usePartnerStore } from "@/stores/partner-store";
import { useToastStore } from "@/stores/toast-store";
import { publishBookingLifecycle } from "@/lib/ws-publish";
import type {
  PartnerBooking,
  PartnerBookingsResponse,
  ProviderProfile,
} from "@/types/partner";

export const partnerKeys = {
  me: ["partner", "me"] as const,
  dashboard: ["partner", "dashboard"] as const,
  operations: ["partner", "operations"] as const,
  earnings: (days: number) => ["partner", "earnings", days] as const,
  reviews: (params: ReviewListParams) => ["partner", "reviews", params] as const,
  reviewsAll: ["partner", "reviews"] as const,
  bookings: (params: BookingListParams) => ["partner", "bookings", params] as const,
  bookingsAll: ["partner", "bookings"] as const,
  walletBalance: ["partner", "wallet", "balance"] as const,
  walletTx: (params: WalletTxParams) => ["partner", "wallet", "tx", params] as const,
  walletTxAll: ["partner", "wallet", "tx"] as const,
  payouts: ["partner", "payouts"] as const,
  invoices: ["partner", "invoices"] as const,
  notifications: (params: NotificationListParams) =>
    ["partner", "notifications", params] as const,
  notificationsAll: ["partner", "notifications"] as const,
  membership: ["partner", "membership"] as const,
  plans: ["partner", "membership", "plans"] as const,
  entitlements: ["partner", "membership", "entitlements"] as const,
};

export type BookingListParams = {
  page?: number;
  limit?: number;
  status?: string;
  sortBy?: "upcoming" | "recent";
};

export type ReviewListParams = {
  page?: number;
  limit?: number;
  rating?: number;
};

export type WalletTxParams = {
  page?: number;
  limit?: number;
};

export type NotificationListParams = {
  page?: number;
  limit?: number;
  type?: string;
  unreadOnly?: boolean;
};

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

function usePartnerQueriesEnabled() {
  const status = usePartnerStore((s) => s.status);
  const accessToken = usePartnerStore((s) => s.accessToken);
  return status === "authenticated" && Boolean(accessToken);
}

export function usePartnerMeQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.me,
    queryFn: () => partnerApi.me(),
    staleTime: 60_000,
    enabled,
  });
}

export function usePartnerDashboardQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.dashboard,
    queryFn: () => partnerApi.dashboard(),
    staleTime: 20_000,
    refetchInterval: enabled ? 30_000 : false,
    enabled,
  });
}

export function usePartnerOperationsQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.operations,
    queryFn: () => partnerApi.operations(),
    staleTime: 15_000,
    refetchInterval: enabled ? 30_000 : false,
    enabled,
  });
}

export function usePartnerEarningsQuery(days = 30) {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.earnings(days),
    queryFn: () => partnerApi.earnings(days),
    staleTime: 60_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export const ACTIVE_BOOKINGS_PARAMS = {
  page: 1,
  limit: 20,
  status: "active",
  sortBy: "upcoming",
} as const satisfies BookingListParams;

export function usePartnerActiveBookingsQuery() {
  return usePartnerBookingsQuery(ACTIVE_BOOKINGS_PARAMS);
}

export function usePartnerBookingsQuery(params: BookingListParams) {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.bookings(params),
    queryFn: () => partnerApi.listBookings(params),
    staleTime: 5_000,
    enabled,
    refetchInterval: (queryRef) => {
      if (!enabled) return false;
      // Always poll the pending tab — new dispatches must appear without a manual refresh.
      if (params.status === "pending") return 10_000;
      const data = queryRef.state.data as PartnerBookingsResponse | undefined;
      const hasActive = (data?.bookings ?? []).some((b) =>
        ["accepted", "assigned", "en_route", "in_progress"].includes(b.status),
      );
      return hasActive ? 15_000 : false;
    },
    placeholderData: (prev) => prev,
  });
}

export function usePartnerReviewsQuery(params: ReviewListParams) {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.reviews(params),
    queryFn: () => partnerApi.reviews(params),
    staleTime: 60_000,
    enabled,
    placeholderData: (prev) => prev,
  });
}

export function useWalletBalanceQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.walletBalance,
    queryFn: () => partnerApi.walletBalance(),
    staleTime: 20_000,
    enabled,
  });
}

export function useWalletTransactionsQuery(params: WalletTxParams) {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.walletTx(params),
    queryFn: () => partnerApi.walletTransactions(params),
    staleTime: 30_000,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function usePartnerPayoutsQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.payouts,
    queryFn: () => partnerApi.payouts(),
    staleTime: 30_000,
    enabled,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function usePartnerInvoicesQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.invoices,
    queryFn: () => partnerApi.invoices(),
    staleTime: 60_000,
    enabled,
  });
}

export function usePartnerNotificationsQuery(params: NotificationListParams = {}) {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.notifications(params),
    queryFn: () => partnerApi.notifications.list(params),
    staleTime: 15_000,
    enabled,
    refetchInterval: enabled ? 15_000 : false,
    placeholderData: (prev) => prev,
  });
}

export function usePartnerMembershipQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.membership,
    queryFn: () => partnerApi.subscriptions.mine(),
    staleTime: 60_000,
    enabled,
  });
}

export function usePartnerPlansQuery() {
  return useQuery({
    queryKey: partnerKeys.plans,
    queryFn: () => partnerApi.subscriptions.plans(),
    staleTime: 120_000,
  });
}

export function usePartnerEntitlementsQuery() {
  const enabled = usePartnerQueriesEnabled();
  return useQuery({
    queryKey: partnerKeys.entitlements,
    queryFn: () => partnerApi.subscriptions.entitlements(),
    staleTime: 60_000,
    enabled,
  });
}

/* ------------------------------------------------------------------ */
/* Mutations — booking lifecycle (optimistic where safe)               */
/* ------------------------------------------------------------------ */

function patchBookingsCache(
  qc: ReturnType<typeof useQueryClient>,
  bookingId: string,
  patch: Partial<PartnerBooking>,
) {
  const snapshots = qc.getQueriesData<PartnerBookingsResponse>({
    queryKey: partnerKeys.bookingsAll,
  });
  for (const [key, prev] of snapshots) {
    if (!prev?.bookings) continue;
    qc.setQueryData<PartnerBookingsResponse>(key, {
      ...prev,
      bookings: prev.bookings.map((b) =>
        b.id === bookingId ? { ...b, ...patch } : b,
      ),
    });
  }
  return snapshots;
}

function restoreSnapshots(
  qc: ReturnType<typeof useQueryClient>,
  snapshots: ReturnType<typeof qc.getQueriesData>,
) {
  for (const [key, prev] of snapshots) {
    if (prev) qc.setQueryData(key, prev);
  }
}

function removeBookingFromCache(
  qc: ReturnType<typeof useQueryClient>,
  bookingId: string,
) {
  const snapshots = qc.getQueriesData<PartnerBookingsResponse>({
    queryKey: partnerKeys.bookingsAll,
  });
  for (const [key, prev] of snapshots) {
    if (!prev?.bookings) continue;
    qc.setQueryData<PartnerBookingsResponse>(key, {
      ...prev,
      bookings: prev.bookings.filter((b) => b.id !== bookingId),
      total: Math.max(0, (prev.total ?? prev.bookings.length) - 1),
    });
  }
}

function findBookingInCache(
  qc: ReturnType<typeof useQueryClient>,
  bookingId: string,
): PartnerBooking | undefined {
  for (const [, prev] of qc.getQueriesData<PartnerBookingsResponse>({
    queryKey: partnerKeys.bookingsAll,
  })) {
    const hit = prev?.bookings?.find((b) => b.id === bookingId);
    if (hit) return hit;
  }
  return undefined;
}

function removeBookingFromStatusCache(
  qc: ReturnType<typeof useQueryClient>,
  bookingId: string,
  status: string,
) {
  for (const [key, prev] of qc.getQueriesData<PartnerBookingsResponse>({
    queryKey: partnerKeys.bookingsAll,
  })) {
    if (!prev?.bookings) continue;
    const params = key[2] as BookingListParams | undefined;
    if (params?.status !== status) continue;
    const next = prev.bookings.filter((b) => b.id !== bookingId);
    if (next.length === prev.bookings.length) continue;
    qc.setQueryData<PartnerBookingsResponse>(key, {
      ...prev,
      bookings: next,
      total: Math.max(0, (prev.total ?? prev.bookings.length) - 1),
    });
  }
}

function prependBookingToStatusCache(
  qc: ReturnType<typeof useQueryClient>,
  booking: PartnerBooking,
  status: string,
) {
  for (const [key, prev] of qc.getQueriesData<PartnerBookingsResponse>({
    queryKey: partnerKeys.bookingsAll,
  })) {
    const params = key[2] as BookingListParams | undefined;
    if (params?.status !== status || !prev) continue;
    if (prev.bookings.some((b) => b.id === booking.id)) {
      patchBookingsCache(qc, booking.id, booking);
      return;
    }
    qc.setQueryData<PartnerBookingsResponse>(key, {
      ...prev,
      bookings: [booking, ...prev.bookings],
      total: (prev.total ?? prev.bookings.length) + 1,
    });
  }
}

export function useAcceptBookingMutation(opts?: { onAccepted?: () => void }) {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ bookingId, eta }: { bookingId: string; eta?: number }) =>
      partnerApi.acceptBooking(bookingId, eta),
    onMutate: async ({ bookingId }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = qc.getQueriesData<PartnerBookingsResponse>({
        queryKey: partnerKeys.bookingsAll,
      });
      const existing = findBookingInCache(qc, bookingId);
      removeBookingFromStatusCache(qc, bookingId, "pending");
      if (existing) {
        prependBookingToStatusCache(qc, { ...existing, status: "accepted" }, "active");
      }
      return { snapshots };
    },
    onError: (error, { bookingId }, ctx) => {
      if (ctx?.snapshots) restoreSnapshots(qc, ctx.snapshots);
      if (error instanceof PartnerApiError) {
        if (
          error.code === "NOT_FOUND" ||
          error.code === "ALREADY_CLAIMED" ||
          error.code === "INVALID_STATUS"
        ) {
          removeBookingFromStatusCache(qc, bookingId, "pending");
        }
        if (error.code === "NOT_FOUND") {
          removeBookingFromCache(qc, bookingId);
        }
        if (error.code === "ALREADY_CLAIMED") {
          showToast("Another professional already accepted this job", "info");
          return;
        }
        if (error.code === "INVALID_STATUS") {
          showToast("This job is no longer available", "info");
          return;
        }
      }
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: (data, { bookingId }) => {
      showToast(
        data?.newlyAccepted === false ? "Job already in Active" : "Job accepted — moved to Active",
        "success",
      );
      opts?.onAccepted?.();
      void publishBookingLifecycle(bookingId, { type: "accept_booking" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
    },
  });
}

export function useRejectBookingMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) =>
      partnerApi.rejectBooking(bookingId, reason),
    onMutate: async ({ bookingId }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = qc.getQueriesData<PartnerBookingsResponse>({
        queryKey: partnerKeys.bookingsAll,
      });
      removeBookingFromStatusCache(qc, bookingId, "pending");
      return { snapshots };
    },
    onError: (error, { bookingId }, ctx) => {
      if (ctx?.snapshots) restoreSnapshots(qc, ctx.snapshots);
      if (error instanceof PartnerApiError && error.code === "NOT_FOUND") {
        removeBookingFromCache(qc, bookingId);
      }
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: (_data, { bookingId, reason }) => {
      showToast("Job declined", "info");
      void publishBookingLifecycle(bookingId, {
        type: "reject_booking",
        data: { reason },
      });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
    },
  });
}

export function useCancelBookingMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ bookingId, reason }: { bookingId: string; reason: string }) =>
      partnerApi.cancelBooking(bookingId, reason),
    onMutate: async ({ bookingId }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = qc.getQueriesData<PartnerBookingsResponse>({
        queryKey: partnerKeys.bookingsAll,
      });
      removeBookingFromStatusCache(qc, bookingId, "active");
      return { snapshots };
    },
    onError: (error, { bookingId }, ctx) => {
      if (ctx?.snapshots) restoreSnapshots(qc, ctx.snapshots);
      if (error instanceof PartnerApiError && error.code === "NOT_FOUND") {
        removeBookingFromCache(qc, bookingId);
      }
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: () => {
      showToast("Job cancelled — customer will receive a full refund", "success");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
    },
  });
}

/**
 * Declares departure. The server owns the timestamp — the client never computes one, so
 * a wrong device clock cannot corrupt an ETA training label.
 *
 * Optimistically flips the card to `en_route`; the server's idempotent response means a
 * double tap or a retry after a dropped connection is harmless.
 */
export function useMarkEnRouteMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({
      bookingId,
      latitude,
      longitude,
    }: {
      bookingId: string;
      latitude: number;
      longitude: number;
    }) => partnerApi.markEnRoute(bookingId, latitude, longitude),
    onMutate: async ({ bookingId }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = patchBookingsCache(qc, bookingId, { status: "en_route" });
      return { snapshots };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.snapshots) restoreSnapshots(qc, ctx.snapshots);
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: (data) => {
      showToast(data.newlyTransitioned ? "On your way" : "Already marked en route", "success");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
    },
  });
}

/** Declares arrival. Server-owned timestamp, idempotent, safe to retry. */
export function useMarkArrivedMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({
      bookingId,
      latitude,
      longitude,
    }: {
      bookingId: string;
      latitude: number;
      longitude: number;
    }) => partnerApi.markArrived(bookingId, latitude, longitude),
    onError: (error) => {
      const msg =
        error instanceof PartnerApiError && error.code === "OUTSIDE_SERVICE_AREA"
          ? "You're outside the job area — move closer to the service location and try again."
          : getErrorMessage(error);
      showToast(msg, "error");
    },
    onSuccess: (data) => {
      showToast(data.newlyTransitioned ? "Arrival recorded" : "Arrival already recorded", "success");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
    },
  });
}

/**
 * Sends the service-start PIN to the customer. No optimistic cache patching —
 * this only triggers a notification/email/SMS on the customer's side.
 */
export function useRequestStartOtpMutation() {
  return useMutation({
    mutationFn: ({ bookingId }: { bookingId: string }) =>
      partnerApi.requestStartOtp(bookingId),
  });
}

export function useStartBookingMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({
      bookingId,
      latitude,
      longitude,
      otp,
    }: {
      bookingId: string;
      latitude: number;
      longitude: number;
      otp?: string;
    }) => partnerApi.startBooking(bookingId, latitude, longitude, otp),
    onMutate: async ({ bookingId }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = patchBookingsCache(qc, bookingId, { status: "in_progress" });
      return { snapshots };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.snapshots) restoreSnapshots(qc, ctx.snapshots);
      const msg =
        error instanceof PartnerApiError && error.code === "OUTSIDE_SERVICE_AREA"
          ? "You're outside the job area — move closer to the service location and try again."
          : getErrorMessage(error);
      showToast(msg, "error");
    },
    onSuccess: (_data, { bookingId }) => {
      showToast("Job started", "success");
      // Backend message-type contract is "start_service" — mapped from the
      // user-facing "start booking" action. See apps/backend/src/websocket/booking.ws.ts.
      void publishBookingLifecycle(bookingId, { type: "start_service" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
    },
  });
}

export function useCompleteBookingMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({
      bookingId,
      latitude,
      longitude,
      notes,
      photos,
    }: {
      bookingId: string;
      latitude: number;
      longitude: number;
      notes?: string;
      photos?: string[];
    }) => partnerApi.completeBooking(bookingId, latitude, longitude, notes, photos),
    onMutate: async ({ bookingId }) => {
      await qc.cancelQueries({ queryKey: partnerKeys.bookingsAll });
      const snapshots = patchBookingsCache(qc, bookingId, {
        status: "completed",
        completedAt: new Date().toISOString(),
      });
      return { snapshots };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.snapshots) restoreSnapshots(qc, ctx.snapshots);
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: (_data, { bookingId }) => {
      showToast("Job completed", "success");
      void publishBookingLifecycle(bookingId, { type: "complete_booking" });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
      void qc.invalidateQueries({ queryKey: partnerKeys.walletBalance });
      void qc.invalidateQueries({ queryKey: partnerKeys.walletTxAll });
    },
  });
}

/* ------------------------------------------------------------------ */
/* Mutations — provider online + withdraw + rating respond             */
/* ------------------------------------------------------------------ */

export function useSetOnlineMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: (online: boolean) => partnerApi.setOnline(online),
    onMutate: async (online) => {
      await qc.cancelQueries({ queryKey: partnerKeys.me });
      const prev = qc.getQueryData<ProviderProfile>(partnerKeys.me);
      if (prev) {
        qc.setQueryData<ProviderProfile>(partnerKeys.me, {
          ...prev,
          isOnline: online,
          onlineSince: online ? new Date().toISOString() : null,
        });
      }
      return { prev };
    },
    onError: (error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(partnerKeys.me, ctx.prev);
      showToast(getErrorMessage(error), "error");
    },
    onSuccess: (data) => {
      showToast(data.isOnline ? "You are now online" : "You are offline", "success");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.me });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
      void qc.invalidateQueries({ queryKey: partnerKeys.operations });
    },
  });
}

export function useWithdrawMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: (payload: {
      amount: number;
      bankAccountNumber: string;
      ifscCode: string;
      accountHolder: string;
      idempotencyKey?: string;
    }) => partnerApi.withdraw(payload),
    onSuccess: () => {
      showToast("Withdrawal requested", "success");
      void qc.invalidateQueries({ queryKey: partnerKeys.walletBalance });
      void qc.invalidateQueries({ queryKey: partnerKeys.walletTxAll });
      void qc.invalidateQueries({ queryKey: partnerKeys.payouts });
      void qc.invalidateQueries({ queryKey: partnerKeys.invoices });
      void qc.invalidateQueries({ queryKey: partnerKeys.me });
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useRespondToRatingMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: ({ ratingId, response }: { ratingId: string; response: string }) =>
      partnerApi.respondToRating(ratingId, response),
    onSuccess: () => {
      showToast("Reply posted", "success");
      void qc.invalidateQueries({ queryKey: partnerKeys.reviewsAll });
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useMarkNotificationReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => partnerApi.notifications.markRead(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.notificationsAll });
    },
  });
}

export function useMarkAllNotificationsReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => partnerApi.notifications.markAllRead(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.notificationsAll });
    },
  });
}

export function useDeleteNotificationMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: (id: string) => partnerApi.notifications.remove(id),
    onSuccess: () => showToast("Notification removed", "info"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: partnerKeys.notificationsAll });
    },
  });
}

export function useUpdateProfileMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: (body: { firstName?: string; lastName?: string; bio?: string }) =>
      partnerApi.updateProfile(body),
    onSuccess: () => {
      showToast("Profile updated", "success");
      void qc.invalidateQueries({ queryKey: partnerKeys.me });
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}

export function useCancelMembershipMutation() {
  const qc = useQueryClient();
  const showToast = useToastStore((s) => s.showToast);
  return useMutation({
    mutationFn: () => partnerApi.subscriptions.cancel(),
    onSuccess: () => {
      showToast("Auto-renew cancelled", "success");
      void qc.invalidateQueries({ queryKey: partnerKeys.membership });
      void qc.invalidateQueries({ queryKey: partnerKeys.entitlements });
    },
    onError: (error) => showToast(getErrorMessage(error), "error"),
  });
}
