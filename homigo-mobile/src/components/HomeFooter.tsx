import React from "react";
import { View, Text, StyleSheet, Pressable, Image } from "react-native";
import { useRouter } from "expo-router";
import { ShieldCheck, Leaf, Clock } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";

/**
 * Premium minimal home footer — mirrors the website SiteFooter closing note.
 * Brand wordmark, trust row, and a soft emerald sign-off on the mint canvas.
 */
export const HomeFooter: React.FC = () => {
  const router = useRouter();
  const { colors: c, isDark } = useTheme();
  const hairline = isDark ? "rgba(255,255,255,0.08)" : "rgba(16,185,129,0.16)";

  return (
    <View style={[styles.container, { borderTopColor: hairline }]}>
      <Image
        source={
          isDark
            ? require("../../assets/brand/logo-full-dark.png")
            : require("../../assets/brand/logo-full.png")
        }
        style={styles.logo}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
        accessibilityLabel="Homeeigo"
      />
      <Text style={[styles.tag, { color: c.textSecondary }]}>
        Premium home services, powered by AI.
      </Text>

      <View style={styles.trustRow}>
        {[
          { icon: ShieldCheck, label: "Verified pros" },
          { icon: Leaf, label: "Eco friendly" },
          { icon: Clock, label: "On-time" },
        ].map(({ icon: Icon, label }) => (
          <View key={label} style={styles.trustItem}>
            <Icon size={15} color={isDark ? "#6ee7b7" : "#059669"} strokeWidth={2.2} />
            <Text style={[styles.trustText, { color: c.textSecondary }]}>{label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.links}>
        <Pressable onPress={() => router.push("/legal/privacy" as never)} hitSlop={6}>
          <Text style={[styles.link, { color: c.textSecondary }]}>Privacy</Text>
        </Pressable>
        <Text style={[styles.dot, { color: c.textSecondary }]}>·</Text>
        <Pressable onPress={() => router.push("/legal/terms" as never)} hitSlop={6}>
          <Text style={[styles.link, { color: c.textSecondary }]}>Terms</Text>
        </Pressable>
        <Text style={[styles.dot, { color: c.textSecondary }]}>·</Text>
        <Pressable onPress={() => router.push("/support" as never)} hitSlop={6}>
          <Text style={[styles.link, { color: c.textSecondary }]}>Support</Text>
        </Pressable>
      </View>

      <Text style={[styles.copy, { color: c.textSecondary }]}>
        © {new Date().getFullYear()} Homeeigo · Made with 💚 in India
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginTop: 8,
    paddingTop: 28,
    paddingBottom: 36,
    paddingHorizontal: 24,
    alignItems: "center",
    borderTopWidth: 1,
  },
  /** Full brand lockup — native 1.45:1 ratio, generous so it reads as the sign-off. */
  logo: { width: 168, height: 116, marginBottom: 4 },
  tag: { fontSize: 12.5, fontWeight: "500", marginTop: 6, textAlign: "center" },
  trustRow: { flexDirection: "row", gap: 18, marginTop: 18, marginBottom: 18 },
  trustItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  trustText: { fontSize: 11.5, fontWeight: "600" },
  links: { flexDirection: "row", alignItems: "center", gap: 8 },
  link: { fontSize: 12.5, fontWeight: "700" },
  dot: { fontSize: 12 },
  copy: { fontSize: 11, fontWeight: "500", marginTop: 16 },
});
