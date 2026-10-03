import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorBlock, HqCard, LoadingBlock, StatRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { useOfferCountdown, useServerNowTick } from "@/hooks/use-offer-countdown";
import { useRealtimeFallbackInterval } from "@/hooks/use-partner-realtime";
import { usePartnerTrackingPublisher } from "@/hooks/use-partner-tracking-publisher";
import {
  BOOKING_LIST_FILTER,
  bookingStatusLabel,
  bookingStatusRank,
  isActiveWorkStatus,
  type BookingListFilter,
} from "@/lib/booking-status";
import { customerName, formatCurrency, formatDateTime } from "@/lib/format";
import { formatCountdown, isOfferLive } from "@/lib/offer";
import { OnlineToggleCard } from "@/screens/hq-work-earnings";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";
import type { PartnerBooking } from "@/types/partner";

type Tab = "pending" | "active" | "completed";

/**
 * Query key + params per tab. Keys and params match JobDetailScreen's list queries exactly, so the
 * two screens share one cache entry instead of fighting over it with different params.
 */
const TABS: { id: Tab; label: string; filter: BookingListFilter; sortBy: "recent" | "upcoming" }[] = [
  { id: "pending", label: "New requests", filter: BOOKING_LIST_FILTER.OFFERS, sortBy: "recent" },
  // ACTIVE_WORK = ACCEPTED | ASSIGNED | EN_ROUTE | IN_PROGRESS. "accepted" would drop started jobs.
  { id: "active", label: "Active", filter: BOOKING_LIST_FILTER.ACTIVE_WORK, sortBy: "upcoming" },
  { id: "completed", label: "Completed", filter: BOOKING_LIST_FILTER.COMPLETED, sortBy: "recent" },
];

function OfferDeadline({ booking }: { booking: PartnerBooking }) {
  const countdown = useOfferCountdown(booking.offer ?? null);
  if (!countdown) return null;
  const color =
    countdown.urgency === "critical"
      ? partnerColors.danger
      : countdown.urgency === "warning"
        ? partnerColors.warning
        : partnerColors.success;
  return (
    <Text style={[styles.deadline, { color }]}>
      {countdown.expired ? "Offer closed" : `Respond within ${formatCountdown(countdown.secondsLeft)}`}
    </Text>
  );
}

export function RequestsScreen({ embedded }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>("pending");
  const current = TABS.find((t) => t.id === tab)!;
  // The socket pushes offers/transitions; polling is only the safety net (fast when it is down).
  const pendingPollMs = useRealtimeFallbackInterval(10_000, 60_000);

  const bookings = useQuery({
    queryKey: ["partner", "bookings", tab],
    queryFn: () => partnerApi.listBookings({ status: current.filter, limit: 20, sortBy: current.sortBy }),
    refetchInterval: tab === "pending" ? pendingPollMs : false,
    refetchIntervalInBackground: false,
  });

  /**
   * GPS publishing must not depend on which tab is visible (it used to stop whenever the partner
   * looked at "New requests"), and must include IN_PROGRESS jobs.
   */
  const active = useQuery({
    queryKey: ["partner", "bookings", "active"],
    queryFn: () =>
      partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, limit: 20, sortBy: "upcoming" }),
  });
  const liveJob = useMemo(() => {
    const rows = (active.data?.bookings ?? []).filter((b) => isActiveWorkStatus(b.status));
    return rows.sort((a, b) => bookingStatusRank(b.status) - bookingStatusRank(a.status))[0] ?? null;
  }, [active.data]);
  usePartnerTrackingPublisher({ bookingId: liveJob?.id ?? null, enabled: !!liveJob });

  // Offers disappear the moment their window closes (server-time estimate), not on the next poll.
  const now = useServerNowTick(tab === "pending");
  const rows = useMemo(() => {
    const all = bookings.data?.bookings ?? [];
    return tab === "pending" ? all.filter((b) => isOfferLive(b.offer, now)) : all;
  }, [bookings.data, tab, now]);

  const body = (
    <>
      <View style={styles.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.id} onPress={() => setTab(t.id)} style={[styles.tab, tab === t.id && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.id && styles.tabTextActive]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {!embedded ? <OnlineToggleCard /> : null}
      {bookings.isLoading ? (
        <LoadingBlock />
      ) : bookings.isError ? (
        <ErrorBlock message="Could not load bookings." />
      ) : rows.length === 0 ? (
        <EmptyState
          message={tab === "pending" ? "No pending requests — you're all caught up!" : `No ${tab} jobs.`}
        />
      ) : (
        rows.map((b) => {
          const name = customerName(b.customer);
          return (
            <Pressable
              key={b.id}
              onPress={() => router.push(`/job/${b.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Open job ${b.service.name}`}
            >
              <HqCard>
                <Text style={styles.bookingTitle}>{b.service.name}</Text>
                {tab === "pending" ? <OfferDeadline booking={b} /> : null}
                <StatRow label="Customer" value={name} />
                {b.customer.phoneMasked ? (
                  <StatRow label="Phone" value={b.customer.phoneMasked} />
                ) : null}
                <StatRow label="When" value={formatDateTime(b.scheduledDate)} />
                <StatRow label="Amount" value={formatCurrency(b.finalAmount || b.amount)} />
                <StatRow label="Address" value={b.address.fullAddress} />
                <StatRow label="Status" value={bookingStatusLabel(b.status, b.arrivedAt)} />
                <View style={styles.openRow}>
                  <Text style={styles.openText}>
                    {tab === "pending" ? "Review & accept →" : "Open job workspace →"}
                  </Text>
                </View>
              </HqCard>
            </Pressable>
          );
        })
      )}
    </>
  );

  if (embedded) {
    return (
      <PartnerScreen title="Bookings" subtitle="Accept, start, and complete jobs." showBack>
        {body}
      </PartnerScreen>
    );
  }
  return (
    <PartnerScreen title="Bookings" subtitle="New requests, active jobs, and completed work.">
      {body}
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 12,
    backgroundColor: "rgba(255,255,255,0.6)",
    borderRadius: 12,
    padding: 4,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: "rgba(61,107,79,0.15)" },
  tabText: { fontSize: 11, fontWeight: "600", color: partnerColors.textMuted },
  tabTextActive: { color: partnerColors.primary },
  bookingTitle: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 4 },
  deadline: { fontSize: 13, fontWeight: "700", marginBottom: 6 },
  openRow: { marginTop: 10, alignItems: "flex-end" },
  openText: { fontSize: 12, fontWeight: "700", color: partnerColors.primary },
});
