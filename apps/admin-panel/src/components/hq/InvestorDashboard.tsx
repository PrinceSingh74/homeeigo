"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, IndianRupee, Repeat, Target, Users, Wrench, Flame, Wallet } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { adminKeys, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { inr, formatNumber } from "@/lib/format";
import { GlassPanel } from "./GlassPanel";
import { StatTile, DataUnavailable, SectionHeading } from "./primitives";
import { IsoBarChart } from "./IsoBarChart";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

/** Phase 9 — Investor Dashboard. Real GMV/revenue/retention/LTV; burn/runway flagged. */
export function InvestorDashboard() {
  const dashboard = useAdminDashboardQuery();
  const finance = useQuery({
    queryKey: adminKeys.financeDashboard(30),
    queryFn: () => adminApi.financeDashboard(30),
    staleTime: 120_000,
  });
  const unit = useQuery({
    queryKey: adminKeys.financeUnit(30),
    queryFn: () => adminApi.financeUnitEconomics(30),
    staleTime: 120_000,
  });
  const membership = useQuery({
    queryKey: ["hq", "investor", "membership"],
    queryFn: () => adminApi.subscriptions.analytics(),
    staleTime: 120_000,
  });
  const intel = useQuery({
    queryKey: ["hq", "investor", "intelligence"],
    queryFn: () => adminApi.financeIntelligence(30),
    staleTime: 120_000,
  });

  const stats = dashboard.data?.stats;
  const fo = (finance.data?.overview ?? {}) as Record<string, unknown>;
  const u = (unit.data ?? {}) as Record<string, unknown>;
  const mem = (membership.data ?? {}) as Record<string, unknown>;

  const gmv = num(fo.gmv);
  const net = num(fo.netRevenue);
  const mrr = num(fo.mrr);
  const arr = num(fo.arr);
  const ltv = num(u.avgLtv);
  const cac = num(u.cac);
  const retention = num(mem.retentionRatePct);

  const revenueBars = useMemo(
    () => (dashboard.data?.charts.revenueByDay ?? []).map((d) => ({ label: d.date.slice(5), value: d.revenue })),
    [dashboard.data],
  );

  return (
    <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="GMV (30d)" value={inr(gmv, true)} icon={TrendingUp} loading={finance.isLoading} tone="accent" />
        <StatTile label="Net Revenue (30d)" value={inr(net, true)} icon={IndianRupee} loading={finance.isLoading} tone="success" />
        <StatTile label="MRR" value={inr(mrr, true)} icon={Repeat} loading={finance.isLoading} />
        <StatTile label="ARR" value={inr(arr, true)} icon={TrendingUp} loading={finance.isLoading} />
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Customers" value={formatNumber(stats?.totalUsers ?? 0)} icon={Users} loading={dashboard.isLoading} />
        <StatTile label="Partners" value={formatNumber(stats?.totalProviders ?? 0)} icon={Wrench} loading={dashboard.isLoading} />
        <StatTile label="Avg LTV" value={inr(ltv)} sub="unit economics" icon={IndianRupee} loading={unit.isLoading} />
        <StatTile
          label="LTV : CAC"
          value={cac > 0 ? `${(ltv / cac).toFixed(1)}x` : "—"}
          sub={cac > 0 ? (ltv / cac >= 3 ? "healthy" : "below 3x") : "CAC pending spend feed"}
          icon={Target}
          loading={unit.isLoading}
          tone={cac > 0 && ltv / cac >= 3 ? "success" : cac > 0 ? "danger" : "default"}
        />
      </section>

      <GlassPanel glow="emerald" className="p-6">
        <SectionHeading title="Revenue Trend" hint={`${revenueBars.length || "—"} days · retention ${retention.toFixed(0)}%`} />
        {dashboard.isLoading ? (
          <div className="biz-skeleton h-16 w-full rounded" />
        ) : revenueBars.length > 0 ? (
          <IsoBarChart
            data={revenueBars}
            format={(v) => inr(v, true)}
            accent="emerald"
            height={200}
            layout="area"
          />
        ) : (
          <DataUnavailable title="No revenue trend" reason="Dashboard returned no daily revenue series." />
        )}
      </GlassPanel>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Gross Margin"
          value={intel.data?.grossMargin.grossMarginPct != null ? `${intel.data.grossMargin.grossMarginPct.toFixed(1)}%` : "—"}
          icon={Target}
          loading={intel.isLoading}
          tone="success"
        />
        <StatTile
          label="EBITDA (30d)"
          value={intel.data?.ebitda.available && intel.data.ebitda.ebitda != null ? inr(intel.data.ebitda.ebitda, true) : "—"}
          sub={intel.data?.ebitda.available ? undefined : "CFO Config → opex"}
          icon={IndianRupee}
          loading={intel.isLoading}
        />
        <StatTile
          label="Monthly Burn"
          value={intel.data?.burnRate.available && intel.data.burnRate.monthlyBurn != null ? inr(intel.data.burnRate.monthlyBurn, true) : "—"}
          sub={intel.data?.burnRate.available ? (intel.data.burnRate.isProfitable ? "cash-flow positive" : "net outflow") : "CFO Config → opex"}
          icon={Flame}
          loading={intel.isLoading}
          tone={intel.data?.burnRate.available ? (intel.data.burnRate.isProfitable ? "success" : "danger") : "default"}
        />
        <StatTile
          label="Cash Runway"
          value={
            intel.data?.cashRunway.status === "profitable"
              ? "∞"
              : intel.data?.cashRunway.runwayMonths != null
                ? `${intel.data.cashRunway.runwayMonths.toFixed(1)} mo`
                : "—"
          }
          sub={intel.data?.cashRunway.status === "input_required" ? "CFO Config" : undefined}
          icon={Wallet}
          loading={intel.isLoading}
          tone={intel.data?.cashRunway.status === "profitable" ? "success" : "default"}
        />
      </section>

      {intel.data && intel.data.missingInputs.length > 0 ? (
        <p className="text-xs text-[var(--color-biz-muted)]">
          Burn, runway and EBITDA combine real ledger revenue/COGS with{" "}
          <Link href="/finance/config" className="text-[var(--color-biz-accent)] hover:underline">
            CFO Config
          </Link>
          . Pending:{" "}
          <span className="text-[var(--color-biz-text)]">{intel.data.missingInputs.join(", ")}</span>. Canonical GMV delta vs booking-based:{" "}
          {intel.data.canonicalGmv.reconciliation.deltaPct}%.
        </p>
      ) : null}
    </div>
  );
}
