import React from "react";
import { View, StyleSheet, type ViewStyle, type StyleProp } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  depth?: "soft" | "medium" | "deep";
};

export function Premium3DCard({
  children,
  style,
  radius = 18,
  depth = "medium",
}: Props) {
  const { c, shadows, isDark } = useServicesTheme();
  const shadow = shadows[depth];

  return (
    <View style={[styles.outer, { borderRadius: radius }, shadow, style]}>
      <View style={[styles.body, { borderRadius: radius, backgroundColor: c.card }]}>
        <LinearGradient
          colors={
            isDark
              ? ["rgba(30, 26, 48, 0.98)", "rgba(26, 22, 40, 1)"]
              : ["rgba(255,255,255,0.95)", "rgba(255,255,255,1)"]
          }
          style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        />
        <LinearGradient
          colors={
            isDark
              ? ["rgba(52, 211, 153, 0.12)", "transparent"]
              : ["rgba(255,255,255,0.8)", "transparent"]
          }
          style={[
            styles.topShine,
            { borderTopLeftRadius: radius, borderTopRightRadius: radius },
          ]}
        />
        <View
          style={[styles.rim, { borderRadius: radius, borderColor: c.premiumCardRim }]}
        />
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {},
  body: {
    overflow: "hidden",
  },
  topShine: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "35%",
    zIndex: 1,
    pointerEvents: "none",
  },
  rim: {
    ...StyleSheet.absoluteFillObject,
    borderWidth: 1,
    zIndex: 2,
    pointerEvents: "none",
  },
});
