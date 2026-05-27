import React, { useMemo } from "react";
import { View, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";

type Particle = { x: number; y: number; size: number; color: string; delay: number };

const COLORS = ["rgba(255,255,255,0.5)", "rgba(253,224,71,0.45)", "rgba(196,181,253,0.5)"];

export function WalletHeroParticles() {
  const particles = useMemo<Particle[]>(
    () =>
      Array.from({ length: 24 }, (_, i) => ({
        x: 8 + (i * 17) % 92,
        y: 10 + (i * 23) % 75,
        size: 2 + (i % 3),
        color: COLORS[i % COLORS.length],
        delay: (i % 8) * 400,
      })),
    [],
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {particles.map((p, i) => (
        <DriftDot key={i} {...p} />
      ))}
    </View>
  );
}

function DriftDot({ x, y, size, color, delay }: Particle) {
  const drift = useSharedValue(0);

  React.useEffect(() => {
    drift.value = withRepeat(
      withTiming(-14, { duration: 6000 + delay, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [drift, delay]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateY: drift.value }],
    opacity: 0.35 + (size / 4) * 0.15,
  }));

  return (
    <Animated.View
      style={[
        styles.dot,
        style,
        {
          left: `${x}%`,
          top: `${y}%`,
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: color,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { position: "absolute" },
});
