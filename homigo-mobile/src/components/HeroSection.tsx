import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Image,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import MaskedView from "@react-native-masked-view/masked-view";
import { Sparkles } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "./Button";

const { width } = Dimensions.get("window");

function GradientText({ children }: { children: string }) {
  return (
    <MaskedView
      maskElement={
        <Text style={styles.headingLine}>{children}</Text>
      }
    >
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
  const imgScale = useRef(new Animated.Value(0.9)).current;

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
      Animated.spring(imgScale, {
        toValue: 1,
        delay: 200,
        useNativeDriver: true,
        speed: 6,
        bounciness: 6,
      }),
    ]).start();
  }, []);

  return (
    <LinearGradient
      colors={
        isDark
          ? [themeColors.bg, "#1E1B4B"]
          : ["#F8FAFC", "#EFF6FF", "#F3E8FF"]
      }
      style={styles.container}
    >
      <Animated.View
        style={[styles.content, { opacity: fade, transform: [{ translateY: slide }] }]}
      >
        {/* AI Badge */}
        <View style={styles.badgeRow}>
          <LinearGradient
            colors={["rgba(37,99,235,0.12)", "rgba(124,58,237,0.12)"]}
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

        {/* Main Heading */}
        <View style={styles.heading}>
          <Text style={[styles.headingLine, { color: themeColors.text }]}>
            The Future of
          </Text>
          <GradientText>Home Services.</GradientText>
        </View>

        {/* Subheading */}
        <Text style={[styles.subheading, { color: themeColors.textSecondary }]}>
          Smart. Fast. Reliable. Book verified professionals in under 60
          seconds with real-time tracking and AI-matched experts.
        </Text>

        {/* CTA Buttons */}
        <View style={styles.buttonContainer}>
          <Button title="Book a Service" onPress={() => {}} variant="primary" size="lg" />
          <Button title="See How It Works" onPress={() => {}} variant="secondary" size="lg" />
        </View>

        {/* Premium 3D smart-home render */}
        <Animated.View
          style={[styles.heroImageWrap, { transform: [{ scale: imgScale }] }]}
        >
          <Image
            source={require("../../assets/hero-villa.jpg")}
            style={styles.heroImage}
            resizeMode="contain"
          />
        </Animated.View>
      </Animated.View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 28,
  },
  content: {
    gap: 18,
  },
  badgeRow: {
    flexDirection: "row",
  },
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
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  heading: {
    gap: 2,
  },
  headingLine: {
    fontSize: 42,
    fontWeight: "800",
    lineHeight: 48,
    letterSpacing: -1,
  },
  subheading: {
    fontSize: 15,
    fontWeight: "400",
    lineHeight: 23,
    maxWidth: "94%",
  },
  buttonContainer: {
    gap: 12,
    marginTop: 4,
  },
  heroImageWrap: {
    marginTop: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    width: width - 28,
    height: (width - 28) * 0.66,
  },
});
