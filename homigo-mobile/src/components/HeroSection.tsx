import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Image,
  Easing,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { Sparkles, ArrowRight, Play } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "./Button";

const { width } = Dimensions.get("window");
const IMG_W = width - 24;
const IMG_H = IMG_W * 0.66;

function GradientText({ children }: { children: string }) {
  return (
    <MaskedView maskElement={<Text style={styles.headingLine}>{children}</Text>}>
      <LinearGradient
        colors={["#2563EB", "#7C3AED", "#06B6D4"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.5 }}
      >
        <Text style={[styles.headingLine, { opacity: 0 }]}>{children}</Text>
      </LinearGradient>
    </MaskedView>
  );
}

export const HeroSection: React.FC = () => {
  const { colors: themeColors, isDark } = useTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(24)).current;
  const imgFloat = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(imgFloat, {
          toValue: -10,
          duration: 2600,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(imgFloat, {
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
        duration: 4000,
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
          styles.content,
          { opacity: fade, transform: [{ translateY: slide }] },
        ]}
      >
        {/* AI Badge */}
        <View style={styles.badgeRow}>
          <LinearGradient
            colors={["rgba(37,99,235,0.14)", "rgba(124,58,237,0.14)"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.badge}
          >
            <Sparkles size={14} color={themeColors.primary} />
            <Text style={[styles.badgeText, { color: themeColors.primary }]}>
              AI-Powered Home Assistance
            </Text>
          </LinearGradient>
        </View>

        {/* Heading */}
        <View style={styles.heading}>
          <Text style={[styles.headingLine, { color: themeColors.text }]}>
            The Future of
          </Text>
          <GradientText>Home Services.</GradientText>
        </View>

        {/* Subheading */}
        <Text style={[styles.subheading, { color: themeColors.textSecondary }]}>
          Smart. Fast. Reliable. Everything your home needs, powered by AI.
        </Text>

        {/* CTAs */}
        <View style={styles.buttonRow}>
          <Button
            title="Book a Service"
            onPress={() => {}}
            variant="primary"
            size="lg"
            icon={<ArrowRight size={18} color="#fff" />}
            style={{ flex: 1 }}
          />
          <Button
            title="How It Works"
            onPress={() => {}}
            variant="secondary"
            size="lg"
            icon={<Play size={16} color={themeColors.primary} />}
            style={{ flex: 1 }}
          />
        </View>

        {/* Floating villa with aurora glow */}
        <View style={styles.stage}>
          <Animated.View
            style={[
              styles.glowBlob,
              {
                opacity: glow.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0.55, 0.85, 0.55],
                }),
                transform: [
                  {
                    scale: glow.interpolate({
                      inputRange: [0, 0.5, 1],
                      outputRange: [0.95, 1.05, 0.95],
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
              style={styles.globFill}
            />
          </Animated.View>

          <Animated.Image
            source={require("../../assets/hero-villa.webp")}
            style={[styles.heroImage, { transform: [{ translateY: imgFloat }] }]}
            resizeMode="contain"
          />
        </View>
      </Animated.View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 24,
  },
  content: {
    gap: 16,
  },
  badgeRow: { flexDirection: "row" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(124,58,237,0.25)",
  },
  badgeText: { fontSize: 12, fontWeight: "700", letterSpacing: 0.2 },
  heading: { gap: 2 },
  headingLine: {
    fontSize: 40,
    fontWeight: "800",
    lineHeight: 46,
    letterSpacing: -1,
  },
  subheading: {
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 22,
    maxWidth: "92%",
  },
  buttonRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 2,
  },
  stage: {
    height: IMG_H + 24,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 6,
  },
  glowBlob: {
    position: "absolute",
    width: IMG_W * 0.82,
    height: IMG_W * 0.82,
    alignItems: "center",
    justifyContent: "center",
  },
  globFill: {
    width: "100%",
    height: "100%",
    borderRadius: 999,
    opacity: 0.35,
  },
  heroImage: {
    width: IMG_W,
    height: IMG_H,
  },
});
