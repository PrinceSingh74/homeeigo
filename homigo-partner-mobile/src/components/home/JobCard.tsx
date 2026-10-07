import { router } from "expo-router";
import { CalendarClock, ChevronRight, MapPin, Timer } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Pill, T } from "@/components/ui";
import { useOfferCountdown } from "@/hooks/use-offer-countdown";
import { bookingStatusLabel } from "@/lib/booking-status";
import { jobSelectionRows } from "@/lib/job-selection";
import { addressLine, compactSelection, slotLine, statusTone } from "@/lib/jobs-list";
import { formatCountdown } from "@/lib/offer";
import { color, elevation, radius, space } from "@/theme/tokens";
import type { PartnerBooking } from "@/types/partner";

/** How long the partner has to answer an offer, ticking on the server-time estimate. */
export function OfferCountdownPill({ offer, testID }: { offer: PartnerBooking["offer"]; testID?: string }) {
  const countdown = useOfferCountdown(offer ?? null);
  if (!countdown) return null;
  if (countdown.expired) return <Pill label="Offer closed" tone="neutral" icon={Timer} testID={testID} />;
  const tone = countdown.urgency === "critical" ? "danger" : countdown.urgency === "warning" ? "warning" : "leaf";
  return <Pill label={`Respond in ${formatCountdown(countdown.secondsLeft)}`} tone={tone} icon={Timer} testID={testID} />;
}

export function openJob(bookingId: string) {
  router.push(`/job/${encodeURIComponent(bookingId)}` as never);
}

/**
 * A job as a card: service, what was booked, the slot, where, and its status — only what the server
 * sent. The whole card opens the job. No amount is shown: a booking's `amount` / `finalAmount` are
 * the customer's price, not the partner's earning.
 */
export function JobCard({
  booking,
  offer = false,
  footer,
  testID,
}: {
  booking: PartnerBooking;
  /** An open offer: shows the time left to respond. */
  offer?: boolean;
  /** Under the details (e.g. the next step of an active job). */
  footer?: ReactNode;
  testID?: string;
}) {
  const rows = jobSelectionRows(booking);
  const selection = compactSelection(rows);
  const slot = slotLine(rows);
  const where = addressLine(booking.address);
  const status = bookingStatusLabel(booking.status, booking.arrivedAt);
  const name = booking.service?.name ?? "Job";
  return (
    <Pressable
      testID={testID ?? `job-card-${booking.id}`}
      onPress={() => openJob(booking.id)}
      accessibilityRole="button"
      accessibilityLabel={[`Open job ${name}`, booking.bookingNumber, status, slot, where ? `${where.label} ${where.value}` : null].filter(Boolean).join(". ")}
      style={({ pressed }) => [styles.card, pressed ? styles.pressed : null]}
    >
      <View style={styles.head}>
        <View style={styles.headText}>
          <T kind="heading" numberOfLines={2}>
            {name}
          </T>
          <T kind="caption" numeric>
            {booking.bookingNumber}
          </T>
        </View>
        <ChevronRight color={color.mist} size={20} />
      </View>

      <View style={styles.pills}>
        <Pill label={status} tone={statusTone(booking.status, booking.arrivedAt)} />
        {offer ? <OfferCountdownPill offer={booking.offer} testID={`offer-countdown-${booking.id}`} /> : null}
        {booking.followUp ? <Pill label={booking.followUp.kind === "REWORK" ? "Rework visit" : "Revisit"} tone="info" /> : null}
      </View>

      {selection ? (
        <T kind="body" tone="slate" numberOfLines={2}>
          {selection}
        </T>
      ) : null}

      {slot ? (
        <View style={styles.line}>
          <CalendarClock color={color.slate} size={16} />
          <T kind="small" tone="ink" numeric style={styles.lineText}>
            {slot}
          </T>
        </View>
      ) : null}
      {where ? (
        <View style={styles.line}>
          <MapPin color={color.slate} size={16} />
          <T kind="small" tone="ink" style={styles.lineText} numberOfLines={2}>
            {where.label === "Area" ? `Area: ${where.value}` : where.value}
          </T>
        </View>
      ) : null}

      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.card, borderWidth: 1, borderColor: color.line, padding: space.lg, gap: space.sm, ...elevation.card },
  pressed: { backgroundColor: color.well },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  headText: { flex: 1, gap: 2 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  line: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  lineText: { flex: 1 },
  footer: { marginTop: space.xs, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, gap: space.xs },
});
