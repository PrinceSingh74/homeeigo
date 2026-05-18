import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  Wind,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

interface Offer {
  icon: LucideIcon;
  discount: string;
  desc: string;
  code: string;
  from: string;
  to: string;
  fg: string;
}

const OFFERS: Offer[] = [
  {
    icon: Wind,
    discount: "Flat ₹100 OFF",
    desc: "On AC Service",
    code: "COOL100",
    from: "#DBEAFE",
    to: "#BAE6FD",
    fg: "#0C3B66",
  },
  {
    icon: Sparkles,
    discount: "20% OFF",
    desc: "On Deep Cleaning",
    code: "CLEAN20",
    from: "#FCE7F3",
    to: "#FBCFE8",
    fg: "#9D2463",
  },
  {
    icon: Wrench,
    discount: "Up to ₹150 OFF",
    desc: "On Plumbing",
    code: "PLUMB150",
    from: "#D1FAE5",
    to: "#A7F3D0",
    fg: "#047857",
  },
];

export const OffersSection: React.FC = () => {
  const { colors: themeColors } = useTheme();
  const [copied, setCopied] = useState<string | null>(null);

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Offers for You
        </Text>
        <Pressable style={styles.seeAll}>
          <Text style={[styles.seeAllText, { color: themeColors.primary }]}>
            See all
          </Text>
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
        {OFFERS.map((o, idx) => {
          const Icon = o.icon;
          const isCopied = copied === o.code;
          return (
            <Pressable
              key={o.code}
              onPress={() => copyCode(o.code)}
              style={[
                styles.offer,
                { marginRight: idx < OFFERS.length - 1 ? 10 : 0 },
              ]}
            >
              <LinearGradient
                colors={[o.from, o.to]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.offerInner}
              >
                <View style={styles.iconChip}>
                  <Icon size={16} color={o.fg} />
                </View>
                <Text
                  style={[styles.discount, { color: o.fg }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {o.discount}
                </Text>
                <Text
                  style={[styles.desc, { color: o.fg }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {o.desc}
                </Text>
                <View style={styles.codeRow}>
                  <Text
                    style={[styles.codeText, { color: o.fg }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {isCopied ? "Copied!" : `Use Code: ${o.code}`}
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
  offer: {
    flex: 1,
  },
  offerInner: {
    borderRadius: 14,
    padding: 12,
    minHeight: 124,
    justifyContent: "space-between",
  },
  iconChip: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.55)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  discount: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: -0.3,
  },
  desc: {
    fontSize: 10,
    fontWeight: "600",
    marginTop: 3,
    opacity: 0.85,
  },
  codeRow: {
    marginTop: 10,
    backgroundColor: "rgba(255,255,255,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
  },
  codeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 0.2,
    textAlign: "center",
  },
});
