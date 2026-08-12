/**
 * AI Assistant — premium 3D / glass design system.
 */
import type { ViewStyle } from "react-native";
import { useResolvedIsDark } from "@/lib/theme-store";

// Emerald/teal AI palette — matched to the WEBSITE AI Assistant (the design
// language) and the Homeeigo brand. Keys are unchanged so every AI component
// inherits the sync; only the values move from violet/cyan to emerald/teal.
const DARK = {
  bg: "#03120c",
  bgMid: "#08211a",
  bgElevated: "#0a2018",
  scrim: "rgba(0,0,0,0.55)",
  card: "rgba(10, 32, 24, 0.92)",
  cardSoft: "rgba(14, 40, 30, 0.88)",
  cardSolid: "#0b241b",
  cardBorder: "rgba(255, 255, 255, 0.1)",
  cardBorderStrong: "rgba(16, 185, 129, 0.42)",
  glassEdge: "rgba(255,255,255,0.14)",
  divider: "rgba(255,255,255,0.07)",
  text: "#FFFFFF",
  muted: "#B4CCC0",
  subtle: "#7FA394",
  faint: "#4E6D5F",
  accent: "#10b981",
  accentBlue: "#0d9488",
  accentCyan: "#2dd4bf",
  accentPink: "#34d399",
  success: "#4ADE80",
  danger: "#EF4444",
  warning: "#FBBF24",
  userBubble: ["#10b981", "#0d9488", "#0f766e"] as const,
  heroBg: ["#0f3d2c", "#0a2018", "#06140e"] as const,
  pageBg: ["#03120c", "#0a2418", "#06160f", "#03120c"] as const,
  btnPrimary: ["#10b981", "#0d9488"] as const,
  voiceOrb: ["#10b981", "#0d9488"] as const,
  routeStroke: ["#2dd4bf", "#10b981"] as const,
  mapBg: "#06140e",
  aiBubble: "rgba(14, 38, 28, 0.95)",
  aiBubbleText: "#D4EFE2",
  chipBg: "rgba(12, 34, 25, 0.94)",
  chipBorder: "rgba(16, 185, 129, 0.38)",
  inputBg: "rgba(9, 30, 22, 0.96)",
  glowCyan: "rgba(45, 212, 191, 0.5)",
  glowViolet: "rgba(16, 185, 129, 0.5)",
  ambientCyan: "rgba(45, 212, 191, 0.16)",
  ambientViolet: "rgba(16, 185, 129, 0.2)",
  ambientPink: "rgba(52, 211, 153, 0.12)",
  shadowColor: "#000000",
  shadowAccent: "#10b981",
};

const LIGHT = {
  bg: "#F0FDF4",
  bgMid: "#F5FEF8",
  bgElevated: "#FFFFFF",
  scrim: "rgba(15, 23, 42, 0.2)",
  card: "#FFFFFF",
  cardSoft: "#F0FDF9",
  cardSolid: "#FFFFFF",
  cardBorder: "rgba(15, 23, 42, 0.07)",
  cardBorderStrong: "rgba(16, 185, 129, 0.28)",
  glassEdge: "rgba(255,255,255,0.9)",
  divider: "rgba(15,23,42,0.06)",
  text: "#0B1020",
  muted: "#475569",
  subtle: "#64748B",
  faint: "#94A3B8",
  accent: "#059669",
  accentBlue: "#0d9488",
  accentCyan: "#0f766e",
  accentPink: "#10b981",
  success: "#16A34A",
  danger: "#EF4444",
  warning: "#F59E0B",
  userBubble: ["#10b981", "#0d9488", "#0f766e"] as const,
  heroBg: ["#0f3d2c", "#0f5c46", "#0a2018"] as const,
  pageBg: ["#ECFDF5", "#F5FEF8", "#F0FDF4"] as const,
  btnPrimary: ["#10b981", "#0d9488"] as const,
  voiceOrb: ["#10b981", "#0d9488"] as const,
  routeStroke: ["#0f766e", "#10b981"] as const,
  mapBg: "#0A1F19",
  aiBubble: "#ECFDF5",
  aiBubbleText: "#134E3A",
  chipBg: "#FFFFFF",
  chipBorder: "rgba(16, 185, 129, 0.28)",
  inputBg: "#FFFFFF",
  glowCyan: "rgba(45, 212, 191, 0.35)",
  glowViolet: "rgba(16, 185, 129, 0.35)",
  ambientCyan: "rgba(45, 212, 191, 0.1)",
  ambientViolet: "rgba(16, 185, 129, 0.12)",
  ambientPink: "rgba(52, 211, 153, 0.08)",
  shadowColor: "#0F172A",
  shadowAccent: "#10b981",
};

export type AiPalette = typeof DARK;

// 4/8 spacing system — every value is on the mandated grid
// (4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 / 48 / 64 / 80).
export const aiSpacing = {
  screen: 16,
  screenLg: 20,
  section: 32,
  sectionSm: 24,
  card: 16,
  cardLg: 16,
  gap: 12,
  gapSm: 8,
  tight: 8,
  micro: 4,
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
      shadowColor: accent ?? "#10b981",
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
