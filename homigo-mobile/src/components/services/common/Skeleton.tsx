import React, { useEffect } from "react";
import { View, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useServicesTheme } from "../ServicesThemeContext";
import { layout } from "@/components/services/theme/layout";

/**
 * Premium skeleton placeholder — a soft pulse rather than a spinner.
 *
 * Skeletons preserve layout while data loads, which removes the perceived-latency
 * hit and the layout shift a spinner causes when content pops in.
 */
export function Skeleton({
  width,
  height,
  radius = layout.cardRadiusSm,
  style,
}: {
  width?: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useServicesTheme();
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [pulse]);

  const aStyle = useAnimatedStyle(() => ({ opacity: 0.45 + pulse.value * 0.35 }));

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        { width, height, borderRadius: radius, backgroundColor: c.chipBg },
        aStyle,
        style,
      ]}
    />
  );
}

/** Card-shaped skeleton matching the review/AI card silhouette. */
export function SkeletonCard({ width, height = 168 }: { width: number; height?: number }) {
  const { c } = useServicesTheme();
  return (
    <View
      style={[
        styles.card,
        { width, height, backgroundColor: c.card, borderColor: c.cardBorder },
      ]}
    >
      <View style={styles.row}>
        <Skeleton width={46} height={46} radius={23} />
        <View style={styles.col}>
          <Skeleton width="70%" height={12} />
          <Skeleton width="45%" height={10} style={{ marginTop: 6 }} />
        </View>
      </View>
      <Skeleton width="100%" height={10} style={{ marginTop: 18 }} />
      <Skeleton width="92%" height={10} style={{ marginTop: 8 }} />
      <Skeleton width="60%" height={10} style={{ marginTop: 8 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: layout.cardRadius,
    borderWidth: 1,
    padding: 20,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  col: { flex: 1 },
});
