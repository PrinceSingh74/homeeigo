import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { useRouter } from "expo-router";
import { ArrowUpRight } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

/**
 * "Explore by Category" — mirrors the Homeeigo website home CategoryShowcase
 * (Hourly / Home Care / Premium Care / Laundry / Outdoor / Express / Coming Soon).
 * Premium 2-column glass cards on the mint canvas; tap opens the Services tab.
 */
type Cat = { key: string; emoji: string; title: string; subtitle: string; accent: string; soon?: boolean };

const CATEGORIES: Cat[] = [
  { key: "hourly", emoji: "⏱️", title: "Hourly Bookings", subtitle: "Flexible help, by the hour", accent: "#0d9488" },
  { key: "home-care", emoji: "🏠", title: "Home Care", subtitle: "Daily cleaning essentials", accent: "#10b981" },
  { key: "premium-care", emoji: "✨", title: "Premium Care", subtitle: "Deep cleaning, healthier home", accent: "#059669" },
  { key: "laundry", emoji: "👕", title: "Laundry & Wardrobe", subtitle: "Fresh, clean & organized", accent: "#14b8a6" },
  { key: "outdoor", emoji: "🌳", title: "Outdoor", subtitle: "Care beyond your home", accent: "#65a30d" },
  { key: "express", emoji: "⚡", title: "Express", subtitle: "For special occasions", accent: "#f59e0b" },
  { key: "coming-soon", emoji: "🔜", title: "Coming Soon", subtitle: "New services on the way", accent: "#64748b", soon: true },
];

export const ExploreCategories: React.FC = () => {
  const router = useRouter();
  const { colors: c, isDark } = useTheme();

  const cardBg = isDark ? "rgba(255,255,255,0.05)" : "#ffffff";
  const border = isDark ? "rgba(255,255,255,0.10)" : "rgba(16,185,129,0.14)";

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.eyebrow, { color: isDark ? "#6ee7b7" : "#047857" }]}>BROWSE</Text>
          <Text style={[styles.title, { color: c.text }]}>Explore by Category</Text>
        </View>
        <Pressable onPress={() => router.push("/services")} hitSlop={8}>
          <Text style={[styles.viewAll, { color: isDark ? "#6ee7b7" : "#047857" }]}>View all →</Text>
        </Pressable>
      </View>

      <View style={styles.grid}>
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat.key}
            disabled={cat.soon}
            onPress={() => router.push("/services")}
            style={({ pressed }) => [
              styles.card,
              { backgroundColor: cardBg, borderColor: border, opacity: cat.soon ? 0.72 : pressed ? 0.9 : 1 },
              shadowStyles.sm,
            ]}
          >
            <View style={[styles.emojiChip, { backgroundColor: cat.accent + (isDark ? "26" : "18") }]}>
              <Text style={styles.emoji}>{cat.emoji}</Text>
            </View>
            <Text style={[styles.cardTitle, { color: c.text }]} numberOfLines={1}>
              {cat.title}
            </Text>
            <Text style={[styles.cardSub, { color: c.textSecondary }]} numberOfLines={2}>
              {cat.subtitle}
            </Text>
            {cat.soon ? (
              <View style={[styles.soonPill, { backgroundColor: cat.accent + "1A" }]}>
                <Text style={[styles.soonText, { color: cat.accent }]}>Soon</Text>
              </View>
            ) : (
              <View style={styles.arrowWrap}>
                <ArrowUpRight size={15} color={cat.accent} strokeWidth={2.6} />
              </View>
            )}
          </Pressable>
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { marginVertical: 20, paddingHorizontal: 24 },
  header: { flexDirection: "row", alignItems: "flex-end", marginBottom: 16 },
  eyebrow: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2, marginBottom: 2 },
  title: { fontSize: 20, fontWeight: "800", letterSpacing: -0.3 },
  viewAll: { fontSize: 13, fontWeight: "700" },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 12 },
  card: {
    width: "48.5%",
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    minHeight: 132,
    justifyContent: "flex-start",
  },
  emojiChip: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  emoji: { fontSize: 22 },
  cardTitle: { fontSize: 14.5, fontWeight: "800", letterSpacing: -0.2 },
  cardSub: { fontSize: 11.5, fontWeight: "500", lineHeight: 15, marginTop: 3 },
  arrowWrap: { position: "absolute", top: 16, right: 16 },
  soonPill: {
    position: "absolute",
    top: 16,
    right: 16,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  soonText: { fontSize: 10, fontWeight: "800", letterSpacing: 0.3 },
});
