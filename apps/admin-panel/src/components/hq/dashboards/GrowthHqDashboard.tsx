"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Gift, IndianRupee, LineChart, Megaphone, Percent, Share2, ShieldCheck, Target, TrendingUp, Users } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { formatNumber, humanizeKey, inr } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { DataUnavailable, MeterBar, SectionHeading, SparkBars, StatTile } from "../primitives";

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
    return keys.map((k) => ({ label: humanizeKey(k), value: num(upgradeFunnel[k]) }));
  }, [m.upgradeFunnel]);

  const cohortBars = useMemo(() => {
    const cohorts = Array.isArray(m.cohorts) ? (m.cohorts as Array<Record<string, unknown>>) : [];
    return cohorts.slice(-12).map((c) => num(c.retentionPct ?? c.retention));
  }, [m.cohorts]);

  return (
    <div className="space-y-8">
      <section>
        <SectionHeading
          title="Growth efficiency"
          hint="30-day ROAS, payback, referral return"
          icon={TrendingUp}
          iconTone="success"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="ROAS"
            value={g?.roas.value != null ? `${g.roas.value.toFixed(2)}x` : "—"}
            sub={
              g?.roas.spendSource === "missing"
                ? "Set MARKETING_SPEND_MONTHLY to compute"
                : `Spend ${inr(g?.roas.marketingSpend ?? 0)}`
            }
            icon={TrendingUp}
            loading={growth.isLoading}
            tone={g?.roas.value != null && g.roas.value >= 1 ? "success" : "default"}
          />
          <StatTile
            label="Payback"
            value={g?.paybackMonths.value != null ? `${g.paybackMonths.value.toFixed(1)} mo` : "—"}
            sub="Months to recover CAC"
            icon={Target}
            loading={growth.isLoading}
          />
          <StatTile
            label="Referral ROI"
            value={g?.referralRoi.roiPct != null ? `${g.referralRoi.roiPct.toFixed(0)}%` : "—"}
            sub={g ? `Referred GMV ${inr(g.referralRoi.referredGmv, true)}` : undefined}
            icon={Gift}
            loading={growth.isLoading}
          />
          <StatTile
            label="Attribution channels"
            value={g ? String(g.attribution.channels.length) : "—"}
            sub={g?.attribution.touchTablePopulated ? "Touch table live" : "Referral/coupon fallback"}
            icon={Megaphone}
            loading={growth.isLoading}
          />
        </div>
      </section>

      <section>
        <SectionHeading
          title="Unit economics"
          hint="What it costs to win a customer vs what they return"
          icon={IndianRupee}
          iconTone="cyan"
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="CAC"
            value={cac > 0 ? inr(cac) : "—"}
            sub={cac > 0 ? "Per new customer (30d)" : "Set MARKETING_SPEND_MONTHLY"}
            icon={IndianRupee}
            loading={unit.isLoading}
            tone="accent"
          />
          <StatTile
            label="Avg LTV"
            value={inr(ltv)}
            sub="Lifetime value"
            icon={TrendingUp}
            loading={unit.isLoading}
            tone="success"
          />
          <StatTile
            label="LTV : CAC"
            value={ratio > 0 ? `${ratio.toFixed(1)}x` : "—"}
            sub={ratio >= 3 ? "Healthy (≥3x)" : ratio > 0 ? "Below 3x target" : "n/a"}
            icon={Target}
            loading={unit.isLoading}
            tone={ratio >= 3 ? "success" : ratio > 0 ? "danger" : "default"}
          />
          <StatTile
            label="Contribution margin"
            value={`${contributionMargin.toFixed(1)}%`}
            sub={`Revenue efficiency ${revenueEfficiency.toFixed(0)}%`}
            icon={IndianRupee}
            loading={unit.isLoading}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeading title="Membership upgrade funnel" hint="live" icon={LineChart} iconTone="cyan" />
          {membership.isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="biz-skeleton h-6 w-full rounded" />
              ))}
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
          <SectionHeading title="Retention & cohorts" hint="last 12 cohorts" icon={ShieldCheck} iconTone="success" />
          <div className="mb-4">
            <MeterBar
              label="Overall retention rate"
              value={retentionPct}
              tone={retentionPct >= 70 ? "success" : "danger"}
            />
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
          <SectionHeading title="Campaign performance" hint="redemptions vs collected revenue" icon={Megaphone} />
          {campaigns.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : campaigns.data ? (
            <div className="grid grid-cols-2 gap-3">
              <StatTile
                label="Redemptions"
                value={formatNumber(
                  num(
                    (campaigns.data as Record<string, unknown>).totalRedemptions ??
                      (campaigns.data as Record<string, unknown>).redemptions,
                  ),
                )}
                icon={Megaphone}
                embedded
              />
              <StatTile
                label="Discount given"
                value={inr(
                  num(
                    (campaigns.data as Record<string, unknown>).totalDiscount ??
                      (campaigns.data as Record<string, unknown>).discountGiven,
                  ),
                )}
                icon={Percent}
                tone="accent"
                embedded
              />
              <StatTile
                label="Revenue after"
                value={inr(
                  num(
                    (campaigns.data as Record<string, unknown>).revenueAfter ??
                      (campaigns.data as Record<string, unknown>).revenue,
                  ),
                )}
                icon={IndianRupee}
                tone="success"
                embedded
              />
              <StatTile
                label="Conversion lift"
                value={`${num((campaigns.data as Record<string, unknown>).conversionImpactPct).toFixed(1)}%`}
                icon={TrendingUp}
                tone="success"
                embedded
              />
            </div>
          ) : (
            <DataUnavailable title="No campaign analytics" reason="Campaign analytics endpoint returned no data." />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="Referral program" hint="qualified referrals and commission paid" icon={Users} iconTone="success" />
          {referrals.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : referrals.data ? (
            <>
              <div className="mb-3 grid grid-cols-2 gap-3">
                <StatTile
                  label="Qualified"
                  value={formatNumber(num(r.qualified ?? r.qualifiedReferrals))}
                  icon={Users}
                  embedded
                />
                <StatTile
                  label="Commission paid"
                  value={inr(num(r.commissionPaid ?? r.totalCommissionPaid))}
                  icon={IndianRupee}
                  embedded
                />
              </div>
              {leaderboard.length > 0 ? (
                <div className="space-y-1.5">
                  {leaderboard.slice(0, 4).map((l, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs"
                    >
                      <span className="truncate">{String(l.name ?? l.userName ?? `Referrer ${i + 1}`)}</span>
                      <span className="biz-num font-semibold">{formatNumber(num(l.count ?? l.referrals))}</span>
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
          <SectionHeading title="Attribution" hint="30-day channel mix" icon={Share2} iconTone="cyan" />
          {growth.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : g && g.attribution.channels.length > 0 ? (
            <div className="space-y-1.5">
              {g.attribution.channels.map((ch) => (
                <div
                  key={ch.channel}
                  className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs"
                >
                  <span className="capitalize">{humanizeKey(ch.channel)}</span>
                  <span className="biz-num font-semibold">
                    {inr(ch.revenue)} · {ch.touches} touches
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <DataUnavailable
              title="No attribution touches"
              reason={g?.attribution.note ?? "Ingest UTM/channel data into marketing_attribution_touches."}
            />
          )}
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="Campaign ROI" hint="uses campaign.cost vs redemption revenue" icon={Target} iconTone="warning" />
          {growth.isLoading ? (
            <div className="biz-skeleton h-24 w-full rounded" />
          ) : g && g.campaignRoi.length > 0 ? (
            <div className="space-y-1.5">
              {g.campaignRoi.slice(0, 6).map((c) => (
                <div
                  key={c.code}
                  className="flex items-center justify-between rounded-lg bg-[var(--color-biz-bg)] px-3 py-2 text-xs"
                >
                  <span className="truncate">{c.name || c.code}</span>
                  <span className="biz-num font-semibold">{c.roi != null ? `${c.roi.toFixed(0)}%` : "—"}</span>
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
