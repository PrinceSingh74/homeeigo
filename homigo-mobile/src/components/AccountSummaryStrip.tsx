import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { CalendarClock, Wallet, ChevronRight } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useBookingsQuery, useWalletBalanceQuery } from "@/hooks/use-core-data";
import { useAuthStore } from "@/stores/auth-store";
import { PressableScale } from "@/components/ai/PressableScale";

/**
 * Account Summary — mirrors the Homeeigo website home AccountSummaryStrip.
 * Two live quick-cards for signed-in users: active bookings + wallet balance.
 * Hidden for guests. Real backend data (useBookingsQuery / useWalletBalanceQuery).
 */
export const AccountSummaryStrip: React.FC = () => {
  const { colors: c, isDark } = useTheme();
  const { goBookings, goWallet } = useAppNavigation();
  const isAuthed = useAuthStore((s) => s.status === "authenticated");
  const { data: bookingsData } = useBookingsQuery();
  const { data: walletData } = useWalletBalanceQuery();

  if (!isAuthed) return null;

  const active = (bookingsData?.bookings ?? []).filter(
    (b) => b.status === "pending" || b.status === "accepted" || b.status === "in_progress",
  ).length;
  const balance = walletData?.balance ?? 0;

  const cardBg = isDark ? "rgba(255,255,255,0.05)" : "#ffffff";
  const border = isDark ? "rgba(255,255,255,0.10)" : "rgba(16,185,129,0.16)";

  return (
    <View style={styles.row}>
      <PressableScale
        haptic
        onPress={goBookings}
        style={[styles.card, { backgroundColor: cardBg, borderColor: border }, shadowStyles.md]}
      >
        <View style={[styles.iconWrap, { backgroundColor: "rgba(16,185,129,0.12)" }]}>
          <CalendarClock size={18} color="#059669" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.label, { color: c.textSecondary }]}>Active bookings</Text>
          <Text style={[styles.value, { color: c.text }]}>{active}</Text>
        </View>
        <ChevronRight size={16} color={c.textSecondary} />
      </PressableScale>

      <PressableScale
        haptic
        onPress={goWallet}
        style={[styles.card, { backgroundColor: cardBg, borderColor: border }, shadowStyles.md]}
      >
        <View style={[styles.iconWrap, { backgroundColor: "rgba(13,148,136,0.12)" }]}>
          <Wallet size={18} color="#0d9488" strokeWidth={2.2} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.label, { color: c.textSecondary }]}>Wallet balance</Text>
          <Text style={[styles.value, { color: c.text }]} numberOfLines={1}>
            ₹{balance.toLocaleString("en-IN", { maximumFractionDigits: 0 })}
          </Text>
        </View>
        <ChevronRight size={16} color={c.textSecondary} />
      </PressableScale>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 12, paddingHorizontal: 24, marginVertical: 8 },
  card: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 18,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  iconWrap: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  label: { fontSize: 10.5, fontWeight: "600" },
  value: { fontSize: 18, fontWeight: "900", letterSpacing: -0.4, marginTop: 1 },
});
