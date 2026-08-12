import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useAiTheme, aiSpacing, aiType, aiRadius, aiCardShadow } from "@/lib/ai-mobile-theme";
import { PressableScale } from "./PressableScale";

type Props = {
  title: string;
  subtitle?: string;
  onViewAll?: () => void;
  viewAllLabel?: string;
  right?: React.ReactNode;
  noInset?: boolean;
};

export function SectionTitle({
  title,
  subtitle,
  onViewAll,
  viewAllLabel = "View all",
  right,
  noInset,
}: Props) {
  const { c, isDark } = useAiTheme();

  return (
    <View style={[styles.wrap, noInset && styles.wrapNoInset]}>
      <View style={styles.left}>
        <LinearGradient
          colors={["#2dd4bf", "#10b981", "#34d399"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
          style={[styles.accentBar, aiCardShadow(c.shadowAccent, "glow")]}
        />
        <View style={styles.textCol}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: c.subtle }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {right ?? (onViewAll ? (
        <PressableScale
          onPress={onViewAll}
          hitSlop={10}
          haptic
          accessibilityRole="button"
          // Names the section it belongs to — three bare "View all" buttons on one
          // screen are indistinguishable to a screen-reader user.
          accessibilityLabel={`${viewAllLabel}: ${title}`}
        >
          <LinearGradient
            colors={
              isDark
                ? ["rgba(16, 185, 129,0.25)", "rgba(45, 212, 191,0.12)"]
                : ["rgba(16, 185, 129,0.12)", "rgba(255,255,255,0.9)"]
            }
            style={[styles.viewAllPill, { borderColor: c.cardBorderStrong }]}
          >
            <Text style={[styles.link, { color: c.accentCyan }]}>{viewAllLabel}</Text>
          </LinearGradient>
        </PressableScale>
      ) : null)}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 14,
    paddingHorizontal: aiSpacing.screen,
    gap: 12,
  },
  wrapNoInset: { paddingHorizontal: 0 },
  left: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  accentBar: {
    width: 4,
    minHeight: 32,
    borderRadius: 3,
    marginTop: 1,
  },
  textCol: { flex: 1, minWidth: 0, gap: 4 },
  title: { ...aiType.h2, fontSize: 18 },
  subtitle: { ...aiType.caption, fontWeight: "500", opacity: 0.9 },
  viewAllPill: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: aiRadius.pill,
    borderWidth: 1,
    marginTop: 2,
  },
  link: { ...aiType.smallStrong, fontSize: 12 },
});
