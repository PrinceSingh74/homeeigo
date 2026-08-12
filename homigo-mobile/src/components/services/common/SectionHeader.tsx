import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight } from "lucide-react-native";
import { PressableScale } from "@/components/ai/PressableScale";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  title: string;
  subtitle?: string;
  overline?: string;
  viewAllLabel?: string;
  onViewAll?: () => void;
  leading?: React.ReactNode;
};

/**
 * Shared section header — the page's editorial anchor. A premium gradient
 * "kicker" bar precedes the overline for a consistent, world-class rhythm that
 * repeats across every services-page section.
 */
export function SectionHeader({
  title,
  subtitle,
  overline,
  viewAllLabel = "View all",
  onViewAll,
  leading,
}: Props) {
  const { c, layout: L } = useServicesTheme();

  return (
    <View style={[styles.wrap, { paddingHorizontal: L.pad }]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {overline ? (
            <View style={styles.kickerRow}>
              <LinearGradient
                colors={[c.primary, c.accentPurple]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.kickerBar}
              />
              <Text style={[styles.overline, { color: c.primary }]}>{overline}</Text>
            </View>
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
            <View style={[styles.viewAllPill, { borderColor: c.borderLight }]}>
              <Text style={[styles.viewAll, { color: c.primary }]}>{viewAllLabel}</Text>
              <ArrowRight size={13} color={c.primary} strokeWidth={2.6} />
            </View>
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
  kickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  kickerBar: {
    width: 18,
    height: 3,
    borderRadius: 2,
  },
  overline: { ...serviceType.overline },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  title: { ...serviceType.sectionTitle, fontSize: 21, lineHeight: 27, letterSpacing: -0.5 },
  subtitle: {
    ...serviceType.sectionSubtitle,
    marginTop: 6,
    maxWidth: "94%",
  },
  viewAllHit: {
    marginTop: 2,
  },
  viewAllPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  viewAll: { ...serviceType.link, fontSize: 12 },
});
