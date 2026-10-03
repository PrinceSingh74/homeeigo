import { useQuery } from "@tanstack/react-query";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { JobChatModal } from "@/components/JobChatModal";
import { JobLifecycleActions } from "@/components/JobLifecycleActions";
import { RequirementChecklist } from "@/components/RequirementChecklist";
import { ExecutionSteps } from "@/components/ExecutionSteps";
import { SafetyPanel } from "@/components/SafetyPanel";
import { QualityPanel } from "@/components/QualityPanel";
import { EmptyState, ErrorBlock, HqCard, LoadingBlock, StatRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { useRealtimeFallbackInterval } from "@/hooks/use-partner-realtime";
import { usePartnerTrackingPublisher } from "@/hooks/use-partner-tracking-publisher";
import { setE2eGeoOverride } from "@/lib/e2e-geo";
import {
  BOOKING_LIST_FILTER,
  BOOKING_STATUS,
  bookingStatusLabel,
  bookingStatusRank,
  isActiveWorkStatus,
  isPendingStatus,
  normalizeBookingStatus,
} from "@/lib/booking-status";
import { customerName, formatCurrency, formatDateTime } from "@/lib/format";
import { getAvailableJobActions, primaryActionLabel } from "@/lib/job-action-policy";
import { toggleChecklistItem } from "@/lib/quality-checklist";
import { followUpLine } from "@/lib/follow-up";
import { CUSTOMER_CALL_AVAILABLE, CUSTOMER_CALL_UNAVAILABLE_NOTE, customerCallLabel } from "@/lib/customer-call";
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

function StatusChip({ status, arrivedAt }: { status: string; arrivedAt?: string | null }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{bookingStatusLabel(status, arrivedAt)}</Text>
    </View>
  );
}

const statusRank = bookingStatusRank;

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
  /**
   * W2-D1: the partner's ticks on the FROZEN service checklist, lifted here so the Complete CTA in
   * the footer (JobLifecycleActions) sends exactly what was ticked. `stillNeeded` is what the server
   * named after a `QUALITY_CHECKLIST_REQUIRED` refusal — those rows are unticked and flagged.
   */
  const [ticked, setTicked] = useState<string[]>([]);
  const [stillNeeded, setStillNeeded] = useState<string[]>([]);

  useEffect(() => {
    setTicked([]);
    setStillNeeded([]);
  }, [bookingId]);

  useEffect(() => {
    const latRaw = Array.isArray(e2eLat) ? e2eLat[0] : e2eLat;
    const lngRaw = Array.isArray(e2eLng) ? e2eLng[0] : e2eLng;
    const lat = latRaw != null ? Number(latRaw) : NaN;
    const lng = lngRaw != null ? Number(lngRaw) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setE2eGeoOverride(lat, lng);
    }
  }, [e2eLat, e2eLng]);

  // X-56: GET /api/bookings/:id is the source of truth for every stage this screen shows (the
  // partner's access rule includes a SENT offer), and the only booking request it makes. The list
  // queries below READ the caches the Requests tab keeps (first paint, most-advanced merge) and never
  // fetch from here — they used to fetch four lists per open and refetch all of them on every
  // booking invalidation (~13 list requests in one second).
  const detail = useQuery({
    queryKey: ["partner", "bookings", "by-id", bookingId],
    queryFn: () => partnerApi.getBooking(bookingId),
    enabled: !!bookingId,
  });

  const pendingPollMs = useRealtimeFallbackInterval(10_000, 60_000);
  // The offer feed is the only source of the live offer window: fetched (and polled) only while this
  // job is an offer, or when the booking row cannot be read (an offer that just lapsed).
  const offerFeedNeeded = detail.isError || (detail.isSuccess && isPendingStatus(detail.data?.status));
  const pending = useQuery({
    queryKey: ["partner", "bookings", "pending"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.OFFERS, limit: 20, sortBy: "recent" }),
    enabled: offerFeedNeeded,
    // Safety net for the offer window; realtime events invalidate it immediately when connected.
    refetchInterval: offerFeedNeeded ? pendingPollMs : false,
    refetchIntervalInBackground: false,
  });
  const active = useQuery({
    queryKey: ["partner", "bookings", "active"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, limit: 20, sortBy: "upcoming" }),
    enabled: false,
  });
  const completed = useQuery({
    queryKey: ["partner", "bookings", "completed"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.COMPLETED, limit: 20, sortBy: "recent" }),
    enabled: false,
  });

  const fromList = findBooking([pending.data, active.data, completed.data], bookingId);

  const candidate =
    findBooking(
      [
        detail.data ? { bookings: [detail.data] } : undefined,
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

  // Same query and cache as JobLifecycleActions: the server's safety / requirement gates and payment
  // exemption, so the hint in the body agrees with the footer button.
  const serverActions = useQuery({
    queryKey: ["partner", "job-actions", bookingId],
    queryFn: () => partnerApi.getJobActions(bookingId),
    enabled: !!bookingId && booking != null && isActiveWorkStatus(booking.status),
    staleTime: 15_000,
  });

  const evidence = useQuery({
    queryKey: ["partner", "job-evidence", bookingId],
    queryFn: () => partnerApi.listEvidence(bookingId),
    enabled: !!bookingId && !!booking,
  });

  // GPS publishing: committed, unfinished work only (IN_PROGRESS included, COMPLETED excluded).
  const isLive = booking != null && isActiveWorkStatus(booking.status);
  // Call/chat keep their previous visibility (accepted onward, including completed).
  const showComms = booking != null && statusRank(booking.status) >= 30;
  usePartnerTrackingPublisher({ bookingId: isLive ? bookingId : null, enabled: isLive });

  const loading =
    (detail.isLoading && !booking) ||
    (pending.isLoading && !booking) ||
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
  // The pending feed is the only source of the live offer window; it lists ONLY open offers.
  const pendingRow = pending.data?.bookings.find((b) => b.id === bookingId);
  // "Not in the feed" means "not an open offer" only if the feed was complete (not paginated away).
  const offerKnown =
    pending.isSuccess && (pending.data?.total ?? 0) <= (pending.data?.bookings.length ?? 0);
  const policy = getAvailableJobActions({
    ...booking,
    requirementGate: serverActions.data?.requirementGate ?? null,
    safetyGate: serverActions.data?.safetyGate ?? null,
    paymentExempt: serverActions.data?.paymentExempt ?? booking.paymentExempt === true,
  });
  const nextLabel = primaryActionLabel(policy.primaryAction);
  const disabledHint =
    (policy.primaryAction && policy.disabledReasons[policy.primaryAction]) || null;
  // The frozen checklist from GET /api/bookings/:id → execution.quality.checklist. Tickable only
  // while the work is in progress; read-only before and after.
  const checklist: readonly string[] = booking.execution?.quality?.checklist ?? [];
  const checklistTickable =
    checklist.length > 0 && normalizeBookingStatus(booking.status) === BOOKING_STATUS.IN_PROGRESS;

  function tickItem(item: string) {
    setTicked((prev) => toggleChecklistItem(checklist, prev, item));
    setStillNeeded((prev) => prev.filter((i) => i !== item));
  }

  function onChecklistRefused(needed: string[]) {
    // Server truth wins: the items it says are missing go back to unticked, and are flagged.
    setTicked((prev) => prev.filter((i) => !needed.includes(i)));
    setStillNeeded(needed);
  }

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

  const footer = (
    <JobLifecycleActions
      bookingId={booking.id}
      status={booking.status}
      enRouteAt={booking.enRouteAt}
      arrivedAt={booking.arrivedAt}
      startedAt={booking.startedAt}
      completedAt={booking.completedAt}
      paymentStatus={booking.paymentStatus}
      paymentExempt={booking.paymentExempt === true}
      customerLabel={name}
      phoneMasked={booking.customer.phoneMasked}
      bookingNumber={booking.bookingNumber}
      sticky
      hideComms
      showReject
      offer={pendingRow?.offer ?? null}
      offerKnown={offerKnown}
      eta={booking.eta}
      checklist={checklist}
      completedChecklist={ticked}
      onChecklistRefused={onChecklistRefused}
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
          <StatusChip status={booking.status} arrivedAt={booking.arrivedAt} />
          <Text style={styles.amount}>
            {formatCurrency(booking.finalAmount || booking.amount)}
          </Text>
        </View>

        {followUpLine(booking.followUp) ? (
          <View testID="job-follow-up">
            <HqCard>
              <Text style={styles.sectionTitle}>{followUpLine(booking.followUp)}</Text>
              <Text style={styles.address}>
                The customer reported an issue with the earlier visit; this visit follows up on it.
              </Text>
            </HqCard>
          </View>
        ) : null}

        <HqCard>
          <Text style={styles.sectionTitle}>Customer</Text>
          <StatRow label="Name" value={name} />
          {booking.customer.phoneMasked ? (
            <StatRow label="Phone" value={booking.customer.phoneMasked} />
          ) : null}
          <StatRow label="When" value={formatDateTime(booking.scheduledDate)} />
        </HqCard>

        {booking.job && (booking.job.variant || booking.job.unit || booking.job.addons.length || booking.job.durationMinutes) ? (
          <View testID="job-brief">
          <HqCard>
            <Text style={styles.sectionTitle}>What was booked</Text>
            {booking.job.variant ? <StatRow label="Option" value={booking.job.variant} /> : null}
            {booking.job.unit ? <StatRow label="Quantity" value={`${booking.job.quantity} ${booking.job.unit}`} /> : null}
            {booking.job.audience ? <StatRow label="For" value={booking.job.audience} /> : null}
            {booking.job.addons.length ? (
              <StatRow
                label="Add-ons"
                value={booking.job.addons.map((a) => (a.quantity > 1 ? `${a.name} × ${a.quantity}` : a.name)).join(", ")}
              />
            ) : null}
            {booking.job.durationMinutes ? <StatRow label="Expected time" value={formatMinutes(booking.job.durationMinutes)} /> : null}
            {booking.job.duration && (booking.job.duration.preparationMinutes || booking.job.duration.cleanupMinutes) ? (
              <Text style={styles.address}>
                Prep {formatMinutes(booking.job.duration.preparationMinutes)} · service {formatMinutes(booking.job.duration.serviceMinutes)} ·
                clean-up {formatMinutes(booking.job.duration.cleanupMinutes)}
              </Text>
            ) : null}
          </HqCard>
          </View>
        ) : null}

        {booking.requirements && !booking.requirements.empty ? (
          <View testID="job-preparation">
          <HqCard>
            <Text style={styles.sectionTitle}>Job preparation</Text>
            {([
              ["Materials to bring", booking.requirements.bringMaterials],
              ["Equipment to bring", booking.requirements.bringEquipment],
              ["Customer provides", booking.requirements.customerProvides],
              ["Customer preconditions", booking.requirements.preconditions],
            ] as const).map(([title, items]) =>
              items.length ? (
                <View key={title}>
                  <Text style={styles.address}>{title}</Text>
                  {items.map((r) => (
                    <Text key={r.label} style={styles.address}>
                      • {r.label}
                      {r.quantity ? ` · ${r.quantity}` : ""}
                      {r.optional ? " (optional)" : ""}
                      {r.chargeable ? " (chargeable add-on)" : ""}
                      {"check" in r ? ` — ${r.check === "CONFIRMED_BY_CUSTOMER" ? "confirmed by the customer" : r.check === "VERIFY_ON_ARRIVAL" ? "verify on arrival" : r.check === "VERIFY_AT_START" ? "verify before you start" : "for your information"}` : ""}
                      {r.instructions ? `
  ${r.instructions}` : ""}
                    </Text>
                  ))}
                </View>
              ) : null,
            )}
          </HqCard>
          </View>
        ) : null}

        {/* §6: the booking's own requirement state and the START gate — server truth. */}
        {/* §9 precedence: safety first. */}
        <SafetyPanel bookingId={booking.id} />
        <RequirementChecklist bookingId={booking.id} active={isActiveWorkStatus(booking.status)} />
        {/* §8: the booking's work plan — server truth. */}
        <ExecutionSteps bookingId={booking.id} />
        {/* §10: the recorded quality verdict (and why a complete was refused); §11: reported issues. */}
        <QualityPanel bookingId={booking.id} />

        {booking.execution && (booking.execution.materials || booking.execution.equipment || booking.execution.quality?.checklist.length) ? (
          <View testID="job-execution">
          <HqCard>
            <Text style={styles.sectionTitle}>Job requirements</Text>
            {booking.execution.materials ? <Text style={styles.address}>{booking.execution.materials}</Text> : null}
            {booking.execution.equipment ? <Text style={styles.address}>{booking.execution.equipment}</Text> : null}
            {checklistTickable ? (
              <View testID="job-quality-checklist">
                <Text style={styles.muted}>Tick each item as you finish it — all are needed to complete the job.</Text>
                {checklist.map((item) => {
                  const checked = ticked.includes(item);
                  const flagged = stillNeeded.includes(item);
                  return (
                    <Pressable
                      key={item}
                      testID="job-checklist-item"
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      accessibilityLabel={item}
                      onPress={() => tickItem(item)}
                      style={styles.checkRow}
                    >
                      <View style={[styles.checkBox, checked ? styles.checkBoxOn : null]}>
                        {checked ? <Text style={styles.checkMark}>✓</Text> : null}
                      </View>
                      <View style={styles.checkBody}>
                        <Text style={[styles.checkLabel, checked ? styles.checkLabelDone : null]}>{item}</Text>
                        {flagged && !checked ? (
                          <Text style={styles.warn} accessibilityRole="alert">
                            Still needed — the server did not receive this item
                          </Text>
                        ) : null}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              checklist.map((item) => (
                <Text key={item} style={styles.address}>
                  • {item}
                </Text>
              ))
            )}
            {booking.execution.quality?.proofRequired ? <Text style={styles.address}>Photo proof required at completion.</Text> : null}
          </HqCard>
          </View>
        ) : null}

        <HqCard>
          <Text style={styles.sectionTitle}>Location</Text>
          <Text style={styles.address}>{booking.address.fullAddress}</Text>
          <Pressable onPress={() => void openMaps()} style={styles.mapsBtn}>
            <Text style={styles.mapsText}>Open in Maps</Text>
          </Pressable>
        </HqCard>

        {showComms ? (
          <View style={styles.comms}>
            {/* X-28: no masked-call relay — the customer's number is never given to a partner; use Chat. */}
            <Pressable testID="job-call-btn" disabled accessibilityState={{ disabled: true }} accessibilityHint={CUSTOMER_CALL_UNAVAILABLE_NOTE} style={[styles.commBtn, { opacity: 0.5 }]}>
              <Text style={styles.commText}>{customerCallLabel(booking.customer.phoneMasked)}</Text>
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
        {showComms && !CUSTOMER_CALL_AVAILABLE ? <Text style={styles.warn}>{CUSTOMER_CALL_UNAVAILABLE_NOTE}</Text> : null}

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

function formatMinutes(n: number): string {
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
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
  // W2-D1 tickable checklist: 44pt rows, existing tokens only.
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, paddingVertical: 4 },
  checkBox: {
    width: 24,
    height: 24,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: partnerColors.line,
    backgroundColor: partnerColors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBoxOn: { backgroundColor: partnerColors.success, borderColor: partnerColors.success },
  checkMark: { color: partnerColors.surface, fontSize: 14, fontWeight: "800", lineHeight: 18 },
  checkBody: { flex: 1 },
  checkLabel: { fontSize: 13, lineHeight: 18, color: partnerColors.text },
  checkLabelDone: { color: partnerColors.textSecondary },
});
