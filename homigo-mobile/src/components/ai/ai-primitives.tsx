import React from "react";
import { View, StyleSheet, Platform, type ViewStyle, type StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import {
  useAiTheme,
  aiRadius,
  aiCardShadow,
  type AiShadowTier,
} from "@/lib/ai-mobile-theme";

type GlassProps = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  shadow?: AiShadowTier;
  glow?: boolean;
  pad?: number;
};

/** Premium 3D glass card — top specular + depth shadow */
export function AiGlassCard({
  children,
  style,
  radius = aiRadius.xl,
  shadow = "lift",
  glow = false,
  pad = 0,
}: GlassProps) {
  const { c, isDark } = useAiTheme();

  return (
    <View
      style={[
        styles.shell,
        { borderRadius: radius },
        aiCardShadow(c.shadowColor, shadow, glow ? c.shadowAccent : undefined),
        glow && aiCardShadow(c.shadowAccent, "glow"),
        style,
      ]}
    >
      <View
        style={[
          styles.card,
          {
            borderRadius: radius,
            borderColor: c.cardBorderStrong,
            backgroundColor: c.card,
            padding: pad,
          },
        ]}
      >
        {Platform.OS === "ios" ? (
          <BlurView
            intensity={isDark ? 28 : 50}
            tint={isDark ? "dark" : "light"}
            style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
          />
        ) : null}

        <LinearGradient
          colors={
            isDark
              ? ["rgba(255,255,255,0.1)", "rgba(255,255,255,0.02)", "transparent"]
              : ["rgba(255,255,255,0.95)", "rgba(255,255,255,0.4)", "transparent"]
          }
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 0.45 }}
          style={[styles.specular, { borderRadius: radius }]}
          pointerEvents="none"
        />

        <LinearGradient
          colors={["transparent", isDark ? "rgba(0,0,0,0.25)" : "rgba(15,23,42,0.04)"]}
          style={[styles.depthFloor, { borderRadius: radius }]}
          pointerEvents="none"
        />

        {children}
      </View>
    </View>
  );
}

/** Thin neon top edge for sections */
export function AiNeonTopEdge({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <LinearGradient
      colors={["#2dd4bf", "#10b981", "#34d399", "transparent"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={[styles.neonEdge, style]}
      pointerEvents="none"
    />
  );
}

const styles = StyleSheet.create({
  shell: { overflow: "visible" },
  card: {
    overflow: "hidden",
    borderWidth: 1,
  },
  specular: {
    ...StyleSheet.absoluteFillObject,
    height: "55%",
  },
  depthFloor: {
    ...StyleSheet.absoluteFillObject,
    top: "50%",
  },
  neonEdge: {
    height: 2,
    width: "100%",
    borderRadius: 1,
  },
});
