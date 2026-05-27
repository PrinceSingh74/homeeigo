import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { serviceType } from "@/theme/typography";
import { layout } from "@/theme/layout";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  title: string;
  subtitle?: string;
  overline?: string;
  viewAllLabel?: string;
  onViewAll?: () => void;
  leading?: React.ReactNode;
};

export function SectionHeader({
  title,
  subtitle,
  overline,
  viewAllLabel = "View All →",
  onViewAll,
  leading,
}: Props) {
  const { c, layout: L } = useServicesTheme();

  return (
    <View style={[styles.wrap, { paddingHorizontal: L.pad }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {overline ? (
            <Text style={[styles.overline, { color: c.primary }]}>{overline}</Text>
          ) : null}
          <View style={styles.titleRow}>
            {leading}
            <Text style={[styles.title, { color: c.textPrimary }]}>{title}</Text>
          </View>
          {subtitle ? (
            <Text style={[styles.subtitle, { color: c.textMuted }]}>{subtitle}</Text>
          ) : null}
        </View>
        {onViewAll ? (
          <PressableScale onPress={onViewAll} haptic style={styles.viewAllHit}>
            <Text style={[styles.viewAll, { color: c.primary }]}>{viewAllLabel}</Text>
          </PressableScale>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: layout.headerToContent,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
  },
  left: { flex: 1, paddingRight: 12 },
  overline: { ...serviceType.overline, marginBottom: 6 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  title: { ...serviceType.sectionTitle },
  subtitle: {
    ...serviceType.sectionSubtitle,
    marginTop: 5,
    maxWidth: "92%",
  },
  viewAllHit: {
    paddingVertical: 6,
    paddingHorizontal: 4,
    marginTop: 2,
  },
  viewAll: { ...serviceType.link },
});
