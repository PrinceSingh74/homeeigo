import React from "react";
import { View, Text, StyleSheet, Image, Pressable } from "react-native";
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { MapPin, ChevronDown, Bell } from "lucide-react-native";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useServicesTheme } from "./ServicesThemeContext";
import { PressableScale } from "@/components/ai/PressableScale";

type Props = {
  scrollY: SharedValue<number>;
};

type RowHandlers = {
  openLocation: () => void;
  openNotifications: () => void;
  openProfile: () => void;
  locationLabel: string;
  unreadNotifications: number;
  maxLocationW: number;
  errorColor: string;
  chipShadow: object;
  isDarkTheme: boolean;
};

/**
 * The navbar content row, rendered in one of two colour tones. Two copies are
 * stacked and cross-faded on scroll (see ServicesHeader) so the whole bar — text,
 * icons and chips — glides smoothly from white-over-image to a frosted light bar,
 * with no colour "pop" (lucide icon colours can't be style-animated, so a crossfade
 * is the clean path to a fully smooth, premium transition).
 */
function HeaderRow({
  tone,
  interactive,
  handlers,
}: {
  tone: "light" | "dark";
  interactive: boolean;
  handlers: RowHandlers;
}) {
  const light = tone === "light";
  const fg = light ? "#ffffff" : "#0F172A";
  const fgSoft = light ? "rgba(255,255,255,0.82)" : "#64748B";
  const accent = light ? "#6ee7b7" : "#059669";
  const chipBg = light ? "rgba(255,255,255,0.16)" : "rgba(15,23,42,0.05)";
  const chipBorder = light ? "rgba(255,255,255,0.28)" : "rgba(15,23,42,0.08)";
  const ringBorder = light ? "rgba(255,255,255,0.9)" : "#059669";
  const none = interactive ? undefined : "none";

  return (
    <View style={styles.topRow} pointerEvents={interactive ? "box-none" : "none"}>
      <View style={styles.logoRow}>
        <Image
          // Over the hero photo (and on a dark frosted bar) the light-wordmark
          // variant is the legible one; the standard artwork is used on light.
          source={
            light || handlers.isDarkTheme
              ? require("../../../assets/brand/logo-full-dark.png")
              : require("../../../assets/brand/logo-full.png")
          }
          style={styles.logo}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
          accessibilityLabel="Homeeigo"
        />
      </View>

      <View style={styles.rightRow}>
        <Pressable
          style={[styles.locationChip, { backgroundColor: chipBg, borderColor: chipBorder, maxWidth: handlers.maxLocationW }]}
          onPress={handlers.openLocation}
          pointerEvents={none}
          accessible={interactive}
          accessibilityRole="button"
          accessibilityLabel={`Location: ${handlers.locationLabel}. Change location`}
        >
          <MapPin size={14} color={accent} strokeWidth={2.4} />
          <Text style={[styles.locationText, { color: fg }]} numberOfLines={1}>
            {handlers.locationLabel}
          </Text>
          <ChevronDown size={13} color={fgSoft} />
        </Pressable>
        <Pressable
          style={[styles.bell, { backgroundColor: chipBg }]}
          onPress={handlers.openNotifications}
          pointerEvents={none}
          accessible={interactive}
          accessibilityRole="button"
          accessibilityLabel={
            handlers.unreadNotifications > 0
              ? `Notifications, ${handlers.unreadNotifications} unread`
              : "Notifications"
          }
        >
          <Bell size={19} color={fg} strokeWidth={2} />
          {handlers.unreadNotifications > 0 ? (
            <View style={[styles.badge, { backgroundColor: handlers.errorColor }]}>
              <Text style={styles.badgeText}>
                {handlers.unreadNotifications > 9 ? "9+" : handlers.unreadNotifications}
              </Text>
            </View>
          ) : null}
        </Pressable>
        <PressableScale
          onPress={handlers.openProfile}
          haptic
          scaleTo={0.94}
          disabled={!interactive}
          accessibilityRole="button"
          accessibilityLabel="Open your profile"
        >
          <View style={[styles.avatarRing, { borderColor: ringBorder }]}>
            <Image
              source={{ uri: "https://api.dicebear.com/7.x/avataaars/png?seed=homigo&size=80" }}
              style={styles.avatar}
            />
          </View>
        </PressableScale>
      </View>
    </View>
  );
}

/**
 * Immersive services navbar — floats transparent over the full-bleed hero image
 * (no white strip). As the hero scrolls away, a frosted surface fades in and the
 * content cross-fades from white → theme text, fully smoothly, driven directly by
 * the scroll position. Content mirrors the home Navbar.
 */
export function ServicesHeader({ scrollY }: Props) {
  const insets = useSafeAreaInsets();
  const { openLocation, openNotifications, openProfile, locationLabel, unreadNotifications } =
    useServicesActions();
  const { c, shadows, isDark, layout: L } = useServicesTheme();

  // Immersive only at the very top; the moment the page scrolls the navbar settles
  // into a solid frosted sticky bar and STAYS there — no "appears late / comes and
  // goes" feeling. The short window keeps the settle buttery-smooth.
  const start = 6;
  const end = 66;

  const surfaceStyle = useAnimatedStyle(() => {
    const p = interpolate(scrollY.value, [start, end], [0, 1], Extrapolation.CLAMP);
    return { opacity: p, shadowOpacity: p * (isDark ? 0.4 : 0.14) };
  });
  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [start, end], [1, 0], Extrapolation.CLAMP),
  }));
  // White (over-image) content layer fades out; dark layer beneath is revealed.
  const lightLayerStyle = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.value, [start, end], [1, 0], Extrapolation.CLAMP),
  }));

  const handlers: RowHandlers = {
    openLocation,
    openNotifications,
    openProfile,
    locationLabel,
    unreadNotifications,
    maxLocationW: L.headerLocationMaxW,
    errorColor: c.error,
    chipShadow: shadows.soft,
    isDarkTheme: isDark,
  };

  return (
    <View
      style={[styles.wrap, { paddingTop: insets.top + 6 }]}
      pointerEvents="box-none"
    >
      {/* Frosted surface — settles in on the first bit of scroll and stays (sticky). */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.surface, surfaceStyle]} pointerEvents="none">
        <BlurView intensity={isDark ? 42 : 60} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? "rgba(11,31,23,0.72)" : "rgba(255,255,255,0.82)" },
          ]}
        />
        <View style={[styles.borderLine, { borderBottomColor: c.headerBorder }]} />
      </Animated.View>

      {/* Subtle top scrim for white-content legibility over the image */}
      <Animated.View style={[styles.topScrim, scrimStyle]} pointerEvents="none">
        <LinearGradient
          colors={["rgba(4,20,13,0.42)", "rgba(4,20,13,0.12)", "transparent"]}
          locations={[0, 0.6, 1]}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <View style={styles.stack}>
        {/* Interactive base layer — dark tone (frosted state). Handles all taps. */}
        <View style={{ paddingHorizontal: L.pad }}>
          <HeaderRow tone="dark" interactive handlers={handlers} />
        </View>

        {/* White overlay — visual only, cross-fades out on scroll. Hidden from a11y. */}
        <Animated.View
          style={[StyleSheet.absoluteFill, lightLayerStyle]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={{ paddingHorizontal: L.pad }}>
            <HeaderRow tone="light" interactive={false} handlers={handlers} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    paddingBottom: 12,
  },
  surface: {
    // Premium depth once the sticky bar is engaged (opacity driven with the surface).
    shadowColor: "#04140d",
    shadowOffset: { width: 0, height: 6 },
    shadowRadius: 16,
    elevation: 8,
  },
  borderLine: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  topScrim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 120,
  },
  stack: {
    position: "relative",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 48,
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  /** Full brand lockup — native 1.45:1 ratio. */
  logo: { height: 40, width: 58 },
  logoText: {
    ...serviceType.logo,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  rightRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  locationChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: layout.chipRadius,
    borderWidth: 1,
    flexShrink: 1,
  },
  locationText: {
    fontFamily: serviceType.link.fontFamily,
    fontSize: 12,
  },
  bell: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: 3,
    right: 3,
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
  avatarRing: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#E5E7EB",
  },
});
