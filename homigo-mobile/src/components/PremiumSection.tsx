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
  { icon: Users, l1: "Elite", l2: "Professionals" },
  { icon: Headphones, l1: "Premium", l2: "Support" },
  { icon: Cpu, l1: "AI", l2: "Optimization" },
  { icon: RotateCcw, l1: "Free", l2: "Revisits" },
];

function BigCrown() {
  const float = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(-6, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
    spin.value = withRepeat(
      withTiming(1, { duration: 9000, easing: Easing.linear }),
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
      <Animated.View style={[styles.crownGlow, spinStyle]} />
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
        <LinearGradient
          colors={["rgba(255,255,255,0.15)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.sheen}
        />

        <BigCrown />

        {/* Title */}
        <View style={styles.titleRow}>
          <Text style={styles.title}>HOMIGO PREMIUM</Text>
          <Text style={styles.titleCrown}>👑</Text>
        </View>

        {/* Benefits */}
        <View style={styles.benefitsRow}>
          {BENEFITS.map((b, idx) => {
            const Icon = b.icon;
            return (
              <View key={idx} style={styles.benefit}>
                <View style={styles.benefitIcon}>
                  <Icon size={17} color="#fff" strokeWidth={2.2} />
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

        {/* Upgrade Now — compact, bottom-right */}
        <View style={styles.btnRow}>
          <Pressable style={styles.upgradeBtn}>
            <Text style={styles.upgradeBtnText}>Upgrade Now</Text>
            <ArrowRight size={14} color="#9333EA" strokeWidth={2.8} />
          </Pressable>
        </View>
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
    padding: 20,
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
    right: 6,
    top: 10,
    width: 104,
    height: 104,
    alignItems: "center",
    justifyContent: "center",
  },
  crownGlow: {
    position: "absolute",
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: "rgba(251,191,36,0.45)",
    borderStyle: "dashed",
  },
  crownEmoji: {
    fontSize: 60,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
    paddingRight: 96,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.4,
  },
  titleCrown: {
    fontSize: 15,
  },
  benefitsRow: {
    flexDirection: "row",
    marginBottom: 18,
    paddingRight: 88,
  },
  benefit: {
    flex: 1,
    alignItems: "center",
  },
  benefitIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.16)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  benefitL1: {
    fontSize: 10,
    fontWeight: "800",
    color: "#fff",
    textAlign: "center",
  },
  benefitL2: {
    fontSize: 9,
    fontWeight: "600",
    color: "rgba(255,255,255,0.82)",
    textAlign: "center",
    marginTop: 1,
  },
  btnRow: {
    flexDirection: "row",
    justifyContent: "flex-start",
  },
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#fff",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 14,
  },
  upgradeBtnText: {
    fontSize: 13.5,
    fontWeight: "800",
    color: "#9333EA",
    letterSpacing: -0.2,
  },
});
