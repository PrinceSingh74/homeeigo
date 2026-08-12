"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Wallet, Landmark, IndianRupee, Percent, CreditCard, Flame, Settings } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";
import { GlassPanel } from "../GlassPanel";
import { StatTile, DataUnavailable, SectionHeading, SparkBars, MeterBar } from "../primitives";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function FinanceHqDashboard() {
  const dash = useQuery({
    queryKey: ["hq", "finance", "dashboard"],
    queryFn: () => adminApi.financeDashboard(30),
    staleTime: 120_000,
  });
  const unit = useQuery({
    queryKey: ["hq", "finance", "unit-economics"],
    queryFn: () => adminApi.financeUnitEconomics(30),
    staleTime: 120_000,
  });
  const intel = useQuery({
    queryKey: ["hq", "finance", "intelligence"],
    queryFn: () => adminApi.financeIntelligence(30),
    staleTime: 120_000,
  });
  const config = useQuery({
    queryKey: ["hq", "finance", "config"],
    queryFn: () => adminApi.financeConfigGet(),
    staleTime: 60_000,
  });

  const o = (dash.data?.overview ?? {}) as Record<string, unknown>;
  const u = (unit.data ?? {}) as Record<string, unknown>;
  const fi = intel.data;

  const settlement = o.settlementPending as { amount?: number } | undefined;
  const chargeback = o.chargebackExposure as { amount?: number } | undefined;
  const gmv = fi?.canonicalGmv.gmv ?? num(o.gmv);
  const net = fi?.revenue.netRevenue ?? num(o.netRevenue);
  const margin = fi?.grossMargin.grossMarginPct ?? num(u.contributionMarginPct ?? u.platformMarginPct);

  const trendBars = useMemo(() => {
    const trend = Array.isArray(dash.data?.trend) ? (dash.data!.trend as Array<Record<string, unknown>>) : [];
    return trend.slice(-30).map((t) => num(t.gmv ?? t.revenue ?? t.amount));
  }, [dash.data]);

  const liabilities = [
    { label: "Wallet", value: num(o.walletLiability) },
    { label: "Gift Card", value: num(o.giftCardLiability) },
    { label: "Cashback", value: num(o.cashbackLiability) },
    { label: "Refund", value: num(o.refundLiability) },
    { label: "Provider Payable", value: num(o.providerPayable) },
  ];
  const totalLiability = liabilities.reduce((s, l) => s + l.value, 0);

  const missing = config.data?.resolved
    ? [
        config.data.resolved.sources.operatingExpenseMonthly === "missing" ? "opex" : null,
        config.data.resolved.sources.cashOnHand === "missing" ? "cash" : null,
      ].filter(Boolean)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionHeading title="Finance Intelligence" hint="canonical GMV · real ledger" />
        <Link
          href="/finance/config"
          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-biz-line)] px-3 py-1.5 text-xs font-semibold hover:border-[var(--color-biz-accent)]"
        >
          <Settings className="h-3.5 w-3.5" />
          CFO Config
        </Link>
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Canonical GMV (30d)" value={inr(gmv, true)} icon={TrendingUp} loading={intel.isLoading} tone="accent" />
        <StatTile label="Net Revenue" value={inr(net, true)} icon={IndianRupee} loading={intel.isLoading} tone="success" />
        <StatTile label="Gross Margin" value={`${margin.toFixed(1)}%`} icon={Percent} loading={intel.isLoading} />
        <StatTile label="MRR" value={inr(num(o.mrr), true)} sub={`ARR ${inr(num(o.arr), true)}`} icon={TrendingUp} loading={dash.isLoading} />
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="EBITDA (30d)"
          value={fi?.ebitda.ebitda != null ? inr(fi.ebitda.ebitda, true) : "—"}
          sub={fi?.ebitda.available ? undefined : "configure opex"}
          icon={Landmark}
          loading={intel.isLoading}
        />
        <StatTile
          label="Monthly Burn"
          value={fi?.burnRate.monthlyBurn != null ? inr(fi.burnRate.monthlyBurn, true) : "—"}
          sub={fi?.burnRate.isProfitable ? "cash-flow positive" : fi?.burnRate.available ? "net outflow" : "configure opex"}
          icon={Flame}
          loading={intel.isLoading}
          tone={fi?.burnRate.isProfitable ? "success" : "default"}
        />
        <StatTile
          label="Cash Runway"
          value={
            fi?.cashRunway.status === "profitable"
              ? "∞"
              : fi?.cashRunway.runwayMonths != null
                ? `${fi.cashRunway.runwayMonths.toFixed(1)} mo`
                : "—"
          }
          icon={Wallet}
          loading={intel.isLoading}
        />
        <StatTile
          label="Profit Forecast / mo"
          value={fi?.forecast.profitForecastMonthly != null ? inr(fi.forecast.profitForecastMonthly, true) : "—"}
          icon={TrendingUp}
          loading={intel.isLoading}
        />
      </section>

      {missing.length > 0 ? (
        <p className="text-xs text-[var(--color-biz-muted)]">
          Pending CFO config: {missing.join(", ")}.{" "}
          <Link href="/finance/config" className="text-[var(--color-biz-accent)] hover:underline">
            Open CFO Config
          </Link>
        </p>
      ) : null}

      <GlassPanel glow="amber" className="p-5">
        <SectionHeading title="Daily GMV / Cash Flow" hint="last 30 days" />
        {dash.isLoading ? (
          <div className="biz-skeleton h-16 w-full rounded" />
        ) : trendBars.length > 0 ? (
          <SparkBars data={trendBars} label={`${trendBars.length} days`} color="var(--color-biz-accent)" height={72} />
        ) : (
          <DataUnavailable title="No cash-flow trend" reason="Finance dashboard returned no daily trend for the period." />
        )}
      </GlassPanel>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassPanel className="p-5">
          <SectionHeading title="Liability Breakdown" hint={`total ${inr(totalLiability, true)}`} />
          <div className="space-y-3">
            {liabilities.map((l) => (
              <MeterBar key={l.label} label={`${l.label} — ${inr(l.value, true)}`} value={l.value} max={Math.max(totalLiability, 1)} suffix="" />
            ))}
          </div>
        </GlassPanel>

        <GlassPanel className="p-5">
          <SectionHeading title="Exposure & Pending" />
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Settlement Pending" value={inr(num(settlement?.amount), true)} icon={Landmark} />
            <StatTile label="Chargeback Exposure" value={inr(num(chargeback?.amount), true)} icon={CreditCard} tone="danger" />
            <StatTile label="Avg LTV" value={inr(num(u.avgLtv))} icon={Wallet} />
            <StatTile label="CAC" value={num(u.cac) > 0 ? inr(num(u.cac)) : "—"} icon={IndianRupee} />
          </div>
        </GlassPanel>
      </div>
    </div>
  );
}
