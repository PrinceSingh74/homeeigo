import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Easing,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { Sparkles, ArrowRight, Play } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

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
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(20)).current;
  const float = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: -8,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    Animated.loop(
      Animated.timing(glow, {
        toValue: 1,
        duration: 4200,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ).start();
  }, []);

  return (
    <LinearGradient
      colors={
        isDark
          ? ["#0F172A", "#1E1B4B", "#0F172A"]
          : ["#F8FAFC", "#EFF6FF", "#F3E8FF"]
      }
      style={styles.container}
    >
      <Animated.View
        style={[
          styles.row,
          { opacity: fade, transform: [{ translateY: slide }] },
        ]}
      >
        {/* LEFT — content */}
        <View style={styles.left}>
          <LinearGradient
            colors={["rgba(37,99,235,0.14)", "rgba(124,58,237,0.14)"]}
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
          <Animated.View
            style={[
              styles.glowBlob,
              {
                opacity: glow.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.5, 0.85, 0.5],
                }),
                transform: [
                  {
                    scale: glow.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.92, 1.06, 0.92],
                    }),
                  },
                ],
              },
            ]}
          >
            <LinearGradient
              colors={["#7C3AED", "#06B6D4", "#EC4899"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.glowFill}
            />
          </Animated.View>

          <Animated.Image
            source={require("../../assets/hero-villa.webp")}
            style={[styles.img, { transform: [{ translateY: float }] }]}
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
  heading: { marginBottom: 10 },
  h1: {
    fontSize: 20,
    fontWeight: "800",
    lineHeight: 25,
    letterSpacing: -0.4,
  },
  sub: {
    fontSize: 11,
    fontWeight: "500",
    lineHeight: 16,
    marginBottom: 16,
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
