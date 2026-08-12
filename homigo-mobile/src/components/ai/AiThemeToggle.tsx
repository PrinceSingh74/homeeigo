import React from "react";
import { View, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Moon, Sun } from "lucide-react-native";
import { useAiTheme, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { useThemeToggle } from "@/lib/theme-store";
import { PressableScale } from "./PressableScale";

/** Nav dark / light mode control */
export function AiThemeToggle() {
  const { isDark, toggle } = useThemeToggle();
  const { c } = useAiTheme();

  return (
    <PressableScale
      onPress={toggle}
      haptic
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: isDark }}
      accessibilityLabel={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <View
        style={[
          styles.btn,
          {
            backgroundColor: isDark ? "rgba(16, 185, 129,0.22)" : c.card,
            borderColor: isDark ? "rgba(16, 185, 129,0.45)" : c.cardBorderStrong,
          },
          aiCardShadow(isDark ? c.shadowAccent : c.shadowColor, isDark ? "glow" : "soft"),
        ]}
      >
        {isDark ? (
          <LinearGradient
            colors={["#FBBF24", "#F59E0B"]}
            style={styles.iconGrad}
          >
            <Sun size={18} color="#FFFFFF" strokeWidth={2.5} />
          </LinearGradient>
        ) : (
          <LinearGradient
            colors={["#4F46E5", "#10b981"]}
            style={styles.iconGrad}
          >
            <Moon size={18} color="#FFFFFF" strokeWidth={2.5} />
          </LinearGradient>
        )}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 42,
    height: 42,
    borderRadius: aiRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  iconGrad: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
});
