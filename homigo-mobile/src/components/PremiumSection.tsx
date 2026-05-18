import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
} from "react-native-reanimated";
import {
  Star,
  Users,
  Headphones,
  Cpu,
  RotateCcw,
  ArrowRight,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

type Benefit = { icon: LucideIcon; l1: string; l2: string };

const BENEFITS: Benefit[] = [
  { icon: Star, l1: "Priority", l2: "Booking" },
  { icon: Users, l1: "Elite", l2: "Professionals" },
  { icon: Headphones, l1: "Premium", l2: "Support" },
  { icon: Cpu, l1: "AI", l2: "Optimization" },
  { icon: RotateCcw, l1: "Free", l2: "Revisits" },
];

function CrownGlow() {
  const spin = useSharedValue(0);

  useEffect(() => {
    spin.value = withRepeat(
      withTiming(1, { duration: 6000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.crownWrap} pointerEvents="none">
      <Animated.View style={[styles.crownRing, spinStyle]} />
      <Text style={styles.crownEmoji}>👑</Text>
    </View>
  );
}

export const PremiumSection: React.FC = () => {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#7C3AED", "#9333EA", "#EC4899"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, shadowStyles.glowViolet]}
      >
        <CrownGlow />

        <View style={styles.titleRow}>
          <Text style={styles.title}>HOMIGO PREMIUM</Text>
          <Text style={styles.titleCrown}>👑</Text>
        </View>

        <View style={styles.benefitsRow}>
          {BENEFITS.map((b, idx) => {
            const Icon = b.icon;
            return (
              <View key={idx} style={styles.benefit}>
                <Icon size={20} color="#fff" strokeWidth={2} />
                <Text style={styles.benefitL1} numberOfLines={1} adjustsFontSizeToFit>
                  {b.l1}
                </Text>
                <Text style={styles.benefitL2} numberOfLines={1} adjustsFontSizeToFit>
                  {b.l2}
                </Text>
              </View>
            );
          })}
        </View>

        <Pressable style={styles.upgradeBtn}>
          <Text style={styles.upgradeBtnText}>Upgrade Now</Text>
          <ArrowRight size={14} color="#7C3AED" strokeWidth={2.6} />
        </Pressable>
      </LinearGradient>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginVertical: 20,
  },
  card: {
    borderRadius: 24,
    padding: 20,
    overflow: "hidden",
  },
  crownWrap: {
    position: "absolute",
    right: 10,
    top: 0,
    bottom: 0,
    width: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  crownRing: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: "rgba(212,175,55,0.4)",
    borderStyle: "dashed",
  },
  crownEmoji: {
    fontSize: 56,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 18,
  },
  title: {
    fontSize: 19,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.3,
  },
  titleCrown: {
    fontSize: 16,
  },
  benefitsRow: {
    flexDirection: "row",
    marginBottom: 18,
  },
  benefit: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 2,
  },
  benefitL1: {
    fontSize: 10,
    fontWeight: "700",
    color: "#fff",
    marginTop: 8,
    textAlign: "center",
  },
  benefitL2: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "rgba(255,255,255,0.85)",
    textAlign: "center",
    marginTop: 1,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: 14,
  },
  upgradeBtnText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#7C3AED",
    letterSpacing: -0.2,
  },
});
