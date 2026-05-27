import React from "react";
import { View, Text, Pressable, StyleSheet, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Calendar, MapPin, ChevronRight } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { spacing, radius, type } from "@/lib/typography";
import type { SavedBooking } from "@/lib/store";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { BookingStatusBadge } from "./BookingStatusBadge";
import { getServiceImage } from "@/lib/service-assets";

type Props = {
  booking: SavedBooking;
  onPress: () => void;
};

export function BookingCard({ booking, onPress }: Props) {
  const { colors: c } = useTheme();
  const cfg = STATUS_CONFIG[booking.status];
  const img = getServiceImage(booking.imageKey);
  const cancelled = booking.status === "cancelled";

  return (
    <Pressable
      onPress={() => {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress();
      }}
      style={({ pressed }) => [
        styles.card,
        {
          backgroundColor: c.cardBg,
          borderColor: "rgba(148, 163, 184, 0.22)",
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
        shadowStyles.lg,
      ]}
    >
      <LinearGradient
        colors={[...cfg.gradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.accentBar}
      />

      <View style={styles.top}>
        <Text style={[styles.id, { color: c.primary }]}>{booking.id}</Text>
        <BookingStatusBadge
          status={booking.status}
          live={booking.status === "in_progress"}
        />
        <ChevronRight size={20} color={c.textSecondary} strokeWidth={2} />
      </View>

      <View style={styles.body}>
        <View
          style={[
            styles.thumb,
            {
              backgroundColor: booking.serviceColor + "14",
              borderColor: booking.serviceColor + "28",
            },
          ]}
        >
          {img ? (
            <Image source={img} style={styles.thumbImg} resizeMode="contain" />
          ) : (
            <Text style={styles.emoji}>✂️</Text>
          )}
        </View>

        <View style={styles.info}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {booking.serviceTitle}
          </Text>
          <Text style={[styles.pkg, { color: c.textSecondary }]} numberOfLines={1}>
            {booking.packageName} · {booking.proName}
          </Text>
          <View style={styles.meta}>
            <Calendar size={14} color={c.primary} />
            <Text style={[styles.metaText, { color: c.textSecondary }]} numberOfLines={1}>
              {booking.dateLabel} · {booking.timeLabel}
            </Text>
          </View>
          <View style={styles.meta}>
            <MapPin size={14} color={c.primary} />
            <Text style={[styles.metaText, { color: c.textSecondary }]} numberOfLines={1}>
              {booking.address}
            </Text>
          </View>
        </View>
      </View>

      <View style={[styles.footer, { borderTopColor: c.border }]}>
        <Text style={[styles.statusHint, { color: cfg.text }]} numberOfLines={2}>
          {cfg.description}
        </Text>
        <Text style={[styles.price, { color: c.violet }]}>
          {cancelled ? "—" : `₹${booking.total}`}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius["2xl"],
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  accentBar: { height: 3, width: "100%" },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md + 2,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  id: { ...type.mono, flex: 1 },
  body: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.lg,
  },
  thumb: {
    width: 72,
    height: 72,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  thumbImg: { width: 54, height: 54 },
  emoji: { fontSize: 26 },
  info: { flex: 1, gap: 4 },
  title: { ...type.title, fontSize: 18, letterSpacing: -0.45 },
  pkg: { ...type.small },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  metaText: { ...type.caption, flex: 1, fontSize: 12, lineHeight: 16 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md + 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.md,
  },
  statusHint: { ...type.caption, flex: 1, fontWeight: "600", lineHeight: 17 },
  price: { ...type.price, fontSize: 22, letterSpacing: -0.6 },
});
