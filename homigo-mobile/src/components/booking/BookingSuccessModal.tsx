import React from "react";
import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Check, Calendar, MapPin } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles, gradients } from "@/lib/colors";
import { spacing, radius, type } from "@/lib/typography";
import { bookingUi } from "@/lib/booking-ui";
import type { SavedBooking } from "@/lib/store";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { Button } from "@/components/Button";
import { BookingStatusBadge } from "./BookingStatusBadge";

type Props = {
  visible: boolean;
  booking: SavedBooking | null;
  onClose: () => void;
  onViewBookings: () => void;
};

export function BookingSuccessModal({
  visible,
  booking,
  onClose,
  onViewBookings,
}: Props) {
  const { colors: c } = useTheme();
  if (!booking) return null;

  const cfg = STATUS_CONFIG[booking.status];

  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.overlay}>
        <View style={[styles.card, { backgroundColor: c.cardBg }, shadowStyles.lg]}>
          <LinearGradient
            colors={gradients.hero}
            style={[styles.iconWrap, shadowStyles.glowBlue]}
          >
            <Check size={36} color="#fff" strokeWidth={3} />
          </LinearGradient>

          <BookingStatusBadge status={booking.status} />
          <Text style={[styles.heading, { color: c.text }]}>You&apos;re all set!</Text>
          <Text style={[styles.id, { color: c.primary }]}>{booking.id}</Text>
          <Text style={[styles.hint, { color: c.textSecondary }]}>
            {cfg.description} · Pro {booking.proName}
          </Text>
          <Text style={[styles.service, { color: c.text }]}>{booking.serviceTitle}</Text>
          <Text style={[styles.pkg, { color: c.textSecondary }]}>
            {booking.packageName} Package
          </Text>

          <View style={[styles.details, bookingUi.block, { backgroundColor: c.bg, borderColor: c.border }]}>
            <View style={styles.detailRow}>
              <Calendar size={16} color={c.primary} />
              <Text style={[styles.detailText, { color: c.text }]}>
                {booking.dateLabel} · {booking.timeLabel}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <MapPin size={16} color={c.primary} />
              <Text style={[styles.detailText, { color: c.text }]}>{booking.address}</Text>
            </View>
            <Text style={[styles.total, { color: c.violet }]}>
              ₹{booking.total} payable at service
            </Text>
          </View>

          <Button title="View my bookings" onPress={onViewBookings} size="md" />
          <Pressable onPress={onClose} style={styles.secondary}>
            <Text style={[styles.secondaryText, { color: c.primary }]}>Book another</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.55)",
    justifyContent: "center",
    padding: spacing["2xl"],
  },
  card: {
    borderRadius: radius["2xl"],
    padding: spacing["2xl"],
    alignItems: "center",
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  heading: { ...type.title, fontSize: 22, marginTop: spacing.sm, marginBottom: spacing.xs },
  id: { ...type.mono, marginBottom: spacing.sm },
  hint: { ...type.small, textAlign: "center", marginBottom: spacing.md, paddingHorizontal: spacing.sm },
  service: { ...type.bodyBold, fontSize: 17 },
  pkg: { ...type.small, marginBottom: spacing.lg },
  details: { width: "100%", gap: spacing.md, marginBottom: spacing.xl },
  detailRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  detailText: { ...type.small, flex: 1 },
  total: { ...type.price, marginTop: spacing.xs },
  secondary: { marginTop: spacing.lg, padding: spacing.sm },
  secondaryText: { ...type.bodyBold },
});
