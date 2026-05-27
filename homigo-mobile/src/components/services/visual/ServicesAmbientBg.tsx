import React, { useEffect } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useServicesTheme } from "../ServicesThemeContext";

function FloatingOrb({
  size,
  top,
  left,
  colors,
  duration,
  drift,
}: {
  size: number;
  top: number;
  left: number;
  colors: readonly [string, string];
  duration: number;
  drift: number;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [t, duration]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateY: t.value * drift },
      { translateX: t.value * (drift * 0.4) },
      { scale: 0.92 + t.value * 0.12 },
    ],
    opacity: 0.35 + t.value * 0.2,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.orb,
        { width: size, height: size, borderRadius: size / 2, top, left },
        style,
      ]}
    >
      <LinearGradient
        colors={[...colors]}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
    </Animated.View>
  );
}

export function ServicesAmbientBg() {
  const { c, layout: L } = useServicesTheme();
  const { screenW: width, screenH: height } = L;

  return (
    <Animated.View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={[...c.ambientMesh]}
        locations={[0, 0.35, 0.7, 1]}
        style={StyleSheet.absoluteFill}
      />
      <FloatingOrb
        size={width * 0.72}
        top={-width * 0.2}
        left={width * 0.35}
        colors={c.orbA}
        duration={5200}
        drift={18}
      />
      <FloatingOrb
        size={width * 0.55}
        top={height * 0.28}
        left={-width * 0.25}
        colors={c.orbB}
        duration={6400}
        drift={-14}
      />
      <FloatingOrb
        size={width * 0.45}
        top={height * 0.55}
        left={width * 0.55}
        colors={c.orbC}
        duration={4800}
        drift={12}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  orb: {
    position: "absolute",
    overflow: "hidden",
  },
});
