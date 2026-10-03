import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { coreApi } from "@/services/core/api";
import type { RequirementItemView } from "@/types/backend";

/**
 * Phase 10 §6 — what the customer must have in place, whether it is, and what to do next
 * (mirror of web BookingRequirements). Server truth; the only customer action on a professional's
 * check is "it's ready now — please check again". State is a glyph plus a word, never colour alone.
 */

const STATE: Record<RequirementItemView["state"], { glyph: string; label: string }> = {
  UNRESOLVED: { glyph: "○", label: "Your professional will check this on arrival" },
  SATISFIED: { glyph: "✓", label: "In place" },
  FAILED: { glyph: "✕", label: "Missing — needed before work can start" },
  EXPIRED: { glyph: "↻", label: "Will be checked again at the new appointment" },
};
const WHEN: Record<RequirementItemView["enforcementPoint"], string> = {
  BEFORE_BOOKING: "confirmed when you booked",
  BEFORE_ARRIVAL: "needed before your professional arrives",
  AT_START: "needed when the service starts",
};

export function BookingRequirementsCard({ bookingId, active }: { bookingId: string; active: boolean }) {
  const { colors: c } = useTheme();
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["bookings", "requirements", bookingId],
    queryFn: () => coreApi.bookings.requirements(bookingId),
    enabled: !!bookingId,
    staleTime: 10_000,
  });
  const ready = useMutation({
    mutationFn: (code: string) => coreApi.bookings.requirementAction(bookingId, code, "READY"),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["bookings", "requirements", bookingId] }),
  });
  const view = query.data;
  if (!view || !view.enforced || view.items.length === 0) return null;
  const blocked = view.items.filter((i) => i.blocking && i.blocking.remediation.role === "CUSTOMER");

  return (
    <View testID="booking-requirements" accessibilityLabel="What we need from you">
      <Text style={[styles.sectionTitle, { color: c.text }]}>What we need from you</Text>
      {active && blocked.length > 0 ? (
        <Text style={styles.alert} accessibilityRole="alert">
          Work cannot start until {blocked.length === 1 ? "this is" : "these are"} in place. Once arranged, tap “It's ready now” so your professional can check again.
        </Text>
      ) : null}
      <View style={[styles.block, { backgroundColor: c.bg, borderColor: c.border }]}>
        {view.items.map((item) => {
          const s = STATE[item.state];
          const canReady = active && item.actions.includes("READY");
          return (
            <View key={item.code} style={styles.item} testID={`booking-requirement-${item.code}`} accessibilityLabel={`${item.label}: ${s.label}`}>
              <Text style={[styles.label, { color: c.text }]}>
                {s.glyph} {item.label}
              </Text>
              <Text style={[styles.meta, { color: c.textSecondary }]}>
                {s.label} · {WHEN[item.enforcementPoint]}
              </Text>
              {item.blocking?.remediation.role === "CUSTOMER" ? <Text style={styles.remediation}>{item.blocking.remediation.text}</Text> : null}
              {canReady ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${item.label}: it's ready now, ask the professional to check again`}
                  disabled={ready.isPending}
                  onPress={() => ready.mutate(item.code)}
                  style={[styles.btn, { backgroundColor: c.primary }, ready.isPending && styles.btnDisabled]}
                >
                  <Text style={styles.btnText}>It's ready now</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        {ready.isError ? <Text style={styles.error} accessibilityRole="alert">Could not update this requirement. Please try again.</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  alert: { color: "#92400e", fontSize: 13, marginBottom: 8 },
  block: { borderWidth: 1, borderRadius: 16, padding: 12 },
  item: { paddingVertical: 8 },
  label: { fontSize: 14, fontWeight: "600" },
  meta: { fontSize: 12, marginTop: 2 },
  remediation: { fontSize: 12, color: "#92400e", marginTop: 2 },
  btn: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, justifyContent: "center", alignSelf: "flex-start", marginTop: 8 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
  error: { color: "#b91c1c", fontSize: 12, marginTop: 8 },
});
