import React, { useEffect } from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
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

const CROWN_IMG = require("../../assets/crown-3d.png");

type Benefit = { icon: LucideIcon; l1: string; l2: string };

const BENEFITS: Benefit[] = [
  { icon: Star, l1: "Priority", l2: "Booking" },
  { icon: Users, l1: "Elite", l2: "Pros" },
  { icon: Headphones, l1: "Premium", l2: "Support" },
  { icon: Cpu, l1: "AI", l2: "Optimize" },
  { icon: RotateCcw, l1: "Free", l2: "Revisits" },
];

function Crown() {
  const float = useSharedValue(0);
  const spin = useSharedValue(0);

  useEffect(() => {
    float.value = withRepeat(
      withTiming(-5, { duration: 2200, easing: Easing.inOut(Easing.ease) }),
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
      <Animated.Image
        source={CROWN_IMG}
        resizeMode="contain"
        style={[styles.crownImg, floatStyle]}
      />
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
          colors={["rgba(255,255,255,0.16)", "rgba(255,255,255,0)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={styles.sheen}
        />

        {/* Title band */}
        <View style={styles.topRow}>
          <Text style={styles.title}>HOMIGO PREMIUM</Text>
          <Crown />
        </View>

        {/* Benefits — full width, readable */}
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

        {/* Upgrade Now */}
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
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 56,
    marginBottom: 14,
  },
  title: {
    fontSize: 19,
    fontWeight: "800",
    color: "#fff",
    letterSpacing: 0.4,
  },
  crownWrap: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  crownGlow: {
    position: "absolute",
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: "rgba(251,191,36,0.5)",
    borderStyle: "dashed",
  },
  crownImg: {
    width: 60,
    height: 60,
  },
  benefitsRow: {
    flexDirection: "row",
    marginBottom: 20,
  },
  benefit: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 1,
  },
  benefitIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
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
  upgradeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 14,
  },
  upgradeBtnText: {
    fontSize: 14,
    fontWeight: "800",
    color: "#9333EA",
    letterSpacing: -0.2,
  },
});
