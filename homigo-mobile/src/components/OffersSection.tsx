import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  Wind,
  Sparkles,
  Wrench,
  ArrowRight,
  Copy,
  Check,
  Percent,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

const { width } = Dimensions.get("window");
const CARD_W = width * 0.62;

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
    setTimeout(() => setCopied(null), 2200);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <View style={styles.pctChip}>
            <Percent size={13} color="#7C3AED" />
          </View>
          <Text style={[styles.title, { color: themeColors.text }]}>
            Offers for You
          </Text>
        </View>
        <Pressable style={styles.viewAll}>
          <Text style={[styles.viewAllText, { color: themeColors.primary }]}>
            View All
          </Text>
          <ArrowRight size={13} color={themeColors.primary} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        decelerationRate="fast"
        snapToInterval={CARD_W + 12}
        contentContainerStyle={styles.list}
      >
        {OFFERS.map((o) => {
          const Icon = o.icon;
          const isCopied = copied === o.code;
          return (
            <LinearGradient
              key={o.code}
              colors={[o.from, o.to]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={[styles.card, shadowStyles.md]}
            >
              <View style={styles.cardTop}>
                <View style={styles.iconChip}>
                  <Icon size={22} color={o.fg} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.discount, { color: o.fg }]}>
                    {o.discount}
                  </Text>
                  <Text style={[styles.desc, { color: o.fg }]}>
                    {o.desc}
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => copyCode(o.code)}
                style={styles.codeChip}
              >
                {isCopied ? (
                  <Check size={12} color={o.fg} />
                ) : (
                  <Copy size={12} color={o.fg} />
                )}
                <Text style={[styles.codeText, { color: o.fg }]}>
                  {isCopied ? "Copied!" : `Use Code: ${o.code}`}
                </Text>
              </Pressable>
            </LinearGradient>
          );
        })}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 12 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 14,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pctChip: {
    width: 26,
    height: 26,
    borderRadius: 9,
    backgroundColor: "rgba(124,58,237,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  viewAll: { flexDirection: "row", alignItems: "center", gap: 4 },
  viewAllText: { fontSize: 13, fontWeight: "700" },
  list: { paddingHorizontal: 16, gap: 12 },
  card: {
    width: CARD_W,
    borderRadius: 18,
    padding: 14,
    justifyContent: "space-between",
    gap: 14,
    minHeight: 118,
  },
  cardTop: { flexDirection: "row", alignItems: "center", gap: 12 },
  iconChip: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.6)",
    alignItems: "center",
    justifyContent: "center",
  },
  discount: { fontSize: 16, fontWeight: "800", letterSpacing: -0.3 },
  desc: { fontSize: 11.5, fontWeight: "600", marginTop: 2, opacity: 0.8 },
  codeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.55)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },
  codeText: { fontSize: 11, fontWeight: "800", letterSpacing: 0.3 },
});
