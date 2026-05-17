import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  Wind,
  Sparkles,
  Wrench,
  ArrowRight,
  Copy,
  Check,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

interface Offer {
  icon: typeof Wind;
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
      await Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch {
      /* haptics unsupported on web */
    }
    setCopied(code);
    setTimeout(() => setCopied(null), 2200);
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Offers for You
        </Text>
        <TouchableOpacity style={styles.viewAll} activeOpacity={0.7}>
          <Text style={[styles.viewAllText, { color: themeColors.primary }]}>
            View All
          </Text>
          <ArrowRight size={14} color={themeColors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.list}>
        {OFFERS.map((o) => {
          const Icon = o.icon;
          const isCopied = copied === o.code;
          return (
            <View
              key={o.code}
              style={[
                styles.offerCard,
                { backgroundColor: o.from },
                shadowStyles.md,
              ]}
            >
              <View
                style={[
                  styles.offerIcon,
                  { backgroundColor: "rgba(255,255,255,0.55)" },
                ]}
              >
                <Icon size={24} color={o.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.offerDiscount, { color: o.fg }]}>
                  {o.discount}
                </Text>
                <Text style={[styles.offerDesc, { color: o.fg, opacity: 0.75 }]}>
                  {o.desc}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => copyCode(o.code)}
                activeOpacity={0.8}
                style={[
                  styles.codeChip,
                  { backgroundColor: "rgba(255,255,255,0.6)" },
                ]}
              >
                {isCopied ? (
                  <Check size={13} color={o.fg} />
                ) : (
                  <Copy size={13} color={o.fg} />
                )}
                <Text style={[styles.codeText, { color: o.fg }]}>
                  {isCopied ? "Copied!" : o.code}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginVertical: 12,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
  },
  viewAll: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewAllText: {
    fontSize: 14,
    fontWeight: "600",
  },
  list: {
    gap: 12,
  },
  offerCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    borderRadius: 20,
    padding: 16,
  },
  offerIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    justifyContent: "center",
    alignItems: "center",
  },
  offerDiscount: {
    fontSize: 17,
    fontWeight: "700",
  },
  offerDesc: {
    fontSize: 13,
    marginTop: 2,
  },
  codeChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  codeText: {
    fontSize: 12,
    fontWeight: "700",
  },
});
