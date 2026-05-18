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
import { Crown, Star, Users, Zap, RotateCcw, ArrowRight } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

const { width } = Dimensions.get("window");

const BENEFITS = [
  { icon: Star, label: "Priority Booking" },
  { icon: Users, label: "Elite Professionals" },
  { icon: Zap, label: "Premium Support" },
  { icon: Star, label: "AI Optimization" },
  { icon: RotateCcw, label: "Free Revisits" },
];

function FloatingParticle({ delay }: { delay: number }) {
  const float = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(-12, { duration: 3000 + delay, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, []);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: float.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: "#D4AF37",
          opacity: 0.3,
        },
        floatStyle,
      ]}
    />
  );
}

export const PremiumSection: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#7C3AED", "#EC4899", "#7C3AED"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, shadowStyles.glowViolet]}
      >
        {/* Floating particles */}
        <FloatingParticle delay={0} />
        <FloatingParticle delay={600} />
        <FloatingParticle delay={1200} />

        {/* Crown Icon */}
        <View style={styles.crownContainer}>
          <Crown size={32} color="#D4AF37" />
        </View>

        <Text style={styles.title}>HOMIGO Premium</Text>
        <Text style={styles.subtitle}>Elite AI-powered home care</Text>

        {/* Benefits Grid */}
        <View style={styles.benefitsGrid}>
          {BENEFITS.map((benefit, idx) => {
            const Icon = benefit.icon;
            return (
              <View key={idx} style={styles.benefitItem}>
                <Icon size={16} color="#D4AF37" />
                <Text style={styles.benefitLabel}>{benefit.label}</Text>
              </View>
            );
          })}
        </View>

        <Pressable style={styles.upgradeBtn}>
          <Text style={styles.upgradeBtnText}>Upgrade Now</Text>
          <ArrowRight size={14} color="#1E1B4B" />
        </Pressable>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginVertical: 48,
  },
  card: {
    borderRadius: 28,
    padding: 24,
    alignItems: "center",
    overflow: "hidden",
  },
  crownContainer: {
    marginBottom: 12,
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 24,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
    marginBottom: 20,
  },
  benefitsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginBottom: 20,
    justifyContent: "center",
  },
  benefitItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  benefitLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#fff",
    letterSpacing: -0.2,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#D4AF37",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 14,
    width: "100%",
    justifyContent: "center",
  },
  upgradeBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#1E1B4B",
    letterSpacing: -0.2,
  },
});
