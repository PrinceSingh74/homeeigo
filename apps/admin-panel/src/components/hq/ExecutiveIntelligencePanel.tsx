"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Percent,
  TrendingUp,
  Timer,
  CheckCircle2,
  Activity,
  Gauge,
  Landmark,
  Flame,
  Wallet,
  LineChart,
  Smile,
  Star,
  MessageSquareWarning,
} from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { inr } from "@/lib/format";
import { GlassPanel } from "./GlassPanel";
import { StatTile, SectionHeading } from "./primitives";

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

const NEEDS_OPEX = "Configure in Finance HQ → CFO Config";
const NEEDS_CASH = "Set cash on hand in CFO Config";

/** Phase 1 — real-data executive intelligence (finance margins, forecast, SLA, ops). */
export function ExecutiveIntelligencePanel() {
  const intel = useQuery({
    queryKey: ["hq", "exec", "finance-intelligence"],
    queryFn: () => adminApi.financeIntelligence(30),
    staleTime: 120_000,
  });
  const kpis = useQuery({
    queryKey: ["hq", "exec", "exec-kpis"],
    queryFn: () => adminApi.geoIntel.execKpis(),
    staleTime: 60_000,
  });
  const revForecast = useQuery({
    queryKey: ["hq", "exec", "revenue-forecast"],
    queryFn: () => adminApi.geoIntel.revenueForecast(),
    staleTime: 120_000,
  });
  const support = useQuery({
    queryKey: ["hq", "exec", "support"],
    queryFn: () => adminApi.support.analytics(),
    staleTime: 120_000,
  });
  const cx = useQuery({
    queryKey: ["hq", "exec", "cx-intelligence"],
    queryFn: () => adminApi.cxIntelligence(30),
    staleTime: 120_000,
  });

  const fi = intel.data;
  const cxData = cx.data;
  const k = kpis.data?.data;
  const rf = revForecast.data?.data;
  const sup = (support.data ?? {}) as Record<string, unknown>;

  const grossMargin = fi?.grossMargin.grossMarginPct;
  const completion = k ? num(k.completionRate) * (num(k.completionRate) <= 1 ? 100 : 1) : 0;

  const slaBreached = num(sup.slaBreached);
  const totalTickets = num(sup.total ?? sup.totalTickets ?? sup.open);
  const slaCompliance = totalTickets > 0 ? Math.max(0, 100 - (slaBreached / totalTickets) * 100) : null;

  return (
    <div className="space-y-4">
      <div>
        <SectionHeading title="Financial Intelligence" hint="real ledger data" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Gross Margin"
            value={grossMargin != null ? `${grossMargin.toFixed(1)}%` : "—"}
            sub={fi ? `Gross profit ${inr(fi.grossMargin.grossProfit, true)}` : undefined}
            icon={Percent}
            loading={intel.isLoading}
            tone="success"
          />
          <StatTile
            label="Net Revenue (30d)"
            value={fi ? inr(fi.revenue.netRevenue, true) : "—"}
            sub={fi ? `Commission + subscriptions` : undefined}
            icon={Percent}
            loading={intel.isLoading}
          />
          <StatTile
            label="Revenue Forecast / mo"
            value={rf ? inr(rf.forecastMonthly, true) : "—"}
            sub={rf ? `${inr(rf.forecastDaily, true)}/day` : undefined}
            icon={TrendingUp}
            loading={revForecast.isLoading}
            tone="accent"
          />
          <StatTile
            label="Contribution Forecast / mo"
            value={fi ? inr(fi.forecast.contributionForecastMonthly, true) : "—"}
            sub="net revenue − COGS"
            icon={LineChart}
            loading={intel.isLoading}
          />
        </div>
      </div>

      <div>
        <SectionHeading title="Profitability & Runway" hint="real data + finance config" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="EBITDA (30d)"
            value={fi?.ebitda.available && fi.ebitda.ebitda != null ? inr(fi.ebitda.ebitda, true) : "—"}
            sub={
              fi?.ebitda.available
                ? fi.ebitda.ebitdaMarginPct != null
                  ? `${fi.ebitda.ebitdaMarginPct.toFixed(1)}% margin`
                  : undefined
                : NEEDS_OPEX
            }
            icon={Landmark}
            loading={intel.isLoading}
            tone={fi?.ebitda.available && (fi.ebitda.ebitda ?? 0) >= 0 ? "success" : "default"}
          />
          <StatTile
            label="Monthly Burn"
            value={fi?.burnRate.available && fi.burnRate.monthlyBurn != null ? inr(fi.burnRate.monthlyBurn, true) : "—"}
            sub={
              fi?.burnRate.available
                ? fi.burnRate.isProfitable
                  ? "cash-flow positive"
                  : "net cash outflow"
                : NEEDS_OPEX
            }
            icon={Flame}
            loading={intel.isLoading}
            tone={fi?.burnRate.available ? (fi.burnRate.isProfitable ? "success" : "danger") : "default"}
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
            sub={fi?.cashRunway.status === "input_required" ? `${NEEDS_OPEX} + ${NEEDS_CASH}` : fi?.cashRunway.status === "profitable" ? "profitable" : undefined}
            icon={Wallet}
            loading={intel.isLoading}
            tone={fi?.cashRunway.status === "profitable" ? "success" : "default"}
          />
          <StatTile
            label="Profit Forecast / mo"
            value={fi?.forecast.profitForecastMonthly != null ? inr(fi.forecast.profitForecastMonthly, true) : "—"}
            sub={fi?.forecast.profitForecastMonthly == null ? NEEDS_OPEX : "monthly run-rate"}
            icon={TrendingUp}
            loading={intel.isLoading}
            tone={fi?.forecast.profitForecastMonthly != null && fi.forecast.profitForecastMonthly >= 0 ? "success" : "default"}
          />
        </div>
      </div>

      <div>
        <SectionHeading title="Operational Intelligence" hint="live" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Booking Success Rate" value={k ? `${completion.toFixed(0)}%` : "—"} sub="completed / attempted" icon={CheckCircle2} loading={kpis.isLoading} tone="success" />
          <StatTile label="Cancellation Rate" value={k ? `${(num(k.cancellationRate) * (num(k.cancellationRate) <= 1 ? 100 : 1)).toFixed(1)}%` : "—"} icon={Activity} loading={kpis.isLoading} />
          <StatTile
            label="Support SLA Compliance"
            value={slaCompliance != null ? `${slaCompliance.toFixed(0)}%` : "—"}
            sub={support.data ? `${slaBreached} breaches` : undefined}
            icon={Timer}
            loading={support.isLoading}
            tone={slaCompliance != null && slaCompliance >= 90 ? "success" : "danger"}
          />
          <StatTile label="Online Partners" value={k ? String(num(k.onlineProviders)) : "—"} icon={Gauge} loading={kpis.isLoading} />
        </div>
      </div>

      <div>
        <SectionHeading title="Customer Intelligence" hint={cxData?.nps.source === "survey" ? "survey data" : cxData?.nps.source === "transactional_rating" ? "rating proxy" : "live"} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatTile
            label="NPS"
            value={cxData?.nps.score != null ? String(cxData.nps.score) : "—"}
            sub={cxData ? `${cxData.nps.source} · n=${cxData.nps.sampleSize}` : undefined}
            icon={Smile}
            loading={cx.isLoading}
            tone={cxData?.nps.score != null && cxData.nps.score >= 0 ? "success" : "default"}
          />
          <StatTile
            label="CSAT"
            value={cxData?.csat.scorePct != null ? `${cxData.csat.scorePct.toFixed(0)}%` : "—"}
            sub={cxData ? `${cxData.csat.source} · n=${cxData.csat.sampleSize}` : undefined}
            icon={Star}
            loading={cx.isLoading}
            tone={cxData?.csat.scorePct != null && cxData.csat.scorePct >= 80 ? "success" : "default"}
          />
          <StatTile
            label="Happiness Score"
            value={cxData?.customerHappinessScore != null ? cxData.customerHappinessScore.toFixed(0) : "—"}
            sub="composite"
            icon={Smile}
            loading={cx.isLoading}
          />
          <StatTile
            label="Service Satisfaction"
            value={cxData?.serviceSatisfactionIndex != null ? `${cxData.serviceSatisfactionIndex.toFixed(0)}` : "—"}
            sub="SSI (rating-based)"
            icon={Star}
            loading={cx.isLoading}
          />
          <StatTile
            label="Complaints (30d)"
            value={cxData ? String(cxData.complaintTrend.reduce((s, d) => s + d.count, 0)) : "—"}
            sub={cxData?.complaintTrend.length ? `${cxData.complaintTrend.length} active days` : "no complaint tickets"}
            icon={MessageSquareWarning}
            loading={cx.isLoading}
            tone={cxData && cxData.complaintTrend.reduce((s, d) => s + d.count, 0) > 0 ? "danger" : "success"}
          />
        </div>
      </div>

      {fi && fi.missingInputs.length > 0 ? (
        <GlassPanel className="p-4">
          <p className="text-xs text-[var(--color-biz-muted)]">
            EBITDA, burn and runway use real revenue/COGS from the ledger plus finance-config inputs.
            Pending env inputs: <span className="text-[var(--color-biz-text)]">{fi.missingInputs.join(", ")}</span>.
            Gateway fee rate: {fi.assumptions.gatewayFeePct}% ({fi.assumptions.sources.gatewayFeePct}).
          </p>
        </GlassPanel>
      ) : null}
    </div>
  );
}
