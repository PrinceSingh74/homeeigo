/**
 * AI Assistant — premium 3D / glass design system.
 */
import type { ViewStyle } from "react-native";
import { useResolvedIsDark } from "@/lib/theme-store";

const DARK = {
  bg: "#030208",
  bgMid: "#0a0f24",
  bgElevated: "#0c1020",
  scrim: "rgba(0,0,0,0.55)",
  card: "rgba(12, 16, 36, 0.92)",
  cardSoft: "rgba(18, 22, 48, 0.88)",
  cardSolid: "#0E1128",
  cardBorder: "rgba(255, 255, 255, 0.1)",
  cardBorderStrong: "rgba(123, 97, 255, 0.42)",
  glassEdge: "rgba(255,255,255,0.14)",
  divider: "rgba(255,255,255,0.07)",
  text: "#FFFFFF",
  muted: "#B4C0D8",
  subtle: "#7A8AA8",
  faint: "#4E5A72",
  accent: "#7B61FF",
  accentBlue: "#4A90E2",
  accentCyan: "#00D1FF",
  accentPink: "#A855F7",
  success: "#4ADE80",
  danger: "#EF4444",
  warning: "#FBBF24",
  userBubble: ["#7B61FF", "#6366F1", "#4A90E2"] as const,
  heroBg: ["#141B42", "#0A0D22", "#060812"] as const,
  pageBg: ["#030208", "#0a0f28", "#060a18", "#030208"] as const,
  btnPrimary: ["#7B61FF", "#4A90E2"] as const,
  voiceOrb: ["#7B61FF", "#4A90E2"] as const,
  routeStroke: ["#00D1FF", "#7B61FF"] as const,
  mapBg: "#060812",
  aiBubble: "rgba(16, 20, 44, 0.95)",
  aiBubbleText: "#D4DCEF",
  chipBg: "rgba(14, 18, 36, 0.94)",
  chipBorder: "rgba(123, 97, 255, 0.38)",
  inputBg: "rgba(10, 14, 32, 0.96)",
  glowCyan: "rgba(0, 209, 255, 0.5)",
  glowViolet: "rgba(123, 97, 255, 0.5)",
  ambientCyan: "rgba(0, 209, 255, 0.16)",
  ambientViolet: "rgba(123, 97, 255, 0.2)",
  ambientPink: "rgba(168, 85, 247, 0.12)",
  shadowColor: "#000000",
  shadowAccent: "#7B61FF",
};

const LIGHT = {
  bg: "#EEF2FA",
  bgMid: "#F8FAFE",
  bgElevated: "#FFFFFF",
  scrim: "rgba(15, 23, 42, 0.2)",
  card: "#FFFFFF",
  cardSoft: "#F5F8FF",
  cardSolid: "#FFFFFF",
  cardBorder: "rgba(15, 23, 42, 0.07)",
  cardBorderStrong: "rgba(123, 97, 255, 0.28)",
  glassEdge: "rgba(255,255,255,0.9)",
  divider: "rgba(15,23,42,0.06)",
  text: "#0B1020",
  muted: "#475569",
  subtle: "#64748B",
  faint: "#94A3B8",
  accent: "#6D49FF",
  accentBlue: "#3B82F6",
  accentCyan: "#0EA5E9",
  accentPink: "#A855F7",
  success: "#16A34A",
  danger: "#EF4444",
  warning: "#F59E0B",
  userBubble: ["#7B61FF", "#6366F1", "#4A90E2"] as const,
  heroBg: ["#1a2048", "#0f1330", "#0a0d22"] as const,
  pageBg: ["#E8EDF8", "#F4F7FD", "#EEF2FA"] as const,
  btnPrimary: ["#7B61FF", "#4A90E2"] as const,
  voiceOrb: ["#7B61FF", "#4A90E2"] as const,
  routeStroke: ["#0EA5E9", "#7B61FF"] as const,
  mapBg: "#0A0F1F",
  aiBubble: "#F1F5F9",
  aiBubbleText: "#1E293B",
  chipBg: "#FFFFFF",
  chipBorder: "rgba(123, 97, 255, 0.28)",
  inputBg: "#FFFFFF",
  glowCyan: "rgba(0, 209, 255, 0.35)",
  glowViolet: "rgba(123, 97, 255, 0.35)",
  ambientCyan: "rgba(0, 209, 255, 0.1)",
  ambientViolet: "rgba(123, 97, 255, 0.12)",
  ambientPink: "rgba(168, 85, 247, 0.08)",
  shadowColor: "#0F172A",
  shadowAccent: "#7B61FF",
};

export type AiPalette = typeof DARK;

export const aiSpacing = {
  screen: 16,
  screenLg: 20,
  section: 28,
  sectionSm: 22,
  card: 16,
  cardLg: 18,
  gap: 12,
  gapSm: 10,
  tight: 8,
  micro: 6,
};

export const aiType = {
  display: { fontSize: 28, lineHeight: 34, letterSpacing: -0.85, fontWeight: "800" as const },
  h1: { fontSize: 22, lineHeight: 28, letterSpacing: -0.55, fontWeight: "800" as const },
  h2: { fontSize: 17, lineHeight: 23, letterSpacing: -0.45, fontWeight: "800" as const },
  h3: { fontSize: 15, lineHeight: 21, letterSpacing: -0.3, fontWeight: "700" as const },
  body: { fontSize: 14, lineHeight: 20, letterSpacing: -0.12, fontWeight: "500" as const },
  bodyStrong: { fontSize: 14, lineHeight: 20, letterSpacing: -0.12, fontWeight: "700" as const },
  small: { fontSize: 12, lineHeight: 17, letterSpacing: -0.05, fontWeight: "500" as const },
  smallStrong: { fontSize: 12, lineHeight: 17, letterSpacing: -0.05, fontWeight: "700" as const },
  caption: { fontSize: 11, lineHeight: 15, letterSpacing: 0.05, fontWeight: "600" as const },
  micro: { fontSize: 10, lineHeight: 13, letterSpacing: 0.35, fontWeight: "700" as const },
  microBold: { fontSize: 9, lineHeight: 12, letterSpacing: 0.5, fontWeight: "800" as const },
};

export const aiRadius = {
  sm: 10,
  md: 14,
  lg: 18,
  xl: 22,
  xxl: 28,
  pill: 999,
};

export type AiShadowTier = "soft" | "medium" | "lift" | "hero" | "glow";

/** Layered depth shadows — premium 3D lift */
export function aiCardShadow(
  shadowColor: string,
  level: AiShadowTier = "medium",
  accent?: string,
): ViewStyle {
  const tiers: Record<AiShadowTier, ViewStyle> = {
    soft: {
      shadowColor,
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.18,
      shadowRadius: 10,
      elevation: 4,
    },
    medium: {
      shadowColor,
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.28,
      shadowRadius: 22,
      elevation: 10,
    },
    lift: {
      shadowColor,
      shadowOffset: { width: 0, height: 16 },
      shadowOpacity: 0.38,
      shadowRadius: 32,
      elevation: 16,
    },
    hero: {
      shadowColor,
      shadowOffset: { width: 0, height: 22 },
      shadowOpacity: 0.5,
      shadowRadius: 40,
      elevation: 22,
    },
    glow: {
      shadowColor: accent ?? "#7B61FF",
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.55,
      shadowRadius: 28,
      elevation: 18,
    },
  };
  return tiers[level];
}

export function useAiTheme() {
  const isDark = useResolvedIsDark();
  return { isDark, c: isDark ? DARK : LIGHT } as { isDark: boolean; c: AiPalette };
}

export const aiColors = DARK;
