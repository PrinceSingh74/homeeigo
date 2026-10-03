import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Wallet, ArrowUpRight, Plus } from "lucide-react-native";
import { coreApi } from "@/services/core/api";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { PressableScale } from "./PressableScale";

export function AiWalletCard({ onAddMoney, onViewBalance }: { onAddMoney?: () => void; onViewBalance?: () => void }) {
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const { c } = useAiTheme();

  useEffect(() => {
    loadBalance();
  }, []);

  const loadBalance = async () => {
    try {
      setLoading(true);
      const data = await coreApi.wallet.balance();
      setBalance(data.balance);
    } catch {
      setBalance(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <PressableScale
      onPress={onViewBalance}
      style={[styles.card, { backgroundColor: c.card, borderColor: c.cardBorder }]}
      haptic
    >
      <LinearGradient
        colors={["rgba(45, 212, 191, 0.15)", "rgba(16, 185, 129, 0.08)"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: "rgba(45, 212, 191, 0.2)" }]}>
          <Wallet size={20} color={c.accent} strokeWidth={2} />
        </View>
        <Text style={[styles.title, { color: c.text }]}>Homeeigo Wallet</Text>
      </View>

      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator size="small" color={c.accent} />
        ) : (
          <>
            <Text style={[styles.label, { color: c.muted }]}>Available balance</Text>
            <Text style={[styles.amount, { color: c.accent }]}>
              ₹{(balance ?? 0).toLocaleString("en-IN")}
            </Text>
          </>
        )}
      </View>

      {onAddMoney && (
        <PressableScale
          onPress={onAddMoney}
          style={[styles.addBtn, { backgroundColor: c.accent }]}
          haptic
        >
          <Plus size={16} color="#FFFFFF" strokeWidth={2.5} />
          <Text style={styles.addBtnText}>Add Money</Text>
        </PressableScale>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: aiRadius.lg,
    padding: aiSpacing.gap,
    gap: aiSpacing.gap,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: aiSpacing.gapSm,
  },
  icon: {
    width: 40,
    height: 40,
    borderRadius: aiRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    ...aiType.body,
    fontWeight: "600",
    fontSize: 15,
  },
  content: {
    gap: 4,
  },
  label: {
    ...aiType.caption,
    fontSize: 12,
  },
  amount: {
    ...aiType.h2,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: aiSpacing.gap,
    paddingVertical: 10,
    borderRadius: aiRadius.md,
  },
  addBtnText: {
    ...aiType.body,
    color: "#FFFFFF",
    fontWeight: "600",
    fontSize: 13,
  },
});
