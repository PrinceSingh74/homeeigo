import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Moon, Sun } from "lucide-react-native";
import { useThemeToggle } from "@/lib/theme-store";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesTheme } from "./ServicesThemeContext";

/** Night / day toggle for Services screen */
export function ServicesThemeToggle() {
  const { isDark, toggle } = useThemeToggle();
  const { c, shadows } = useServicesTheme();

  return (
    <PressableScale
      onPress={toggle}
      haptic
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to night mode"}
    >
      <View
        style={[
          styles.btn,
          {
            backgroundColor: isDark ? "rgba(139, 92, 246, 0.25)" : c.chipBg,
            borderColor: isDark ? "rgba(167, 139, 250, 0.45)" : c.badgeBorder,
          },
          shadows.glass,
        ]}
      >
        {isDark ? (
          <LinearGradient colors={["#FBBF24", "#F59E0B"]} style={styles.iconGrad}>
            <Sun size={17} color="#FFFFFF" strokeWidth={2.5} />
          </LinearGradient>
        ) : (
          <LinearGradient colors={["#6C3AE8", "#8B5CF6"]} style={styles.iconGrad}>
            <Moon size={17} color="#FFFFFF" strokeWidth={2.5} />
          </LinearGradient>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 38,
    height: 38,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  iconGrad: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
});
