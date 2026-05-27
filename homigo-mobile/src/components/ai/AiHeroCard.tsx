import React, { useEffect } from "react";
import { View, Text, Image, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  interpolate,
} from "react-native-reanimated";
import { Camera, Mic } from "lucide-react-native";
import { AI_USER } from "@/lib/ai-mobile-data";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { PressableScale } from "./PressableScale";

const ROBOT = require("../../../assets/robot-3d.png");

/** Hero card is always on a dark gradient — never use light-theme black text */
const HERO_INK = {
  greeting: "#C5D0E8",
  headline: "#FFFFFF",
  subline: "#9AA8C4",
};

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

export function AiHeroCard() {
  const { c } = useAiTheme();

  // Robot float
  const float = useSharedValue(0);
  // Voice orb pulse
  const pulse = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  }, [float, pulse]);

  const robotStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(float.value, [0, 1], [0, -8]) }],
  }));
  const wave1Style = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.55, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.35]) }],
  }));
  const wave2Style = useAnimatedStyle(() => ({
    opacity: interpolate(pulse.value, [0, 1], [0.35, 0]),
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.6]) }],
  }));

  return (
    <View style={styles.outer}>
      <LinearGradient
        colors={[...c.heroBg]}
        style={[
          styles.card,
          { borderColor: c.cardBorderStrong },
          aiCardShadow(c.shadowAccent, "hero"),
        ]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        {/* Ambient glows */}
        <View style={[styles.glowA, { backgroundColor: c.glowCyan }]} />
        <View style={[styles.glowB, { backgroundColor: c.glowViolet }]} />

        {/* MAIN ROW: robot | text | voice orb */}
        <View style={styles.row}>
          {/* Robot column */}
          <View style={styles.robotCol}>
            <View style={styles.platformShadow} />
            <LinearGradient
              colors={["transparent", "rgba(0, 209, 255, 0.95)", "transparent"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.platformLine}
            />
            <Animated.View style={[styles.robotInner, robotStyle]}>
              <Image source={ROBOT} style={styles.robot} resizeMode="contain" />
            </Animated.View>
          </View>

          {/* Greeting + headline */}
          <View style={styles.textCol}>
            <Text style={[styles.greeting, { color: HERO_INK.greeting }]}>
              {getGreeting()}, {AI_USER.name}{" "}
              <Text style={{ fontSize: 13, color: HERO_INK.greeting }}>👋</Text>
            </Text>
            <Text style={[styles.headline, { color: HERO_INK.headline }]} numberOfLines={2}>
              How can I help{"\n"}today?
            </Text>
            <Text style={[styles.subline, { color: HERO_INK.subline }]} numberOfLines={2}>
              Book services, diagnose issues,{"\n"}or manage your home instantly.
            </Text>
          </View>

          {/* Voice orb with pulsing rings */}
          <View style={styles.orbCol}>
            <Animated.View style={[styles.orbWave, wave2Style]} />
            <Animated.View style={[styles.orbWave, wave1Style]} />
            <View style={styles.orbHalo} />
            <LinearGradient
              colors={["#5B45E0", "#7B61FF", "#4A90E2"]}
              style={styles.orbBody}
            >
              <View style={styles.orbInner}>
                <Mic size={22} color="#FFFFFF" strokeWidth={2.6} />
              </View>
            </LinearGradient>
          </View>
        </View>

        {/* CTA buttons */}
        <View style={styles.ctaRow}>
          <PressableScale style={styles.ctaPrimaryWrap} haptic>
            <LinearGradient
              colors={["#7B61FF", "#6366F1"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaPrimary}
            >
              <Mic size={16} color="#FFFFFF" strokeWidth={2.5} />
              <Text style={styles.ctaPrimaryText}>Talk to AI</Text>
            </LinearGradient>
          </PressableScale>

          <PressableScale
            style={[
              styles.ctaGhost,
              { borderColor: "rgba(255,255,255,0.18)", backgroundColor: "rgba(255,255,255,0.04)" },
            ]}
            haptic
          >
            <Camera size={16} color="#E2E8F0" strokeWidth={2.2} />
            <Text style={styles.ctaGhostText}>Upload Photo</Text>
          </PressableScale>
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingHorizontal: aiSpacing.screen,
    marginBottom: aiSpacing.section,
  },
  card: {
    borderRadius: aiRadius.xxl,
    borderWidth: 1,
    padding: aiSpacing.cardLg,
    paddingBottom: aiSpacing.card,
    overflow: "hidden",
  },
  glowA: {
    position: "absolute",
    left: -50,
    top: -40,
    width: 180,
    height: 180,
    borderRadius: 90,
    opacity: 0.6,
  },
  glowB: {
    position: "absolute",
    right: -30,
    bottom: -30,
    width: 160,
    height: 160,
    borderRadius: 80,
    opacity: 0.5,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  robotCol: {
    width: 92,
    height: 110,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  platformShadow: {
    position: "absolute",
    bottom: 4,
    width: 82,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(0, 209, 255, 0.35)",
    shadowColor: "#00D1FF",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.6,
    shadowRadius: 16,
    elevation: 10,
  },
  platformLine: {
    position: "absolute",
    bottom: 10,
    width: 70,
    height: 4,
    borderRadius: 2,
  },
  robotInner: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
  },
  robot: { width: 92, height: 92 },
  textCol: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 2,
  },
  greeting: { ...aiType.small, fontSize: 12, fontWeight: "600", marginBottom: 2 },
  headline: {
    ...aiType.h1,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: -0.6,
    marginTop: 2,
  },
  subline: {
    ...aiType.small,
    fontSize: 11.5,
    lineHeight: 16,
    marginTop: 6,
    fontWeight: "500",
  },
  orbCol: {
    width: 90,
    height: 90,
    alignItems: "center",
    justifyContent: "center",
  },
  orbWave: {
    position: "absolute",
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 2,
    borderColor: "#7B61FF",
  },
  orbHalo: {
    position: "absolute",
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(123,97,255,0.35)",
    shadowColor: "#7B61FF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 18,
  },
  orbBody: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.3)",
  },
  orbInner: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  ctaRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },
  ctaPrimaryWrap: { flex: 1 },
  ctaPrimary: {
    height: 46,
    borderRadius: aiRadius.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaPrimaryText: {
    ...aiType.bodyStrong,
    fontSize: 13,
    color: "#FFFFFF",
    letterSpacing: -0.2,
  },
  ctaGhost: {
    flex: 1,
    height: 46,
    borderRadius: aiRadius.md,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  ctaGhostText: {
    ...aiType.bodyStrong,
    fontSize: 13,
    color: "#E2E8F0",
    letterSpacing: -0.2,
  },
});
