import React from "react";
import { View, Text, StyleSheet } from "react-native";
import Animated, { FadeInUp } from "react-native-reanimated";
import { Star, ShieldCheck, Users, CheckCircle2 } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useServicesTheme } from "./ServicesThemeContext";
import { useStatsOverview } from "@/hooks/use-core-data";
import { serviceType } from "@/components/services/theme/typography";
import { layout } from "@/components/services/theme/layout";

const nf = (n: number) => n.toLocaleString("en-IN");

type Metric = { key: string; icon: LucideIcon; value: string; label: string };

/**
 * Aggregate social proof — the compounding trust signal.
 *
 * Every value is read from GET /api/stats/overview. A metric is rendered ONLY when
 * the backend actually returns a usable value; each one hides independently, and if
 * none are available the whole strip hides. Nothing is ever hardcoded or estimated.
 */
export function SocialProofStrip() {
  const { c, shadows, layout: L } = useServicesTheme();
  const { data: stats, isLoading } = useStatsOverview();

  const metrics = React.useMemo<Metric[]>(() => {
    if (!stats) return [];
    const out: Metric[] = [];

    if (stats.averageRating != null && stats.averageRating > 0) {
      out.push({
        key: "rating",
        icon: Star,
        value: `${stats.averageRating}`,
        label: stats.reviewCount > 0 ? `${nf(stats.reviewCount)} reviews` : "average rating",
      });
    }
    if (stats.completedBookings > 0) {
      out.push({
        key: "jobs",
        icon: CheckCircle2,
        value: nf(stats.completedBookings),
        label: "jobs completed",
      });
    }
    if (stats.activeProviders > 0) {
      out.push({
        key: "pros",
        icon: ShieldCheck,
        value: nf(stats.activeProviders),
        label: "verified pros",
      });
    }
    if (stats.customers > 0) {
      out.push({ key: "customers", icon: Users, value: nf(stats.customers), label: "happy customers" });
    }
    return out;
  }, [stats]);

  // Skeleton while the endpoint resolves — avoids a layout jump when it lands.
  if (isLoading) {
    return (
      <View style={[styles.row, { paddingHorizontal: L.pad }]}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.card, styles.skeleton, { backgroundColor: c.card, borderColor: c.cardBorder }]}
          />
        ))}
      </View>
    );
  }

  // Backend has nothing to prove yet — hide rather than invent.
  if (metrics.length === 0) return null;

  return (
    <View style={[styles.row, { paddingHorizontal: L.pad }]}>
      {metrics.map((m, i) => (
        <Animated.View
          key={m.key}
          entering={FadeInUp.delay(i * 70).duration(420)}
          style={[styles.card, shadows.soft, { backgroundColor: c.card, borderColor: c.cardBorder }]}
          accessible
          accessibilityLabel={`${m.value} ${m.label}`}
        >
          <m.icon size={15} color={c.primary} strokeWidth={2.4} />
          <Text style={[styles.value, { color: c.textPrimary }]} numberOfLines={1}>
            {m.value}
          </Text>
          <Text style={[styles.label, { color: c.textMuted }]} numberOfLines={1}>
            {m.label}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 8,
  },
  card: {
    flex: 1,
    alignItems: "center",
    gap: 4,
    paddingVertical: 16,
    paddingHorizontal: 8,
    borderRadius: layout.cardRadius,
    borderWidth: 1,
  },
  skeleton: { height: 92, opacity: 0.5 },
  value: { ...serviceType.cardTitle, fontSize: 16, fontWeight: "800" },
  label: { ...serviceType.captionSm, textAlign: "center" },
});
