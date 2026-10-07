import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";

/**
 * The reads behind the money, work and performance screens. One key means one query everywhere
 * (the keys are the ones the rest of the app already invalidates), and every hook is a plain
 * `useQuery` so a screen can tell loading, a refusal, no connection and "the server sent null" apart.
 *
 * Every hook waits for the restored session (`useSessionReady`), the same gate the account hooks
 * use (`useAuthed`): a deep link or a push tap can mount one of these screens before the session is
 * back, and a read made then is a 401 that sticks on the screen as an error.
 */

/** Key prefixes, for pull-to-refresh and invalidation. */
export const K = {
  provider: ["partner", "provider"],
  dashboard: ["partner", "dashboard"],
  operations: ["partner", "operations"],
  payouts: ["partner", "payouts"],
  withdrawals: ["partner", "withdrawals"],
  invoices: ["partner", "invoices"],
  earnings: ["partner", "earnings"],
  tax: ["partner", "tax"],
  forecast: ["partner", "forecast"],
  incentives: ["partner", "incentives"],
  attendance: ["partner", "attendance"],
  serviceHistory: ["partner", "service-history"],
  route: ["partner", "route"],
  bookings: ["partner", "bookings"],
  reviews: ["partner", "reviews"],
  score: ["partner", "score"],
  scoreHistory: ["partner", "score-history"],
  lifecycle: ["partner", "lifecycle"],
  career: ["partner", "career"],
  rankings: ["partner", "rankings"],
  intel: ["partner", "intel"],
  surge: ["partner", "surge"],
  density: ["partner", "density"],
  demand: ["partner", "geo-demand"],
} as const;

/** A deep link can mount a screen before the session is restored; a read then would be a 401. */
export function useSessionReady(): boolean {
  return useAuthStore((s) => s.hydrated && Boolean(s.accessToken));
}

export function useProviderQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "provider"], queryFn: () => partnerApi.provider(), enabled: ready });
}

export function useDashboardQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "dashboard"], queryFn: () => partnerApi.dashboard(), enabled: ready });
}

export function useOperationsQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "operations"], queryFn: () => partnerApi.operations(), enabled: ready });
}

/* ------------------------------------------------------------------ money */

export function usePayoutsQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "payouts"], queryFn: () => partnerApi.getPayouts(), enabled: ready });
}

export function useWithdrawalsQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "withdrawals"], queryFn: () => partnerApi.getWithdrawals(), enabled: ready });
}

export function useInvoicesQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "invoices"], queryFn: () => partnerApi.getInvoices(), enabled: ready });
}

export function useEarningsQuery(days: number) {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "earnings", days], queryFn: () => partnerApi.earnings(days), enabled: ready });
}

export function useTaxSummaryQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "tax"], queryFn: () => partnerApi.getTaxSummary(), enabled: ready });
}

export function useForecastQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "forecast"], queryFn: () => partnerApi.partnerOs.forecast(), enabled: ready });
}

export function useIncentivesQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "incentives"], queryFn: () => partnerApi.partnerOs.incentives(), enabled: ready });
}

/** The invoice document for one earning. Asked for only when the partner opens it. */
export function useEarningInvoiceQuery(earningId: string | null) {
  const ready = useSessionReady();
  return useQuery({
    queryKey: ["partner", "earning-invoice", earningId],
    queryFn: () => partnerApi.getEarningInvoice(earningId ?? ""),
    enabled: ready && Boolean(earningId),
    staleTime: 5 * 60_000,
  });
}

/* ------------------------------------------------------------------- work */

export function useAttendanceQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "attendance"], queryFn: () => partnerApi.partnerOs.attendance(), enabled: ready });
}

export function useServiceHistoryQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "service-history"], queryFn: () => partnerApi.partnerOs.serviceHistory(), enabled: ready });
}

export function useRouteQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "route"], queryFn: () => partnerApi.routeOptimize(), retry: false, enabled: ready });
}

/* ------------------------------------------------------------ performance */

export const REVIEWS_PAGE_SIZE = 20;

export function useReviewsQuery(page: number) {
  const ready = useSessionReady();
  return useQuery({
    queryKey: ["partner", "reviews", page],
    queryFn: () => partnerApi.reviews({ page, limit: REVIEWS_PAGE_SIZE }),
    placeholderData: (previous) => previous,
    enabled: ready,
  });
}

export function useScoreQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "score"], queryFn: () => partnerApi.partnerOs.score(), enabled: ready });
}

export function useScoreHistoryQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "score-history"], queryFn: () => partnerApi.partnerOs.scoreHistory(), enabled: ready });
}

export function useLifecycleQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "lifecycle"], queryFn: () => partnerApi.partnerOs.lifecycle(), enabled: ready });
}

export function useCareerQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "career"], queryFn: () => partnerApi.partnerOs.career(), enabled: ready });
}

export function useRankingsQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "rankings"], queryFn: () => partnerApi.partnerOs.rankings(), enabled: ready });
}

/** Flag-gated on the server: `null` means the feature is switched off, not "nothing to say". */
export function useNudgesQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "intel", "nudges"], queryFn: () => partnerApi.partnerOs.intel.nudges(), enabled: ready });
}

/** Flag-gated on the server: `null` means the feature is switched off. */
export function useZoneRecommendationsQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "intel", "zones"], queryFn: () => partnerApi.partnerOs.intel.zones(), enabled: ready });
}

/* ---------------------------------------------------------------- territory */

export function useSurgeQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "surge"], queryFn: () => partnerApi.geoIntel.surge(), enabled: ready });
}

export function useDensityQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "density"], queryFn: () => partnerApi.geoIntel.density(), enabled: ready });
}

export function useDemandForecastQuery() {
  const ready = useSessionReady();
  return useQuery({ queryKey: ["partner", "geo-demand"], queryFn: () => partnerApi.geoIntel.demandForecast(24), enabled: ready });
}

/* ------------------------------------------------------------------ refresh */

/** A query-key prefix: `["partner", "earnings"]` covers every period that screen has on show. */
export type RefreshKey = readonly unknown[];

/**
 * Pull-to-refresh for a screen: asks again for every read on show under these key prefixes —
 * including the ones a child component owns — and spins only for a pull (a background refetch does
 * not yank the list down).
 */
export function useRefresh(keys: readonly RefreshKey[]): { refreshing: boolean; onRefresh: () => void } {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(keys);
  latest.current = keys;
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.allSettled(latest.current.map((queryKey) => qc.refetchQueries({ queryKey, type: "active" }))).finally(() => setRefreshing(false));
  }, [qc]);
  return { refreshing, onRefresh };
}
