import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Bell, CalendarDays, Inbox } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { IconButton } from "@/components/account/controls";
import { ErrorState, ListSkeleton, RowsSkeleton } from "@/components/account/states";
import { JobCard, openJob } from "@/components/home/JobCard";
import { OnlineSwitch } from "@/components/home/OnlineSwitch";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Banner, Button, Card, EmptyState, KeyValue, ListRow, Section, T, formatRupees } from "@/components/ui";
import { useAuthed, useDashboardQuery, usePullRefresh } from "@/hooks/account/queries";
import { useServerNowTick } from "@/hooks/use-offer-countdown";
import { useRealtimeFallbackInterval } from "@/hooks/use-partner-realtime";
import { BOOKING_LIST_FILTER, bookingStatusLabel } from "@/lib/booking-status";
import { jobSelectionRows } from "@/lib/job-selection";
import { JOBS_PAGE_SIZE, jobsToday, nextStep, pickActiveJob, slotLine } from "@/lib/jobs-list";
import { isOfferLive } from "@/lib/offer";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { space } from "@/theme/tokens";
import type { PartnerBooking } from "@/types/partner";

/** The next step of the active job, from the server's `/actions` answer (never guessed from the status). */
function NextStep({ booking }: { booking: PartnerBooking }) {
  const actions = useQuery({
    queryKey: ["partner", "job-actions", booking.id],
    queryFn: () => partnerApi.getJobActions(booking.id),
    staleTime: 10_000,
  });
  const step = nextStep(actions.data);
  return (
    <View style={styles.next}>
      {step ? (
        <>
          <T kind="small">Next step</T>
          <T kind="bodyStrong" tone="leaf" testID="home-next-step">
            {step.label}
          </T>
          {step.blockedBy ? <T kind="small">{step.blockedBy}</T> : null}
        </>
      ) : null}
      <Button label="Open job" onPress={() => openJob(booking.id)} testID="home-open-active-job" />
    </View>
  );
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—";
}

export default function HomeTab() {
  const authed = useAuthed();
  const firstName = useAuthStore((s) => s.user?.firstName)?.trim();
  const pollMs = useRealtimeFallbackInterval(10_000, 60_000);

  const dashboard = useDashboardQuery();
  // Same keys and params as the jobs list and the job screen: one cache entry each.
  const offers = useQuery({
    queryKey: ["partner", "bookings", "pending"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.OFFERS, page: 1, limit: JOBS_PAGE_SIZE, sortBy: "recent" }),
    enabled: authed,
    refetchInterval: pollMs,
    refetchIntervalInBackground: false,
  });
  const active = useQuery({
    queryKey: ["partner", "bookings", "active"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, page: 1, limit: JOBS_PAGE_SIZE, sortBy: "upcoming" }),
    enabled: authed,
  });
  const unread = useQuery({
    queryKey: ["partner", "notifications", "unread"],
    queryFn: () => partnerApi.notifications.list({ limit: 1 }),
    enabled: authed,
  });
  const { refreshing, onRefresh } = usePullRefresh(dashboard, offers, active, unread);

  // An offer whose window has closed (server-time estimate) is not listed: it cannot be accepted.
  const now = useServerNowTick((offers.data?.bookings.length ?? 0) > 0);
  const liveOffers = (offers.data?.bookings ?? []).filter((b) => isOfferLive(b.offer, now));
  const activeJob = pickActiveJob(active.data?.bookings);
  const today = jobsToday(active.data?.bookings, Date.now());
  const laterCount = (active.data?.bookings.length ?? 0) - today.length;
  const d = dashboard.data;

  return (
    <PartnerScreen
      title={firstName ? `Hello, ${firstName}` : "Hello, partner"}
      refreshing={refreshing}
      onRefresh={onRefresh}
      headerAction={<IconButton icon={Bell} label="Notifications" tone="neutral" badge={unread.data?.unreadCount ?? null} onPress={() => router.push("/hq/account-notifications")} testID="home-notifications" />}
    >
      <OnlineSwitch />

      {activeJob ? (
        <Section title="Your active job">
          <JobCard booking={activeJob} testID="home-active-job" footer={<NextStep booking={activeJob} />} />
        </Section>
      ) : null}

      <Section title="New offers" action={liveOffers.length > 0 ? <Button label="See all" variant="quiet" onPress={() => router.push("/(tabs)/requests")} /> : undefined}>
        {offers.isLoading ? (
          <ListSkeleton cards={1} label="Loading offers" />
        ) : offers.isError && !offers.data ? (
          <Card>
            <ErrorState error={offers.error} title="Offers could not be loaded" onRetry={() => void offers.refetch()} />
          </Card>
        ) : liveOffers.length === 0 ? (
          <Card>
            <EmptyState icon={Inbox} title="No offers right now" message="When a job is offered to you it appears here with the time you have to respond. Stay online to receive offers." testID="home-no-offers" />
          </Card>
        ) : (
          <View style={styles.list}>
            {liveOffers.map((b) => (
              <JobCard key={b.id} booking={b} offer testID={`home-offer-${b.id}`} />
            ))}
          </View>
        )}
      </Section>

      <Section title="Today's schedule" action={laterCount > 0 ? <Button label={`${laterCount} later`} variant="quiet" accessibilityLabel={`See ${laterCount} jobs on later days`} onPress={() => router.push("/(tabs)/requests")} /> : undefined}>
        {active.isLoading ? (
          <RowsSkeleton rows={2} label="Loading today's schedule" />
        ) : active.isError && !active.data ? (
          <Card>
            <ErrorState error={active.error} title="Your schedule could not be loaded" onRetry={() => void active.refetch()} />
          </Card>
        ) : today.length === 0 ? (
          <Card>
            <EmptyState icon={CalendarDays} title="Nothing booked for today" message="Jobs you accept for today appear here in time order." testID="home-no-schedule" />
          </Card>
        ) : (
          <Card>
            {today.map((b, i) => (
              <ListRow
                key={b.id}
                testID={`home-schedule-${b.id}`}
                title={`${timeOf(b.scheduledDate)} · ${b.service.name}`}
                subtitle={[bookingStatusLabel(b.status, b.arrivedAt), slotLine(jobSelectionRows(b))].filter(Boolean).join(" · ")}
                onPress={() => openJob(b.id)}
                last={i === today.length - 1}
              />
            ))}
          </Card>
        )}
      </Section>

      <Section title="Your numbers" action={<Button label="Earnings" variant="quiet" accessibilityLabel="Open earnings" onPress={() => router.push("/hq/earnings-hq")} />}>
        {dashboard.isLoading ? (
          <RowsSkeleton rows={4} label="Loading your numbers" />
        ) : !d ? (
          <Card>
            <ErrorState error={dashboard.error} title="Your numbers could not be loaded" onRetry={() => void dashboard.refetch()} testID="home-dashboard-error" />
          </Card>
        ) : (
          <Card testID="home-figures">
            <KeyValue label="Earned today, after commission" value={formatRupees(d.earnings.today)} strong testID="home-earned-today" />
            <KeyValue label="Earned in the last 7 days, after commission" value={formatRupees(d.earnings.thisWeek)} />
            <KeyValue label="Jobs completed today" value={String(d.counts.completedToday)} />
            <KeyValue label="Customer rating" value={d.counts.totalReviews > 0 ? `${d.rating.toFixed(1)} from ${d.counts.totalReviews} reviews` : "No reviews yet"} />
            <KeyValue label="Offers accepted" value={`${d.rates.acceptanceRate.toFixed(0)}%`} />
          </Card>
        )}
        {dashboard.isError && d ? <Banner tone="warning" message="These numbers may be out of date. Pull down to refresh." /> : null}
      </Section>
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.md },
  next: { gap: space.xs },
});
