import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { JobChatModal } from "@/components/JobChatModal";
import { StartJobOtpSheet } from "@/components/StartJobOtpSheet";
import { getAvailableJobActions, primaryActionLabel } from "@/lib/job-action-policy";
import { getJobCoords } from "@/lib/job-coords";
import { partnerApi } from "@/services/partner-api";
import type { PartnerBooking } from "@/types/partner";
import { partnerColors } from "@/theme/colors";

type Props = {
  bookingId: string;
  status: string;
  enRouteAt: string | null;
  arrivedAt: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  paymentStatus?: string | null;
  customerLabel: string;
  phoneMasked?: string | null;
  bookingNumber: string;
  /** Sticky primary CTA style for job detail footer */
  sticky?: boolean;
  /** Hide Call/Chat (detail screen hosts them separately) */
  hideComms?: boolean;
  /** Hide Accept/Reject pair — detail handles reject separately if needed */
  showReject?: boolean;
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
  customerLabel,
  phoneMasked,
  bookingNumber,
  sticky = false,
  hideComms = false,
  showReject = true,
}: Props) {
  const qc = useQueryClient();
  const insets = useSafeAreaInsets();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["partner", "bookings"] });
    void qc.invalidateQueries({ queryKey: ["partner", "bookings", "by-id", bookingId] });
    void qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] });
  };
  const [otpOpen, setOtpOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [coordsWarning, setCoordsWarning] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const policy = getAvailableJobActions({
    status,
    enRouteAt,
    arrivedAt,
    startedAt,
    completedAt,
    paymentStatus,
  });
  const primaryLabel = primaryActionLabel(policy.primaryAction);
  const disabledHint =
    (policy.primaryAction && policy.disabledReasons[policy.primaryAction]) ||
    (policy.requiredGates.includes("PAYMENT_SETTLED")
      ? "Payment confirmation pending"
      : null);

  const accept = useMutation({
    mutationFn: () => partnerApi.acceptBooking(bookingId, 30),
    onSuccess: (data) => {
      const st = data.booking.status;
      qc.setQueryData(["partner", "bookings", "by-id", bookingId], (prev: PartnerBooking | undefined) =>
        prev ? { ...prev, status: st } : prev,
      );
      qc.setQueryData(
        ["partner", "bookings", "pending"],
        (old: { bookings?: Array<{ id: string; status: string }> } | undefined) => {
          if (!old?.bookings) return old;
          return {
            ...old,
            bookings: old.bookings.map((b) => (b.id === bookingId ? { ...b, status: st } : b)),
          };
        },
      );
      invalidate();
    },
    onError: (err) => setActionError(err instanceof Error ? err.message : "Accept failed"),
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
      if (c.warning) setCoordsWarning(c.warning);
      return partnerApi.markEnRoute(bookingId, c.latitude, c.longitude);
    },
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof Error ? err.message : "Could not mark en route"),
  });
  const arrived = useMutation({
    mutationFn: async () => {
      setActionError(null);
      setCoordsWarning(null);
      const c = await getJobCoords("strict");
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
      if (c.warning) setCoordsWarning(c.warning);
      // Complete first; optional evidence must not block earnings posting.
      const result = await partnerApi.completeBooking(
        bookingId,
        c.latitude,
        c.longitude,
        undefined,
        undefined,
      );
      const mediaUrl = await pickEvidenceDataUrl();
      if (mediaUrl) {
        await partnerApi
          .uploadEvidence(bookingId, {
            stage: "COMPLETION",
            mediaUrl,
            clientUploadId: `m-cmp-${Date.now()}`,
            replace: true,
            latitude: c.latitude,
            longitude: c.longitude,
          })
          .catch(() => undefined);
      }
      return result;
    },
    onSuccess: invalidate,
    onError: (err) => setActionError(err instanceof Error ? err.message : "Complete failed"),
  });

  const statusNorm = String(status).toLowerCase().replace(/-/g, "_");
  const busy =
    accept.isPending ||
    reject.isPending ||
    enRoute.isPending ||
    arrived.isPending ||
    start.isPending ||
    complete.isPending;

  const isActive =
    statusNorm === "accepted" || statusNorm === "assigned" || statusNorm === "en_route" || statusNorm === "in_progress";

  async function callCustomer() {
    setActionError(null);
    try {
      const data = await partnerApi.initiateCall(bookingId);
      await Linking.openURL(data.dialUri);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not start call");
    }
  }

  function runPrimary() {
    const action = policy.primaryAction;
    if (!action || busy) return;
    if (action === "ACCEPT") accept.mutate();
    else if (action === "START_NAVIGATION") enRoute.mutate();
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
      {policy.primaryAction && !disabledHint ? (
        <Text style={styles.next}>Next: {primaryLabel}</Text>
      ) : null}

      {!hideComms && isActive ? (
        <View style={styles.actions}>
          <Pressable
            testID="job-call-btn"
            onPress={() => void callCustomer()}
            style={styles.secondaryBtn}
          >
            <Text style={styles.secondaryText}>
              {phoneMasked ? `Call ${phoneMasked}` : "Call"}
            </Text>
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

      {statusNorm === "pending" && showReject ? (
        <View style={styles.actions}>
          <Pressable
            testID="job-primary-cta"
            disabled={busy}
            onPress={() => accept.mutate()}
            style={styles.acceptBtn}
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
      ) : primaryLabel && statusNorm !== "pending" ? (
        <Pressable
          testID="job-primary-cta"
          disabled={busy || !!disabledHint}
          onPress={runPrimary}
          style={[styles.acceptBtn, (busy || disabledHint) && styles.acceptDisabled]}
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
});
