import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { EmptyState, ErrorBlock, HqCard, HqCardTitle, LoadingBlock, StatRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { usePartnerTrackingPublisher } from "@/hooks/use-partner-tracking-publisher";
import { customerName, formatCurrency, formatDateTime } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { OnlineToggleCard } from "@/screens/hq-work-earnings";
import { partnerColors } from "@/theme/colors";

type Tab = "pending" | "active" | "completed";

const TABS: { id: Tab; label: string; status: string }[] = [
  { id: "pending", label: "New requests", status: "pending" },
  { id: "active", label: "Active", status: "accepted" },
  { id: "completed", label: "Completed", status: "completed" },
];

async function getCoords() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== "granted") throw new Error("Location permission required to start/complete jobs.");
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
}

function BookingActions({
  bookingId,
  status,
  enRouteAt,
  arrivedAt,
}: {
  bookingId: string;
  status: string;
  enRouteAt: string | null;
  arrivedAt: string | null;
}) {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["partner", "bookings"] });
  const accept = useMutation({ mutationFn: () => partnerApi.acceptBooking(bookingId, 30), onSuccess: invalidate });
  const reject = useMutation({ mutationFn: () => partnerApi.rejectBooking(bookingId, "Not available"), onSuccess: invalidate });
  const enRoute = useMutation({
    mutationFn: async () => {
      const c = await getCoords();
      return partnerApi.markEnRoute(bookingId, c.latitude, c.longitude);
    },
    onSuccess: invalidate,
  });
  const arrived = useMutation({
    mutationFn: async () => {
      const c = await getCoords();
      return partnerApi.markArrived(bookingId, c.latitude, c.longitude);
    },
    onSuccess: invalidate,
  });
  const start = useMutation({
    mutationFn: async () => {
      const c = await getCoords();
      return partnerApi.startBooking(bookingId, c.latitude, c.longitude);
    },
    onSuccess: invalidate,
  });
  const complete = useMutation({
    mutationFn: async () => {
      const c = await getCoords();
      return partnerApi.completeBooking(bookingId, c.latitude, c.longitude);
    },
    onSuccess: invalidate,
  });
  const busy =
    accept.isPending ||
    reject.isPending ||
    enRoute.isPending ||
    arrived.isPending ||
    start.isPending ||
    complete.isPending;

  if (status === "pending") {
    return (
      <View style={styles.actions}>
        <Pressable disabled={busy} onPress={() => accept.mutate()} style={styles.acceptBtn}>
          <Text style={styles.acceptText}>Accept</Text>
        </Pressable>
        <Pressable disabled={busy} onPress={() => reject.mutate()} style={styles.rejectBtn}>
          <Text style={styles.rejectText}>Reject</Text>
        </Pressable>
      </View>
    );
  }

  // Arrival does not change `status`, so the stage comes from the lifecycle timestamps.
  // Offering only the one legal next action is what stops a partner from skipping the
  // travel-start anchor that the ETA training label's duration is measured from.
  if (status === "accepted" || status === "assigned" || status === "en_route") {
    if (!enRouteAt && (status === "accepted" || status === "assigned")) {
      return (
        <Pressable disabled={busy} onPress={() => enRoute.mutate()} style={styles.acceptBtn}>
          {enRoute.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>On my way</Text>}
        </Pressable>
      );
    }
    if (!arrivedAt) {
      return (
        <Pressable disabled={busy} onPress={() => arrived.mutate()} style={styles.acceptBtn}>
          {arrived.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>I&apos;ve arrived</Text>}
        </Pressable>
      );
    }
    return (
      <Pressable disabled={busy} onPress={() => start.mutate()} style={styles.acceptBtn}>
        {start.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Start job</Text>}
      </Pressable>
    );
  }

  if (status === "in_progress") {
    return (
      <Pressable disabled={busy} onPress={() => complete.mutate()} style={styles.acceptBtn}>
        {complete.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.acceptText}>Complete job</Text>}
      </Pressable>
    );
  }
  return null;
}

export function RequestsScreen({ embedded }: { embedded?: boolean }) {
  const [tab, setTab] = useState<Tab>("pending");
  const current = TABS.find((t) => t.id === tab)!;
  const bookings = useQuery({
    queryKey: ["partner", "bookings", tab],
    queryFn: () => partnerApi.listBookings({ status: current.status, limit: 20, sortBy: tab === "pending" ? "recent" : "upcoming" }),
  });

  // Closes the parity gap with partner-web, which has streamed GPS app-wide since the
  // beginning. Mobile partners previously produced no tracking telemetry at all.
  const liveJob = (bookings.data?.bookings ?? []).find((b) =>
    ["accepted", "assigned", "en_route", "in_progress"].includes(b.status),
  );
  usePartnerTrackingPublisher({ bookingId: liveJob?.id ?? null, enabled: !!liveJob });

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
      ) : (bookings.data?.bookings ?? []).length === 0 ? (
        <EmptyState message={tab === "pending" ? "No pending requests — you're all caught up!" : `No ${tab} jobs.`} />
      ) : (
        bookings.data!.bookings.map((b) => (
          <HqCard key={b.id}>
            <Text style={styles.bookingTitle}>{b.service.name}</Text>
            <StatRow label="Customer" value={customerName(b.customer)} />
            <StatRow label="When" value={formatDateTime(b.scheduledDate)} />
            <StatRow label="Amount" value={formatCurrency(b.finalAmount || b.amount)} />
            <StatRow label="Address" value={b.address.fullAddress} />
            <StatRow label="Status" value={b.status} />
            <BookingActions
              bookingId={b.id}
              status={b.status}
              enRouteAt={b.enRouteAt}
              arrivedAt={b.arrivedAt}
            />
          </HqCard>
        ))
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
  tabs: { flexDirection: "row", gap: 6, marginBottom: 12, backgroundColor: "rgba(255,255,255,0.6)", borderRadius: 12, padding: 4 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: "rgba(61,107,79,0.15)" },
  tabText: { fontSize: 11, fontWeight: "600", color: partnerColors.textMuted },
  tabTextActive: { color: partnerColors.primary },
  bookingTitle: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 4 },
  actions: { flexDirection: "row", gap: 8, marginTop: 8 },
  acceptBtn: { flex: 1, backgroundColor: partnerColors.primary, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  acceptText: { color: "#fff", fontWeight: "700" },
  rejectBtn: { flex: 1, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  rejectText: { color: partnerColors.textMuted, fontWeight: "700" },
});
