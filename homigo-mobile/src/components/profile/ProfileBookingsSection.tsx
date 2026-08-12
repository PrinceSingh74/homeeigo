import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Star, User } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore } from "@/lib/store";
import { PROFILE_CARD_RADIUS } from "@/lib/profile-layout";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { shadowStyles } from "@/lib/colors";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";
import { getServiceImage } from "@/lib/service-assets";
import { STATUS_CONFIG } from "@/lib/booking-status";
import { SectionHeader } from "@/components/profile/SectionHeader";

type Props = {
  onViewAll: () => void;
  onBooking: (id: string, action: string) => void;
};

export function ProfileBookingsSection({ onViewAll, onBooking }: Props) {
  const { colors: c, isDark } = useTheme();
  const bookings = useAppStore((s) => s.bookings).slice(0, 2);

  if (bookings.length === 0) return null;

  return (
    <Animated.View
      entering={profileEnter.section}
      style={[
        styles.section,
        {
          backgroundColor: c.cardBg,
          borderColor: isDark ? c.border : "#E5E7EB",
        },
        shadowStyles.md,
      ]}
    >
      <SectionHeader title="My Bookings" onAction={onViewAll} actionLabel="View All" />

      <View style={styles.list}>
        {bookings.map((b, i) => {
          const img = getServiceImage(b.imageKey);
          const cfg = STATUS_CONFIG[b.status];
          const action = b.status === "confirmed" || b.status === "in_progress" ? "Track" : "Rebook";
          return (
            <Animated.View key={b.id} entering={profileEnter.row(i)}>
              <PressableScale
                onPress={() => onBooking(b.id, action)}
                haptic
                style={[
                  styles.row,
                  { backgroundColor: isDark ? c.bg : "#F9FAFB", borderColor: c.border },
                ]}
              >
                <View style={styles.thumb}>
                  {img ? (
                    <Image source={img} style={styles.thumbImg} resizeMode="contain" />
                  ) : null}
                </View>

                <View style={styles.main}>
                  <View style={styles.body}>
                    <Text
                      style={[profileType.bookingTitle, profileTextBase, { color: c.text }]}
                      numberOfLines={1}
                    >
                      {b.serviceTitle}
                    </Text>
                    <View style={styles.proRow}>
                      <User size={12} color={c.textSecondary} />
                      <Text
                        style={[profileType.bookingMeta, profileTextBase, { color: c.textSecondary }]}
                        numberOfLines={1}
                      >
                        {b.proName}
                      </Text>
                    </View>
                    <Text
                      style={[profileType.bookingMeta, profileTextBase, { color: c.textSecondary }]}
                      numberOfLines={1}
                    >
                      {b.dateLabel} · {b.timeLabel}
                    </Text>
                  </View>

                  <View style={styles.actions}>
                    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
                      <Text
                        style={[
                          profileType.bookingBadge,
                          profileTextBase,
                          { color: cfg.text },
                        ]}
                      >
                        {cfg.label}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.actionBtn,
                        { borderColor: "#A7F3D0", backgroundColor: "#ECFDF5" },
                      ]}
                    >
                      <Text
                        style={[profileType.bookingAction, profileTextBase, { color: c.primary }]}
                      >
                        {action}
                      </Text>
                    </View>
                  </View>
                </View>
              </PressableScale>
            </Animated.View>
          );
        })}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: PROFILE_CARD_RADIUS,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  list: { gap: 12 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
  },
  thumb: {
    width: 68,
    height: 68,
    borderRadius: 12,
    backgroundColor: "#fff",
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  thumbImg: { width: 56, height: 56 },
  main: { flex: 1, minWidth: 0, flexDirection: "row", gap: 8 },
  body: { flex: 1, minWidth: 0, gap: 5 },
  proRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  actions: {
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 8,
    flexShrink: 0,
    minWidth: 72,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
  },
});
