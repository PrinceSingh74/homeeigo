import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Image,
  Dimensions,
} from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "./Button";
import { Card } from "./Card";
import { LinearGradient } from "expo-linear-gradient";

const { width } = Dimensions.get("window");

export const HeroSection: React.FC = () => {
  const { colors: themeColors, isDark } = useTheme();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 600,
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  return (
    <LinearGradient
      colors={[themeColors.bg, isDark ? "#1F2937" : "#EFF6FF"]}
      style={styles.container}
    >
      <View style={styles.content}>
        {/* AI Badge */}
        <Animated.View style={{ opacity: fadeAnim }}>
          <Card variant="standard" style={styles.badge}>
            <Text style={[styles.badgeText, { color: themeColors.primary }]}>
              ✨ AI-Powered Home Services
            </Text>
          </Card>
        </Animated.View>

        {/* Main Heading */}
        <Animated.Text
          style={[
            styles.mainHeading,
            { color: themeColors.text, opacity: fadeAnim },
          ]}
        >
          The Future of{"\n"}
          <Text style={{ color: themeColors.violet }}>
            Home Services.
          </Text>
        </Animated.Text>

        {/* Subheading */}
        <Animated.Text
          style={[
            styles.subheading,
            { color: themeColors.textSecondary, opacity: fadeAnim },
          ]}
        >
          Smart. Fast. Reliable. Book verified professionals in under 60 seconds with real-time tracking and AI-matched experts.
        </Animated.Text>

        {/* CTA Buttons */}
        <View style={styles.buttonContainer}>
          <Button
            title="Book a Service"
            onPress={() => {}}
            variant="primary"
            size="lg"
          />
          <Button
            title="See How It Works"
            onPress={() => {}}
            variant="secondary"
            size="lg"
          />
        </View>

        {/* Premium 3D smart-home render */}
        <Animated.View
          style={[
            styles.heroImageWrap,
            { opacity: fadeAnim, transform: [{ scale: scaleAnim }] },
          ]}
        >
          <Image
            source={require("../../assets/hero-villa.jpg")}
            style={styles.heroImage}
            resizeMode="contain"
          />
        </Animated.View>
      </View>
    </LinearGradient>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  content: {
    gap: 20,
  },
  badge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "600",
  },
  mainHeading: {
    fontSize: 44,
    fontWeight: "700",
    lineHeight: 48,
  },
  subheading: {
    fontSize: 16,
    fontWeight: "400",
    lineHeight: 22,
  },
  buttonContainer: {
    gap: 12,
  },
  heroImageWrap: {
    marginTop: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  heroImage: {
    width: width - 32,
    height: (width - 32) * 0.66,
  },
});
