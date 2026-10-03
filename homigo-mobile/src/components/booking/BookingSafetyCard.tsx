import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { coreApi } from "@/services/core/api";

/**
 * Phase 10 §9 — safety information the customer was given at booking and, if work is paused for
 * safety, a plain explanation (mirror of web BookingSafety). Server truth.
 */
export function BookingSafetyCard({ bookingId }: { bookingId: string }) {
  const { colors: c } = useTheme();
  const q = useQuery({ queryKey: ["bookings", "safety", bookingId], queryFn: () => coreApi.bookings.safety(bookingId), enabled: !!bookingId, staleTime: 15_000 });
  const v = q.data;
  const s = v?.safety;
  const has = !!s && (s.warnings.length || s.customerRequirements.length || s.information || s.medicalDisclaimer || s.emergencyProtocol);
  if (!v || (!has && v.gate.ok)) return null;
  return (
    <View testID="booking-safety">
      <Text style={[styles.title, { color: c.text }]}>Safety</Text>
      {!v.gate.ok ? (
        <Text style={styles.hold} accessibilityRole="alert">
          ⛔ Work is paused for safety{v.holds.length ? `: ${v.holds.map((h) => h.condition).join(", ")}` : ""}. Our safety team is looking into it and will contact you.
        </Text>
      ) : null}
      <View style={[styles.block, { backgroundColor: c.bg, borderColor: c.border }]}>
        {s?.information ? <Text style={{ color: c.text }}>{s.information}</Text> : null}
        {s?.customerRequirements.map((r) => <Text key={r} style={{ color: c.text }}>• {r}</Text>)}
        {s?.warnings.map((w) => <Text key={w} style={styles.warn}>⚠ {w}</Text>)}
        {s?.medicalDisclaimer ? <Text style={[styles.small, { color: c.textSecondary }]}>{s.medicalDisclaimer}</Text> : null}
        {s?.emergencyProtocol ? <Text style={[styles.small, { color: c.textSecondary }]}>In an emergency: {s.emergencyProtocol}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  hold: { color: "#991b1b", fontSize: 13, fontWeight: "600", marginBottom: 8 },
  block: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 6 },
  warn: { color: "#92400e" },
  small: { fontSize: 12 },
});
