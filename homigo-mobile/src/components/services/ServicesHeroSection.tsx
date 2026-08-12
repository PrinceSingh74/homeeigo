import React from "react";
import { View, Text, StyleSheet, Image, Dimensions } from "react-native";
import Animated, { FadeInDown, FadeInUp, type SharedValue } from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowRight, Zap, Star, ShieldCheck, Clock, BadgeCheck, Lock } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesActions } from "@/hooks/useServicesActions";

const { width, height } = Dimensions.get("window");
const HERO_H = Math.min(Math.round(height * 0.86), 780);
const WELCOME = require("../../../assets/services/welcome.webp");

// Exact same trust pills as the website services hero (HERO_TRUST_PILLS).
const PILLS = [
  { icon: ShieldCheck, label: "Background Verified" },
  { icon: Clock, label: "On-time Guarantee" },
  { icon: BadgeCheck, label: "Satisfaction Guaranteed" },
  { icon: Lock, label: "Secure Payments" },
];

type Props = { scrollY?: SharedValue<number> };

/**
 * Full-screen immersive services hero — a premium branded app design: the
 * "Namaste, welcome home" portrait fills the whole hero edge-to-edge, and ALL
 * content (eyebrow, headline "Handled with Care.", subtitle, CTAs, trust pills)
 * is written over the image on a cinematic gradient scrim. Same content as the
 * website services page.
 */
export function ServicesHeroSection(_props: Props) {
  const { book } = useServicesActions();
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.hero}>
      <Image source={WELCOME} style={styles.photo} resizeMode="cover" />

      {/* cinematic scrims — top for status legibility, strong bottom for content */}
      <LinearGradient
        colors={["rgba(4,20,13,0.55)", "rgba(4,20,13,0.05)", "transparent"]}
        locations={[0, 0.22, 0.4]}
        style={StyleSheet.absoluteFill}
      />
      <LinearGradient
        colors={["transparent", "rgba(4,20,13,0.35)", "rgba(3,16,10,0.94)"]}
        locations={[0.32, 0.6, 1]}
        style={StyleSheet.absoluteFill}
      />

      {/* ---- Top overlay: eyebrow + Instant Booking + rating (below the floating header) ---- */}
      <View style={[styles.top, { paddingTop: insets.top + 74 }]}>
        <Animated.View entering={FadeInDown.duration(460)} style={styles.eyebrow}>
          <View style={styles.eyeDot} />
          <Text style={styles.eyebrowText}>India&apos;s Most Trusted Home Services</Text>
        </Animated.View>

        <View style={styles.topRow}>
          <Animated.View entering={FadeInDown.delay(120).duration(460)} style={styles.instantBadge}>
            <Zap size={12} color="#f59e0b" fill="#f59e0b" />
            <View>
              <Text style={styles.instantTitle}>Instant Booking</Text>
              <Text style={styles.instantSub}>Hassle-free in 60 secs</Text>
            </View>
          </Animated.View>
          <Animated.View entering={FadeInDown.delay(160).duration(460)} style={styles.ratingPill}>
            <Star size={11} color="#fbbf24" fill="#fbbf24" />
            <Text style={styles.ratingText}>4.9</Text>
          </Animated.View>
        </View>
      </View>

      {/* ---- Bottom overlay: all the hero content on the image ---- */}
      <View style={styles.bottom}>
        <Animated.Text entering={FadeInUp.delay(120).duration(520)} style={styles.namaste}>
          🙏  Namaste, welcome home
        </Animated.Text>

        <Animated.Text entering={FadeInUp.delay(180).duration(560)} style={styles.h1}>
          All your home needs,{" "}
          <Text style={styles.h1Accent}>Handled with Care.</Text>
        </Animated.Text>

        <Animated.Text entering={FadeInUp.delay(240).duration(560)} style={styles.sub}>
          Professional, reliable, background-verified partners for a cleaner, happier home.
        </Animated.Text>

        {/* CTAs */}
        <Animated.View entering={FadeInUp.delay(300).duration(560)} style={styles.ctas}>
          <PressableScale haptic onPress={() => book()} style={styles.primaryBtn}>
            <Text style={styles.primaryText}>Book a Service</Text>
            <ArrowRight size={17} color="#04140d" strokeWidth={2.8} />
          </PressableScale>
          <PressableScale haptic onPress={() => book()} style={styles.ghostBtn}>
            <Text style={styles.ghostText}>Explore</Text>
          </PressableScale>
        </Animated.View>

        {/* trust pills over the scrim */}
        <Animated.View entering={FadeInUp.delay(360).duration(560)} style={styles.pills}>
          {PILLS.map((p) => (
            <View key={p.label} style={styles.pill}>
              <p.icon size={13} color="#6ee7b7" strokeWidth={2.4} />
              <Text style={styles.pillText} numberOfLines={1}>{p.label}</Text>
            </View>
          ))}
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { width, height: HERO_H, backgroundColor: "#04140d", overflow: "hidden" },
  photo: { width: "100%", height: "100%" },

  top: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 18 },
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    alignSelf: "flex-start",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
  },
  eyeDot: { width: 7, height: 7, borderRadius: 999, backgroundColor: "#34d399" },
  eyebrowText: { fontSize: 11, fontWeight: "800", color: "#fff", letterSpacing: 0.2 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 },
  instantBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  instantTitle: { fontSize: 12, fontWeight: "900", color: "#0f172a" },
  instantSub: { fontSize: 9.5, fontWeight: "600", color: "#64748b", marginTop: 1 },
  ratingPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(4,20,13,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
  },
  ratingText: { color: "#fff", fontSize: 13, fontWeight: "900" },

  bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: 22, paddingBottom: 26 },
  namaste: { color: "#a7f3d0", fontSize: 13, fontWeight: "800", letterSpacing: 0.2, marginBottom: 10 },
  h1: {
    color: "#fff",
    fontSize: width < 380 ? 30 : 34,
    fontWeight: "900",
    letterSpacing: -0.9,
    lineHeight: width < 380 ? 36 : 40,
    textShadowColor: "rgba(0,0,0,0.4)",
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 12,
  },
  h1Accent: { color: "#6ee7b7" },
  sub: {
    color: "rgba(255,255,255,0.9)",
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
    marginTop: 12,
    maxWidth: 360,
  },

  ctas: { flexDirection: "row", gap: 10, marginTop: 20 },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#fff",
    paddingVertical: 16,
    paddingHorizontal: 26,
    borderRadius: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 6,
  },
  primaryText: { color: "#04140d", fontSize: 14.5, fontWeight: "900", letterSpacing: 0.2 },
  ghostBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.55)",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  ghostText: { color: "#fff", fontSize: 14.5, fontWeight: "800" },

  pills: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 20 },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  pillText: { fontSize: 10.5, fontWeight: "700", color: "rgba(255,255,255,0.92)" },
});
