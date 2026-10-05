import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Check, Circle, CircleDot, Flag, Minus } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { coreApi } from "@/services/core/api";
import { radius, spacing, type as typo } from "@/lib/typography";
import type { BackendBooking } from "@/types/backend";
import {
  BOOKING_END_NOTE,
  PROGRESS_STATE_WORD,
  deriveBookingProgress,
  type ProgressStageState,
} from "@/lib/booking-progress";

/**
 * The booking's six real stages — arrival, start check, service started, work, quality check,
 * completion — from `deriveBookingProgress` (mirror of web BookingProgressRail). Each stage shows
 * the time the server recorded and nothing when it recorded none. State is an icon plus a word,
 * never colour alone.
 */

const formatTime = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
};

const ICON: Record<ProgressStageState, typeof Check> = {
  done: Check,
  current: CircleDot,
  attention: Flag,
  upcoming: Circle,
  skipped: Minus,
  not_reached: Minus,
};

type Props = {
  bookingId: string;
  /** GET /api/bookings/:id — undefined until it has loaded. */
  booking: BackendBooking | undefined;
  loading: boolean;
  failed: boolean;
};

export function BookingProgressRail({ bookingId, booking, loading, failed }: Props) {
  const { colors: c } = useTheme();
  // Same keys as the PIN, execution and completion cards, so one fetch serves both.
  const pinQ = useQuery({
    queryKey: ["bookings", "start-pin", bookingId],
    queryFn: () => coreApi.bookings.startPin(bookingId),
    enabled: !!bookingId,
    staleTime: 5_000,
    retry: 1,
  });
  const executionQ = useQuery({
    queryKey: ["bookings", "execution", bookingId],
    queryFn: () => coreApi.bookings.execution(bookingId),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const completionQ = useQuery({
    queryKey: ["bookings", "completion", bookingId],
    queryFn: () => coreApi.bookings.completion(bookingId),
    enabled: !!bookingId,
    staleTime: 15_000,
  });

  const frame = [styles.block, { backgroundColor: c.bg, borderColor: c.border }];

  if (!booking) {
    return (
      <View style={frame} testID="booking-progress-pending" accessibilityLiveRegion="polite">
        <Text style={[styles.note, { color: c.textSecondary }]}>
          {loading
            ? "Loading progress…"
            : failed
              ? "We couldn't load this booking's progress. Check your connection and reopen the booking."
              : "Progress isn't available for this booking yet."}
        </Text>
      </View>
    );
  }

  const { stages, ended } = deriveBookingProgress({
    booking,
    startPin: pinQ.data ?? null,
    execution: executionQ.data ?? null,
    completion: completionQ.data ?? null,
  });

  const tone = (state: ProgressStageState) => {
    if (state === "done") return { border: c.success, fill: c.success, icon: "#fff", line: c.success };
    if (state === "current") return { border: c.primary, fill: c.cardBg, icon: c.primary, line: c.border };
    if (state === "attention") return { border: c.warning, fill: c.cardBg, icon: c.warning, line: c.border };
    return { border: c.border, fill: c.cardBg, icon: c.textSecondary, line: c.border };
  };

  return (
    <View style={frame} testID="booking-progress">
      {ended ? (
        <Text style={[styles.ended, { color: c.text, borderColor: c.border, backgroundColor: c.cardBg }]} testID="booking-progress-ended">
          {BOOKING_END_NOTE[ended]}
        </Text>
      ) : null}
      {stages.map((s, i) => {
        const last = i === stages.length - 1;
        const t = tone(s.state);
        const Icon = ICON[s.state];
        const time = s.at ? formatTime(s.at) : "";
        const due = s.dueAt ? formatTime(s.dueAt) : "";
        const strong = s.state === "done" || s.state === "current" || s.state === "attention";
        const spoken = [
          `Step ${i + 1} of ${stages.length}`,
          s.label,
          PROGRESS_STATE_WORD[s.state],
          time,
          due ? `confirms automatically on ${due}` : "",
          s.detail ?? "",
        ]
          .filter(Boolean)
          .join(", ");
        return (
          <View key={s.id} style={styles.row} accessible accessibilityLabel={spoken} testID={`booking-progress-${s.id}`}>
            <View style={styles.rail}>
              <View style={[styles.dot, { borderColor: t.border, backgroundColor: t.fill }]}>
                <Icon size={12} color={t.icon} strokeWidth={3} />
              </View>
              {!last ? <View style={[styles.line, { backgroundColor: t.line }]} /> : null}
            </View>
            <View style={[styles.content, last && styles.contentLast]}>
              <View style={styles.head}>
                <Text style={[styles.label, { color: strong ? c.text : c.textSecondary }, !strong && styles.labelQuiet]}>{s.label}</Text>
                <Text style={[styles.word, { color: s.state === "current" || s.state === "attention" ? c.text : c.textSecondary }]}>
                  {PROGRESS_STATE_WORD[s.state]}
                </Text>
              </View>
              {time ? <Text style={[styles.meta, { color: c.textSecondary }]}>{time}</Text> : null}
              {due ? <Text style={[styles.meta, { color: c.textSecondary }]}>Confirms automatically on {due}</Text> : null}
              {s.detail ? <Text style={[styles.meta, { color: c.textSecondary }]}>{s.detail}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg, marginBottom: spacing.xl },
  note: { ...typo.small },
  ended: { ...typo.small, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, marginBottom: spacing.md, overflow: "hidden" },
  row: { flexDirection: "row", minHeight: 44 },
  rail: { width: 32, alignItems: "center" },
  dot: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  line: { width: 2, flex: 1, marginVertical: 2, borderRadius: 1 },
  content: { flex: 1, paddingBottom: spacing.md, paddingTop: 2 },
  contentLast: { paddingBottom: 0 },
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: spacing.sm },
  label: { ...typo.bodyBold, fontSize: 14, flex: 1 },
  labelQuiet: { fontWeight: "500" },
  word: { ...typo.caption, fontWeight: "700" },
  meta: { ...typo.caption, fontSize: 12, lineHeight: 16, marginTop: 2 },
});
