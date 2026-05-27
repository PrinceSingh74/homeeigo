import React from "react";
import { View, Text, StyleSheet, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { walletEnter } from "@/lib/wallet-animations";

const CROWN_IMG = require("../../../assets/crown-3d.png");

type Props = {
  onUpgrade: () => void;
};

export function WalletPremiumBanner({ onUpgrade }: Props) {
  const { colors: c } = useTheme();

  return (
    <Animated.View entering={walletEnter.premium} style={styles.outer}>
      <LinearGradient
        colors={["#F0FDF4", "#DBEAFE"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.wrap}
      >
        <Image source={CROWN_IMG} style={styles.crown} resizeMode="contain" />
        <View style={styles.copy}>
          <Text style={styles.title}>Go Premium. Save More.</Text>
          <Text style={[styles.sub, { color: c.text }]}>
            Priority support, exclusive offers, free rescheduling & more.
          </Text>
        </View>
        <PressableScale onPress={onUpgrade} haptic style={styles.btnWrap}>
          <View style={styles.btn}>
            <Text style={styles.btnText}>Upgrade Now</Text>
            <ChevronRight size={12} color="#fff" strokeWidth={2.5} />
          </View>
        </PressableScale>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: { marginTop: 0, marginBottom: spacing.xl },
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#86EFAC",
    minHeight: 160,
    position: "relative",
    shadowColor: "#10B981",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 6,
  },
  crown: { width: 60, height: 60 },
  copy: { flex: 1, minWidth: 0, paddingRight: 108, paddingTop: 4 },
  title: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: "#047857",
  },
  sub: {
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
    opacity: 0.9,
  },
  btnWrap: {
    position: "absolute",
    right: 12,
    bottom: 12,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 36,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: "#7C3AED",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 4,
  },
  btnText: { color: "#fff", fontSize: 12, fontWeight: "700" },
});
