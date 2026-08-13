import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock3, ShieldCheck } from "lucide-react-native";
import { coreApi } from "@/services/core/api";

/**
 * Customer's service-start PIN (Urban-Company style).
 *
 * The partner cannot begin work until the customer reads this PIN back in
 * person at the door. Polls quietly while the job hasn't started so the PIN
 * lights up the moment the partner requests it; stops once verified.
 */
export function ServiceStartPinCard({
  bookingId,
  proName,
}: {
  bookingId: string;
  proName?: string | null;
}) {
  const pinQ = useQuery({
    queryKey: ["start-pin", bookingId],
    queryFn: () => coreApi.bookings.startPin(bookingId),
    enabled: !!bookingId,
    staleTime: 5_000,
    retry: 1,
    refetchInterval: (queryRef) =>
      queryRef.state.data?.state === "verified" ? false : 10_000,
  });

  const data = pinQ.data;

  const [now, setNow] = useState(() => Date.now());
  const expiresMs = data?.expiresAt ? new Date(data.expiresAt).getTime() : null;
  useEffect(() => {
    if (data?.state !== "active" || !expiresMs) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [data?.state, expiresMs]);

  if (!data) return null;

  const secondsLeft = expiresMs ? Math.max(0, Math.floor((expiresMs - now) / 1000)) : null;
  const countdown =
    secondsLeft != null
      ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}`
      : null;
  const isActive = data.state === "active" && Boolean(data.pin) && (secondsLeft ?? 1) > 0;
  const partnerLabel = proName?.trim() || "your professional";

  if (data.state === "verified") {
    return (
      <View style={[styles.card, styles.cardVerified]}>
        <View style={[styles.iconWrap, { backgroundColor: "rgba(16,185,129,0.14)" }]}>
          <CheckCircle2 size={18} color="#059669" />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.titleText}>PIN verified</Text>
          <Text style={styles.subText}>Your service has started.</Text>
        </View>
      </View>
    );
  }

  if (isActive) {
    return (
      <View style={[styles.card, styles.cardActive]}>
        <View style={styles.activeHeader}>
          <View style={styles.activeHeaderLeft}>
            <View style={styles.shieldBadge}>
              <ShieldCheck size={16} color="#fff" />
            </View>
            <View>
              <Text style={styles.eyebrow}>SERVICE START PIN</Text>
              <Text style={styles.subText}>Share in person with {partnerLabel}</Text>
            </View>
          </View>
          {countdown ? (
            <View style={styles.countdownPill}>
              <Clock3 size={11} color="#047857" />
              <Text style={styles.countdownText}>{countdown}</Text>
            </View>
          ) : null}
        </View>

        <View style={styles.digitsRow}>
          {(data.pin ?? "").split("").map((digit, i) => (
            <View key={`${i}-${digit}`} style={styles.digitBox}>
              <Text style={styles.digitText}>{digit}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.noteText}>
          Only share this PIN face-to-face at your door. HOMEEIGO staff will never call asking
          for it.
        </Text>
      </View>
    );
  }

  // waiting — PIN not requested yet
  return (
    <View style={[styles.card, styles.cardWaiting]}>
      <View style={[styles.iconWrap, { backgroundColor: "rgba(16,185,129,0.1)" }]}>
        <ShieldCheck size={18} color="#059669" />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.titleText}>Start PIN protection is on</Text>
        <Text style={styles.subText}>
          A 6-digit PIN will appear here when {partnerLabel} is ready to begin.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    borderRadius: 18,
    borderWidth: 1,
  },
  cardActive: {
    padding: 14,
    backgroundColor: "#ecfdf5",
    borderColor: "rgba(16,185,129,0.35)",
  },
  cardVerified: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    backgroundColor: "rgba(16,185,129,0.07)",
    borderColor: "rgba(16,185,129,0.25)",
  },
  cardWaiting: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 13,
    backgroundColor: "#f8fafc",
    borderColor: "#e2e8f0",
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  shieldBadge: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: "#059669",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  activeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  activeHeaderLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1, minWidth: 0 },
  eyebrow: { fontSize: 10, fontWeight: "900", letterSpacing: 1.2, color: "#047857" },
  titleText: { fontSize: 14, fontWeight: "800", color: "#0f172a" },
  subText: { fontSize: 11.5, fontWeight: "600", color: "#64748b", marginTop: 1 },
  countdownPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(16,185,129,0.12)",
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
  },
  countdownText: { fontSize: 11, fontWeight: "800", color: "#047857", fontVariant: ["tabular-nums"] },
  digitsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
    marginTop: 14,
  },
  digitBox: {
    width: 40,
    height: 50,
    borderRadius: 12,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.3)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  digitText: { fontSize: 22, fontWeight: "900", color: "#047857", letterSpacing: -0.5 },
  noteText: { fontSize: 10.5, fontWeight: "600", color: "#64748b", marginTop: 12, lineHeight: 15 },
});
