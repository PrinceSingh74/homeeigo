import React from "react";
import { View, Text, StyleSheet, Image, Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  FadeInDown,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { MapPin, ChevronDown, Bell } from "lucide-react-native";
import { serviceType } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useServicesTheme } from "./ServicesThemeContext";
import { ServicesThemeToggle } from "./ServicesThemeToggle";
import { PressableScale } from "@/components/ai/PressableScale";

type Props = {
  scrollY: SharedValue<number>;
};

export function ServicesHeader({ scrollY }: Props) {
  const insets = useSafeAreaInsets();
  const { openLocation, openNotifications, openProfile, locationLabel, unreadNotifications } =
    useServicesActions();
  const { c, shadows, isDark, layout: L } = useServicesTheme();

  const shadowStyle = useAnimatedStyle(() => ({
    shadowOpacity: interpolate(
      scrollY.value,
      [0, 24, 80],
      [0, isDark ? 0.2 : 0.04, isDark ? 0.35 : 0.1],
      Extrapolation.CLAMP,
    ),
    elevation: interpolate(scrollY.value, [0, 24], [0, 6], Extrapolation.CLAMP),
  }));

  return (
    <Animated.View
      entering={FadeInDown.duration(480)}
      style={[
        styles.wrap,
        { paddingTop: insets.top + 4, backgroundColor: c.headerBg },
        shadows.glass,
        shadowStyle,
      ]}
    >
      <BlurView
        intensity={isDark ? 48 : 72}
        tint={c.glassTint}
        style={StyleSheet.absoluteFill}
      />
      <View
        style={[
          styles.headerGlass,
          { backgroundColor: isDark ? "rgba(12,10,20,0.5)" : "rgba(255,255,255,0.55)" },
        ]}
      />
      <View
        style={[styles.borderLine, { borderBottomColor: c.headerBorder }]}
      />
      <View style={[styles.topRow, { paddingHorizontal: L.pad }]}>
        <View style={styles.logoRow}>
          <View style={[styles.logoMark, { backgroundColor: c.primary }, shadows.soft]}>
            <Text style={styles.logoLetter}>M</Text>
          </View>
          <Text style={[styles.logoText, { color: c.textPrimary }]}>HOMIGO</Text>
        </View>

        <View style={styles.rightRow}>
          <Pressable
            style={[
              styles.locationChip,
              {
                backgroundColor: c.locationBg,
                borderColor: c.chipBorder,
                maxWidth: L.headerLocationMaxW,
              },
            ]}
            onPress={openLocation}
          >
            <MapPin size={15} color={c.primary} strokeWidth={2.2} />
            <Text
              style={[styles.locationText, { color: c.textPrimary }]}
              numberOfLines={1}
            >
              {locationLabel}
            </Text>
            <ChevronDown size={13} color={c.textSecondary} />
          </Pressable>
          <ServicesThemeToggle />
          <Pressable style={styles.bell} onPress={openNotifications}>
            <Bell size={21} color={c.textPrimary} strokeWidth={2} />
            {unreadNotifications > 0 ? (
              <View style={[styles.badge, { backgroundColor: c.error }]}>
                <Text style={styles.badgeText}>
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </Text>
              </View>
            ) : null}
          </Pressable>
          <PressableScale onPress={openProfile} haptic scaleTo={0.94}>
            <Image
              source={{
                uri: "https://api.dicebear.com/7.x/avataaars/png?seed=homigo&size=80",
              }}
              style={[styles.avatar, { borderColor: c.borderLight }]}
            />
          </PressableScale>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    paddingBottom: 12,
  },
  headerGlass: {
    ...StyleSheet.absoluteFillObject,
  },
  borderLine: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 52,
  },
  logoRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  logoMark: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  logoLetter: {
    color: "#fff",
    fontFamily: serviceType.logo.fontFamily,
    fontSize: 15,
    fontWeight: "700",
  },
  logoText: {
    ...serviceType.logo,
  },
  rightRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  locationChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: layout.chipRadius,
    borderWidth: 1,
    flexShrink: 1,
  },
  locationText: {
    fontFamily: serviceType.link.fontFamily,
    fontSize: 12,
  },
  bell: { padding: 5 },
  badge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    borderWidth: 1.5,
    borderColor: "#fff",
  },
  badgeText: {
    fontSize: 8,
    fontWeight: "700",
    color: "#fff",
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "#E5E7EB",
    borderWidth: 2,
  },
});
