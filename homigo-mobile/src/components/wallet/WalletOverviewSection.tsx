import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Check, ChevronRight, CalendarDays, MapPin } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { WALLET_SECTION_GAP } from "@/lib/wallet-layout";
import { spacing } from "@/lib/typography";
import { shadowStyles } from "@/lib/colors";
import { PressableScale } from "@/components/ai/PressableScale";
import { walletEnter } from "@/lib/wallet-animations";
import {
  useWalletBalanceQuery,
  useBookingsQuery,
  useAddressesQuery,
} from "@/hooks/use-core-data";
import { formatINR } from "@/lib/wallet-mobile-data";

type Props = {
  onViewDetails: () => void;
};

export function WalletOverviewSection({ onViewDetails }: Props) {
  const { colors: c } = useTheme();
  const { data: walletData } = useWalletBalanceQuery();
  const { data: bookingsData } = useBookingsQuery();
  const { data: addressesData } = useAddressesQuery();

  const activeBookings = (bookingsData?.bookings ?? []).filter(
    (b) => b.status !== "completed" && !String(b.status).startsWith("cancelled"),
  ).length;
  const addressCount = addressesData?.addresses?.length ?? 0;

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
            <Text style={[styles.colLabel, { color: c.textSecondary }]}>Money in Wallet</Text>
            <Text style={[styles.colValue, { color: c.text }]}>
              ₹{formatINR(walletData?.balance ?? 0)}
            </Text>
            <View style={styles.secureRow}>
              <Check size={12} color={c.success} strokeWidth={3} />
              <Text style={[styles.footGreen, { color: c.success }]}>Secured & Safe</Text>
            </View>
          </PressableScale>
        </Animated.View>
        <View style={[styles.vDivider, { backgroundColor: c.border }]} />
        <Animated.View entering={walletEnter.overview(1)} style={styles.colWrap}>
          <PressableScale style={styles.col} haptic>
            <View style={styles.labelWithIcon}>
              <Text style={[styles.colLabel, { color: c.textSecondary }]}>Active Bookings</Text>
              <CalendarDays size={12} color={c.primary} />
            </View>
            <Text style={[styles.colValue, { color: c.text }]}>{activeBookings}</Text>
            <Text style={[styles.footMuted, { color: c.textSecondary }]}>Live service requests</Text>
          </PressableScale>
        </Animated.View>
        <View style={[styles.vDivider, { backgroundColor: c.border }]} />
        <Animated.View entering={walletEnter.overview(2)} style={styles.colWrap}>
          <PressableScale style={styles.col} haptic>
            <View style={styles.labelWithIcon}>
              <Text style={[styles.colLabel, { color: c.textSecondary }]}>Saved Addresses</Text>
              <MapPin size={12} color={c.teal} />
            </View>
            <Text style={[styles.colValue, { color: c.text }]}>{addressCount}</Text>
            <Text style={[styles.footMuted, { color: c.textSecondary }]}>Ready for booking</Text>
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
  labelWithIcon: { flexDirection: "row", alignItems: "center", gap: 4 },
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
