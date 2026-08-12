import React, { useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { useAiTheme } from "@/lib/ai-mobile-theme";

const { width: W } = Dimensions.get("window");

/** Cinematic 3D ambient — floating orbs + light beams */
export function AiPageAmbient() {
  const { c, isDark } = useAiTheme();
  const drift = useSharedValue(0);

  useEffect(() => {
    drift.value = withRepeat(
      withTiming(1, { duration: 8000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [drift]);

  const orbA = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(drift.value, [0, 1], [0, -18]) },
      { scale: interpolate(drift.value, [0, 1], [1, 1.08]) },
    ],
  }));
  const orbB = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(drift.value, [0, 1], [0, 14]) },
      { translateX: interpolate(drift.value, [0, 1], [0, 12]) },
    ],
  }));

  if (!isDark) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={["rgba(16, 185, 129,0.08)", "transparent", "rgba(45, 212, 191,0.06)"]}
          style={StyleSheet.absoluteFill}
        />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={["rgba(45, 212, 191,0.06)", "transparent", "rgba(16, 185, 129,0.08)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.beam}
      />

      <Animated.View style={[styles.orbWrapA, orbA]}>
        <LinearGradient
          colors={[c.ambientCyan, "transparent"]}
          style={styles.orbA}
        />
      </Animated.View>

      <Animated.View style={[styles.orbWrapB, orbB]}>
        <LinearGradient
          colors={[c.ambientViolet, c.ambientPink, "transparent"]}
          style={styles.orbB}
        />
      </Animated.View>

      <View style={[styles.orbC, { backgroundColor: c.ambientViolet }]} />

      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.35)", "rgba(0,0,0,0.65)"]}
        style={styles.vignetteBottom}
      />
      <LinearGradient
        colors={["rgba(0,0,0,0.18)", "transparent"]}
        style={styles.vignetteTop}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  beam: {
    position: "absolute",
    top: 60,
    left: -W * 0.2,
    width: W * 1.4,
    height: 280,
    transform: [{ rotate: "-12deg" }],
    opacity: 0.9,
  },
  orbWrapA: { position: "absolute", top: 100, left: -70 },
  orbA: {
    width: 240,
    height: 240,
    borderRadius: 120,
    opacity: 0.85,
  },
  orbWrapB: { position: "absolute", top: 380, right: -90 },
  orbB: {
    width: 280,
    height: 280,
    borderRadius: 140,
    opacity: 0.8,
  },
  orbC: {
    position: "absolute",
    bottom: 220,
    left: W * 0.15,
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.55,
  },
  vignetteBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 200,
  },
  vignetteTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: 120,
  },
});
