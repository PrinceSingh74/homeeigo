import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { JobChatModal } from "@/components/JobChatModal";
import { StartJobOtpSheet } from "@/components/StartJobOtpSheet";
import { useOfferCountdown } from "@/hooks/use-offer-countdown";
import { isActiveWorkStatus, isPendingStatus } from "@/lib/booking-status";
import { getAvailableJobActions, primaryActionLabel } from "@/lib/job-action-policy";
import { describeAcceptFailure, formatCountdown, type OfferWindow } from "@/lib/offer";
import { getJobCoords, LOCATION_REQUIRED_MESSAGE, LOCATION_UNAVAILABLE_NOTE } from "@/lib/job-coords";
import { canCompleteChecklist, completedChecklistFor, describeChecklistRefusal } from "@/lib/quality-checklist";
import { PartnerApiError, partnerApi } from "@/services/partner-api";
import type { PartnerBooking, PartnerBookingsResponse } from "@/types/partner";
import { partnerColors } from "@/theme/colors";
import { CUSTOMER_CALL_UNAVAILABLE_NOTE, customerCallLabel } from "@/lib/customer-call";

type Props = {
  bookingId: string;
  status: string;
  enRouteAt: string | null;
  arrivedAt: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  paymentStatus?: string | null;
  /** The list's copy of the server payment exemption, used until /actions answers. */
  paymentExempt?: boolean;
  customerLabel: string;
  phoneMasked?: string | null;
  bookingNumber: string;
  /** Sticky primary CTA style for job detail footer */
  sticky?: boolean;
  /** Hide Call/Chat (detail screen hosts them separately) */
  hideComms?: boolean;
  /** Hide Accept/Reject pair — detail handles reject separately if needed */
  showReject?: boolean;
  /**
   * The live offer window from the pending list (`offer` on the row). Only meaningful while PENDING.
   * `null` with `offerKnown` = the pending feed no longer lists this job → it is not an open offer.
   */
  offer?: OfferWindow | null;
  /** True once the pending feed has loaded, so "no offer" can be trusted as "offer closed". */
  offerKnown?: boolean;
  /** Server-computed ETA on the booking (minutes). Never invented client-side. */
  eta?: number | null;
  /**
   * W2-D1: the booking's FROZEN service quality checklist (`execution.quality.checklist`) and the
   * items the partner has ticked on the detail screen. Complete stays disabled until every item is
   * ticked, and only the ticked items are sent — never a list the partner did not tick.
   */
  checklist?: readonly string[];
  completedChecklist?: readonly string[];
  /** The server refused with `QUALITY_CHECKLIST_REQUIRED`: these frozen items are still needed. */
  onChecklistRefused?: (stillNeeded: string[]) => void;
};

async function pickEvidenceDataUrl(): Promise<string | undefined> {
  try {
    const picked = await Promise.race([
      ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        quality: 0.7,
        base64: true,
      }),
      new Promise<{ canceled: true }>((resolve) => {
        setTimeout(() => resolve({ canceled: true }), 12_000);
      }),
    ]);
    if (!picked.canceled && "assets" in picked && picked.assets?.[0]?.base64) {
      const mime = picked.assets[0].mimeType ?? "image/jpeg";
      return `data:${mime};base64,${picked.assets[0].base64}`;
    }
  } catch {
    /* optional */
  }
  return undefined;
}

/**
 * Shared accept → en-route → arrive → start OTP → complete CTAs.
 * Reused by RequestsScreen (if needed) and JobDetailScreen — one lifecycle, no second FSM.
 */
export function JobLifecycleActions({
  bookingId,
  status,
  enRouteAt,
  arrivedAt,
  startedAt,
  completedAt,
  paymentStatus,
  paymentExempt = false,
  customerLabel,
  phoneMasked,
  bookingNumber,
  sticky = false,
  hideComms = false,
  showReject = true,
  offer = null,
  offerKnown = false,
  eta = null,
  checklist = [],
  completedChecklist = [],
  onChecklistRefused,
}: Props) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["partner", "bookings"] });
    void qc.invalidateQueries({ queryKey: ["partner", "bookings", "by-id", bookingId] });
    void qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] });
    // Phase 10 panels on the detail screen read state a lifecycle transition changes (work steps
    // unblock on start; verdict and completion appear on complete). Without this they kept showing
    // the pre-transition answer — "Blocked", no step buttons — until the screen was left.
    for (const panel of ["execution", "requirements", "safety", "quality", "completion", "cases", "job-actions"]) {
      void qc.invalidateQueries({ queryKey: ["partner", panel, bookingId] });
    }
  };
  const [otpOpen, setOtpOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [coordsWarning, setCoordsWarning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // §6: the START requirement gate is the server's to know — the local policy mirror cannot compute it.
  const actionsQuery = useQuery({
    queryKey: ["partner", "job-actions", bookingId],
    queryFn: () => partnerApi.getJobActions(bookingId),
    enabled: isActiveWorkStatus(status),
    staleTime: 15_000,
  });

  const policy = getAvailableJobActions({
    status,
    enRouteAt,
    arrivedAt,
    startedAt,
    completedAt,
    paymentStatus,
    requirementGate: actionsQuery.data?.requirementGate ?? null,
    safetyGate: actionsQuery.data?.safetyGate ?? null,
    paymentExempt: actionsQuery.data?.paymentExempt ?? paymentExempt,
  });
  const primaryLabel = primaryActionLabel(policy.primaryAction);
  // W2-D1: the client gate mirrors the server's item-by-item match; the server stays the authority.
  const checklistGate =
    policy.primaryAction === "COMPLETE_SERVICE"
      ? canCompleteChecklist(checklist, completedChecklist)
      : null;
  const disabledHint =
    (policy.primaryAction && policy.disabledReasons[policy.primaryAction]) ||
    (policy.requiredGates.includes("PAYMENT_SETTLED")
      ? "Payment confirmation pending"
      : null) ||
    (checklistGate && !checklistGate.allowed ? checklistGate.hint : null);

  const countdown = useOfferCountdown(isPendingStatus(status) ? offer : null);
  /**
   * An offer the partner can no longer win must not look like one they can: past its deadline
   * (server-time estimate), or absent from the live pending feed.
   */
  const offerClosed =
    isPendingStatus(status) && ((countdown?.expired ?? false) || (offerKnown && !offer));

  const removeFromPending = () => {
    qc.setQueriesData<PartnerBookingsResponse>({ queryKey: ["partner", "bookings"] }, (old) => {
      if (!old?.bookings) return old;
      const next = old.bookings.filter((b) => !(b.id === bookingId && isPendingStatus(b.status)));
      return next.length === old.bookings.length ? old : { ...old, bookings: next };
    });
  };

  const accept = useMutation({
    // ETA: the booking's own server-computed value, or none (the server then derives it from the
    // partner's live location). A hard-coded client number would be an invented ETA.
    mutationFn: () =>
      partnerApi.acceptBooking(bookingId, typeof eta === "number" && eta >= 1 ? eta : undefined),
    onMutate: () => setActionError(null),
    onSuccess: (data) => {
      const st = data.booking.status;
      qc.setQueryData(["partner", "bookings", "by-id", bookingId], (prev: PartnerBooking | undefined) =>
        prev ? { ...prev, status: st } : prev,
      );
      removeFromPending();
      invalidate();
      void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
      void qc.invalidateQueries({ queryKey: ["partner", "dashboard"] });
    },
    onError: (err) => {
      const failure =
        err instanceof PartnerApiError
          ? describeAcceptFailure(err.code, err.message)
          : describeAcceptFailure("NETWORK_ERROR");
      setActionError(failure.message);
      if (failure.offerGone) removeFromPending();
      // Always resync with the server: its answer is the truth about this offer.
      invalidate();
      void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
    },
  });
  const reject = useMutation({
    mutationFn: () => partnerApi.rejectBooking(bookingId, "Not available"),
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof Error ? err.message : "Reject failed"),
  });
  const enRoute = useMutation({
    mutationFn: async () => {
      setActionError(null);
      const c = await getJobCoords("soft");
      setCoordsWarning(c ? null : LOCATION_UNAVAILABLE_NOTE);
      return partnerApi.markEnRoute(bookingId, c?.latitude ?? null, c?.longitude ?? null);
    },
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof Error ? err.message : "Could not mark en route"),
  });
  const arrived = useMutation({
    mutationFn: async () => {
      setActionError(null);
      setCoordsWarning(null);
      const c = await getJobCoords("strict");
      if (!c) throw new Error(LOCATION_REQUIRED_MESSAGE);
      return partnerApi.markArrived(bookingId, c.latitude, c.longitude);
    },
    onSuccess: invalidate,
    onError: (err) =>
      setActionError(
        err instanceof Error
          ? err.message
          : "Move closer to the service location and try again",
      ),
  });
  const start = useMutation({
    mutationFn: async (otp?: string) => {
      setActionError(null);
      setCoordsWarning(null);
      const c = await getJobCoords("strict");
      if (!c) throw new Error(LOCATION_REQUIRED_MESSAGE);
      return partnerApi.startBooking(bookingId, c.latitude, c.longitude, otp);
    },
    onSuccess: invalidate,
    onError: (err) =>
      setActionError(
        err instanceof Error
          ? err.message
          : "Move closer to the service location and try again",
      ),
  });
  const complete = useMutation({
    mutationFn: async () => {
      setActionError(null);
      const c = await getJobCoords("soft");
      setCoordsWarning(c ? null : LOCATION_UNAVAILABLE_NOTE);
      const mediaUrl = await pickEvidenceDataUrl();
      const photos = mediaUrl ? [mediaUrl] : undefined;
      // Only the items the partner ticked, as exact frozen strings; key omitted when there is no checklist.
      const result = await partnerApi.completeBooking(
        bookingId,
        c?.latitude ?? null,
        c?.longitude ?? null,
        undefined,
        photos,
        completedChecklistFor(checklist, completedChecklist),
      );
      if (mediaUrl) {
        await partnerApi
          .uploadEvidence(bookingId, {
            stage: "COMPLETION",
            mediaUrl,
            clientUploadId: `m-cmp-${Date.now()}`,
            replace: true,
            ...(c ? { latitude: c.latitude, longitude: c.longitude } : {}),
          })
          .catch(() => undefined);
      }
      return result;
    },
    onSuccess: invalidate,
    onError: async (err) => {
      const code = err instanceof PartnerApiError ? err.code : null;
      const message = err instanceof Error ? err.message : "Complete failed";
      if (code !== "QUALITY_CHECKLIST_REQUIRED") {
        setActionError(message);
        return;
      }
      // The refusal names what is missing in the quality history's last entry, not in the 409 body.
      let serverMissing: string[] | null = null;
      try {
        const quality = await partnerApi.getQuality(bookingId);
        const last = quality.history[quality.history.length - 1];
        serverMissing = last ? last.missingChecklistItems : null;
      } catch {
        /* fall back to "every item" below */
      }
      const refusal = describeChecklistRefusal(code, message, checklist, serverMissing);
      setActionError(refusal.message);
      onChecklistRefused?.(refusal.stillNeeded);
      void qc.invalidateQueries({ queryKey: ["partner", "quality", bookingId] });
    },
  });

  const pending = isPendingStatus(status);
  const busy =
    accept.isPending ||
    reject.isPending ||
    enRoute.isPending ||
    arrived.isPending ||
    start.isPending ||
    complete.isPending;

  const isActive = isActiveWorkStatus(status);

  function runPrimary() {
    const action = policy.primaryAction;
    if (!action || busy) return;
    if (action === "ACCEPT") {
      if (!offerClosed) accept.mutate();
    } else if (action === "START_NAVIGATION") enRoute.mutate();
    else if (action === "MARK_ARRIVED") arrived.mutate();
    else if (action === "START_SERVICE") setOtpOpen(true);
    else if (action === "COMPLETE_SERVICE") complete.mutate();
  }

  const primaryPending =
    (policy.primaryAction === "ACCEPT" && accept.isPending) ||
    (policy.primaryAction === "START_NAVIGATION" && enRoute.isPending) ||
    (policy.primaryAction === "MARK_ARRIVED" && arrived.isPending) ||
    (policy.primaryAction === "COMPLETE_SERVICE" && complete.isPending);

  return (
    <View
      style={[
        styles.wrap,
        sticky && styles.stickyWrap,
        sticky && { paddingBottom: Math.max(16, insets.bottom + 8) },
      ]}
    >
      {coordsWarning ? <Text style={styles.warn}>{coordsWarning}</Text> : null}
      {actionError ? <Text style={styles.warn}>{actionError}</Text> : null}
      {disabledHint ? <Text style={styles.hint}>{disabledHint}</Text> : null}
      {policy.primaryAction === "START_SERVICE" &&
      policy.requiredGates.includes("START_OTP_VERIFIED") &&
      !disabledHint ? (
        <Text style={styles.hint}>Customer OTP required — tap Start job to enter PIN</Text>
      ) : null}
      {policy.primaryAction && !disabledHint && !offerClosed ? (
        <Text style={styles.next}>Next: {primaryLabel}</Text>
      ) : null}

      {!hideComms && isActive ? (
        <View style={styles.actions}>
          {/* X-28: no masked-call relay — the customer's number is never given to a partner; use Chat. */}
          <Pressable
            testID="job-call-btn"
            disabled
            accessibilityState={{ disabled: true }}
            accessibilityHint={CUSTOMER_CALL_UNAVAILABLE_NOTE}
            style={[styles.secondaryBtn, { opacity: 0.5 }]}
          >
            <Text style={styles.secondaryText}>{customerCallLabel(phoneMasked)}</Text>
          </Pressable>
          <Pressable
            testID="job-chat-btn"
            onPress={() => setChatOpen(true)}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryText}>Chat</Text>
          </Pressable>
        </View>
      ) : null}

      {pending && offerClosed ? (
        <Text testID="job-offer-closed" style={styles.closed}>
          {countdown?.expired
            ? "This request timed out before it was answered and has gone to another partner."
            : "This request is no longer open for you — it was taken, withdrawn or has expired."}
        </Text>
      ) : pending && showReject ? (
        <>
          {countdown ? (
            <Text
              testID="job-offer-countdown"
              style={[
                styles.countdown,
                countdown.urgency === "critical"
                  ? styles.countdownCritical
                  : countdown.urgency === "warning"
                    ? styles.countdownWarning
                    : null,
              ]}
            >
              Respond within {formatCountdown(countdown.secondsLeft)}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Pressable
              testID="job-primary-cta"
              disabled={busy || offerClosed}
              onPress={() => {
                if (!offerClosed) accept.mutate();
              }}
              style={[styles.acceptBtn, (busy || offerClosed) && styles.acceptDisabled]}
            >
              {accept.isPending ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.acceptText}>Accept</Text>
              )}
            </Pressable>
            <Pressable disabled={busy} onPress={() => reject.mutate()} style={styles.rejectBtn}>
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
          </View>
        </>
      ) : primaryLabel && !pending ? (
        <Pressable
          testID="job-primary-cta"
          disabled={busy || !!disabledHint}
          onPress={runPrimary}
          style={[styles.acceptBtn, styles.soloBtn, (busy || disabledHint) && styles.acceptDisabled]}
        >
          {primaryPending ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.acceptText}>{primaryLabel}</Text>
          )}
        </Pressable>
      ) : null}

      <StartJobOtpSheet
        bookingId={bookingId}
        customerName={customerLabel}
        visible={otpOpen}
        onClose={() => setOtpOpen(false)}
        onStart={async (otp) => {
          await start.mutateAsync(otp);
        }}
      />
      {!hideComms ? (
        <JobChatModal
          bookingId={bookingId}
          customerName={customerLabel}
          bookingNumber={bookingNumber}
          phoneMasked={phoneMasked}
          visible={chatOpen}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 8 },
  stickyWrap: {
    marginTop: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: partnerColors.line,
    backgroundColor: "rgba(246,241,214,0.96)",
  },
  actions: { flexDirection: "row", gap: 8 },
  acceptBtn: {
    flex: 1,
    backgroundColor: partnerColors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  // The lone primary CTA sits in the column wrap, where acceptBtn's `flex: 1` (meant for the
  // Accept/Reject row) means flexBasis 0: the button collapsed to its padding and Android clipped
  // the label. Size it by its content instead, at least 44pt tall.
  soloBtn: { flex: 0, minHeight: 44, justifyContent: "center" },
  acceptDisabled: { opacity: 0.5 },
  acceptText: { color: "#fff", fontWeight: "700" },
  rejectBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: "center",
  },
  rejectText: { color: partnerColors.textMuted, fontWeight: "700" },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: "center",
    backgroundColor: partnerColors.surface,
  },
  secondaryText: { color: partnerColors.primary, fontWeight: "700", fontSize: 12 },
  warn: { fontSize: 11, color: partnerColors.warning, marginBottom: 2 },
  hint: { fontSize: 11, color: partnerColors.textMuted },
  next: { fontSize: 11, fontWeight: "600", color: partnerColors.primary },
  countdown: { fontSize: 13, fontWeight: "700", color: partnerColors.success },
  countdownWarning: { color: partnerColors.warning },
  countdownCritical: { color: partnerColors.danger },
  closed: {
    fontSize: 12,
    color: partnerColors.textMuted,
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 10,
    padding: 10,
    textAlign: "center",
  },
});
