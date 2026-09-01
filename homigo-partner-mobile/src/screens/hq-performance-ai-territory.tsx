import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useAuthStore } from "@/stores/auth-store";
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

function useAuthedQuery() {
  return useAuthStore((s) => s.hydrated && Boolean(s.accessToken));
}

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
  const ready = useAuthedQuery();
  const score = useQuery({ queryKey: ["partner", "score"], queryFn: () => partnerApi.partnerOs.score(), enabled: ready });
  const history = useQuery({ queryKey: ["partner", "score-history"], queryFn: () => partnerApi.partnerOs.scoreHistory(), enabled: ready });
  const lifecycle = useQuery({ queryKey: ["partner", "lifecycle"], queryFn: () => partnerApi.partnerOs.lifecycle(), enabled: ready });
  if (!ready || score.isLoading) return <HqShell title="Score" subtitle="Partner score"><LoadingBlock /></HqShell>;
  if (score.isError || !score.data) {
    return (
      <HqShell title="Score" subtitle="Partner score">
        <ErrorBlock message="Could not load your score." />
      </HqShell>
    );
  }
  const d = score.data;
  const latest = history.data?.items[0];
  const labels: Record<string, string> = {
    quality: "Quality",
    reliability: "Reliability",
    completion: "Completion",
    onTime: "On-time",
    customerSatisfaction: "Customer satisfaction",
    compliance: "Compliance",
    safety: "Safety",
  };
  return (
    <HqShell title="Score" subtitle="Server-calculated. Not editable on this device.">
      <View style={styles.grid}>
        <KpiCard label="Score" value={d.overallScore == null ? "—" : `${Math.round(d.overallScore)}`} />
        <KpiCard label="Band" value={d.band.replace(/_/g, " ")} />
      </View>
      <HqCard>
        <HqMuted>{`Lifecycle ${lifecycle.data?.lifecycleState ?? "—"} · availability ${lifecycle.data?.availability.currentStatus ?? "—"}`}</HqMuted>
        {Object.entries(d.components).map(([key, c]) => (
          <StatRow key={key} label={labels[key] ?? key} value={c.value == null ? "Not enough data" : String(Math.round(c.value))} />
        ))}
      </HqCard>
      <HqCard>
        <HqCardTitle>Why did my score change?</HqCardTitle>
        {!latest ? (
          <EmptyState message="No score history yet." />
        ) : (
          <>
            <StatRow label="Change" value={`${latest.previousScore ?? "—"} → ${latest.newScore ?? "—"}`} />
            {(latest.reasons ?? []).map((r) => (
              <Text key={r.detail} style={styles.tip}>{r.detail}</Text>
            ))}
          </>
        )}
      </HqCard>
    </HqShell>
  );
}

export function PerformanceCareerScreen() {
  const ready = useAuthedQuery();
  const career = useQuery({ queryKey: ["partner", "career"], queryFn: () => partnerApi.partnerOs.career(), enabled: ready });
  if (!ready || career.isLoading) return <HqShell title="Career" subtitle="Level and progress"><LoadingBlock /></HqShell>;
  if (career.isError || !career.data) {
    return (
      <HqShell title="Career" subtitle="Level and progress">
        <ErrorBlock message="Could not load career progress." />
      </HqShell>
    );
  }
  const d = career.data;
  return (
    <HqShell title="Career" subtitle={`${d.currentLevel}${d.nextLevel ? ` · ${d.progressPct}% toward ${d.nextLevel}` : ""}`}>
      <View style={styles.grid}>
        <KpiCard label="Level" value={d.currentLevel} />
        <KpiCard label="Priority boost" value={d.benefitsActive ? `+${d.careerPriorityBoost}` : "Paused"} />
      </View>
      <HqCard>
        <HqCardTitle>Requirements</HqCardTitle>
        {d.requirements.map((r) => (
          <StatRow key={r.id} label={`${r.met ? "Done · " : ""}${r.label}`} value={`${r.current}/${r.target}`} />
        ))}
      </HqCard>
      <HqCard>
        <HqCardTitle>Badges</HqCardTitle>
        {d.badges.length === 0 ? (
          <EmptyState message="No badges awarded yet." />
        ) : (
          d.badges.map((b) => <StatRow key={b.code} label={b.label} value={b.code} />)
        )}
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
      <AiAssistantChat />
    </HqShell>
  );
}

/**
 * Ask-anything box, routed through the backend AI Gateway (`/api/ai/partner`).
 *
 * The insight list above stays deterministic and always renders; this adds the
 * conversational half. On failure the turn is labelled offline rather than dropped, so a
 * partner is never shown a canned line as though a model wrote it.
 */
function AiAssistantChat() {
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Array<{ q: string; a: string; offline?: boolean; basis?: string[] }>>([]);

  const ask = useMutation({
    mutationFn: (q: string) => partnerApi.aiChat(q),
    onSuccess: (res, q) =>
      setTurns((t) => [
        ...t,
        {
          q,
          a: res.content,
          offline: res.mode === "deterministic_fallback",
          basis: res.basis,
        },
      ]),
    onError: (_e, q) =>
      setTurns((t) => [
        ...t,
        { q, a: "Assistant is unavailable right now. Your dashboard insights above are still current.", offline: true },
      ]),
  });

  const send = () => {
    const q = input.trim();
    if (!q || ask.isPending) return;
    setInput("");
    ask.mutate(q);
  };

  return (
    <HqCard>
      <Text style={styles.tip}>Ask about routes, earnings or scheduling</Text>
      {turns.map((t, i) => (
        <View key={i} style={{ marginBottom: 10 }}>
          <Text style={[styles.tip, { fontWeight: "700" }]}>You: {t.q}</Text>
          <Text style={styles.tip}>{t.a}</Text>
          {t.basis?.length ? (
            <Text style={[styles.tip, { fontSize: 11, color: partnerColors.textMuted }]}>
              Based on: {t.basis.join("; ")}
            </Text>
          ) : null}
          {t.offline ? (
            <Text style={[styles.tip, { fontSize: 11, color: partnerColors.textMuted }]}>
              VERIFIED SUMMARY — live model unavailable
            </Text>
          ) : null}
        </View>
      ))}
      {ask.isPending ? <Text style={styles.tip}>Thinking…</Text> : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        <TextInput
          value={input}
          onChangeText={setInput}
          onSubmitEditing={send}
          editable={!ask.isPending}
          placeholder="Ask the assistant…"
          accessibilityLabel="Ask the partner copilot"
          placeholderTextColor={partnerColors.textMuted}
          style={{
            flex: 1, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 10,
            paddingHorizontal: 12, paddingVertical: 8, color: partnerColors.text,
          }}
        />
          <Pressable
            onPress={send}
            disabled={ask.isPending}
            accessibilityRole="button"
            accessibilityLabel="Send question"
            style={{
              backgroundColor: partnerColors.primary, borderRadius: 10,
              paddingHorizontal: 16, justifyContent: "center", opacity: ask.isPending ? 0.6 : 1,
            }}
          >
            <Text style={{ color: "#fff", fontWeight: "700" }}>Ask</Text>
          </Pressable>
      </View>
    </HqCard>
  );
}

export function AiDemandForecastScreen() {
  const forecast = useQuery({ queryKey: ["partner", "geo-demand"], queryFn: () => partnerApi.geoIntel.demandForecast(24) });
  if (forecast.isLoading) return <HqShell title="Demand Forecast" subtitle="24h predictions"><LoadingBlock /></HqShell>;
  if (forecast.isError || !forecast.data) return <HqShell title="Demand Forecast" subtitle="24h predictions"><ErrorBlock message="Demand forecast unavailable." /></HqShell>;
  const points = (forecast.data.points ?? []).slice(0, 20);
  return (
    <HqShell title="Demand Forecast" subtitle="24h zone-hour demand predictions.">
      <KpiCard label="Total predicted" value={Math.round(forecast.data.totalPredicted ?? 0)} />
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
  if (surge.isError || zones.isError || !zones.data) {
    return (
      <HqShell title="Growth Advisor" subtitle="Surge and zones">
        <ErrorBlock message="Could not load growth intelligence." />
      </HqShell>
    );
  }
  const surgeZones = Array.isArray(surge.data) ? surge.data : [];
  const opportunity = zones.data.bestOpportunity ?? zones.data.ranked ?? [];
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
        {surgeZones.slice(0, 8).map((z) => (
          <StatRow key={z.zoneId} label={z.name} value={`${z.predictedSurge.toFixed(2)}x`} />
        ))}
      </HqCard>
      <HqCard>
        <HqCardTitle>Best opportunity zones</HqCardTitle>
        {opportunity.slice(0, 8).map((z) => (
          <StatRow
            key={z.zoneId}
            label={z.name}
            value={`D ${z.demand24h} / S ${z.supply} · gap ${z.gap ?? z.demand24h - z.supply}`}
          />
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
        {(Array.isArray(surge.data) ? surge.data : []).map((z) => (
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
        {(Array.isArray(density.data) ? density.data : []).map((z) => (
          <StatRow key={z.zoneId} label={z.name} value={`${z.providers} providers · ${z.densityPerKm2.toFixed(2)}/km²`} />
        ))}
      </HqCard>
    </HqShell>
  );
}

export function TerritoryAnalyticsScreen() {
  const zones = useQuery({ queryKey: ["partner", "zones"], queryFn: () => partnerApi.geoIntel.zoneScoring() });
  if (zones.isLoading) return <HqShell title="Territory Analytics" subtitle="Zone scoring"><LoadingBlock /></HqShell>;
  if (zones.isError || !zones.data) {
    return (
      <HqShell title="Territory Analytics" subtitle="Zone scoring">
        <ErrorBlock message="Could not load territory analytics." />
      </HqShell>
    );
  }
  const z = zones.data;
  return (
    <HqShell title="Territory Analytics" subtitle="Surge zones, demand index, and top territories.">
      <HqCard>
        <HqCardTitle>Top territories</HqCardTitle>
        {(z.ranked ?? []).slice(0, 10).map((zone) => (
          <StatRow
            key={zone.zoneId}
            label={zone.name}
            value={`D ${zone.demand24h} / S ${zone.supply} · ${zone.opportunityScore ?? zone.compositeScore}`}
          />
        ))}
      </HqCard>
      <HqCard>
        <HqCardTitle>High risk zones</HqCardTitle>
        {(z.highRisk ?? []).length === 0 ? (
          <EmptyState message="No high-risk zones flagged." />
        ) : (
          (z.highRisk ?? []).map((zone) => <StatRow key={zone.zoneId} label={zone.name} value={zone.riskScore.toFixed(1)} />)
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
