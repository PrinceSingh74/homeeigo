import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Check, ChevronRight, Coins } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import {
  WALLET_BALANCE,
  WALLET_H_COINS,
  WALLET_GIFT_VALUE,
  WALLET_GIFT_COUNT,
  formatINR,
} from "@/lib/wallet-mobile-data";
import { WALLET_SECTION_GAP } from "@/lib/wallet-layout";
import { spacing, radius } from "@/lib/typography";
import { shadowStyles } from "@/lib/colors";
import { PressableScale } from "@/components/ai/PressableScale";
import { walletEnter } from "@/lib/wallet-animations";

type Props = {
  onViewDetails: () => void;
};

export function WalletOverviewSection({ onViewDetails }: Props) {
  const { colors: c } = useTheme();

  return (
    <View style={[styles.section, { marginBottom: WALLET_SECTION_GAP }]}>
      <View style={styles.headRow}>
        <Text style={[styles.heading, { color: c.text }]}>Wallet Overview</Text>
        <PressableScale onPress={onViewDetails} style={styles.linkRow} haptic>
          <Text style={[styles.link, { color: c.primary }]}>View Details</Text>
          <ChevronRight size={12} color={c.primary} strokeWidth={2.5} />
        </PressableScale>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: c.cardBg, borderColor: c.border },
          shadowStyles.md,
        ]}
      >
        <Animated.View entering={walletEnter.overview(0)} style={styles.colWrap}>
          <PressableScale style={styles.col} haptic>
            <Text style={[styles.colLabel, { color: c.textSecondary }]}>
              Money in Wallet
            </Text>
            <Text style={[styles.colValue, { color: c.text }]}>
              ₹{formatINR(WALLET_BALANCE)}
            </Text>
            <View style={styles.secureRow}>
              <Check size={12} color={c.success} strokeWidth={3} />
              <Text style={[styles.footGreen, { color: c.success }]}>
                Secured & Safe
              </Text>
            </View>
          </PressableScale>
        </Animated.View>
        <View style={[styles.vDivider, { backgroundColor: c.border }]} />
        <Animated.View entering={walletEnter.overview(1)} style={styles.colWrap}>
          <PressableScale style={styles.col} haptic>
            <View style={styles.labelWithIcon}>
              <Text style={[styles.colLabel, { color: c.textSecondary }]}>H-Coins</Text>
              <Coins size={12} color="#D4AF37" />
            </View>
            <Text style={[styles.colValue, { color: c.text }]}>{WALLET_H_COINS}</Text>
            <Text style={[styles.footMuted, { color: c.textSecondary }]}>
              Use Coins to save more
            </Text>
          </PressableScale>
        </Animated.View>
        <View style={[styles.vDivider, { backgroundColor: c.border }]} />
        <Animated.View entering={walletEnter.overview(2)} style={styles.colWrap}>
          <PressableScale style={styles.col} haptic>
            <Text style={[styles.colLabel, { color: c.textSecondary }]}>Gift Cards</Text>
            <Text style={[styles.colValue, { color: c.text }]}>
              ₹{formatINR(WALLET_GIFT_VALUE, 0)}
            </Text>
            <Text style={[styles.footMuted, { color: c.textSecondary }]}>
              {WALLET_GIFT_COUNT} Gift Cards
            </Text>
          </PressableScale>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: 0 },
  headRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  heading: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  linkRow: { flexDirection: "row", alignItems: "center", gap: 2 },
  link: { fontSize: 12, fontWeight: "700" },
  card: {
    flexDirection: "row",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 8,
  },
  colWrap: { flex: 1 },
  col: { flex: 1, alignItems: "center", paddingHorizontal: 6 },
  colLabel: { fontSize: 11, fontWeight: "600", textAlign: "center" },
  labelWithIcon: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  colValue: {
    fontSize: 18,
    fontWeight: "800",
    marginTop: 6,
    letterSpacing: -0.3,
    textAlign: "center",
  },
  secureRow: { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 6 },
  footGreen: { fontSize: 10, fontWeight: "700" },
  footMuted: { fontSize: 10, fontWeight: "600", marginTop: 6, textAlign: "center", lineHeight: 13 },
  vDivider: { width: 1, alignSelf: "stretch", marginVertical: 6 },
});
