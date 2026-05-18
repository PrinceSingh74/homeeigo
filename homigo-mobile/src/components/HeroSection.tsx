import React, { useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSpring,
  Easing,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { Sparkles, ArrowRight, Play } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles, gradients } from "@/lib/colors";

const { width } = Dimensions.get("window");
const H_PAD = 18;
const STAGE_W = width - H_PAD * 2;
const LEFT_W = STAGE_W * 0.55;
const RIGHT_W = STAGE_W * 0.45;
const IMG = RIGHT_W + 14;

function GradientText({ children }: { children: string }) {
  return (
    <MaskedView maskElement={<Text style={styles.h1}>{children}</Text>}>
      <LinearGradient
        colors={["#2563EB", "#7C3AED", "#06B6D4"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.6 }}
      >
        <Text style={[styles.h1, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

export const HeroSection: React.FC = () => {
  const { colors: themeColors, isDark } = useTheme();

  // Entry animations
  const fadeAnim = useSharedValue(0);
  const slideAnim = useSharedValue(20);

  // Loop animations
  const floatAnim = useSharedValue(0);
  const glowAnim = useSharedValue(0);

  useEffect(() => {
    // Entry fade + slide
    fadeAnim.value = withTiming(1, { duration: 700, easing: Easing.inOut(Easing.ease) });
    slideAnim.value = withTiming(0, { duration: 700, easing: Easing.inOut(Easing.ease) });

    // Float loop
    floatAnim.value = withRepeat(
      withTiming(-8, { duration: 2800, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );

    // Glow pulse loop
    glowAnim.value = withRepeat(
      withTiming(1, { duration: 4000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [fadeAnim, slideAnim, floatAnim, glowAnim]);

  // Animated styles
  const entryAnimStyle = useAnimatedStyle(() => ({
    opacity: fadeAnim.value,
    transform: [{ translateY: slideAnim.value }],
  }));

  const floatAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: floatAnim.value }],
  }));

  const glowAnimStyle = useAnimatedStyle(() => ({
    opacity: 0.25 + glowAnim.value * 0.25,
    transform: [{ scale: 0.92 + glowAnim.value * 0.14 }],
  }));

  return (
    <LinearGradient
      colors={gradients.heroBackground}
      style={styles.container}
    >
      <Animated.View style={[styles.row, entryAnimStyle]}>
        {/* LEFT — content */}
        <View style={styles.left}>
          <LinearGradient
            colors={["rgba(37,99,235,0.12)", "rgba(124,58,237,0.12)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.badge}
          >
            <Sparkles size={11} color={themeColors.primary} />
            <Text style={[styles.badgeText, { color: themeColors.primary }]}>
              AI-Powered
            </Text>
          </LinearGradient>

          <View style={styles.heading}>
            <Text style={[styles.h1, { color: themeColors.text }]}>
              The Future of
            </Text>
            <GradientText>Home Services.</GradientText>
          </View>

          <Text
            style={[styles.sub, { color: themeColors.textSecondary }]}
          >
            Smart. Fast. Reliable. Everything your home needs, powered by AI.
          </Text>

          <View style={styles.ctas}>
            <Pressable>
              <LinearGradient
                colors={["#2563EB", "#7C3AED", "#06B6D4"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={[styles.primaryBtn, shadowStyles.glowBlue]}
              >
                <Text style={styles.primaryText}>Book a Service</Text>
                <ArrowRight size={15} color="#fff" />
              </LinearGradient>
            </Pressable>

            <Pressable style={styles.ghostBtn}>
              <View
                style={[
                  styles.playCircle,
                  { borderColor: themeColors.border },
                ]}
              >
                <Play size={11} color={themeColors.primary} fill={themeColors.primary} />
              </View>
              <Text style={[styles.ghostText, { color: themeColors.text }]}>
                See How It Works
              </Text>
            </Pressable>
          </View>
        </View>

        {/* RIGHT — floating villa with aurora glow */}
        <View style={styles.right}>
          <Animated.View style={[styles.glowBlob, glowAnimStyle]}>
            <LinearGradient
              colors={["#7C3AED", "#06B6D4", "#EC4899"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.glowFill}
            />
          </Animated.View>

          <Animated.Image
            source={require("../../assets/hero-villa.webp")}
            style={[styles.img, floatAnimStyle]}
            resizeMode="contain"
          />
        </View>
      </Animated.View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: H_PAD,
    paddingTop: 14,
    paddingBottom: 18,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  left: {
    width: LEFT_W,
    paddingRight: 6,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.25)",
    marginBottom: 12,
  },
  badgeText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.2 },
  heading: { marginBottom: 12 },
  h1: {
    fontSize: 26,
    fontWeight: "800",
    lineHeight: 32,
    letterSpacing: -0.5,
  },
  sub: {
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 18,
    marginBottom: 20,
  },
  ctas: { gap: 10 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  primaryText: {
    color: "#fff",
    fontSize: 13.5,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  ghostBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
  },
  playCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.6)",
  },
  ghostText: { fontSize: 12, fontWeight: "700" },
  right: {
    width: RIGHT_W,
    height: IMG + 20,
    alignItems: "center",
    justifyContent: "center",
  },
  glowBlob: {
    position: "absolute",
    width: RIGHT_W * 1.15,
    height: RIGHT_W * 1.15,
  },
  glowFill: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    opacity: 0.32,
  },
  img: {
    width: IMG,
    height: IMG,
  },
});
