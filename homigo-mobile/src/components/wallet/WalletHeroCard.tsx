import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from "react-native-reanimated";
import {
  Eye,
  EyeOff,
  Plus,
  TrendingUp,
  Crown,
  Coins,
  ChevronRight,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import {
  WALLET_BALANCE,
  WALLET_ADDED_MONTH,
  WALLET_H_COINS,
  WALLET_PREMIUM_EXPIRY,
  formatINR,
} from "@/lib/wallet-mobile-data";
import { WALLET_HERO_H, WALLET_HERO_H_COMPACT } from "@/lib/wallet-layout";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { walletEnter } from "@/lib/wallet-animations";
import { WalletHeroParticles } from "@/components/wallet/WalletHeroParticles";

const WALLET_IMG = require("../../../assets/wallet-3d.png");

type Props = {
  onAddMoney: () => void;
  onPremium: () => void;
  onCoins?: () => void;
};

export function WalletHeroCard({ onAddMoney, onPremium, onCoins }: Props) {
  const { isDark } = useTheme();
  const { width } = useWindowDimensions();
  const compact = width < 380;
  const cardH = compact ? WALLET_HERO_H_COMPACT : WALLET_HERO_H;
  const [hidden, setHidden] = useState(false);

  const floatY = useSharedValue(0);
  const rotate = useSharedValue(0);
  const glow = useSharedValue(1);

  useEffect(() => {
    floatY.value = withRepeat(
      withSequence(
        withTiming(-3, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
        withTiming(3, { duration: 1600, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    rotate.value = withRepeat(
      withSequence(
        withTiming(-4, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
        withTiming(4, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      ),
      -1,
      true,
    );
    glow.value = withRepeat(
      withSequence(
        withTiming(0.95, { duration: 3000 }),
        withTiming(1, { duration: 3000 }),
      ),
      -1,
      true,
    );
  }, [floatY, rotate, glow]);

  const walletAnim = useAnimatedStyle(() => ({
    transform: [
      { translateY: floatY.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  const cardGlow = useAnimatedStyle(() => ({ opacity: glow.value }));

  const toggleHidden = () => {
    Haptics.selectionAsync().catch(() => {});
    setHidden((v) => !v);
  };

  return (
    <Animated.View
      entering={walletEnter.hero}
      style={[
        styles.wrap,
        {
          shadowColor: "#7C3AED",
          shadowOffset: { width: 0, height: 16 },
          shadowOpacity: 0.3,
          shadowRadius: 24,
          elevation: 12,
        },
      ]}
    >
      <Animated.View style={[cardGlow, { borderRadius: radius.xl }]}>
        <LinearGradient
          colors={["#7C3AED", "#A21CAF", "#C026D3"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.card, { minHeight: cardH }]}
        >
          <WalletHeroParticles />

          <View style={styles.headerRow}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Total Balance</Text>
              <Pressable onPress={toggleHidden} hitSlop={12} accessibilityLabel="Toggle balance">
                {hidden ? (
                  <EyeOff size={14} color="rgba(255,255,255,0.8)" />
                ) : (
                  <Eye size={14} color="rgba(255,255,255,0.8)" />
                )}
              </Pressable>
            </View>
            <PressableScale onPress={onAddMoney} style={styles.addBtn} haptic>
              <Plus size={14} color="#7C3AED" strokeWidth={2.5} />
              <Text style={styles.addBtnText}>Add Money</Text>
            </PressableScale>
          </View>

          <View style={styles.bodyRow}>
            <View style={styles.balanceBlock}>
              <Text style={[styles.amount, compact && styles.amountCompact]}>
                {hidden ? "₹ ••••••" : `₹${formatINR(WALLET_BALANCE)}`}
              </Text>
              <View style={styles.pill}>
                <TrendingUp size={12} color="#10B981" strokeWidth={2.5} />
                <Text style={styles.pillText}>
                  ₹{formatINR(WALLET_ADDED_MONTH, 0)} added this month
                </Text>
              </View>
            </View>
            <Animated.View style={[styles.walletWrap, walletAnim]}>
              <Image source={WALLET_IMG} style={styles.walletImg} resizeMode="contain" />
            </Animated.View>
          </View>

          <BlurView
            intensity={isDark ? 32 : 48}
            tint="dark"
            style={styles.glassStrip}
          >
            <PressableScale onPress={onPremium} style={styles.stripItem} haptic>
              <View style={styles.stripIcon}>
                <Crown size={16} color="#D4AF37" />
              </View>
              <View style={styles.stripText}>
                <Text style={styles.stripTitle}>HOMIGO Premium</Text>
                <Text style={styles.stripSub} numberOfLines={1}>
                  Active | Valid till {WALLET_PREMIUM_EXPIRY}
                </Text>
              </View>
              <ChevronRight size={14} color="rgba(255,255,255,0.6)" />
            </PressableScale>
            <View style={styles.stripDivider} />
            <PressableScale onPress={onCoins} style={styles.stripItem} haptic>
              <View style={[styles.stripIcon, styles.coinIcon]}>
                <Coins size={16} color="#F59E0B" />
              </View>
              <View style={styles.stripText}>
                <Text style={styles.stripTitle}>H-Coins</Text>
                <Text style={styles.stripSub}>{WALLET_H_COINS} Coins</Text>
              </View>
              <ChevronRight size={14} color="rgba(255,255,255,0.6)" />
            </PressableScale>
          </BlurView>
        </LinearGradient>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 4,
    marginBottom: WALLET_HERO_H_COMPACT === 260 ? 20 : 24,
    borderRadius: radius.xl,
  },
  card: {
    borderRadius: radius.xl,
    overflow: "hidden",
    padding: 24,
    paddingBottom: 0,
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 12,
    zIndex: 2,
  },
  labelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 12,
    fontWeight: "600",
    letterSpacing: 0.2,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#fff",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 4,
  },
  addBtnText: { color: "#7C3AED", fontSize: 12, fontWeight: "700" },
  bodyRow: {
    flex: 1,
    minHeight: 108,
    position: "relative",
    zIndex: 2,
  },
  balanceBlock: {
    maxWidth: "62%",
    paddingTop: 4,
  },
  amount: {
    color: "#fff",
    fontSize: 48,
    fontWeight: "800",
    letterSpacing: -1,
    lineHeight: 52,
  },
  amountCompact: { fontSize: 40, lineHeight: 44 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  pillText: {
    color: "rgba(255,255,255,0.88)",
    fontSize: 13,
    fontWeight: "500",
  },
  walletWrap: {
    position: "absolute",
    right: 0,
    top: 0,
    width: 140,
    height: 140,
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.95,
    zIndex: 1,
  },
  walletImg: { width: 132, height: 132 },
  glassStrip: {
    flexDirection: "row",
    marginHorizontal: -24,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(0,0,0,0.2)",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.12)",
    zIndex: 2,
  },
  stripItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 4,
  },
  stripDivider: {
    width: 1,
    backgroundColor: "rgba(255,255,255,0.22)",
    marginVertical: 4,
  },
  stripIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  coinIcon: { backgroundColor: "rgba(245,158,11,0.2)" },
  stripText: { flex: 1, minWidth: 0 },
  stripTitle: { color: "#fff", fontSize: 11, fontWeight: "700" },
  stripSub: { color: "rgba(255,255,255,0.85)", fontSize: 10, marginTop: 2 },
});
