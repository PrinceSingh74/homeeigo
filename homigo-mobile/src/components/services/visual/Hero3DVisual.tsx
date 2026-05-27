import React, { useEffect } from "react";
import { View, Image, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { HOUSE_3D_IMAGE } from "@/constants/servicesData";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  compact?: boolean;
};

export function Hero3DVisual({ compact = false }: Props) {
  const { c, shadows, isDark, layout: L } = useServicesTheme();
  const IMG_W = compact
    ? L.heroHouseW
    : Math.min(210, L.screenW * 0.46);

  const floatY = useSharedValue(0);
  const tilt = useSharedValue(0);

  useEffect(() => {
    floatY.value = withRepeat(
      withTiming(compact ? -6 : -10, {
        duration: 2800,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
    tilt.value = withRepeat(
      withTiming(1, { duration: 3600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [floatY, tilt, compact]);

  const houseStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: floatY.value },
      { rotate: `${-2 + tilt.value * 3}deg` },
      { scale: 0.98 + tilt.value * 0.03 },
    ],
  }));

  const stageH = compact ? IMG_W * 0.92 : 176;

  return (
    <View
      style={[
        styles.stage,
        compact && styles.stageCompact,
        { width: IMG_W + (compact ? 8 : 24), height: stageH },
      ]}
    >
      <LinearGradient
        colors={
          isDark
            ? ["rgba(139, 92, 246, 0.35)", "rgba(108, 58, 232, 0)"]
            : ["rgba(108, 58, 232, 0.22)", "rgba(108, 58, 232, 0)"]
        }
        style={[
          styles.halo,
          {
            width: IMG_W + (compact ? 28 : 40),
            height: IMG_W + (compact ? 28 : 40),
            borderRadius: (IMG_W + (compact ? 28 : 40)) / 2,
          },
        ]}
      />
      {!compact ? (
        <>
          <View
            style={[
              styles.pedestalShadow,
              {
                width: IMG_W * 0.85,
                backgroundColor: isDark ? "rgba(0,0,0,0.45)" : "rgba(26, 11, 59, 0.2)",
              },
            ]}
          />
          <LinearGradient
            colors={[c.accentPurple, c.primary, c.primary2]}
            style={[styles.pedestal, { width: IMG_W * 0.55 }]}
          >
            <LinearGradient
              colors={["rgba(255,255,255,0.45)", "transparent"]}
              style={styles.pedestalShine}
            />
          </LinearGradient>
        </>
      ) : null}
      <Animated.View
        style={[
          styles.houseWrap,
          compact && styles.houseWrapCompact,
          houseStyle,
          shadows.float,
        ]}
      >
        <Image
          source={HOUSE_3D_IMAGE}
          style={{
            width: IMG_W,
            height: IMG_W * (compact ? 0.88 : 0.95),
          }}
          resizeMode="contain"
        />
      </Animated.View>
      {!compact ? (
        <>
          <View style={[styles.sparkle, styles.sparkleA, { backgroundColor: c.gold }]} />
          <View
            style={[
              styles.sparkle,
              styles.sparkleB,
              { backgroundColor: c.gold, width: 5, height: 5, borderRadius: 3 },
            ]}
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignItems: "center",
    justifyContent: "flex-start",
  },
  stageCompact: {
    justifyContent: "center",
    overflow: "visible",
  },
  halo: {
    position: "absolute",
    top: 0,
    alignSelf: "center",
    opacity: 0.85,
  },
  pedestalShadow: {
    position: "absolute",
    bottom: 8,
    height: 18,
    borderRadius: 999,
    transform: [{ scaleX: 1.12 }],
  },
  pedestal: {
    position: "absolute",
    bottom: 12,
    height: 12,
    borderRadius: 8,
    opacity: 0.85,
  },
  pedestalShine: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 8,
  },
  houseWrap: { marginBottom: 18 },
  houseWrapCompact: { marginBottom: 0, marginTop: -2 },
  sparkle: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 4,
    opacity: 0.7,
  },
  sparkleA: { top: 24, right: 12 },
  sparkleB: { top: 48, left: 8 },
});
