import React from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Circle, Defs, RadialGradient, Stop } from "react-native-svg";
import { useTheme } from "@/hooks/useTheme";

/**
 * World-class home canvas — mirrors the Homeeigo website home/services page:
 *   base  → linear-gradient(135deg, #ffffff 0%, #f0fdf4 35%, #ffffff 100%)
 *   orbs  → soft emerald (top-right) + teal (bottom-left) radial glows
 * Dark-safe: falls back to the app's dark canvas with dimmed emerald/teal glows.
 * Rendered once behind the scrolling content (absolute fill, ~zero scroll cost).
 */
export function HomeBackground() {
  const { isDark } = useTheme();
  const { width, height } = useWindowDimensions();
  const h = Math.max(height, 900);

  if (isDark) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={["#05140d", "#07130f", "#04100b"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Svg width={width} height={h} style={StyleSheet.absoluteFill}>
          <Defs>
            <RadialGradient id="emeraldDark" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#10b981" stopOpacity={0.18} />
              <Stop offset="100%" stopColor="#10b981" stopOpacity={0} />
            </RadialGradient>
            <RadialGradient id="tealDark" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#14b8a6" stopOpacity={0.14} />
              <Stop offset="100%" stopColor="#14b8a6" stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={width * 0.92} cy={h * 0.08} r={width * 0.75} fill="url(#emeraldDark)" />
          <Circle cx={width * 0.06} cy={h * 0.42} r={width * 0.7} fill="url(#tealDark)" />
        </Svg>
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient
        colors={["#ffffff", "#f0fdf4", "#ffffff"]}
        locations={[0, 0.35, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Svg width={width} height={h} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="emeraldOrb" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#6ee7b7" stopOpacity={0.55} />
            <Stop offset="60%" stopColor="#a7f3d0" stopOpacity={0.28} />
            <Stop offset="100%" stopColor="#d1fae5" stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="tealOrb" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#5eead4" stopOpacity={0.45} />
            <Stop offset="60%" stopColor="#99f6e4" stopOpacity={0.22} />
            <Stop offset="100%" stopColor="#ccfbf1" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        {/* top-right emerald orb */}
        <Circle cx={width * 0.95} cy={h * 0.06} r={width * 0.78} fill="url(#emeraldOrb)" />
        {/* bottom-left teal orb */}
        <Circle cx={width * 0.04} cy={h * 0.4} r={width * 0.72} fill="url(#tealOrb)" />
      </Svg>
    </View>
  );
}
