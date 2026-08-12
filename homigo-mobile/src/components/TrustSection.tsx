import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  ShieldCheck,
  UserCheck,
  Lock,
  Cpu,
  MapPin,
  Headphones,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

type Trust = {
  id: number;
  icon: LucideIcon;
  l1: string;
  l2: string;
};

const TRUSTS: Trust[] = [
  { id: 1, icon: ShieldCheck, l1: "Verified", l2: "Professionals" },
  { id: 2, icon: UserCheck, l1: "Background", l2: "Checks" },
  { id: 3, icon: Lock, l1: "Secure", l2: "Payments" },
  { id: 4, icon: Cpu, l1: "AI Fraud", l2: "Detection" },
  { id: 5, icon: MapPin, l1: "Live", l2: "Tracking" },
  { id: 6, icon: Headphones, l1: "Support", l2: "24/7" },
];

export const TrustSection: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: themeColors.text }]}>
        Trust & Safety
      </Text>

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
        {TRUSTS.map((t) => {
          const Icon = t.icon;
          return (
            <View key={t.id} style={styles.item}>
              <View style={styles.iconWrap}>
                <Icon size={22} color="#059669" strokeWidth={2} />
              </View>
              <Text
                style={[styles.label, { color: themeColors.textSecondary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {t.l1}
              </Text>
              <Text
                style={[styles.label, { color: themeColors.textSecondary }]}
                numberOfLines={1}
                adjustsFontSizeToFit
              >
                {t.l2}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginVertical: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: "800",
    letterSpacing: -0.4,
    marginBottom: 16,
  },
  card: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderRadius: 20,
    borderWidth: 1,
    paddingVertical: 20,
    paddingHorizontal: 10,
  },
  item: {
    flex: 1,
    alignItems: "center",
    paddingHorizontal: 2,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: "rgba(37,99,235,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  label: {
    fontSize: 9.5,
    fontWeight: "600",
    textAlign: "center",
    lineHeight: 13,
  },
});
