import React, { useEffect, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { ArrowRight, Sparkles } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

const { width } = Dimensions.get("window");

function GlowRing() {
  const scale = useSharedValue(1);

  useEffect(() => {
    scale.value = withRepeat(
      withTiming(1.2, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 120,
          height: 120,
          borderRadius: 60,
          borderWidth: 2,
          borderColor: "rgba(6,182,212,0.3)",
          alignItems: "center",
          justifyContent: "center",
        },
        glowStyle,
      ]}
    >
      <View
        style={{
          width: 80,
          height: 80,
          borderRadius: 40,
          borderWidth: 1.5,
          borderColor: "rgba(6,182,212,0.5)",
        }}
      />
    </Animated.View>
  );
}

export const FinalCtaSection: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#0A0F1E", "#1E1B4B", "#2563EB"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.ctaCard, shadowStyles.xl]}
      >
        {/* Glow rings */}
        <View style={styles.glowContainer}>
          <GlowRing />
        </View>

        {/* Icon */}
        <View style={styles.iconContainer}>
          <LinearGradient
            colors={["#06B6D4", "#2563EB"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconBg}
          >
            <Sparkles size={32} color="#fff" />
          </LinearGradient>
        </View>

        {/* Main heading */}
        <Text style={styles.mainHeading}>
          Ready to experience{"\n"}
          <Text style={{ color: "#06B6D4" }}>the future?</Text>
        </Text>

        {/* Subheading */}
        <Text style={styles.subheading}>
          Book premium AI-powered home services instantly.
        </Text>

        {/* CTA Button */}
        <Pressable>
          <LinearGradient
            colors={["#06B6D4", "#2563EB", "#7C3AED"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.ctaButton, shadowStyles.glowCyan]}
          >
            <Text style={styles.ctaButtonText}>Get Started</Text>
            <ArrowRight size={16} color="#fff" strokeWidth={3} />
          </LinearGradient>
        </Pressable>

        {/* Bottom note */}
        <Text style={styles.bottomNote}>
          Join 50K+ happy customers nationwide
        </Text>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginTop: 20,
    marginBottom: 24,
  },
  ctaCard: {
    borderRadius: 32,
    paddingHorizontal: 24,
    paddingVertical: 48,
    alignItems: "center",
    overflow: "hidden",
  },
  glowContainer: {
    position: "absolute",
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.4,
  },
  iconContainer: {
    marginBottom: 24,
    zIndex: 1,
  },
  iconBg: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  mainHeading: {
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
    lineHeight: 36,
    letterSpacing: -0.5,
    marginBottom: 12,
    zIndex: 1,
  },
  subheading: {
    fontSize: 14,
    fontWeight: "500",
    color: "rgba(255,255,255,0.75)",
    textAlign: "center",
    marginBottom: 28,
    zIndex: 1,
  },
  ctaButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 18,
    width: "100%",
    zIndex: 1,
  },
  ctaButtonText: {
    fontSize: 16,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
  },
  bottomNote: {
    marginTop: 20,
    fontSize: 12,
    fontWeight: "600",
    color: "rgba(255,255,255,0.55)",
    textAlign: "center",
    zIndex: 1,
  },
});
