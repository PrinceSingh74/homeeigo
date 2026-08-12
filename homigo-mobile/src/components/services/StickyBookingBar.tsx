import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  interpolate,
  Extrapolation,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BlurView } from "expo-blur";
import { ArrowRight, Clock } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesTheme } from "./ServicesThemeContext";
import { useServicesActions } from "@/hooks/useServicesActions";
import { useCatalogServices } from "@/hooks/use-catalog";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";

/** Height of the bar itself (excludes the tab bar + safe area it sits above). */
export const STICKY_BAR_H = 68;
/** BottomNav is 64 + safe-area bottom; the bar floats directly above it. */
const TAB_BAR_H = 64;

type Props = {
  scrollY: SharedValue<number>;
  /** Scroll offset after which the bar reveals (default: just past the fold). */
  revealAt?: number;
};

/**
 * Persistent booking CTA — the page's primary conversion lever.
 *
 * Reveals after the first scroll (so it never competes with the hero), sits in the
 * thumb zone directly above the tab bar, and never occludes content because the
 * scroll container reserves its height. Price is shown ONLY when the catalog
 * actually returns one — nothing is invented.
 */
export function StickyBookingBar({ scrollY, revealAt = 260 }: Props) {
  const insets = useSafeAreaInsets();
  const { c, isDark, layout: L } = useServicesTheme();
  const { book } = useServicesActions();
  const { services } = useCatalogServices();

  // Cheapest live catalog price → an honest "starting from" anchor. Hidden if absent.
  const startingPrice = React.useMemo(() => {
    const prices = (services ?? [])
      .map((s) => Number(String(s.price ?? "").replace(/[^\d.]/g, "")))
      .filter((n) => Number.isFinite(n) && n > 0);
    return prices.length ? Math.min(...prices) : null;
  }, [services]);

  const barStyle = useAnimatedStyle(() => {
    const p = interpolate(scrollY.value, [revealAt, revealAt + 80], [0, 1], Extrapolation.CLAMP);
    return {
      opacity: p,
      transform: [{ translateY: interpolate(p, [0, 1], [STICKY_BAR_H + 16, 0]) }],
    };
  });

  const bottom = TAB_BAR_H + (insets.bottom > 0 ? insets.bottom : 12) + 8;

  return (
    <Animated.View
      style={[styles.wrap, { bottom, paddingHorizontal: L.pad }, barStyle]}
      pointerEvents="box-none"
    >
      <View style={[styles.bar, { borderColor: c.cardBorder }]}>
        <BlurView intensity={isDark ? 40 : 60} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
        <View
          style={[
            StyleSheet.absoluteFill,
            { backgroundColor: isDark ? "rgba(11,31,23,0.82)" : "rgba(255,255,255,0.88)" },
          ]}
        />

        <View style={styles.info}>
          <Text style={[styles.title, { color: c.textPrimary }]} numberOfLines={1}>
            Book a service
          </Text>
          <View style={styles.metaRow}>
            {startingPrice != null ? (
              <Text style={[styles.price, { color: c.primary }]}>From ₹{startingPrice}</Text>
            ) : null}
            <View style={styles.metaItem}>
              <Clock size={11} color={c.textMuted} strokeWidth={2.2} />
              <Text style={[styles.meta, { color: c.textMuted }]}>60-sec booking</Text>
            </View>
          </View>
        </View>

        <PressableScale
          haptic
          scaleTo={0.96}
          onPress={() => book()}
          style={[styles.cta, { backgroundColor: c.primary }]}
          accessibilityRole="button"
          accessibilityLabel="Book a service now"
        >
          <Text style={styles.ctaText}>Book Now</Text>
          <ArrowRight size={16} color="#fff" strokeWidth={2.8} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 40,
  },
  bar: {
    height: STICKY_BAR_H,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingLeft: 16,
    paddingRight: 8,
    borderRadius: layout.cardRadiusLg,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#04140d",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 12,
  },
  info: { flex: 1, minWidth: 0 },
  title: { ...serviceType.cardTitle, fontSize: 15 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 3 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  price: { ...serviceType.badge, fontSize: 12, fontWeight: "800" },
  meta: { ...serviceType.captionSm },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 48,
    paddingHorizontal: 18,
    borderRadius: layout.cardRadius,
  },
  ctaText: { ...serviceType.button, color: "#fff", fontSize: 14 },
});
