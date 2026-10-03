import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { coreApi } from "@/services/core/api";

/**
 * Phase 10 §8 — "What was done" (mirror of web BookingExecution). Step titles and states from the
 * server; the professional's notes and reasons are never shown. Glyph + word, never colour alone.
 */
const STATE: Record<string, { glyph: string; label: string }> = {
  COMPLETED: { glyph: "✓", label: "Done" },
  IN_PROGRESS: { glyph: "▶", label: "In progress" },
  SKIPPED_WITH_REASON: { glyph: "–", label: "Not needed" },
  FAILED: { glyph: "✕", label: "Could not be done — our team is on it" },
  ESCALATED: { glyph: "!", label: "With our support team" },
};
const PENDING = { glyph: "○", label: "Not started" };

export function BookingExecutionCard({ bookingId }: { bookingId: string }) {
  const { colors: c } = useTheme();
  const query = useQuery({
    queryKey: ["bookings", "execution", bookingId],
    queryFn: () => coreApi.bookings.execution(bookingId),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const view = query.data;
  if (!view || !view.enforced || view.steps.length === 0) return null;
  const done = view.steps.filter((s) => s.state === "COMPLETED").length;
  return (
    <View testID="booking-execution" accessibilityLabel={`What was done, ${done} of ${view.steps.length}`}>
      <Text style={[styles.title, { color: c.text }]}>
        What was done <Text style={{ color: c.textSecondary }}>· {done} of {view.steps.length}</Text>
      </Text>
      <View style={[styles.block, { backgroundColor: c.bg, borderColor: c.border }]}>
        {view.steps.map((s) => {
          const st = STATE[s.state] ?? PENDING;
          return (
            <Text key={s.code} style={[styles.row, { color: c.text }]} testID={`booking-step-${s.code}`} accessibilityLabel={`Step ${s.stepNumber}, ${s.title}: ${st.label}`}>
              {st.glyph} {s.stepNumber}. {s.title} <Text style={{ color: c.textSecondary }}>· {st.label}</Text>
            </Text>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  block: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 6 },
  row: { fontSize: 14 },
});
