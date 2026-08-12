import React, { useState } from "react";
import { Modal, View, Text, Pressable, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { X, Coins, Wallet } from "lucide-react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTheme } from "@/hooks/useTheme";
import { sheetHandle } from "@/lib/booking-ui";
import { spacing, radius } from "@/lib/typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { useHCoinSummary, useHCoinHistory, useHCoinRedeem } from "@/hooks/use-hcoins";

const fmt = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });

export function HCoinsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { colors: c } = useTheme();
  const { data: summary } = useHCoinSummary();
  const { data: history, isLoading } = useHCoinHistory(visible);
  const redeem = useHCoinRedeem();
  const [busy, setBusy] = useState(false);

  const balance = summary?.balance ?? 0;
  const minRedeem = summary?.minRedeem ?? 100;
  const canRedeem = balance >= minRedeem;

  const doRedeem = async () => {
    if (!canRedeem || busy) return;
    setBusy(true);
    await redeem(balance);
    setBusy(false);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.cardBg }]}>
        <View style={sheetHandle} />
        <View style={styles.head}>
          <Text style={[styles.title, { color: c.text }]}>H-Coins</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <X size={22} color={c.textSecondary} />
          </Pressable>
        </View>

        <LinearGradient colors={["#FDE68A", "#F59E0B"]} style={styles.hero}>
          <Coins size={26} color="#7C2D12" />
          <Text style={styles.heroBalance}>{balance.toLocaleString("en-IN")}</Text>
          <Text style={styles.heroSub}>≈ ₹{(summary?.redeemableValue ?? 0).toLocaleString("en-IN")} · 1 coin = ₹{summary?.coinValue ?? 0.1}</Text>
        </LinearGradient>

        <PressableScale
          haptic
          disabled={!canRedeem || busy}
          onPress={() => void doRedeem()}
          style={[styles.redeemBtn, { backgroundColor: c.primary, opacity: !canRedeem || busy ? 0.5 : 1 }]}
        >
          <Wallet size={15} color="#fff" />
          <Text style={styles.redeemText}>
            {busy ? "Redeeming…" : canRedeem ? `Redeem ${balance} → ₹${summary?.redeemableValue ?? 0} wallet` : `Earn ${minRedeem - balance} more to redeem`}
          </Text>
        </PressableScale>

        <Text style={[styles.hint, { color: c.textSecondary, borderColor: c.border }]}>
          Earn coins on every completed booking, review &amp; referral. Redeem to your wallet — use on any service or membership.
        </Text>

        <Text style={[styles.section, { color: c.textSecondary }]}>ACTIVITY</Text>
        <ScrollView contentContainerStyle={{ paddingBottom: spacing["3xl"] }}>
          {isLoading ? (
            <ActivityIndicator color={c.primary} style={{ marginVertical: 16 }} />
          ) : !history || history.length === 0 ? (
            <Text style={[styles.empty, { color: c.textSecondary, borderColor: c.border }]}>No H-Coin activity yet.</Text>
          ) : (
            history.map((t) => (
              <View key={t.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowDesc, { color: c.text }]} numberOfLines={1}>{t.description}</Text>
                  <Text style={[styles.rowDate, { color: c.textSecondary }]}>{fmt(t.createdAt)}</Text>
                </View>
                <Text style={[styles.rowAmt, { color: t.type === "EARN" ? c.success : c.textSecondary }]}>
                  {t.type === "EARN" ? "+" : "−"}{t.amount}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(15,23,42,0.45)" },
  sheet: { borderTopLeftRadius: radius["2xl"], borderTopRightRadius: radius["2xl"], paddingHorizontal: 20, paddingBottom: spacing["3xl"], maxHeight: "82%" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  title: { fontSize: 18, fontWeight: "800" },
  hero: { alignItems: "center", padding: spacing.lg, borderRadius: radius.lg, gap: 2 },
  heroBalance: { fontSize: 30, fontWeight: "800", color: "#7C2D12", marginTop: 4 },
  heroSub: { fontSize: 12, color: "#7C2D12" },
  redeemBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, paddingVertical: 13, marginTop: spacing.md },
  redeemText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  hint: { fontSize: 11, lineHeight: 16, borderWidth: 1, borderRadius: 10, padding: 10, marginTop: spacing.md },
  section: { fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { fontSize: 12, textAlign: "center", borderWidth: 1, borderStyle: "dashed", borderRadius: 12, paddingVertical: 16 },
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 9 },
  rowDesc: { fontSize: 13 },
  rowDate: { fontSize: 11, marginTop: 2 },
  rowAmt: { fontSize: 15, fontWeight: "800" },
});
