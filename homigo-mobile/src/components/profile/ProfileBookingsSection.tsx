import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { Star, User } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { PROFILE_BOOKINGS } from "@/lib/profile-mobile-data";
import { PROFILE_CARD_RADIUS } from "@/lib/profile-layout";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { shadowStyles } from "@/lib/colors";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";
import { getServiceImage } from "@/lib/service-assets";
import { SectionHeader } from "@/components/profile/SectionHeader";

type Props = {
  onViewAll: () => void;
  onBooking: (id: string, action: string) => void;
};

export function ProfileBookingsSection({ onViewAll, onBooking }: Props) {
  const { colors: c, isDark } = useTheme();

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
        {PROFILE_BOOKINGS.map((b, i) => {
          const img = getServiceImage(b.imageKey);
          return (
            <Animated.View key={b.id} entering={profileEnter.row(i)}>
              <PressableScale
                onPress={() => onBooking(b.id, b.action)}
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
                      {b.title}
                    </Text>
                    <View style={styles.proRow}>
                      <User size={12} color={c.textSecondary} />
                      <Text
                        style={[profileType.bookingMeta, profileTextBase, { color: c.textSecondary }]}
                        numberOfLines={1}
                      >
                        {b.pro}
                      </Text>
                      <Text style={[profileType.bookingMeta, { color: c.textSecondary }]}>•</Text>
                      <Star size={11} color={c.gold} fill={c.gold} />
                      <Text style={[profileType.bookingMeta, profileTextBase, { color: c.textSecondary }]}>
                        {b.rating}
                      </Text>
                    </View>
                    <Text
                      style={[profileType.bookingMeta, profileTextBase, { color: c.textSecondary }]}
                      numberOfLines={1}
                    >
                      {b.date}
                    </Text>
                  </View>

                  <View style={styles.actions}>
                    <View style={[styles.badge, { backgroundColor: b.statusBg }]}>
                      <Text
                        style={[
                          profileType.bookingBadge,
                          profileTextBase,
                          { color: b.statusColor },
                        ]}
                      >
                        {b.status}
                      </Text>
                    </View>
                    <View
                      style={[
                        styles.actionBtn,
                        { borderColor: "#DBEAFE", backgroundColor: "#EFF6FF" },
                      ]}
                    >
                      <Text
                        style={[profileType.bookingAction, profileTextBase, { color: c.primary }]}
                      >
                        {b.action}
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
