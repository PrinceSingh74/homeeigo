"use client";

import { memo, useMemo } from "react";
import { AlertTriangle, TrendingUp, Zap, IndianRupee, Trophy, ShieldAlert, Brain } from "lucide-react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { SurgeZone, DemandForecast, FraudData, RevenueForecast, ZoneScoring } from "@/services/admin-api";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

function buildInsights(
  surge: SurgeZone[] | undefined,
  demand: DemandForecast | undefined,
  fraud: FraudData | undefined,
  rev: RevenueForecast | undefined,
  zones: ZoneScoring | undefined,
): string[] {
  const out: string[] = [];
  const topSurge = surge?.find((z) => (z.demandDeltaPct ?? 0) > 30 || z.predictedSurge >= 1.5);
  if (topSurge) {
    out.push(
      `${topSurge.name}: demand pressure ${topSurge.demandDeltaPct != null ? `+${topSurge.demandDeltaPct}%` : "high"} — surge ×${topSurge.predictedSurge} expected.`,
    );
  }
  const shortage = zones?.highRisk?.[0];
  if (shortage) {
    out.push(
      `Provider shortage likely in ${shortage.name} (risk ${shortage.riskScore}, supply ${shortage.supply}/${shortage.demand24h} demand).`,
    );
  }
  if (rev) {
    const trendDaily = rev.realized7d / 7;
    const delta = trendDaily > 0 ? Math.round(((rev.forecastDaily - trendDaily) / trendDaily) * 100) : 0;
    if (Math.abs(delta) >= 5) {
      out.push(
        `Revenue forecast ${delta >= 0 ? "exceeds" : "trails"} the weekly trend by ${Math.abs(delta)}% (₹${rev.forecastDaily.toLocaleString("en-IN")}/day).`,
      );
    }
  }
  if (fraud && fraud.suspiciousCount > 0) {
    out.push(
      `${fraud.suspiciousCount} fake-GPS event${fraud.suspiciousCount > 1 ? "s" : ""} flagged (risk ${fraud.riskScore}, peak ${Math.round(Math.max(...fraud.events.map((e) => e.implied_kmh)))} km/h).`,
    );
  }
  const best = zones?.bestEarning?.[0];
  if (best && best.revenue24h > 0) {
    out.push(`Top earning zone: ${best.name} (₹${best.revenue24h.toLocaleString("en-IN")} / 24h).`);
  }
  return out;
}

function Card({
  icon,
  title,
  accent,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-3.5 backdrop-blur-xl">
      <p className={`mb-2 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${accent}`}>
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}

const Row = ({ a, b }: { a: string; b: string }) => (
  <div className="flex items-center justify-between py-0.5 text-sm">
    <span className="truncate text-slate-300">{a}</span>
    <span className="ml-2 shrink-0 font-mono font-semibold text-[var(--color-biz-text)]">{b}</span>
  </div>
);

function AiIntelligencePanelInner({
  surge,
  demand,
  fraud,
  revenue,
  zones,
}: {
  surge?: SurgeZone[];
  demand?: DemandForecast;
  fraud?: FraudData;
  revenue?: RevenueForecast;
  zones?: ZoneScoring;
}) {
  useRenderProbe("AiIntelligencePanel");
  useMountProbe("AiIntelligencePanel");
  const insights = useMemo(
    () => buildInsights(surge, demand, fraud, revenue, zones),
    [surge, demand, fraud, revenue, zones],
  );

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <Card icon={<Brain size={13} />} title="AI Operations Insights" accent="text-sky-300">
        {insights.length ? (
          <ul className="space-y-1.5">
            {insights.map((t, i) => (
              <li key={i} className="flex gap-2 text-xs leading-snug text-slate-200">
                <span className="mt-0.5 text-sky-400">▹</span>
                {t}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-slate-500">No actionable signals right now.</p>
        )}
      </Card>

      <Card icon={<Zap size={13} />} title="Surge Intelligence" accent="text-red-300">
        {(surge ?? []).slice(0, 4).map((z) => (
          <Row
            key={z.zoneId}
            a={`${z.name} · ${z.supply} live`}
            b={`×${z.predictedSurge}${z.demandDeltaPct != null ? ` (+${z.demandDeltaPct}%)` : ""}`}
          />
        ))}
        {!surge?.length ? <p className="text-xs text-slate-500">No surge zones.</p> : null}
      </Card>

      <Card icon={<TrendingUp size={13} />} title="Demand Forecast" accent="text-amber-300">
        <Row a={`Next ${demand?.horizonHours ?? 24}h predicted`} b={String(demand?.totalPredicted ?? "—")} />
        {(zones?.ranked ?? []).slice(0, 3).map((z) => (
          <Row key={z.zoneId} a={z.name} b={`${z.demand24h} / 24h`} />
        ))}
      </Card>

      <Card icon={<IndianRupee size={13} />} title="Revenue Forecast" accent="text-emerald-300">
        {revenue ? (
          <>
            <Row a="Daily" b={inr(revenue.forecastDaily)} />
            <Row a="Weekly" b={inr(revenue.forecastWeekly)} />
            <Row a="Monthly" b={inr(revenue.forecastMonthly)} />
          </>
        ) : (
          <p className="text-xs text-slate-500">—</p>
        )}
      </Card>

      <Card icon={<Trophy size={13} />} title="Zone Intelligence" accent="text-violet-300">
        {(zones?.bestEarning ?? []).slice(0, 3).map((z) => (
          <Row key={z.zoneId} a={`🏆 ${z.name}`} b={inr(z.revenue24h)} />
        ))}
        {(zones?.highRisk ?? []).slice(0, 2).map((z) => (
          <Row key={z.zoneId} a={`⚠ ${z.name}`} b={`risk ${z.riskScore}`} />
        ))}
      </Card>

      <Card icon={<ShieldAlert size={13} />} title="Fraud Command" accent="text-red-300">
        <Row a="Suspicious events" b={String(fraud?.suspiciousCount ?? 0)} />
        <Row a="Risk score" b={String(fraud?.riskScore ?? 0)} />
        {(fraud?.events ?? []).slice(0, 2).map((e, i) => (
          <div key={i} className="flex items-center gap-1.5 py-0.5 text-[11px] text-red-300/90">
            <AlertTriangle size={11} /> {Math.round(e.implied_kmh)} km/h teleport · {e.jump_meters.toFixed(0)}m
          </div>
        ))}
      </Card>
    </div>
  );
}

export const AiIntelligencePanel = memo(AiIntelligencePanelInner);
