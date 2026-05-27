import React from "react";
import { View, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  intensity?: number;
  borderRadius?: number;
  elevated?: boolean;
};

export function GlassSurface({
  children,
  style,
  intensity,
  borderRadius = 18,
  elevated = true,
}: Props) {
  const { c, shadows, isDark } = useServicesTheme();
  const blurIntensity = intensity ?? (isDark ? 36 : 48);

  return (
    <View
      style={[
        styles.wrap,
        { borderRadius, borderColor: c.trustGlassBorder },
        elevated && shadows.glass,
        isDark && { backgroundColor: "rgba(26, 22, 40, 0.55)" },
        style,
      ]}
    >
      <BlurView
        intensity={blurIntensity}
        tint={c.glassTint}
        style={[StyleSheet.absoluteFill, { borderRadius, overflow: "hidden" }]}
      />
      <LinearGradient
        colors={
          isDark
            ? ["rgba(30, 26, 48, 0.85)", "rgba(22, 18, 36, 0.65)", "rgba(18, 14, 30, 0.5)"]
            : ["rgba(255,255,255,0.72)", "rgba(255,255,255,0.45)", "rgba(255,255,255,0.25)"]
        }
        style={[StyleSheet.absoluteFill, { borderRadius }]}
      />
      <View style={[styles.edge, { borderRadius, borderColor: c.trustGlassBorder }]} />
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: "hidden",
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.35)",
  },
  edge: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
  },
  content: {
    position: "relative",
    zIndex: 2,
  },
});
