import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { hasMorePages, mergePages } from "@/lib/jobs-list";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";

/**
 * The reads the home, jobs, HQ and account screens share. Keys are the ones the rest of the app
 * already uses (`["partner", "provider"]`, `…"dashboard"`, `…"operations"`, …), so a mutation or a
 * realtime event that invalidates one refreshes every screen showing it.
 */

/** A session the API can be called with: hydrated and holding a token. Queries wait for it. */
export function useAuthed(): boolean {
  return useAuthStore((s) => s.hydrated && Boolean(s.accessToken));
}

export function useProviderQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "provider"], queryFn: () => partnerApi.provider(), enabled });
}

export function useDashboardQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "dashboard"], queryFn: () => partnerApi.dashboard(), enabled });
}

export function useOperationsQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "operations"], queryFn: () => partnerApi.operations(), enabled });
}

/** `GET /api/users/me`: the decrypted email / phone and `isEmailVerified`. */
export function useUserProfileQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "user-profile"], queryFn: () => partnerApi.userProfile(), enabled });
}

export function useWellbeingQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "wellbeing"], queryFn: () => partnerApi.partnerOs.wellbeing(), enabled });
}

export function useComplianceQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "compliance"], queryFn: () => partnerApi.partnerOs.compliance(), enabled });
}

export function useAcademyQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "academy"], queryFn: () => partnerApi.partnerOs.academy(), enabled });
}

export function useRewardsQuery() {
  const enabled = useAuthed();
  return useQuery({ queryKey: ["partner", "rewards"], queryFn: () => partnerApi.partnerOs.rewards(), enabled });
}

/**
 * Pull-to-refresh for a screen: asks every query again and shows the spinner only for the pull
 * (a background refetch does not make the list jump).
 */
export function usePullRefresh(...queries: Array<{ refetch: () => Promise<unknown> }>): { refreshing: boolean; onRefresh: () => void } {
  const [refreshing, setRefreshing] = useState(false);
  const latest = useRef(queries);
  latest.current = queries;
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.allSettled(latest.current.map((q) => q.refetch())).finally(() => setRefreshing(false));
  }, []);
  return { refreshing, onRefresh };
}

export type PagedQuery<TItem> = {
  rows: TItem[];
  /** The server's count for the list; undefined until the first page has answered. */
  total: number | undefined;
  /** True until the first page has answered once. */
  isLoading: boolean;
  /** The first page failed and there is nothing to show. */
  error: unknown;
  /** A later page failed (the rows already loaded stay on screen). */
  moreError: unknown;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
  refetch: () => Promise<unknown>;
  /** The first page's raw answer (for fields beside the rows, e.g. `unreadCount`). */
  first: unknown;
};

/**
 * A `page` / `limit` list read one page at a time ("Load more").
 *
 * Every page is its own ordinary query holding the server's page answer unchanged — page 1 under
 * `baseKey`, page n under `[...baseKey, "page", n]`. That is deliberate: other screens read and
 * patch `["partner", "bookings", …]` entries as plain page answers (the job screen's first paint,
 * `removeFromPending`), which an infinite-query's `{ pages, pageParams }` shape would break.
 */
export function usePagedQuery<TPage, TItem extends { id: string }>(opts: {
  baseKey: readonly unknown[];
  fetchPage: (page: number) => Promise<TPage>;
  items: (page: TPage) => TItem[];
  total: (page: TPage) => number;
  pageSize: number;
  enabled?: boolean;
  /** Polling for the first page only (the newest rows). */
  refetchInterval?: number | false;
}): PagedQuery<TItem> {
  const authed = useAuthed();
  const enabled = authed && (opts.enabled ?? true);
  const keyId = JSON.stringify(opts.baseKey);
  // The page count belongs to one list: a different key starts again at one page, in the same render.
  const [paging, setPaging] = useState({ keyId, count: 1 });
  const count = paging.keyId === keyId ? paging.count : 1;

  const results = useQueries({
    queries: Array.from({ length: count }, (_, i) => ({
      queryKey: i === 0 ? [...opts.baseKey] : [...opts.baseKey, "page", i + 1],
      queryFn: () => opts.fetchPage(i + 1),
      enabled,
      refetchInterval: i === 0 ? (opts.refetchInterval ?? false) : (false as const),
      refetchIntervalInBackground: false,
    })),
  }) as UseQueryResult<TPage>[];

  const first = results[0];
  const last = results[results.length - 1];
  const loaded = results.filter((r) => r.data !== undefined);
  const rows = mergePages(results.map((r) => (r.data !== undefined ? opts.items(r.data) : undefined)));
  const total = first?.data !== undefined ? opts.total(first.data) : undefined;
  const lastLoaded = loaded[loaded.length - 1];
  const hasMore = hasMorePages({
    total,
    pagesLoaded: loaded.length,
    pageSize: opts.pageSize,
    lastPageLength: lastLoaded?.data !== undefined ? opts.items(lastLoaded.data).length : null,
  });
  const isLoadingMore = count > 1 && Boolean(last?.isLoading);
  const moreError = count > 1 && last?.isError && last.data === undefined ? last.error : null;

  const resultsRef = useRef(results);
  resultsRef.current = results;
  const loadMore = useCallback(() => {
    const current = resultsRef.current;
    const tail = current[current.length - 1];
    // A failed page is asked for again; otherwise the next page is added.
    if (tail && tail.isError && tail.data === undefined) void tail.refetch();
    else if (tail && tail.data !== undefined) setPaging({ keyId, count: current.length + 1 });
  }, [keyId]);
  const refetch = useCallback(() => Promise.allSettled(resultsRef.current.map((r) => r.refetch())), []);

  return {
    rows,
    total,
    isLoading: enabled ? Boolean(first?.isLoading) || (first?.data === undefined && !first?.isError) : !authed,
    error: first?.data === undefined && first?.isError ? first.error : null,
    moreError,
    hasMore: hasMore && !isLoadingMore,
    isLoadingMore,
    loadMore,
    refetch,
    first: first?.data,
  };
}
