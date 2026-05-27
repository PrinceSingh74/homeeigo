import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  Wallet,
  ShoppingBag,
  Tag,
  Coins,
  ChevronRight,
} from "lucide-react-native";
import Animated from "react-native-reanimated";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore } from "@/lib/store";
import { WALLET_TXNS } from "@/lib/wallet-mobile-data";
import { WALLET_SECTION_GAP } from "@/lib/wallet-layout";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { walletEnter } from "@/lib/wallet-animations";

function TxnIcon({ title, color }: { title: string; color: string }) {
  const size = 20;
  const stroke = 2;
  if (title.includes("added")) return <Wallet size={size} color={color} strokeWidth={stroke} />;
  if (title.includes("Cleaning"))
    return <ShoppingBag size={size} color={color} strokeWidth={stroke} />;
  if (title.includes("Promo")) return <Tag size={size} color={color} strokeWidth={stroke} />;
  return <Coins size={size} color={color} strokeWidth={stroke} />;
}

type Props = {
  onViewAll: () => void;
};

export function WalletRecentTransactions({ onViewAll }: Props) {
  const { colors: c, isDark } = useTheme();
  const showToast = useAppStore((s) => s.showToast);

  const copyAmount = async (amt: number) => {
    await Clipboard.setStringAsync(`₹${Math.abs(amt).toLocaleString("en-IN")}`);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    showToast("Amount copied");
  };

  return (
    <View style={[styles.section, { marginBottom: WALLET_SECTION_GAP }]}>
      <View style={styles.headRow}>
        <Text style={[styles.heading, { color: c.text }]}>Recent Transactions</Text>
        <PressableScale onPress={onViewAll} style={styles.linkRow} haptic>
          <Text style={[styles.link, { color: c.primary }]}>View All</Text>
          <ChevronRight size={12} color={c.primary} strokeWidth={2.5} />
        </PressableScale>
      </View>

      <View style={styles.list}>
        {WALLET_TXNS.map((t, i) => {
          const isCredit = t.type === "credit";
          const prefix = isCredit ? "+ " : "- ";
          const amtStr = `₹${Math.abs(t.amount).toLocaleString("en-IN")}`;

          return (
            <Animated.View key={t.id} entering={walletEnter.txn(i)}>
              <PressableScale
                onLongPress={() => copyAmount(t.amount)}
                style={[
                  styles.row,
                  {
                    backgroundColor: isDark ? c.cardBg : "#F9FAFB",
                    borderColor: c.border,
                  },
                ]}
                haptic
              >
                <View
                  style={[
                    styles.iconBox,
                    {
                      backgroundColor: isDark ? `${t.iconColor}20` : t.iconBg,
                    },
                  ]}
                >
                  <TxnIcon title={t.title} color={t.iconColor} />
                </View>
                <View style={styles.mid}>
                  <Text style={[styles.title, { color: c.text }]}>{t.title}</Text>
                  <Text style={[styles.sub, { color: c.textSecondary }]} numberOfLines={2}>
                    {t.subtitle}
                  </Text>
                </View>
                <View style={styles.right}>
                  <Text
                    style={[
                      styles.amt,
                      { color: isCredit ? c.success : c.error },
                    ]}
                  >
                    {prefix}
                    {amtStr}
                  </Text>
                  <View style={styles.statusRow}>
                    <View style={[styles.dot, { backgroundColor: c.success }]} />
                    <Text style={[styles.status, { color: c.success }]}>Success</Text>
                  </View>
                </View>
              </PressableScale>
            </Animated.View>
          );
        })}
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
  list: { gap: 10, maxHeight: 400 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    gap: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  iconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  mid: { flex: 1, minWidth: 0 },
  title: { fontSize: 13, fontWeight: "700", lineHeight: 17 },
  sub: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  right: { alignItems: "flex-end" },
  amt: {
    fontSize: 13,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    letterSpacing: -0.3,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 },
  dot: { width: 4, height: 4, borderRadius: 2 },
  status: { fontSize: 10, fontWeight: "600" },
});
