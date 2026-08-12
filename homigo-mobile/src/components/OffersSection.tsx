import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Gift, Sparkles, type LucideIcon } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";
import { openBook } from "@/lib/navigation";
import { useAppStore } from "@/lib/store";
import { useWalletOffersQuery } from "@/hooks/use-core-data";

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) + amt;
  let g = ((n >> 8) & 0x00ff) + amt;
  let b = (n & 0x0000ff) + amt;
  r = Math.max(0, Math.min(255, r));
  g = Math.max(0, Math.min(255, g));
  b = Math.max(0, Math.min(255, b));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

const PALETTE = [
  { from: "#D1FAE5", to: "#A7F3D0", fg: "#047857", icon: Gift },
  { from: "#CCFBF1", to: "#99F6E4", fg: "#0F766E", icon: Sparkles },
  { from: "#DCFCE7", to: "#BBF7D0", fg: "#15803D", icon: Gift },
] as const;

export const OffersSection: React.FC = () => {
  const router = useRouter();
  const { colors: themeColors } = useTheme();
  const setActivePromo = useAppStore((s) => s.setActivePromo);
  const [copied, setCopied] = useState<string | null>(null);
  const { data, isLoading } = useWalletOffersQuery();
  const offers = data?.offers ?? [];

  async function copyCode(code: string) {
    await Clipboard.setStringAsync(code);
    try {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      /* web */
    }
    setCopied(code);
    setTimeout(() => setCopied(null), 2000);
  }

  if (isLoading) {
    return (
      <View style={[styles.container, { alignItems: "center" }]}>
        <ActivityIndicator color="#059669" />
      </View>
    );
  }

  if (!offers.length) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>Offers for You</Text>
        <Pressable style={styles.seeAll} onPress={() => openBook(router)}>
          <Text style={[styles.seeAllText, { color: "#059669" }]}>See all</Text>
        </Pressable>
      </View>

      <View
        style={[
          styles.card,
          {
            backgroundColor: themeColors.cardBg,
            borderColor: themeColors.border,
          },
          shadowStyles.md,
        ]}
      >
        {offers.slice(0, 3).map((o, idx) => {
          const palette = PALETTE[idx % PALETTE.length]!;
          const Icon = palette.icon as LucideIcon;
          const code = String(o.id ?? `OFFER${idx + 1}`).toUpperCase();
          const discount =
            typeof o.discount === "number"
              ? `${o.discount}% OFF`
              : typeof o.amount === "number"
                ? `₹${o.amount} bonus`
                : "Special offer";
          const isCopied = copied === code;
          return (
            <Pressable
              key={code}
              onPress={() => {
                setActivePromo(code);
                openBook(router, { service: "cleaning", promo: code });
              }}
              onLongPress={() => copyCode(code)}
              style={[styles.offer, { marginRight: idx < Math.min(offers.length, 3) - 1 ? 10 : 0 }]}
            >
              <LinearGradient
                colors={[palette.from, palette.to]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.offerInner}
              >
                <View style={[styles.iconShadow, { shadowColor: palette.fg }]}>
                  <LinearGradient
                    colors={[shade(palette.fg, 70), palette.fg, shade(palette.fg, -25)]}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 0.9, y: 1 }}
                    style={styles.iconChip}
                  >
                    <Icon size={16} color="#fff" strokeWidth={2.4} />
                  </LinearGradient>
                </View>
                <Text style={[styles.discount, { color: palette.fg }]} numberOfLines={1}>
                  {discount}
                </Text>
                <Text style={[styles.desc, { color: palette.fg }]} numberOfLines={2}>
                  {String(o.title ?? o.description ?? "Wallet offer")}
                </Text>
                <View style={styles.codeRow}>
                  <Text style={[styles.codeText, { color: palette.fg }]} numberOfLines={1}>
                    {isCopied ? "Copied!" : code}
                  </Text>
                </View>
              </LinearGradient>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 20 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  seeAll: { flexDirection: "row", alignItems: "center", gap: 5 },
  seeAllText: { fontSize: 12, fontWeight: "700" },
  card: {
    flexDirection: "row",
    marginHorizontal: 24,
    borderRadius: 20,
    borderWidth: 1,
    padding: 12,
  },
  offer: { flex: 1 },
  offerInner: {
    borderRadius: 14,
    padding: 12,
    minHeight: 124,
    justifyContent: "space-between",
  },
  iconShadow: {
    marginBottom: 10,
    borderRadius: 11,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
  },
  iconChip: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  discount: { fontSize: 13, fontWeight: "800", letterSpacing: -0.3 },
  desc: { fontSize: 10, fontWeight: "600", marginTop: 3, opacity: 0.85 },
  codeRow: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  codeText: { fontSize: 9, fontWeight: "800", letterSpacing: 0.2, textAlign: "center" },
});
