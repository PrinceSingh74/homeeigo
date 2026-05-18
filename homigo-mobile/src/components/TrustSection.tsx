import React from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import {
  ShieldCheck,
  Search,
  Lock,
  Zap,
  MapPin,
  Headphones,
  type LucideIcon,
} from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

const { width } = Dimensions.get("window");

type Trust = {
  id: number;
  icon: LucideIcon;
  title: string;
  color: string;
};

const TRUSTS: Trust[] = [
  { id: 1, icon: ShieldCheck, title: "Verified\nProfessionals", color: "#2563EB" },
  { id: 2, icon: Search, title: "Background\nChecks", color: "#7C3AED" },
  { id: 3, icon: Lock, title: "Secure\nPayments", color: "#06B6D4" },
  { id: 4, icon: Zap, title: "AI Fraud\nDetection", color: "#F59E0B" },
  { id: 5, icon: MapPin, title: "Live\nTracking", color: "#10B981" },
  { id: 6, icon: Headphones, title: "24/7\nSupport", color: "#EC4899" },
];

export const TrustSection: React.FC = () => {
  const { colors: themeColors } = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: themeColors.text }]}>
          Why Trust HOMIGO
        </Text>
      </View>

      <View style={styles.grid}>
        {TRUSTS.map((trust) => {
          const Icon = trust.icon;
          return (
            <View key={trust.id} style={styles.trustCard}>
              <LinearGradient
                colors={[trust.color + "15", trust.color + "08"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.iconBg}
              >
                <Icon size={28} color={trust.color} />
              </LinearGradient>
              <Text
                style={[styles.trustTitle, { color: themeColors.text }]}
                numberOfLines={2}
              >
                {trust.title}
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
    marginVertical: 48,
  },
  header: {
    marginBottom: 28,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.4,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "space-between",
  },
  trustCard: {
    width: (width - 48 - 16) / 2,
    alignItems: "center",
    padding: 16,
    borderRadius: 20,
    backgroundColor: "transparent",
  },
  iconBg: {
    width: 64,
    height: 64,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  trustTitle: {
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
    lineHeight: 18,
    letterSpacing: -0.2,
  },
});
