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
  primary: "#6C3AE8",
  primary2: "#7C3AED",
  lightPurple: "#EDE9FE",
  accentPurple: "#8B5CF6",
  background: "#F8F7FF",
  surface: "#FFFFFF",
  card: "#FFFFFF",
  textPrimary: "#0F0A1E",
  textSecondary: "#6B7280",
  textMuted: "#9CA3AF",
  gold: "#FBBF24",
  success: "#10B981",
  borderLight: "#EDE9FE",
  chipBg: "#F3F0FF",
  locationBg: "#F3F0FF",
  error: "#EF4444",
  darkBg: "#1A0B3B",
  darkBgEnd: "#2D1060",
  expressMid: "#241047",
  heroSheen: "rgba(237, 232, 255, 0.9)",
  badgeBg: "rgba(255,255,255,0.82)",
  badgeBorder: "rgba(108, 58, 232, 0.12)",
  trustGlassBorder: "rgba(108, 58, 232, 0.06)",
  chipBorder: "rgba(108, 58, 232, 0.1)",
  cardBorder: "rgba(108, 58, 232, 0.05)",
  headerBg: "rgba(255,255,255,0.72)",
  headerBorder: "rgba(108, 58, 232, 0.1)",
  glassTint: "light",
  ambientMesh: ["#F0EAFF", "#F8F7FF", "#FFFFFF", "#F3EEFF"] as const,
  orbA: ["rgba(108, 58, 232, 0.2)", "rgba(139, 92, 246, 0.04)"] as const,
  orbB: ["rgba(124, 58, 237, 0.14)", "rgba(237, 233, 254, 0)"] as const,
  orbC: ["rgba(167, 139, 250, 0.12)", "rgba(248, 247, 255, 0)"] as const,
  premiumCardFill: "#FFFFFF",
  premiumCardRim: "rgba(108, 58, 232, 0.06)",
  hdBadgeBg: "rgba(0,0,0,0.55)",
  subtitleOnDark: "rgba(255,255,255,0.62)",
};

export const SERVICES_DARK: ServicesPalette = {
  primary: "#8B5CF6",
  primary2: "#A78BFA",
  lightPurple: "rgba(139, 92, 246, 0.22)",
  accentPurple: "#A78BFA",
  background: "#07050F",
  surface: "#12101C",
  card: "#1A1628",
  textPrimary: "#F4F2FF",
  textSecondary: "#B8B2CC",
  textMuted: "#8B849E",
  gold: "#FBBF24",
  success: "#34D399",
  error: "#F87171",
  borderLight: "rgba(139, 92, 246, 0.18)",
  chipBg: "rgba(108, 58, 232, 0.2)",
  locationBg: "rgba(108, 58, 232, 0.16)",
  darkBg: "#0F0820",
  darkBgEnd: "#1E1040",
  expressMid: "#160A30",
  heroSheen: "rgba(108, 58, 232, 0.15)",
  badgeBg: "rgba(26, 22, 40, 0.88)",
  badgeBorder: "rgba(139, 92, 246, 0.35)",
  trustGlassBorder: "rgba(139, 92, 246, 0.12)",
  chipBorder: "rgba(139, 92, 246, 0.25)",
  cardBorder: "rgba(139, 92, 246, 0.12)",
  headerBg: "rgba(12, 10, 20, 0.92)",
  headerBorder: "rgba(139, 92, 246, 0.2)",
  glassTint: "dark",
  ambientMesh: ["#0F0A1E", "#120E22", "#07050F", "#1A1035"] as const,
  orbA: ["rgba(108, 58, 232, 0.35)", "rgba(139, 92, 246, 0.05)"] as const,
  orbB: ["rgba(124, 58, 237, 0.28)", "rgba(7, 5, 15, 0)"] as const,
  orbC: ["rgba(167, 139, 250, 0.2)", "rgba(7, 5, 15, 0)"] as const,
  premiumCardFill: "#1E1830",
  premiumCardRim: "rgba(167, 139, 250, 0.15)",
  hdBadgeBg: "rgba(0,0,0,0.65)",
  subtitleOnDark: "rgba(255,255,255,0.55)",
};

export function getServicesShadows(isDark: boolean) {
  const glow = isDark ? "#8B5CF6" : "#6C3AE8";
  const deep = isDark ? "#000" : "#1A0B3B";
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
