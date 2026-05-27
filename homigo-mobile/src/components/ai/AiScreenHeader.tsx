import React from "react";
import { View, Text, Image, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BlurView } from "expo-blur";
import { Bell, Sparkles } from "lucide-react-native";
import { AI_TAGLINE } from "@/lib/ai-mobile-data";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { AiThemeToggle } from "./AiThemeToggle";
import { PressableScale } from "./PressableScale";
import { useAppNavigation } from "@/hooks/useAppNavigation";

const AVATAR =
  "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=120&h=120&fit=crop&q=80";

/** Header always high-contrast on its own surface (not hero card) */
const HEADER = {
  dark: { title: "#FFFFFF", ai: "#5EE9FF", tagline: "#B8C5E0" },
  light: { title: "#0B1020", ai: "#6D49FF", tagline: "#475569" },
};

export function AiScreenHeader() {
  const { openNotifications, goProfile } = useAppNavigation();
  const { c, isDark } = useAiTheme();
  const ink = isDark ? HEADER.dark : HEADER.light;
  const headerBg = isDark ? "rgba(6, 8, 22, 0.96)" : "rgba(255, 255, 255, 0.98)";

  return (
    <View style={[styles.wrap, { backgroundColor: headerBg, borderBottomColor: isDark ? "rgba(123,97,255,0.25)" : "rgba(15,23,42,0.08)" }]}>
      {Platform.OS === "ios" ? (
        <BlurView intensity={isDark ? 40 : 72} tint={isDark ? "dark" : "light"} style={StyleSheet.absoluteFill} />
      ) : null}
      <LinearGradient
        colors={
          isDark
            ? ["rgba(255,255,255,0.08)", "transparent"]
            : ["rgba(255,255,255,0.9)", "transparent"]
        }
        style={styles.headerShine}
        pointerEvents="none"
      />

      <View style={styles.brand}>
        <LinearGradient
          colors={["#00D1FF", "#7B61FF", "#A855F7"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.logoMark, aiCardShadow(c.shadowAccent, "glow")]}
        >
          <Sparkles size={16} color="#FFFFFF" strokeWidth={2.6} />
        </LinearGradient>
        <View style={{ minWidth: 0, flexShrink: 1 }}>
          <Text style={[styles.logo, { color: ink.title }]} numberOfLines={1}>
            HOMIGO <Text style={{ color: ink.ai }}>AI</Text>
          </Text>
          <Text style={[styles.tagline, { color: ink.tagline }]} numberOfLines={1}>
            {AI_TAGLINE}
          </Text>
        </View>
      </View>

      <View style={styles.right}>
        <AiThemeToggle />
        <PressableScale
          onPress={openNotifications}
          style={[
            styles.iconBtn,
            { backgroundColor: c.card, borderColor: c.cardBorderStrong },
            aiCardShadow(c.shadowColor, "medium"),
          ]}
          hitSlop={8}
          haptic
        >
          <Bell size={19} color={c.muted} strokeWidth={2.2} />
          <LinearGradient colors={["#EF4444", "#DC2626"]} style={styles.badge}>
            <Text style={styles.badgeText}>3</Text>
          </LinearGradient>
        </PressableScale>

        <PressableScale
          onPress={goProfile}
          style={[styles.avatarWrap, aiCardShadow(c.shadowAccent, "glow")]}
          hitSlop={6}
          haptic
        >
          <LinearGradient colors={["#00D1FF", "#7B61FF"]} style={styles.avatarRing}>
            <Image source={{ uri: AVATAR }} style={styles.avatar} />
          </LinearGradient>
        </PressableScale>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: aiSpacing.screen,
    paddingTop: 8,
    paddingBottom: 14,
    gap: 12,
    marginBottom: 6,
    overflow: "hidden",
    borderBottomWidth: StyleSheet.hairlineWidth,
    zIndex: 20,
  },
  headerShine: {
    ...StyleSheet.absoluteFillObject,
    height: "70%",
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1, minWidth: 0 },
  logoMark: {
    width: 40,
    height: 40,
    borderRadius: aiRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  logo: { ...aiType.h2, fontSize: 18, fontWeight: "800", letterSpacing: -0.6 },
  tagline: { ...aiType.caption, fontSize: 11, marginTop: 3, fontWeight: "500" },
  right: { flexDirection: "row", alignItems: "center", gap: 10 },
  iconBtn: {
    width: 42,
    height: 42,
    borderRadius: aiRadius.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    position: "absolute",
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  badgeText: { ...aiType.micro, fontSize: 9, color: "#FFFFFF" },
  avatarWrap: { borderRadius: 22 },
  avatarRing: {
    width: 42,
    height: 42,
    borderRadius: 21,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatar: { width: 36, height: 36, borderRadius: 18 },
});
