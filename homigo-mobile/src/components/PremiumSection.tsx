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
import { shadowStyles } from "@/lib/colors";

type Benefit = { icon: LucideIcon; l1: string; l2: string };

const BENEFITS: Benefit[] = [
  { icon: Star, l1: "Priority", l2: "Booking" },
  { icon: Users, l1: "Elite", l2: "Pros" },
  { icon: Headphones, l1: "Premium", l2: "Support" },
  { icon: Cpu, l1: "AI", l2: "Optimize" },
  { icon: RotateCcw, l1: "Free", l2: "Revisits" },
];

function CrownBadge() {
  const float = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(-5, { duration: 2000, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    spin.value = withRepeat(
      withTiming(1, { duration: 8000, easing: Easing.linear }),
      -1,
      false
    );
  }, []);

  const floatStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: float.value }],
  }));
  const spinStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.crownWrap} pointerEvents="none">
      <Animated.View style={[styles.crownRing, spinStyle]} />
      <Animated.Text style={[styles.crownEmoji, floatStyle]}>👑</Animated.Text>
    </View>
  );
}

export const PremiumSection: React.FC = () => {
  return (
    <View style={styles.container}>
      <LinearGradient
        colors={["#7C3AED", "#9333EA", "#DB2777"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, shadowStyles.glowViolet]}
      >
        {/* soft sheen */}
        <LinearGradient
          colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.sheen}
        />

        <CrownBadge />

        {/* Title */}
        <View style={styles.titleRow}>
          <View style={styles.titlePill}>
            <Text style={styles.titlePillText}>PREMIUM</Text>
          </View>
          <Text style={styles.title}>HOMIGO Premium</Text>
        </View>
        <Text style={styles.subtitle}>
          Unlock the elite home-care experience
        </Text>

        {/* Benefits — full-width even row */}
        <View style={styles.benefitsRow}>
          {BENEFITS.map((b, idx) => {
            const Icon = b.icon;
            return (
              <View key={idx} style={styles.benefit}>
                <View style={styles.benefitIcon}>
                  <Icon size={18} color="#fff" strokeWidth={2.2} />
                </View>
                <Text
                  style={styles.benefitL1}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {b.l1}
                </Text>
                <Text
                  style={styles.benefitL2}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {b.l2}
                </Text>
              </View>
            );
          })}
        </View>

        {/* CTA */}
        <Pressable style={styles.upgradeBtn}>
          <Text style={styles.upgradeBtnText}>Upgrade Now</Text>
          <ArrowRight size={15} color="#9333EA" strokeWidth={2.8} />
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
    borderRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 22,
    overflow: "hidden",
  },
  sheen: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "55%",
  },
  crownWrap: {
    position: "absolute",
    top: 14,
    right: 16,
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  crownRing: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: "rgba(251,191,36,0.5)",
    borderStyle: "dashed",
  },
  crownEmoji: {
    fontSize: 40,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingRight: 70,
  },
  titlePill: {
    backgroundColor: "rgba(255,255,255,0.2)",
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 7,
  },
  titlePillText: {
    fontSize: 9,
    fontWeight: "900",
    color: "#fff",
    letterSpacing: 1,
  },
  title: {
    fontSize: 19,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "500",
    color: "rgba(255,255,255,0.78)",
    marginTop: 7,
    marginBottom: 22,
    paddingRight: 70,
  },
  benefitsRow: {
    flexDirection: "row",
    marginBottom: 22,
  },
  benefit: {
    flex: 1,
    alignItems: "center",
  },
  benefitIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 9,
  },
  benefitL1: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
  },
  benefitL2: {
    fontSize: 9.5,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
    marginTop: 1,
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingVertical: 14,
    borderRadius: 16,
  },
  upgradeBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#9333EA",
    letterSpacing: -0.2,
  },
});
