import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KpiCard } from "@/components/KpiCard";
import {
  EmptyState,
  ErrorBlock,
  HqCard,
  HqCardTitle,
  HqMuted,
  LoadingBlock,
  ProgressRow,
  StatRow,
} from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { customerName, formatCurrency, formatDate, formatPct } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { useDashboardQuery } from "@/screens/hq-work-earnings";
import { partnerColors } from "@/theme/colors";

function HqShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <PartnerScreen title={title} subtitle={subtitle} showBack>
      {children}
    </PartnerScreen>
  );
}

export function PerformanceReviewsScreen() {
  const reviews = useQuery({ queryKey: ["partner", "reviews"], queryFn: () => partnerApi.reviews({ limit: 20 }) });
  if (reviews.isLoading) return <HqShell title="Reviews" subtitle="Customer feedback"><LoadingBlock /></HqShell>;
  const r = reviews.data!;
  return (
    <HqShell title="Reviews" subtitle="Customer ratings and review responses.">
      <View style={styles.grid}>
        <KpiCard label="Average" value={r.averageRating?.toFixed(1) ?? "—"} />
        <KpiCard label="Total" value={r.total} />
      </View>
      <HqCard>
        {r.reviews.length === 0 ? (
          <EmptyState message="No reviews yet." />
        ) : (
          r.reviews.map((rev) => (
            <View key={rev.id} style={styles.review}>
              <Text style={styles.reviewTitle}>{customerName(rev.customer)} · {rev.rating}★</Text>
              <Text style={styles.reviewBody}>{rev.comment || "No comment"}</Text>
              <Text style={styles.reviewMeta}>{rev.service.name} · {formatDate(rev.createdAt)}</Text>
            </View>
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function PerformanceScorecardScreen() {
  const dashboard = useDashboardQuery();
  const intel = useQuery({ queryKey: ["partner", "intelligence"], queryFn: () => partnerApi.partnerOs.intelligence() });
  if (dashboard.isLoading) return <HqShell title="Scorecard" subtitle="Performance metrics"><LoadingBlock /></HqShell>;
  const d = dashboard.data!;
  return (
    <HqShell title="Scorecard" subtitle="Acceptance, completion, cancellation, response time, rating.">
      <View style={styles.grid}>
        <KpiCard label="Rating" value={d.rating.toFixed(1)} />
        <KpiCard label="Repeat %" value={intel.data ? formatPct(intel.data.repeatCustomerRatePct) : "—"} />
      </View>
      <HqCard>
        <StatRow label="Acceptance rate" value={formatPct(d.rates.acceptanceRate)} />
        <StatRow label="Completion rate" value={formatPct(d.rates.completionRate)} />
        <StatRow label="Response rate" value={formatPct(d.rates.responseRate)} />
        <StatRow label="On-time rate" value={formatPct(d.rates.onTimeRate)} />
        <StatRow label="Cancellation rate" value={formatPct(d.rates.cancellationRate)} />
      </HqCard>
    </HqShell>
  );
}

export function PerformanceRankingsScreen() {
  const rankings = useQuery({ queryKey: ["partner", "rankings"], queryFn: () => partnerApi.partnerOs.rankings() });
  if (rankings.isLoading) return <HqShell title="Rankings" subtitle="City and area ranks"><LoadingBlock /></HqShell>;
  const r = rankings.data!;
  return (
    <HqShell title="Rankings" subtitle="City, area, and category rankings.">
      <View style={styles.grid}>
        <KpiCard label="City rank" value={`#${r.cityRank}/${r.cityTotal}`} />
        <KpiCard label="Area rank" value={`#${r.areaRank}/${r.areaTotal}`} />
        <KpiCard label="Score" value={r.compositeScore.toFixed(1)} />
      </View>
      <HqCard>
        <HqCardTitle>Category ranks</HqCardTitle>
        {r.categoryRanks.map((c) => (
          <StatRow key={c.category} label={c.category} value={`#${c.rank}/${c.total}`} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function PerformanceQualityScreen() {
  const dashboard = useDashboardQuery();
  if (dashboard.isLoading) return <HqShell title="Quality Insights" subtitle="Recommendations"><LoadingBlock /></HqShell>;
  const d = dashboard.data!;
  const tips: string[] = [];
  if (d.rates.acceptanceRate < 80) tips.push("Improve acceptance rate by responding to pending requests faster.");
  if (d.rates.cancellationRate > 10) tips.push("Reduce cancellations — confirm schedule before accepting jobs.");
  if (d.rates.onTimeRate < 85) tips.push("Leave earlier for jobs to improve on-time arrival rate.");
  if (d.rating < 4.5) tips.push("Follow up with customers after service to improve ratings.");
  if (tips.length === 0) tips.push("Great work! Your quality metrics are strong. Keep your acceptance and on-time rates high.");
  return (
    <HqShell title="Quality Insights" subtitle="Rule-based quality recommendations from your KPIs.">
      <HqCard>
        {tips.map((t) => (
          <Text key={t} style={styles.tip}>• {t}</Text>
        ))}
      </HqCard>
    </HqShell>
  );
}

export function PerformanceAnalyticsScreen() {
  const earnings = useQuery({ queryKey: ["partner", "earnings", 30], queryFn: () => partnerApi.earnings(30) });
  const dashboard = useDashboardQuery();
  if (earnings.isLoading || dashboard.isLoading) return <HqShell title="Analytics" subtitle="Charts"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Analytics" subtitle="Performance analytics for earnings and bookings.">
      <View style={styles.grid}>
        <KpiCard label="Period earnings" value={formatCurrency(earnings.data!.periodEarnings)} />
        <KpiCard label="Jobs" value={earnings.data!.totalJobs} />
        <KpiCard label="Acceptance" value={formatPct(dashboard.data!.rates.acceptanceRate)} />
        <KpiCard label="Completion" value={formatPct(dashboard.data!.rates.completionRate)} />
      </View>
      <HqCard>
        <HqCardTitle>Daily breakdown (30d)</HqCardTitle>
        {(earnings.data!.breakdown ?? []).slice(-10).map((b) => (
          <StatRow key={b.date} label={formatDate(b.date)} value={`${formatCurrency(b.earnings)} · ${b.jobs} jobs`} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function AiAssistantScreen() {
  const dashboard = useDashboardQuery();
  if (dashboard.isLoading) return <HqShell title="AI Assistant" subtitle="Insights"><LoadingBlock /></HqShell>;
  const d = dashboard.data!;
  const insights = [
    `You have ${d.counts.pendingRequests} pending requests — respond quickly to protect acceptance rate.`,
    `Today's earnings: ${formatCurrency(d.earnings.today)} (${d.earnings.todayChange >= 0 ? "+" : ""}${d.earnings.todayChange}% vs yesterday).`,
    `Commission tier: ${formatPct(d.earnings.commissionRate)} — complete more jobs to unlock better rates.`,
    d.counts.activeBookings > 0
      ? `${d.counts.activeBookings} active job(s) in progress — use Route Center to optimize travel.`
      : "No active jobs — go online in a high-surge zone to maximize earnings.",
  ];
  return (
    <HqShell title="AI Assistant" subtitle="Smart insights from your live dashboard data.">
      <HqCard>
        {insights.map((line) => (
          <Text key={line} style={styles.tip}>• {line}</Text>
        ))}
      </HqCard>
    </HqShell>
  );
}

export function AiDemandForecastScreen() {
  const forecast = useQuery({ queryKey: ["partner", "geo-demand"], queryFn: () => partnerApi.geoIntel.demandForecast(24) });
  if (forecast.isLoading) return <HqShell title="Demand Forecast" subtitle="24h predictions"><LoadingBlock /></HqShell>;
  if (forecast.isError) return <HqShell title="Demand Forecast" subtitle="24h predictions"><ErrorBlock message="Demand forecast unavailable." /></HqShell>;
  const points = forecast.data!.data.points.slice(0, 20);
  return (
    <HqShell title="Demand Forecast" subtitle="24h zone-hour demand predictions.">
      <KpiCard label="Total predicted" value={Math.round(forecast.data!.data.totalPredicted)} />
      <HqCard>
        {points.map((p, i) => (
          <StatRow key={`${p.zone_id}-${p.hour}-${i}`} label={`${p.zone_id} · ${p.hour}`} value={p.predicted.toFixed(1)} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function AiRouteScreen() {
  return <RouteCenterAlias title="Route AI" subtitle="AI route optimization summary and stop sequence." />;
}

function RouteCenterAlias({ title, subtitle }: { title: string; subtitle: string }) {
  const route = useQuery({ queryKey: ["partner", "route"], queryFn: () => partnerApi.routeOptimize() });
  if (route.isLoading) return <HqShell title={title} subtitle={subtitle}><LoadingBlock /></HqShell>;
  if (route.isError) return <HqShell title={title} subtitle={subtitle}><ErrorBlock message="No route to optimize." /></HqShell>;
  const r = route.data!;
  return (
    <HqShell title={title} subtitle={subtitle}>
      <View style={styles.grid}>
        <KpiCard label="Stops" value={r.metrics.stops} />
        <KpiCard label="Time saved" value={`${Math.round(r.metrics.timeSavedMin)} min`} />
      </View>
      <HqCard>
        <StatRow label="Optimized distance" value={`${r.metrics.optimizedDistanceKm.toFixed(1)} km`} />
        <StatRow label="Optimized ETA" value={`${Math.round(r.metrics.optimizedEtaMin)} min`} />
        <StatRow label="Source" value={r.metrics.source} />
      </HqCard>
    </HqShell>
  );
}

export function AiIntelligenceScreen() {
  const surge = useQuery({ queryKey: ["partner", "surge"], queryFn: () => partnerApi.geoIntel.surge() });
  const zones = useQuery({ queryKey: ["partner", "zones"], queryFn: () => partnerApi.geoIntel.zoneScoring() });
  const dashboard = useDashboardQuery();
  if (surge.isLoading || zones.isLoading) return <HqShell title="Growth Advisor" subtitle="Surge and zones"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Growth Advisor" subtitle="Surge radar, zone ranking, and live earnings.">
      {dashboard.data ? (
        <View style={styles.grid}>
          <KpiCard label="Today" value={formatCurrency(dashboard.data.earnings.today)} />
          <KpiCard label="Rating" value={dashboard.data.rating.toFixed(1)} />
        </View>
      ) : null}
      <HqCard>
        <HqCardTitle>Top surge zones</HqCardTitle>
        {(surge.data?.data ?? []).slice(0, 8).map((z) => (
          <StatRow key={z.zoneId} label={z.name} value={`${z.predictedSurge.toFixed(2)}x`} />
        ))}
      </HqCard>
      <HqCard>
        <HqCardTitle>Best earning zones</HqCardTitle>
        {(zones.data?.data.bestEarning ?? []).slice(0, 8).map((z) => (
          <StatRow key={z.zoneId} label={z.name} value={z.compositeScore.toFixed(1)} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function TerritoryNavigationScreen() {
  const route = useQuery({ queryKey: ["partner", "route"], queryFn: () => partnerApi.routeOptimize() });
  return (
    <HqShell title="Navigation" subtitle="Turn-by-turn job navigation.">
      {route.isLoading ? (
        <LoadingBlock />
      ) : route.isError || !route.data?.sequence.length ? (
        <EmptyState message="No active navigation stops. Accept a job to start navigation." />
      ) : (
        <HqCard>
          {route.data.sequence.map((s) => (
            <Pressable
              key={s.bookingId}
              onPress={() => void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`)}
              style={styles.navRow}
            >
              <Text style={styles.navLabel}>Stop #{s.order}</Text>
              <Text style={styles.navMeta}>Open in Google Maps · ETA {s.cumulativeEtaMin} min</Text>
            </Pressable>
          ))}
        </HqCard>
      )}
    </HqShell>
  );
}

export function TerritoryHeatmapScreen() {
  const surge = useQuery({ queryKey: ["partner", "surge"], queryFn: () => partnerApi.geoIntel.surge() });
  if (surge.isLoading) return <HqShell title="Heatmap" subtitle="Surge zones"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Heatmap" subtitle="Interactive surge zones and zone leaderboard.">
      <HqCard>
        {(surge.data?.data ?? []).map((z) => (
          <StatRow
            key={z.zoneId}
            label={`${z.name}${z.city ? ` · ${z.city}` : ""}`}
            value={`Surge ${z.predictedSurge.toFixed(2)}x · ${z.activeBookings} jobs`}
          />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function TerritoryCoverageScreen() {
  const density = useQuery({ queryKey: ["partner", "density"], queryFn: () => partnerApi.geoIntel.density() });
  if (density.isLoading) return <HqShell title="Coverage Areas" subtitle="Provider density"><LoadingBlock /></HqShell>;
  return (
    <HqShell title="Coverage Areas" subtitle="Provider density per zone.">
      <HqCard>
        {(density.data?.data ?? []).map((z) => (
          <StatRow key={z.zoneId} label={z.name} value={`${z.providers} providers · ${z.densityPerKm2.toFixed(2)}/km²`} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function TerritoryAnalyticsScreen() {
  const zones = useQuery({ queryKey: ["partner", "zones"], queryFn: () => partnerApi.geoIntel.zoneScoring() });
  if (zones.isLoading) return <HqShell title="Territory Analytics" subtitle="Zone scoring"><LoadingBlock /></HqShell>;
  const z = zones.data!.data;
  return (
    <HqShell title="Territory Analytics" subtitle="Surge zones, demand index, and top territories.">
      <HqCard>
        <HqCardTitle>Top territories</HqCardTitle>
        {z.ranked.slice(0, 10).map((zone) => (
          <StatRow key={zone.zoneId} label={zone.name} value={`Score ${zone.compositeScore.toFixed(1)}`} />
        ))}
      </HqCard>
      <HqCard>
        <HqCardTitle>High risk zones</HqCardTitle>
        {z.highRisk.length === 0 ? (
          <EmptyState message="No high-risk zones flagged." />
        ) : (
          z.highRisk.map((zone) => <StatRow key={zone.zoneId} label={zone.name} value={zone.riskScore.toFixed(1)} />)
        )}
      </HqCard>
    </HqShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 4 },
  review: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: partnerColors.line },
  reviewTitle: { fontSize: 14, fontWeight: "700", color: partnerColors.text },
  reviewBody: { marginTop: 4, fontSize: 13, color: partnerColors.textMuted, lineHeight: 18 },
  reviewMeta: { marginTop: 4, fontSize: 11, color: partnerColors.textMuted },
  tip: { fontSize: 13, lineHeight: 20, color: partnerColors.text, marginBottom: 8 },
  navRow: { paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: partnerColors.line },
  navLabel: { fontSize: 14, fontWeight: "700", color: partnerColors.primary },
  navMeta: { marginTop: 2, fontSize: 12, color: partnerColors.textMuted },
});
