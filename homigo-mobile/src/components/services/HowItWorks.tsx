import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { Search, CalendarClock, UserCheck, Sparkles, Star } from "lucide-react-native";
import { SectionHeader } from "./common/SectionHeader";
import { useServicesTheme } from "./ServicesThemeContext";

/** Exact same 5 steps as the website services page (HOW_IT_WORKS_STEPS). */
const STEPS = [
  { icon: Search, title: "Choose a Service", desc: "Select from 100+ home services", grad: ["#10b981", "#0d9488"] as const },
  { icon: CalendarClock, title: "Pick Date & Time", desc: "Choose your preferred time slot", grad: ["#14b8a6", "#0f766e"] as const },
  { icon: UserCheck, title: "Verified Partner Assigned", desc: "We assign the best-matched expert", grad: ["#22c55e", "#15803d"] as const },
  { icon: Sparkles, title: "Service Delivered", desc: "Relax, we handle the rest!", grad: ["#059669", "#047857"] as const },
  { icon: Star, title: "Rate & Relax", desc: "Your feedback helps us improve", grad: ["#0d9488", "#0f766e"] as const },
];

/** How It Works — mirrors the website services page, in a premium app layout. */
export function HowItWorks() {
  const { c } = useServicesTheme();
  return (
    <View>
      <SectionHeader overline="Simple" title="How it works" subtitle="From booking to done in four easy steps" />
      <View style={styles.list}>
        {STEPS.map((s, i) => (
          <Animated.View key={s.title} entering={FadeInUp.delay(i * 90).duration(480)} style={styles.row}>
            <View style={styles.railCol}>
              <LinearGradient colors={s.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.iconWrap}>
                <s.icon size={20} color="#fff" strokeWidth={2.4} />
              </LinearGradient>
              {i < STEPS.length - 1 ? <View style={[styles.connector, { backgroundColor: c.borderLight }]} /> : null}
            </View>
            <View style={[styles.card, { backgroundColor: c.card, borderColor: c.cardBorder }]}>
              <View style={styles.cardHead}>
                <Text style={[styles.stepNo, { color: c.textMuted }]}>STEP {i + 1}</Text>
                <Text style={[styles.title, { color: c.textPrimary }]}>{s.title}</Text>
              </View>
              <Text style={[styles.desc, { color: c.textSecondary }]}>{s.desc}</Text>
            </View>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, gap: 4, marginTop: 8 },
  row: { flexDirection: "row", gap: 14 },
  railCol: { alignItems: "center", width: 44 },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#059669",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },
  connector: { width: 2, flex: 1, minHeight: 22, borderRadius: 2, marginVertical: 4 },
  card: { flex: 1, borderRadius: 20, borderWidth: 1, padding: 16, marginBottom: 12 },
  cardHead: { gap: 3 },
  stepNo: { fontSize: 10, fontWeight: "800", letterSpacing: 1 },
  title: { fontSize: 15.5, fontWeight: "800", letterSpacing: -0.3 },
  desc: { fontSize: 12.5, fontWeight: "500", lineHeight: 18, marginTop: 5 },
});
