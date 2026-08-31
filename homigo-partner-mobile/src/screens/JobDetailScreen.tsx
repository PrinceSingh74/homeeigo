import { useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { JobChatModal } from "@/components/JobChatModal";
import { JobLifecycleActions } from "@/components/JobLifecycleActions";
import { EmptyState, ErrorBlock, HqCard, LoadingBlock, StatRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { usePartnerTrackingPublisher } from "@/hooks/use-partner-tracking-publisher";
import { setE2eGeoOverride } from "@/lib/e2e-geo";
import { customerName, formatCurrency, formatDateTime } from "@/lib/format";
import { getAvailableJobActions, primaryActionLabel } from "@/lib/job-action-policy";
import { partnerApi } from "@/services/partner-api";
import type { PartnerBooking } from "@/types/partner";
import { partnerColors } from "@/theme/colors";

const TIMELINE: Array<{
  key: "enRouteAt" | "arrivedAt" | "startedAt" | "completedAt";
  label: string;
}> = [
  { key: "enRouteAt", label: "On the way" },
  { key: "arrivedAt", label: "Arrived" },
  { key: "startedAt", label: "Started" },
  { key: "completedAt", label: "Completed" },
];

function StatusChip({ status }: { status: string }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{status.replace(/_/g, " ")}</Text>
    </View>
  );
}

function statusRank(status: string): number {
  const u = String(status).toUpperCase().replace(/-/g, "_");
  if (u === "COMPLETED") return 60;
  if (u === "IN_PROGRESS") return 50;
  if (u === "EN_ROUTE") return 40;
  if (u === "ACCEPTED" || u === "ASSIGNED") return 30;
  if (u === "PENDING") return 10;
  return 0;
}

/** Prefer the most advanced lifecycle copy when the same id appears in multiple list caches. */
function findBooking(
  caches: Array<{ bookings?: PartnerBooking[] } | undefined>,
  id: string,
): PartnerBooking | undefined {
  const hits: PartnerBooking[] = [];
  for (const cache of caches) {
    const hit = cache?.bookings?.find((b) => b.id === id);
    if (hit) hits.push(hit);
  }
  if (hits.length === 0) return undefined;
  return hits.sort((a, b) => {
    const byStatus = statusRank(b.status) - statusRank(a.status);
    if (byStatus !== 0) return byStatus;
    const aTs = a.enRouteAt || a.arrivedAt || a.startedAt || a.completedAt || "";
    const bTs = b.enRouteAt || b.arrivedAt || b.startedAt || b.completedAt || "";
    return String(bTs).localeCompare(String(aTs));
  })[0];
}

/** Stale pending list rows must not rewind Accept → On my way after a successful mutation. */
const stageHold = new Map<string, PartnerBooking>();

function holdAdvance(id: string, candidate: PartnerBooking | null | undefined): PartnerBooking | null {
  if (!id) return candidate ?? null;
  const prev = stageHold.get(id);
  if (!candidate) return prev ?? null;
  if (!prev || statusRank(candidate.status) >= statusRank(prev.status)) {
    const merged: PartnerBooking = prev
      ? {
          ...candidate,
          enRouteAt: candidate.enRouteAt || prev.enRouteAt,
          arrivedAt: candidate.arrivedAt || prev.arrivedAt,
          startedAt: candidate.startedAt || prev.startedAt,
          completedAt: candidate.completedAt || prev.completedAt,
        }
      : candidate;
    stageHold.set(id, merged);
    return merged;
  }
  return prev;
}

export function JobDetailScreen() {
  const { id, e2eLat, e2eLng } = useLocalSearchParams<{
    id: string;
    e2eLat?: string;
    e2eLng?: string;
  }>();
  const bookingId = Array.isArray(id) ? id[0] : id ?? "";
  const [chatOpen, setChatOpen] = useState(false);
  const [callError, setCallError] = useState<string | null>(null);

  useEffect(() => {
    const latRaw = Array.isArray(e2eLat) ? e2eLat[0] : e2eLat;
    const lngRaw = Array.isArray(e2eLng) ? e2eLng[0] : e2eLng;
    const lat = latRaw != null ? Number(latRaw) : NaN;
    const lng = lngRaw != null ? Number(lngRaw) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setE2eGeoOverride(lat, lng);
    }
  }, [e2eLat, e2eLng]);

  const pending = useQuery({
    queryKey: ["partner", "bookings", "pending"],
    queryFn: () => partnerApi.listBookings({ status: "pending", limit: 20, sortBy: "recent" }),
  });
  const active = useQuery({
    queryKey: ["partner", "bookings", "active"],
    queryFn: () => partnerApi.listBookings({ status: "accepted", limit: 20, sortBy: "upcoming" }),
  });
  const completed = useQuery({
    queryKey: ["partner", "bookings", "completed"],
    queryFn: () => partnerApi.listBookings({ status: "completed", limit: 20, sortBy: "recent" }),
  });

  const fromList = findBooking([pending.data, active.data, completed.data], bookingId);

  const detail = useQuery({
    queryKey: ["partner", "bookings", "by-id", bookingId],
    queryFn: () => partnerApi.getBooking(bookingId),
    enabled: !!bookingId,
  });

  // List caches can lag behind accept; GET /bookings/:id is the source of truth.
  const lookup = useQuery({
    queryKey: ["partner", "bookings", "detail", bookingId],
    queryFn: () => partnerApi.listBookings({ limit: 50, sortBy: "recent" }),
    enabled: !!bookingId,
  });

  const candidate =
    findBooking(
      [
        detail.data ? { bookings: [detail.data] } : undefined,
        lookup.data,
        active.data,
        completed.data,
        pending.data,
      ],
      bookingId,
    ) ??
    fromList ??
    detail.data ??
    null;

  const booking = holdAdvance(bookingId, candidate);

  const evidence = useQuery({
    queryKey: ["partner", "job-evidence", bookingId],
    queryFn: () => partnerApi.listEvidence(bookingId),
    enabled: !!bookingId && !!booking,
  });

  const isLive = booking != null && statusRank(booking.status) >= 30;
  usePartnerTrackingPublisher({ bookingId: isLive ? bookingId : null, enabled: isLive });

  const loading =
    (detail.isLoading && !booking) ||
    pending.isLoading ||
    active.isLoading ||
    (lookup.isFetching && !booking) ||
    (detail.isFetching && booking != null && statusRank(booking.status) < 30 && !detail.data);

  if (loading) {
    return (
      <PartnerScreen title="Job" subtitle="Loading…" showBack>
        <LoadingBlock />
      </PartnerScreen>
    );
  }

  if (!booking) {
    return (
      <PartnerScreen title="Job" subtitle="Not found" showBack>
        <EmptyState message="This job is not in your bookings." />
      </PartnerScreen>
    );
  }

  const name = customerName(booking.customer);
  const policy = getAvailableJobActions(booking);
  const nextLabel = primaryActionLabel(policy.primaryAction);
  const disabledHint =
    (policy.primaryAction && policy.disabledReasons[policy.primaryAction]) || null;

  async function openMaps() {
    const lat = booking!.address.latitude;
    const lng = booking!.address.longitude;
    const addr = encodeURIComponent(booking!.address.fullAddress || "Job location");
    const url =
      lat != null && lng != null
        ? `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${addr}`;
    await Linking.openURL(url);
  }

  async function callCustomer() {
    setCallError(null);
    try {
      const data = await partnerApi.initiateCall(bookingId);
      await Linking.openURL(data.dialUri);
    } catch (err) {
      setCallError(err instanceof Error ? err.message : "Could not start call");
    }
  }

  const footer = (
    <JobLifecycleActions
      bookingId={booking.id}
      status={booking.status}
      enRouteAt={booking.enRouteAt}
      arrivedAt={booking.arrivedAt}
      startedAt={booking.startedAt}
      completedAt={booking.completedAt}
      paymentStatus={booking.paymentStatus}
      customerLabel={name}
      phoneMasked={booking.customer.phoneMasked}
      bookingNumber={booking.bookingNumber}
      sticky
      hideComms
      showReject
    />
  );

  return (
    <PartnerScreen
      title={booking.service.name}
      subtitle={booking.bookingNumber}
      showBack
      footer={footer}
    >
      <View testID="job-detail-screen" style={styles.root}>
        <View style={styles.headerRow}>
          <StatusChip status={booking.status} />
          <Text style={styles.amount}>
            {formatCurrency(booking.finalAmount || booking.amount)}
          </Text>
        </View>

        <HqCard>
          <Text style={styles.sectionTitle}>Customer</Text>
          <StatRow label="Name" value={name} />
          {booking.customer.phoneMasked ? (
            <StatRow label="Phone" value={booking.customer.phoneMasked} />
          ) : null}
          <StatRow label="When" value={formatDateTime(booking.scheduledDate)} />
        </HqCard>

        <HqCard>
          <Text style={styles.sectionTitle}>Location</Text>
          <Text style={styles.address}>{booking.address.fullAddress}</Text>
          <Pressable onPress={() => void openMaps()} style={styles.mapsBtn}>
            <Text style={styles.mapsText}>Open in Maps</Text>
          </Pressable>
        </HqCard>

        {isLive ? (
          <View style={styles.comms}>
            <Pressable testID="job-call-btn" onPress={() => void callCustomer()} style={styles.commBtn}>
              <Text style={styles.commText}>
                {booking.customer.phoneMasked
                  ? `Call ${booking.customer.phoneMasked}`
                  : "Call"}
              </Text>
            </Pressable>
            <Pressable
              testID="job-chat-btn"
              onPress={() => setChatOpen(true)}
              style={styles.commBtn}
            >
              <Text style={styles.commText}>Chat</Text>
            </Pressable>
          </View>
        ) : null}
        {callError ? <Text style={styles.warn}>{callError}</Text> : null}

        <HqCard>
          <Text style={styles.sectionTitle}>Lifecycle</Text>
          {disabledHint ? <Text style={styles.warn}>{disabledHint}</Text> : null}
          {nextLabel ? <Text style={styles.next}>Next action: {nextLabel}</Text> : null}
          {TIMELINE.map((step, i) => {
            const at = booking[step.key];
            return (
              <View key={step.key} style={styles.timelineRow}>
                <View style={styles.timelineRail}>
                  <View style={[styles.dot, at ? styles.dotDone : null]} />
                  {i < TIMELINE.length - 1 ? <View style={styles.rail} /> : null}
                </View>
                <View style={styles.timelineBody}>
                  <Text style={styles.timelineLabel}>{step.label}</Text>
                  <Text style={styles.timelineAt}>
                    {at ? formatDateTime(at) : "Pending"}
                  </Text>
                </View>
              </View>
            );
          })}
        </HqCard>

        <HqCard>
          <Text style={styles.sectionTitle}>Evidence</Text>
          {evidence.isLoading ? (
            <ActivityIndicator color={partnerColors.primary} />
          ) : evidence.isError ? (
            <ErrorBlock message="Could not load evidence." />
          ) : (evidence.data?.evidence ?? []).length === 0 ? (
            <Text style={styles.muted}>No photos yet — capture on arrive or complete.</Text>
          ) : (
            (evidence.data?.evidence ?? []).map((e) => (
              <StatRow
                key={e.id}
                label={e.stage}
                value={formatDateTime(e.capturedAt) + (e.isCurrent ? " · current" : "")}
              />
            ))
          )}
        </HqCard>

        <JobChatModal
          bookingId={booking.id}
          customerName={name}
          bookingNumber={booking.bookingNumber}
          phoneMasked={booking.customer.phoneMasked}
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      </View>
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  root: { gap: 12, paddingBottom: 24 },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  chip: {
    backgroundColor: "rgba(61,107,79,0.15)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    color: partnerColors.primary,
  },
  amount: { fontSize: 18, fontWeight: "800", color: partnerColors.success },
  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: partnerColors.text,
    marginBottom: 6,
  },
  address: { fontSize: 13, lineHeight: 18, color: partnerColors.textSecondary, marginBottom: 8 },
  mapsBtn: {
    alignSelf: "flex-start",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: partnerColors.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: partnerColors.surface,
  },
  mapsText: { fontSize: 12, fontWeight: "700", color: partnerColors.primary },
  comms: { flexDirection: "row", gap: 8 },
  commBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
    backgroundColor: partnerColors.surface,
  },
  commText: { color: partnerColors.primary, fontWeight: "700", fontSize: 13 },
  timelineRow: { flexDirection: "row", gap: 10, minHeight: 44 },
  timelineRail: { width: 16, alignItems: "center" },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: partnerColors.line,
    marginTop: 4,
  },
  dotDone: { backgroundColor: partnerColors.success },
  rail: { flex: 1, width: 2, backgroundColor: partnerColors.line, marginVertical: 2 },
  timelineBody: { flex: 1, paddingBottom: 10 },
  timelineLabel: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  timelineAt: { fontSize: 11, color: partnerColors.textMuted, marginTop: 2 },
  next: { fontSize: 12, fontWeight: "600", color: partnerColors.primary, marginBottom: 8 },
  muted: { fontSize: 12, color: partnerColors.textMuted },
  warn: { fontSize: 11, color: partnerColors.warning, marginBottom: 6 },
});
