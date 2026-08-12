import type { ViewStyle } from "react-native";

export type ServicesPalette = {
  primary: string;
  primary2: string;
  lightPurple: string;
  accentPurple: string;
  background: string;
  surface: string;
  card: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  gold: string;
  success: string;
  borderLight: string;
  chipBg: string;
  locationBg: string;
  error: string;
  darkBg: string;
  darkBgEnd: string;
  expressMid: string;
  heroSheen: string;
  badgeBg: string;
  badgeBorder: string;
  trustGlassBorder: string;
  chipBorder: string;
  cardBorder: string;
  headerBg: string;
  headerBorder: string;
  glassTint: "light" | "dark";
  ambientMesh: readonly [string, string, string, string];
  orbA: readonly [string, string];
  orbB: readonly [string, string];
  orbC: readonly [string, string];
  premiumCardFill: string;
  premiumCardRim: string;
  hdBadgeBg: string;
  subtitleOnDark: string;
};

export const SERVICES_LIGHT: ServicesPalette = {
  primary: "#059669",
  primary2: "#0d9488",
  lightPurple: "#D1FAE5",
  accentPurple: "#10b981",
  background: "#F0FDF4",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  textPrimary: "#0F0A1E",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  gold: "#FBBF24",
  success: "#10B981",
  borderLight: "#D1FAE5",
  chipBg: "#ECFDF5",
  locationBg: "#ECFDF5",
  error: "#EF4444",
  darkBg: "#04140d",
  darkBgEnd: "#065f46",
  expressMid: "#0f3d2c",
  heroSheen: "rgba(209, 250, 229, 0.9)",
  badgeBg: "rgba(255,255,255,0.82)",
  badgeBorder: "rgba(16, 185, 129, 0.14)",
  trustGlassBorder: "rgba(16, 185, 129, 0.08)",
  chipBorder: "rgba(16, 185, 129, 0.12)",
  cardBorder: "rgba(16, 185, 129, 0.08)",
  headerBg: "rgba(255,255,255,0.72)",
  headerBorder: "rgba(16, 185, 129, 0.12)",
  glassTint: "light",
  ambientMesh: ["#ECFDF5", "#F0FDF4", "#FFFFFF", "#F0FDFA"] as const,
  orbA: ["rgba(16, 185, 129, 0.2)", "rgba(20, 184, 166, 0.04)"] as const,
  orbB: ["rgba(13, 148, 136, 0.14)", "rgba(209, 250, 229, 0)"] as const,
  orbC: ["rgba(45, 212, 191, 0.12)", "rgba(240, 253, 244, 0)"] as const,
  premiumCardFill: "#FFFFFF",
  premiumCardRim: "rgba(16, 185, 129, 0.08)",
  hdBadgeBg: "rgba(0,0,0,0.55)",
  subtitleOnDark: "rgba(255,255,255,0.62)",
};

export const SERVICES_DARK: ServicesPalette = {
  primary: "#10b981",
  primary2: "#2dd4bf",
  lightPurple: "rgba(52, 211, 153, 0.22)",
  accentPurple: "#2dd4bf",
  background: "#04100b",
  surface: "#0b1f17",
  card: "#0f2a20",
  textPrimary: "#F4F2FF",
  textSecondary: "#B8B2CC",
  textMuted: "#8B849E",
  gold: "#FBBF24",
  success: "#34D399",
  error: "#F87171",
  borderLight: "rgba(52, 211, 153, 0.18)",
  chipBg: "rgba(16, 185, 129, 0.2)",
  locationBg: "rgba(16, 185, 129, 0.16)",
  darkBg: "#04140d",
  darkBgEnd: "#065f46",
  expressMid: "#0f3d2c",
  heroSheen: "rgba(16, 185, 129, 0.15)",
  badgeBg: "rgba(11, 31, 23, 0.88)",
  badgeBorder: "rgba(52, 211, 153, 0.35)",
  trustGlassBorder: "rgba(52, 211, 153, 0.12)",
  chipBorder: "rgba(52, 211, 153, 0.25)",
  cardBorder: "rgba(52, 211, 153, 0.12)",
  headerBg: "rgba(12, 10, 20, 0.92)",
  headerBorder: "rgba(16, 185, 129, 0.2)",
  glassTint: "dark",
  ambientMesh: ["#0F0A1E", "#120E22", "#04100b", "#1A1035"] as const,
  orbA: ["rgba(16, 185, 129, 0.32)", "rgba(20, 184, 166, 0.05)"] as const,
  orbB: ["rgba(13, 148, 136, 0.24)", "rgba(4, 16, 11, 0)"] as const,
  orbC: ["rgba(45, 212, 191, 0.2)", "rgba(4, 16, 11, 0)"] as const,
  premiumCardFill: "#1E1830",
  premiumCardRim: "rgba(52, 211, 153, 0.15)",
  hdBadgeBg: "rgba(0,0,0,0.65)",
  subtitleOnDark: "rgba(255,255,255,0.55)",
};

export function getServicesShadows(isDark: boolean) {
  const glow = isDark ? "#10b981" : "#059669";
  const deep = isDark ? "#000" : "#04140d";
  return {
    soft: {
      shadowColor: glow,
      shadowOffset: { width: 0, height: 8 },
      shadowOpacity: isDark ? 0.28 : 0.14,
      shadowRadius: 20,
      elevation: 10,
    } satisfies ViewStyle,
    medium: {
      shadowColor: glow,
      shadowOffset: { width: 0, height: 14 },
      shadowOpacity: isDark ? 0.35 : 0.22,
      shadowRadius: 28,
      elevation: 14,
    } satisfies ViewStyle,
    deep: {
      shadowColor: deep,
      shadowOffset: { width: 0, height: 20 },
      shadowOpacity: isDark ? 0.5 : 0.28,
      shadowRadius: 36,
      elevation: 18,
    } satisfies ViewStyle,
    float: {
      shadowColor: glow,
      shadowOffset: { width: 0, height: 24 },
      shadowOpacity: isDark ? 0.45 : 0.35,
      shadowRadius: 40,
      elevation: 20,
    } satisfies ViewStyle,
    glass: {
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 6 },
      shadowOpacity: isDark ? 0.35 : 0.08,
      shadowRadius: 16,
      elevation: 8,
    } satisfies ViewStyle,
  };
}
