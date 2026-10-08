import React, { useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Calendar, Clock } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { spacing, type, radius } from "@/lib/typography";
import {
  applyDatePart,
  applyTimePart,
  formatDateLabel,
  formatTimeLabel,
  sameCalendarDay,
} from "@/lib/booking-datetime";
import { rescheduleErrorMessage, useRescheduleBookingMutation } from "@/hooks/use-reschedule-booking";
import { useRescheduleQuoteQuery } from "@/hooks/use-core-data";
import { useAvailabilityQuery } from "@/hooks/use-core-data";

/** Same lead time the web reschedule modal enforces. */
const MIN_LEAD_MS = 60 * 60 * 1000;

type Props = {
  bookingId: string;
  /** Current slot from the server (GET /api/bookings/:id), or null while it loads. */
  currentScheduledAt: Date | null;
  /** Needed to ask the server which slots it will actually accept for the chosen day. */
  serviceId?: string | null;
  onCancel: () => void;
  onDone: () => void;
};

/** Customer-safe wording for a slot the server refused. Matches the web app's copy (parity). */
const SLOT_REASON_COPY: Record<string, string> = {
  SLOT_IN_PAST: "This time has passed",
  LEAD_TIME_NOT_MET: "Too soon — needs more notice",
  BEYOND_ADVANCE_WINDOW: "Too far ahead",
  SAME_DAY_UNAVAILABLE: "Not available same day",
  BLACKOUT_DATE: "Not available on this date",
  OUTSIDE_WORKING_HOURS: "No professional works at this time",
  PROVIDER_BUSY: "Fully booked",
  NO_QUALIFIED_PROVIDER: "No professional available",
  CUSTOMER_HAS_BOOKING: "You already have a booking at this time",
  PARTNER_OFFLINE: "Your chosen professional isn't online for this time — pick a later date",
};

/** YYYY-MM-DD in the business timezone, which is what the availability endpoint expects. */
function businessDate(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/**
 * Reschedule a booking: PUT /api/bookings/:id { scheduledDate }. The server checks the customer's
 * and the partner's calendars; its refusal (overlap, partner unavailable, already started) is shown
 * as returned, and nothing changes locally until it succeeds.
 */
export function RescheduleBookingPanel({ bookingId, currentScheduledAt, serviceId, onCancel, onDone }: Props) {
  const { colors: c, isDark } = useTheme();
  const reschedule = useRescheduleBookingMutation();
  const [picked, setPicked] = useState<Date>(() => {
    const base = currentScheduledAt && currentScheduledAt.getTime() > Date.now() + MIN_LEAD_MS
      ? currentScheduledAt
      : new Date(Date.now() + 2 * MIN_LEAD_MS);
    const d = new Date(base);
    d.setSeconds(0, 0);
    return d;
  });
  /**
   * The times the SERVER will accept for the chosen day. §44: the mobile app must not decide
   * availability. The hardcoded six times this replaces were a client guess the backend had never
   * agreed to, so a customer could pick a slot the server then refused with PROVIDER_UNAVAILABLE.
   */
  // The booking being moved must not block its own new time (the server excludes it the same way).
  const availability = useAvailabilityQuery({ serviceId, date: businessDate(picked), excludeBookingId: bookingId });
  /**
   * §45 / O6: what this move costs, from the SERVER. The client shows the number and never
   * works the percentage out itself — the fee is priced by the policy frozen on the booking,
   * which a client cannot see.
   */
  const feeQuote = useRescheduleQuoteQuery(bookingId, true);
  const fee = feeQuote.data?.quote;
  const serverSlots = availability.data?.slots;

  const [picker, setPicker] = useState<"date" | "time" | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const days = useMemo(() => {
    const out: Date[] = [];
    const t = new Date();
    t.setHours(0, 0, 0, 0);
    for (let i = 0; i < 7; i++) {
      const d = new Date(t);
      d.setDate(t.getDate() + i);
      out.push(d);
    }
    return out;
  }, []);

  const tooSoon = picked.getTime() < Date.now() + MIN_LEAD_MS;
  const unchanged = !!currentScheduledAt && Math.abs(currentScheduledAt.getTime() - picked.getTime()) < 60_000;

  function choose(next: Date) {
    Haptics.selectionAsync();
    setError(null);
    setConfirming(false);
    setPicked(next);
  }

  function submit() {
    if (tooSoon) {
      setError("Please pick a time at least 1 hour from now.");
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setError(null);
    reschedule.mutate(
      { bookingId, scheduledAt: picked },
      {
        onSuccess: () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          onDone();
        },
        onError: (e) => {
          setConfirming(false);
          setError(rescheduleErrorMessage(e));
        },
      },
    );
  }

  return (
    <View style={[styles.panel, { borderColor: c.border, backgroundColor: c.cardBg }]}>
      <Text style={[styles.title, { color: c.text }]}>Reschedule booking</Text>
      {currentScheduledAt ? (
        <Text style={[styles.body, { color: c.textSecondary }]}>
          Currently {formatDateLabel(currentScheduledAt)} · {formatTimeLabel(currentScheduledAt)}
        </Text>
      ) : null}

      <View style={styles.row}>
        <Pressable
          onPress={() => setPicker("date")}
          style={[styles.pickBtn, { borderColor: c.border }]}
          accessibilityRole="button"
          accessibilityLabel="Pick a new date"
        >
          <Calendar size={16} color={c.primary} />
          <Text style={[styles.pickText, { color: c.text }]}>{formatDateLabel(picked)}</Text>
        </Pressable>
        <Pressable
          onPress={() => setPicker("time")}
          style={[styles.pickBtn, { borderColor: c.border }]}
          accessibilityRole="button"
          accessibilityLabel="Pick a new time"
        >
          <Clock size={16} color={c.primary} />
          <Text style={[styles.pickText, { color: c.text }]}>{formatTimeLabel(picked)}</Text>
        </Pressable>
      </View>

      <View style={styles.chips}>
        {days.map((d) => {
          const active = sameCalendarDay(d, picked);
          return (
            <Pressable
              key={d.toISOString()}
              onPress={() => choose(applyDatePart(picked, d))}
              style={[styles.chip, active ? { backgroundColor: c.primary } : { borderColor: c.border, borderWidth: 1 }]}
            >
              <Text style={[styles.chipText, { color: active ? "#fff" : c.text }]}>
                {d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric" })}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.chips}>
        {(serverSlots ?? []).length > 0
          ? serverSlots!.map((slot) => {
              const at = new Date(slot.start);
              const active = at.getTime() === picked.getTime();
              const label = at.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true });
              return (
                <Pressable
                  key={slot.start}
                  disabled={!slot.available}
                  accessibilityLabel={
                    slot.available ? label : `${label} — ${SLOT_REASON_COPY[slot.reason ?? ""] ?? "unavailable"}`
                  }
                  onPress={() => choose(at)}
                  style={[
                    styles.chip,
                    active ? { backgroundColor: c.primary } : { borderColor: c.border, borderWidth: 1 },
                    !slot.available && { opacity: 0.35 },
                  ]}
                >
                  <Text style={[styles.chipText, { color: active ? "#fff" : c.text }]}>{label}</Text>
                </Pressable>
              );
            })
          : (
              <Text style={[styles.chipText, { color: c.textSecondary }]}>
                {availability.isLoading ? "Checking which times are free…" : "No times are available for this day."}
              </Text>
            )}
      </View>
      {serverSlots && serverSlots.length > 0 && serverSlots.every((s) => !s.available) && (
        <Text style={[styles.chipText, { color: c.textSecondary, marginTop: spacing.sm }]}>
          No times are available on this day. Please try another date.
        </Text>
      )}

      {picker && (Platform.OS === "android" ? (
        <DateTimePicker
          value={picked}
          mode={picker}
          minimumDate={new Date()}
          onChange={(event, date) => {
            const mode = picker;
            setPicker(null);
            if (event.type === "dismissed" || !date) return;
            choose(mode === "date" ? applyDatePart(picked, date) : applyTimePart(picked, date));
          }}
        />
      ) : (
        <View>
          <DateTimePicker
            value={picked}
            mode={picker}
            display="spinner"
            minimumDate={new Date()}
            themeVariant={isDark ? "dark" : "light"}
            onChange={(_, date) => {
              if (date) choose(picker === "date" ? applyDatePart(picked, date) : applyTimePart(picked, date));
            }}
          />
          <Pressable onPress={() => setPicker(null)} style={styles.doneBtn}>
            <Text style={{ color: c.primary, fontWeight: "700" }}>Done</Text>
          </Pressable>
        </View>
      ))}

      {confirming && !error ? (
        <Text style={[styles.body, { color: c.text }]}>
          Move to {formatDateLabel(picked)} at {formatTimeLabel(picked)}? Your professional is notified.
        </Text>
      ) : null}
      {error ? (
        <Text style={[styles.body, { color: c.error }]} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}

      {/* §45 / O6: the customer is told the cost BEFORE they confirm, never after. */}
      {fee && fee.disposition === "LATE_FEE" ? (
        <Text style={[styles.body, { color: c.warning ?? c.error }]} accessibilityLiveRegion="polite">
          {fee.feeAmount > 0
            ? `Moving this booking now carries a ₹${fee.feeAmount} late-reschedule fee (${fee.feeBps / 100}%).`
            : fee.message}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          style={[styles.secondary, { borderColor: c.border }]}
          onPress={onCancel}
          accessibilityRole="button"
        >
          <Text style={[styles.secondaryText, { color: c.text }]}>Keep current time</Text>
        </Pressable>
        <Pressable
          style={[styles.primary, { backgroundColor: c.primary, opacity: tooSoon || unchanged || reschedule.isPending ? 0.5 : 1 }]}
          onPress={submit}
          disabled={tooSoon || unchanged || reschedule.isPending}
          accessibilityRole="button"
        >
          <Text style={styles.primaryText}>
            {reschedule.isPending ? "Rescheduling…" : confirming ? "Confirm new time" : "Reschedule"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.md, gap: spacing.sm },
  title: { ...type.bodyBold },
  body: { ...type.caption, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8 },
  pickBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  pickText: { ...type.small, fontWeight: "700" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.pill },
  chipText: { ...type.caption, fontWeight: "700" },
  doneBtn: { alignSelf: "flex-end", padding: spacing.sm },
  actions: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },
  secondary: { flex: 1, alignItems: "center", justifyContent: "center", height: 44, borderRadius: radius.md, borderWidth: 1 },
  secondaryText: { ...type.bodyBold },
  primary: { flex: 1, alignItems: "center", justifyContent: "center", height: 44, borderRadius: radius.md },
  primaryText: { ...type.bodyBold, color: "#fff" },
});
