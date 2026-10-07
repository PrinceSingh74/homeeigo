import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ClipboardList, Inbox, XCircle } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Chips, Segmented } from "@/components/account/controls";
import { ErrorState, ListSkeleton } from "@/components/account/states";
import { JobCard } from "@/components/home/JobCard";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Banner, Button, EmptyState, T } from "@/components/ui";
import { useAuthed, usePagedQuery, usePullRefresh } from "@/hooks/account/queries";
import { useServerNowTick } from "@/hooks/use-offer-countdown";
import { useRealtimeFallbackInterval } from "@/hooks/use-partner-realtime";
import { usePartnerTrackingPublisher } from "@/hooks/use-partner-tracking-publisher";
import { BOOKING_LIST_FILTER } from "@/lib/booking-status";
import { errorSentence } from "@/lib/error-sentence";
import { CLOSED_SOURCES, JOBS_PAGE_SIZE, JOB_FILTERS, JOB_SOURCES, pickActiveJob, type ClosedKind, type JobFilterId, type JobListSource } from "@/lib/jobs-list";
import { isOfferLive } from "@/lib/offer";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";
import type { PartnerBooking, PartnerBookingsResponse } from "@/types/partner";

const EMPTY: Record<Exclude<JobFilterId, "closed">, { icon: typeof Inbox; title: string; message: string }> = {
  pending: { icon: Inbox, title: "No new requests", message: "A job offered to you appears here with the time you have to respond. Go online on the Home tab to receive offers." },
  active: { icon: ClipboardList, title: "No active jobs", message: "Jobs you have accepted stay here until they are completed." },
  completed: { icon: CheckCircle2, title: "No completed jobs yet", message: "Each job you complete is listed here." },
};

/**
 * The jobs list. One filter is one server list (`GET /api/providers/me/bookings?status=`), read a
 * page at a time. Page 1 of New / Active / Completed lives under the same cache keys the job screen
 * reads, so the two never disagree.
 */
export function RequestsScreen() {
  const authed = useAuthed();
  const [filter, setFilter] = useState<JobFilterId>("pending");
  const [closedKind, setClosedKind] = useState<ClosedKind>("cancelled");
  const closed = CLOSED_SOURCES.find((s) => s.id === closedKind) ?? CLOSED_SOURCES[0]!;
  const source: JobListSource = filter === "closed" ? closed : JOB_SOURCES[filter];
  // The socket pushes offers and transitions; polling is only the safety net (fast when it is down).
  const pollMs = useRealtimeFallbackInterval(10_000, 60_000);

  const list = usePagedQuery<PartnerBookingsResponse, PartnerBooking>({
    baseKey: ["partner", "bookings", source.key],
    fetchPage: (page) => partnerApi.listBookings({ status: source.status, page, limit: JOBS_PAGE_SIZE, sortBy: source.sortBy }),
    items: (p) => p.bookings,
    total: (p) => p.total,
    pageSize: JOBS_PAGE_SIZE,
    refetchInterval: filter === "pending" ? pollMs : false,
  });

  /**
   * GPS publishing for the live job must not depend on which filter is showing, and must include
   * jobs already in progress — so the active list is always read here.
   */
  const active = useQuery({
    queryKey: ["partner", "bookings", "active"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, page: 1, limit: JOBS_PAGE_SIZE, sortBy: "upcoming" }),
    enabled: authed,
  });
  const liveJob = useMemo(() => pickActiveJob(active.data?.bookings), [active.data]);
  usePartnerTrackingPublisher({ bookingId: liveJob?.id ?? null, enabled: !!liveJob });

  // An offer leaves the list the moment its window closes (server-time estimate), not on the next poll.
  const now = useServerNowTick(filter === "pending");
  const rows = filter === "pending" ? list.rows.filter((b) => isOfferLive(b.offer, now)) : list.rows;
  const { refreshing, onRefresh } = usePullRefresh(list, active);
  const empty = filter === "closed" ? { icon: XCircle, title: `No ${closed.label.toLowerCase()} jobs`, message: closed.empty } : EMPTY[filter];

  return (
    <PartnerScreen title="Jobs" refreshing={refreshing} onRefresh={onRefresh}>
      <View style={styles.body}>
        <Segmented
          testID="jobs-filter"
          segments={JOB_FILTERS.map((f) => ({ ...f, count: f.id === "active" ? (active.data?.total ?? null) : null }))}
          value={filter}
          onChange={setFilter}
        />
        {filter === "closed" ? (
          <Chips testID="jobs-closed-kind" label="Which closed jobs" options={CLOSED_SOURCES.map((s) => ({ id: s.id, label: s.label }))} value={[closedKind]} onToggle={setClosedKind} />
        ) : null}

        {list.isLoading ? (
          <ListSkeleton cards={3} lines={3} label="Loading jobs" />
        ) : list.error ? (
          <ErrorState error={list.error} title="Your jobs could not be loaded" onRetry={() => void list.refetch()} testID="jobs-error" />
        ) : rows.length === 0 ? (
          <EmptyState icon={empty.icon} title={empty.title} message={empty.message} testID={`jobs-empty-${filter}`} />
        ) : (
          <>
            {rows.map((b) => (
              <JobCard key={b.id} booking={b} offer={filter === "pending"} />
            ))}
            {typeof list.total === "number" && filter !== "pending" ? (
              <T kind="caption" style={styles.count} numeric>
                Showing {rows.length} of {list.total}
              </T>
            ) : null}
            {list.moreError ? <Banner tone="warning" message={errorSentence(list.moreError, "More jobs could not be loaded.")} /> : null}
            {list.hasMore || list.isLoadingMore || list.moreError ? (
              <Button label={list.moreError ? "Try again" : "Load more"} variant="secondary" onPress={list.loadMore} loading={list.isLoadingMore} testID="jobs-load-more" />
            ) : null}
          </>
        )}
      </View>
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.md },
  count: { textAlign: "center" },
});
