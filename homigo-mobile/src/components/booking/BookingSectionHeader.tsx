import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { spacing, type } from "@/lib/typography";

type Props = {
  step?: number;
  title: string;
  subtitle?: string;
};

/** Numbered section header — guides users through the booking sequence */
export function BookingSectionHeader({ step, title, subtitle }: Props) {
  const { colors: c } = useTheme();

  return (
    <View style={styles.wrap}>
      {step != null ? (
        <View style={[styles.badge, { backgroundColor: c.primary + "18" }]}>
          <Text style={[styles.badgeText, { color: c.primary }]}>{step}</Text>
        </View>
      ) : null}
      <View style={styles.text}>
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        {subtitle ? (
          <Text style={[styles.sub, { color: c.textSecondary }]}>{subtitle}</Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    marginBottom: spacing.md,
    marginTop: spacing.sm,
  },
  badge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { ...type.chip, fontWeight: "800" },
  text: { flex: 1, gap: 2 },
  title: { ...type.section },
  sub: { ...type.small, lineHeight: 18 },
});
