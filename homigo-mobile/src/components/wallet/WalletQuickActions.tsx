import React from "react";
import { View, Text, StyleSheet, ScrollView, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { WALLET_QUICK_ACTIONS } from "@/lib/wallet-mobile-data";
import { walletTileWidth, walletQuickSnap, WALLET_SECTION_GAP } from "@/lib/wallet-layout";
import { spacing, type } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { shadowStyles } from "@/lib/colors";
import { walletEnter } from "@/lib/wallet-animations";
import { WalletAddMoneyIcon } from "@/components/wallet/WalletAddMoneyIcon";
import { WalletUpiIcon } from "@/components/wallet/WalletUpiIcon";

type Props = {
  onAction: (id: string, label: string) => void;
};

export function WalletQuickActions({ onAction }: Props) {
  const { colors: c, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const tileW = walletTileWidth(width);
  const snap = walletQuickSnap(width);

  return (
    <View style={[styles.section, { marginBottom: WALLET_SECTION_GAP }]}>
      <Text style={[styles.heading, { color: c.text }]}>Quick Actions</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={snap}
        snapToAlignment="start"
        contentContainerStyle={styles.scroll}
      >
        {WALLET_QUICK_ACTIONS.map((action, i) => {
          const Icon = action.icon;
          const isUpi = action.id === "upi";
          const isAdd = action.id === "add";

          return (
            <Animated.View key={action.id} entering={walletEnter.quick(i)}>
              <PressableScale
                onPress={() => onAction(action.id, action.label)}
                style={[styles.tile, { width: tileW }, shadowStyles.sm]}
                haptic
              >
                <LinearGradient
                  colors={
                    isDark
                      ? [c.cardBg, c.cardBg]
                      : ["#F9FAFB", "#F3F4F6"]
                  }
                  style={StyleSheet.absoluteFill}
                />
                <View
                  style={[
                    StyleSheet.absoluteFill,
                    styles.tileBorder,
                    { borderColor: c.border },
                  ]}
                />
                {action.badge ? (
                  <View style={styles.newBadge}>
                    <Text style={styles.newBadgeText}>{action.badge}</Text>
                  </View>
                ) : null}
                <View style={[styles.iconWrap, { backgroundColor: action.bg }]}>
                  {isAdd ? (
                    <WalletAddMoneyIcon size={22} color="#7C3AED" />
                  ) : isUpi ? (
                    <WalletUpiIcon />
                  ) : (
                    <Icon size={22} color={action.color} strokeWidth={2} />
                  )}
                </View>
                <Text style={[styles.label, { color: c.text }]} numberOfLines={2}>
                  {action.label}
                </Text>
              </PressableScale>
            </Animated.View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {},
  heading: {
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: -0.3,
    marginBottom: spacing.sm,
  },
  scroll: { gap: 12, paddingRight: 4 },
  tile: {
    minHeight: 100,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    overflow: "hidden",
  },
  tileBorder: {
    borderRadius: 14,
    borderWidth: 1,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 11,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 13,
  },
  newBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#7C3AED",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 3,
  },
  newBadgeText: { color: "#fff", fontSize: 8, fontWeight: "800" },
});
