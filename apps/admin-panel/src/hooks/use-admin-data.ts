"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { adminApi, type ServiceInput, type AdminPlanInput } from "@/services/admin-api";
import type {
  AdminCustomer,
  AdminListBookingsResponse,
  AdminListCustomersResponse,
  AdminListProvidersResponse,
  AdminProvider,
  BanAction,
  VerifyAction,
} from "@/types/admin";
import {
  BOOKINGS_LIST_POLL_MS,
  DASHBOARD_POLL_MS,
  OPS_MAP_POLL_MS,
  TOPBAR_BADGE_STALE_MS,
} from "@/lib/query-polling";

export const adminKeys = {
  dashboard: ["admin", "dashboard"] as const,
  notifications: ["admin", "notifications"] as const,
  reviews: (params: Record<string, unknown>) => ["admin", "reviews", params] as const,
  reviewsAll: ["admin", "reviews"] as const,
  customers: (params: AdminListParams) => ["admin", "customers", params] as const,
  customersAll: ["admin", "customers"] as const,
  providers: (params: AdminListParams) => ["admin", "providers", params] as const,
  providersAll: ["admin", "providers"] as const,
  bookings: (params: AdminBookingsParams) => ["admin", "bookings", params] as const,
  bookingsAll: ["admin", "bookings"] as const,
  analytics: (range: { startDate?: string; endDate?: string }) =>
    ["admin", "analytics", range] as const,
  services: (params: AdminListParams) => ["admin", "services", params] as const,
  servicesAll: ["admin", "services"] as const,
  opsMap: ["admin", "ops-map"] as const,
};

export type AdminListParams = {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
  kyc?: string;
  sort?: string;
  /** Top-bar badge counts — long cache, WS-invalidated. */
  badge?: boolean;
};

export type AdminBookingsParams = AdminListParams & {
  startDate?: string;
  endDate?: string;
  /** When false, disables background polling (overview widgets). Default true. */
  poll?: boolean;
};

/* ------------------------------------------------------------------------- */
/* Queries                                                                    */
/* ------------------------------------------------------------------------- */

export function useAdminDashboardQuery() {
  return useQuery({
    queryKey: adminKeys.dashboard,
    queryFn: () => adminApi.dashboard(),
    staleTime: 60_000,
    refetchInterval: DASHBOARD_POLL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useAdminOpsMapQuery(refetchInterval = OPS_MAP_POLL_MS) {
  return useQuery({
    queryKey: adminKeys.opsMap,
    queryFn: () => adminApi.opsMap(),
    staleTime: 30_000,
    refetchInterval,
    refetchIntervalInBackground: false,
  });
}

export function useAdminCustomersQuery(params: AdminListParams) {
  return useQuery({
    queryKey: adminKeys.customers(params),
    queryFn: () => adminApi.listUsers(params),
    staleTime: params.badge ? TOPBAR_BADGE_STALE_MS : 20_000,
    refetchInterval: false,
    placeholderData: (prev) => prev,
  });
}

export function useAdminReviewsQuery(params: {
  page: number;
  limit: number;
  status?: string;
  rating?: string;
  search?: string;
}) {
  const query: Record<string, string | number> = { page: params.page, limit: params.limit };
  if (params.status && params.status !== "all") query.status = params.status;
  if (params.rating && params.rating !== "all") query.rating = params.rating;
  if (params.search?.trim()) query.search = params.search.trim();
  return useQuery({
    queryKey: adminKeys.reviews(params),
    queryFn: () => adminApi.reviews.list(query),
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });
}

export function useModerateReviewMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: { isPublic?: boolean; isFlagged?: boolean } }) =>
      adminApi.reviews.moderate(id, patch),
    onSettled: () => void qc.invalidateQueries({ queryKey: adminKeys.reviewsAll }),
  });
}

export function useDeleteReviewMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.reviews.remove(id),
    onSettled: () => void qc.invalidateQueries({ queryKey: adminKeys.reviewsAll }),
  });
}

export function useAdminNotificationsQuery() {
  return useQuery({
    queryKey: adminKeys.notifications,
    queryFn: () => adminApi.notifications.list(8),
    staleTime: TOPBAR_BADGE_STALE_MS,
    refetchInterval: false,
    placeholderData: (prev) => prev,
  });
}

export function useMarkAllAdminNotificationsReadMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => adminApi.notifications.markAllRead(),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.notifications });
    },
  });
}

export function useAdminProvidersQuery(params: AdminListParams) {
  return useQuery({
    queryKey: adminKeys.providers(params),
    queryFn: () => adminApi.listProviders(params),
    staleTime: params.badge ? TOPBAR_BADGE_STALE_MS : 20_000,
    refetchInterval: false,
    placeholderData: (prev) => prev,
  });
}

export function useAdminBookingsQuery(params: AdminBookingsParams) {
  const poll = params.poll !== false;
  return useQuery({
    queryKey: adminKeys.bookings(params),
    queryFn: () => adminApi.listBookings(params),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
    refetchInterval: poll ? BOOKINGS_LIST_POLL_MS : false,
    refetchIntervalInBackground: false,
    notifyOnChangeProps: ["data", "error", "isLoading", "isPending"],
  });
}

export function useAdminAnalyticsQuery(range: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: adminKeys.analytics(range),
    queryFn: () => adminApi.analytics(range),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });
}

/* ------------------------------------------------------------------------- */
/* Mutations — optimistic where it matters (verify, ban)                      */
/* ------------------------------------------------------------------------- */

type VerifyVars = { providerId: string; action: VerifyAction; notes?: string };

export function useVerifyProviderMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: VerifyVars) =>
      adminApi.verifyProvider(vars.providerId, vars.action, vars.notes),
    onMutate: async ({ providerId, action }) => {
      await qc.cancelQueries({ queryKey: adminKeys.providersAll });
      const snapshots = qc.getQueriesData<AdminListProvidersResponse>({
        queryKey: adminKeys.providersAll,
      });
      for (const [key, prev] of snapshots) {
        if (!prev?.providers) continue;
        qc.setQueryData<AdminListProvidersResponse>(key, {
          ...prev,
          providers: prev.providers.map((p: AdminProvider) =>
            p.id === providerId
              ? {
                  ...p,
                  isApproved: action === "approve",
                  isVerified: action === "approve",
                }
              : p,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.snapshots) return;
      for (const [key, prev] of ctx.snapshots) {
        if (prev) qc.setQueryData(key, prev);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.providersAll });
      void qc.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

type BanVars = { userId: string; action: BanAction; reason?: string };

export function useBanUserMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: BanVars) => adminApi.banUser(vars.userId, vars.action, vars.reason),
    onMutate: async ({ userId, action }) => {
      await qc.cancelQueries({ queryKey: adminKeys.customersAll });
      const snapshots = qc.getQueriesData<AdminListCustomersResponse>({
        queryKey: adminKeys.customersAll,
      });
      for (const [key, prev] of snapshots) {
        if (!prev?.users) continue;
        qc.setQueryData<AdminListCustomersResponse>(key, {
          ...prev,
          users: prev.users.map((u: AdminCustomer) =>
            u.id === userId ? { ...u, isActive: action === "unban" } : u,
          ),
        });
      }
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      if (!ctx?.snapshots) return;
      for (const [key, prev] of ctx.snapshots) {
        if (prev) qc.setQueryData(key, prev);
      }
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.customersAll });
      void qc.invalidateQueries({ queryKey: adminKeys.bookingsAll });
      void qc.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

export function useProcessWithdrawalMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.processWithdrawal(id),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: adminKeys.dashboard });
    },
  });
}

/** Helper for tables that omit `AdminListBookingsResponse` shape narrowing */
export type AnyAdminList =
  | AdminListBookingsResponse
  | AdminListCustomersResponse
  | AdminListProvidersResponse;

/* ------------------------------------------------------------------------- */
/* Services management                                                        */
/* ------------------------------------------------------------------------- */

export function useAdminServicesQuery(params: AdminListParams) {
  return useQuery({
    queryKey: adminKeys.services(params),
    queryFn: () => adminApi.services.list(params),
    staleTime: 15_000,
  });
}

export function useCreateServiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ServiceInput) => adminApi.services.create(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.servicesAll }),
  });
}

export function useUpdateServiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: Partial<ServiceInput> }) =>
      adminApi.services.update(vars.id, vars.body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.servicesAll }),
  });
}

export function useSetServiceStatusMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; isActive: boolean }) =>
      adminApi.services.setStatus(vars.id, vars.isActive),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.servicesAll }),
  });
}

export function useDeleteServiceMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => adminApi.services.remove(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: adminKeys.servicesAll }),
  });
}

// ===== Subscriptions / Membership =====
const subKeys = {
  plans: ["admin", "sub", "plans"] as const,
  revenue: ["admin", "sub", "revenue"] as const,
  subscribers: (p: AdminListParams) => ["admin", "sub", "subscribers", p] as const,
};

export function useAdminPlansQuery() {
  return useQuery({ queryKey: subKeys.plans, queryFn: () => adminApi.subscriptions.listPlans() });
}

export function useAdminRevenueQuery() {
  return useQuery({ queryKey: subKeys.revenue, queryFn: () => adminApi.subscriptions.revenue() });
}

export function useAdminSubscribersQuery(params: AdminListParams) {
  return useQuery({
    queryKey: subKeys.subscribers(params),
    queryFn: () => adminApi.subscriptions.subscribers(params),
  });
}

export function useCreatePlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AdminPlanInput) => adminApi.subscriptions.createPlan(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "sub"] }),
  });
}

export function useUpdatePlanMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: Partial<AdminPlanInput> & { isActive?: boolean } }) =>
      adminApi.subscriptions.updatePlan(vars.id, vars.body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "sub"] }),
  });
}

export function useAdminReferralAnalyticsQuery() {
  return useQuery({
    queryKey: ["admin", "referrals", "analytics"],
    queryFn: () => adminApi.referrals.analytics(),
  });
}

export function useAdminHCoinAnalyticsQuery() {
  return useQuery({
    queryKey: ["admin", "hcoins", "analytics"],
    queryFn: () => adminApi.hcoins.analytics(),
  });
}

export function useUpdateHCoinRuleMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; body: { coins?: number; isActive?: boolean } }) =>
      adminApi.hcoins.updateRule(vars.id, vars.body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "hcoins"] }),
  });
}

export function useGrantHCoinMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; coins: number; note?: string }) =>
      adminApi.hcoins.grant(body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["admin", "hcoins"] }),
  });
}

export function useAdminTransfersQuery(params: AdminListParams) {
  return useQuery({
    queryKey: ["admin", "transfers", params],
    queryFn: () => adminApi.transfers.list(params),
    placeholderData: (prev) => prev,
  });
}

export function useAdminGiftCardsQuery(params: AdminListParams) {
  return useQuery({
    queryKey: ["admin", "giftcards", params],
    queryFn: () => adminApi.giftCards.list(params),
    placeholderData: (prev) => prev,
  });
}

export function useAdminInvoicesQuery(params: AdminListParams & { search?: string }) {
  return useQuery({
    queryKey: ["admin", "invoices", params],
    queryFn: () => adminApi.invoices.list(params),
    placeholderData: (prev) => prev,
  });
}

export function useAdminRevenueReportQuery() {
  return useQuery({ queryKey: ["admin", "revenue-report"], queryFn: () => adminApi.invoices.revenueReport() });
}
