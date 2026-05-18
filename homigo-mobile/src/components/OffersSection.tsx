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
                <View style={[styles.iconShadow, { shadowColor: o.fg }]}>
                  <LinearGradient
                    colors={[shade(o.fg, 70), o.fg, shade(o.fg, -25)]}
                    start={{ x: 0.1, y: 0 }}
                    end={{ x: 0.9, y: 1 }}
                    style={styles.iconChip}
                  >
                    <LinearGradient
                      colors={["rgba(255,255,255,0.5)", "rgba(255,255,255,0)"]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 0, y: 0.7 }}
                      style={styles.gloss}
                    />
                    <Icon size={16} color="#fff" strokeWidth={2.4} />
                  </LinearGradient>
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
    overflow: "hidden",
  },
  gloss: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "60%",
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
