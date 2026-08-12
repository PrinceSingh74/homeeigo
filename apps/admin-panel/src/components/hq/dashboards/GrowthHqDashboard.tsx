"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { IndianRupee, Users, Megaphone, Gift, TrendingUp, Target } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { inr, formatNumber } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { StatTile, MeterBar, SparkBars, DataUnavailable, SectionHeading } from "../primitives";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function GrowthHqDashboard() {
  const growth = useQuery({
    queryKey: ["hq", "growth", "intelligence"],
    queryFn: () => adminApi.growthIntelligence(30),
    staleTime: 120_000,
  });
  const unit = useQuery({
    queryKey: ["hq", "growth", "unit-economics"],
    queryFn: () => adminApi.financeUnitEconomics(30),
    staleTime: 120_000,
  });
  const campaigns = useQuery({
    queryKey: ["hq", "growth", "campaigns"],
    queryFn: () => adminApi.campaigns.analytics(),
    staleTime: 120_000,
  });
  const referrals = useQuery({
    queryKey: ["hq", "growth", "referrals"],
    queryFn: () => adminApi.referrals.analytics(),
    staleTime: 120_000,
  });
  const membership = useQuery({
    queryKey: ["hq", "growth", "membership"],
    queryFn: () => adminApi.subscriptions.analytics(),
    staleTime: 120_000,
  });

  const u = (unit.data ?? {}) as Record<string, unknown>;
  const g = growth.data;
  const cac = g?.cac ?? num(u.cac);
  const ltv = g?.ltv ?? num(u.avgLtv ?? u.avgLTV);
  const ratio = g?.ltvCacRatio ?? (cac > 0 ? ltv / cac : 0);
  const contributionMargin = num(u.contributionMarginPct);
  const revenueEfficiency = num(u.revenueEfficiencyPct);

  const m = (membership.data ?? {}) as Record<string, unknown>;
  const retentionPct = num(m.retentionRatePct);

  const r = (referrals.data ?? {}) as Record<string, unknown>;
  const leaderboard = Array.isArray(r.leaderboard) ? (r.leaderboard as Array<Record<string, unknown>>) : [];

  const funnelStages = useMemo(() => {
    const upgradeFunnel = (m.upgradeFunnel ?? {}) as Record<string, unknown>;
    const keys = Object.keys(upgradeFunnel);
    if (keys.length === 0) return [];
    return keys.map((k) => ({ label: k, value: num(upgradeFunnel[k]) }));
  }, [m.upgradeFunnel]);

  const cohortBars = useMemo(() => {
    const cohorts = Array.isArray(m.cohorts) ? (m.cohorts as Array<Record<string, unknown>>) : [];
    return cohorts.slice(-12).map((c) => num(c.retentionPct ?? c.retention));
  }, [m.cohorts]);

  return (
    <div className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="ROAS"
          value={g?.roas.value != null ? `${g.roas.value.toFixed(2)}x` : "—"}
          sub={g?.roas.spendSource === "missing" ? "set MARKETING_SPEND_MONTHLY" : `spend ${inr(g?.roas.marketingSpend ?? 0)}`}
          icon={TrendingUp}
          loading={growth.isLoading}
          tone={g?.roas.value != null && g.roas.value >= 1 ? "success" : "default"}
        />
        <StatTile
          label="Payback"
          value={g?.paybackMonths.value != null ? `${g.paybackMonths.value.toFixed(1)} mo` : "—"}
          sub="CAC / contribution"
          icon={Target}
          loading={growth.isLoading}
        />
        <StatTile
          label="Referral ROI"
          value={g?.referralRoi.roiPct != null ? `${g.referralRoi.roiPct.toFixed(0)}%` : "—"}
          sub={g ? `GMV ${inr(g.referralRoi.referredGmv, true)}` : undefined}
          icon={Gift}
          loading={growth.isLoading}
        />
        <StatTile label="Attribution channels" value={g ? String(g.attribution.channels.length) : "—"} sub={g?.attribution.touchTablePopulated ? "touch table live" : "referral/coupon fallback"} icon={Megaphone} loading={growth.isLoading} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="CAC"
          value={cac > 0 ? inr(cac) : "—"}
          sub={cac > 0 ? "per new customer (30d)" : "set MARKETING_SPEND_MONTHLY"}
          icon={IndianRupee}
          loading={unit.isLoading}
          tone="accent"
        />
        <StatTile label="Avg LTV" value={inr(ltv)} sub="lifetime value" icon={TrendingUp} loading={unit.isLoading} tone="success" />
        <StatTile
          label="LTV : CAC"
          value={ratio > 0 ? `${ratio.toFixed(1)}x` : "—"}
          sub={ratio >= 3 ? "healthy (≥3x)" : ratio > 0 ? "below target" : "n/a"}
          icon={Target}
          loading={unit.isLoading}
          tone={ratio >= 3 ? "success" : ratio > 0 ? "danger" : "default"}
        />
        <StatTile label="Contribution Margin" value={`${contributionMargin.toFixed(1)}%`} sub={`Revenue efficiency ${revenueEfficiency.toFixed(0)}%`} icon={IndianRupee} loading={unit.isLoading} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeading title="Membership Upgrade Funnel" hint="live" />
          {membership.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <div key={i} className="biz-skeleton h-6 w-full rounded" />)}
            </div>
          ) : funnelStages.length > 0 ? (
            <div className="space-y-3">
              {funnelStages.map((s) => {
                const max = Math.max(...funnelStages.map((x) => x.value), 1);
                return <MeterBar key={s.label} label={s.label} value={s.value} max={max} suffix="" />;
              })}
            </div>
          ) : (
            <DataUnavailable title="No funnel data" reason="Membership funnel returned no stages for the current period." />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="Retention & Cohorts" hint="last 12 cohorts" />
          <div className="mb-4">
            <MeterBar label="Overall retention rate" value={retentionPct} tone={retentionPct >= 70 ? "success" : "danger"} />
          </div>
          {cohortBars.length > 0 ? (
            <SparkBars data={cohortBars} label="Cohort retention %" color="var(--color-biz-success)" />
          ) : (
            <DataUnavailable title="No cohort data" reason="No membership cohorts available yet." />
          )}
        </GlassPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-[var(--color-biz-accent)]" />
            <h2 className="text-sm font-semibold">Campaign Performance</h2>
          </div>
          {campaigns.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : campaigns.data ? (
            <div className="grid grid-cols-2 gap-3">
              <StatTile label="Redemptions" value={formatNumber(num((campaigns.data as Record<string, unknown>).totalRedemptions ?? (campaigns.data as Record<string, unknown>).redemptions))} />
              <StatTile label="Discount Given" value={inr(num((campaigns.data as Record<string, unknown>).totalDiscount ?? (campaigns.data as Record<string, unknown>).discountGiven))} />
              <StatTile label="Revenue Impact" value={inr(num((campaigns.data as Record<string, unknown>).revenueAfter ?? (campaigns.data as Record<string, unknown>).revenue))} />
              <StatTile label="Conversion Impact" value={`${num((campaigns.data as Record<string, unknown>).conversionImpactPct).toFixed(1)}%`} tone="success" />
            </div>
          ) : (
            <DataUnavailable title="No campaign analytics" reason="Campaign analytics endpoint returned no data." />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Gift className="h-4 w-4 text-[var(--color-biz-accent)]" />
            <h2 className="text-sm font-semibold">Referral Program</h2>
          </div>
          {referrals.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : referrals.data ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <StatTile label="Qualified" value={formatNumber(num(r.qualified ?? r.qualifiedReferrals))} icon={Users} />
                <StatTile label="Commission Paid" value={inr(num(r.commissionPaid ?? r.totalCommissionPaid))} icon={IndianRupee} />
              </div>
              {leaderboard.length > 0 ? (
                <div className="space-y-1.5">
                  {leaderboard.slice(0, 4).map((l, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-1.5 text-xs">
                      <span className="truncate">{String(l.name ?? l.userName ?? `Referrer ${i + 1}`)}</span>
                      <span className="font-semibold tabular-nums">{formatNumber(num(l.count ?? l.referrals))}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <DataUnavailable title="No referral analytics" reason="Referral analytics endpoint returned no data." />
          )}
        </GlassPanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeading title="Attribution Engine" hint="30d" />
          {growth.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : g && g.attribution.channels.length > 0 ? (
            <div className="space-y-1.5">
              {g.attribution.channels.map((ch) => (
                <div key={ch.channel} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                  <span className="capitalize">{ch.channel}</span>
                  <span className="font-semibold tabular-nums">{inr(ch.revenue)} · {ch.touches} touches</span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No attribution touches" reason={g?.attribution.note ?? "Ingest UTM/channel data into marketing_attribution_touches."} />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="Campaign ROI" hint="cost from campaigns.cost" />
          {growth.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : g && g.campaignRoi.length > 0 ? (
            <div className="space-y-1.5">
              {g.campaignRoi.slice(0, 6).map((c) => (
                <div key={c.code} className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs">
                  <span className="truncate">{c.name || c.code}</span>
                  <span className="font-semibold tabular-nums">{c.roi != null ? `${c.roi.toFixed(0)}%` : "—"}</span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable title="No campaign ROI" reason="Set campaign.cost and drive redemptions to compute ROI." />
          )}
        </GlassPanel>
      </div>
    </div>
  );
}
