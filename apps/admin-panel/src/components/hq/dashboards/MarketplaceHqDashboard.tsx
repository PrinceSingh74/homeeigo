"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, Wrench, CalendarCheck, Crown, TrendingDown, MapPin, Trophy } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { inr, formatNumber } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { StatTile, DataUnavailable, SectionHeading, MeterBar } from "../primitives";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function MarketplaceHqDashboard() {
  const dashboard = useAdminDashboardQuery();
  const insights = useQuery({
    queryKey: ["hq", "marketplace", "insights"],
    queryFn: () => adminApi.subscriptions.insights(),
    staleTime: 120_000,
  });
  const zones = useQuery({
    queryKey: ["hq", "marketplace", "zone-scoring"],
    queryFn: () => adminApi.geoIntel.zoneScoring(),
    staleTime: 120_000,
  });
  const opsMap = useQuery({
    queryKey: ["hq", "marketplace", "ops-map"],
    queryFn: () => adminApi.opsMap(),
    staleTime: 60_000,
  });

  const stats = dashboard.data?.stats;
  const ins = (insights.data ?? {}) as Record<string, unknown>;
  const vip = Array.isArray(ins.highValueMembers) ? (ins.highValueMembers as Array<Record<string, unknown>>) : [];
  const churnRisk = Array.isArray(ins.churnRiskUsers) ? (ins.churnRiskUsers as Array<Record<string, unknown>>) : [];

  const metrics = opsMap.data?.metrics;

  const completion = stats?.totalBookings
    ? Math.round((stats.completedBookings / stats.totalBookings) * 100)
    : 0;

  const topZones = useMemo(() => {
    const ranked = zones.data?.data?.bestEarning ?? zones.data?.data?.ranked ?? [];
    return ranked.slice(0, 6);
  }, [zones.data]);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Customers" value={formatNumber(stats?.totalUsers ?? 0)} icon={Users} loading={dashboard.isLoading} />
        <StatTile label="Partners" value={formatNumber(stats?.totalProviders ?? 0)} sub={`${formatNumber(stats?.activeNow ?? 0)} online`} icon={Wrench} loading={dashboard.isLoading} tone="success" />
        <StatTile label="Bookings" value={formatNumber(stats?.totalBookings ?? 0)} sub={`${completion}% completion`} icon={CalendarCheck} loading={dashboard.isLoading} />
        <StatTile label="Avg Rating" value={`${(stats?.averageRating ?? 0).toFixed(1)}★`} icon={Crown} loading={dashboard.isLoading} tone="accent" />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Crown className="h-4 w-4 text-[var(--color-biz-accent)]" />
            <h2 className="text-sm font-semibold">VIP / High-Value Members</h2>
          </div>
          {insights.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : vip.length > 0 ? (
            <div className="space-y-1.5">
              {vip.slice(0, 6).map((v, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                  <span className="truncate">{String(v.name ?? v.userName ?? v.email ?? `Member ${i + 1}`)}</span>
                  <span className="font-semibold tabular-nums text-[var(--color-biz-accent)]">
                    {inr(num(v.lifetimeValue ?? v.ltv ?? v.value))}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No high-value members" reason="Membership insights returned no high-value members." />
          )}
        </GlassPanel>

        <GlassPanel glow="red" className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <TrendingDown className="h-4 w-4 text-[var(--color-biz-danger)]" />
            <h2 className="text-sm font-semibold">Churn-Risk Customers</h2>
          </div>
          {insights.isLoading ? (
            <div className="biz-skeleton h-32 w-full rounded" />
          ) : churnRisk.length > 0 ? (
            <div className="space-y-1.5">
              {churnRisk.slice(0, 6).map((c, i) => (
                <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                  <span className="truncate">{String(c.name ?? c.userName ?? c.email ?? `Customer ${i + 1}`)}</span>
                  <span className="font-semibold tabular-nums text-[var(--color-biz-danger)]">
                    {(num(c.churnProbability ?? c.churn ?? c.risk) * (num(c.churnProbability ?? c.churn) <= 1 ? 100 : 1)).toFixed(0)}%
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No churn-risk data" reason="Membership insights returned no at-risk customers." />
          )}
        </GlassPanel>
      </div>

      <GlassPanel className="p-5">
        <SectionHeading title="Zone Performance Rankings" hint="by earning score" />
        {zones.isLoading ? (
          <div className="biz-skeleton h-40 w-full rounded" />
        ) : topZones.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {topZones.map((z, i) => (
              <div key={z.zoneId} className="flex items-center gap-3 rounded-lg bg-[var(--color-biz-bg)] px-3 py-2.5">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-biz-accent-dim)] text-xs font-bold text-[var(--color-biz-accent)]">
                  {i === 0 ? <Trophy className="h-3.5 w-3.5" /> : i + 1}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{z.name}</p>
                  <p className="text-[10px] text-[var(--color-biz-muted)]">
                    {z.city ?? "—"} · {formatNumber(z.demand24h)} demand
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular-nums">{inr(z.revenue24h)}</p>
                  <p className="text-[10px] text-[var(--color-biz-muted)]">24h revenue</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <DataUnavailable title="No zone data" reason="Zone-scoring returned no ranked zones." />
        )}
      </GlassPanel>

      <GlassPanel className="p-5">
        <div className="mb-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 text-[var(--color-biz-accent)]" />
          <h2 className="text-sm font-semibold">Service Availability & Supply</h2>
        </div>
        {opsMap.isLoading ? (
          <div className="biz-skeleton h-20 w-full rounded" />
        ) : metrics ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <MeterBar
                label="Online partner coverage"
                value={metrics.totalProviders > 0 ? (metrics.onlineProviders / metrics.totalProviders) * 100 : 0}
                tone="success"
              />
              <MeterBar
                label="Service gaps"
                value={metrics.serviceGaps}
                max={Math.max(metrics.serviceGaps, 10)}
                suffix=" zones"
                tone={metrics.serviceGaps > 0 ? "danger" : "success"}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Active Bookings" value={formatNumber(metrics.activeBookings)} />
              <StatTile label="Avg ETA" value={`${Math.round(metrics.averageEtaMin)}m`} />
            </div>
          </div>
        ) : (
          <DataUnavailable title="No ops-map data" reason="Operations map returned no metrics." />
        )}
      </GlassPanel>
    </div>
  );
}
