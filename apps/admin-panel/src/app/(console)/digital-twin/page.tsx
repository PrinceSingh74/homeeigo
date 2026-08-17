"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Activity,
  AlertTriangle,
  Brain,
  Car,
  CloudRain,
  ExternalLink,
  FlaskConical,
  Globe2,
  IndianRupee,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Timer,
  Users,
  Zap,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { GlassRing3D } from "@/components/hq/GlassRing3D";
import { adminApi, type TwinLayers, type TwinScenario, type TwinSimulation } from "@/services/admin-api";
import { formatNumber, formatPercent, inr } from "@/lib/format";
import { DIGITAL_TWIN_POLL_MS } from "@/lib/query-polling";
import { useMountProbe, useRenderProbe } from "@/lib/render-probe";
import { cn } from "@/lib/cn";

const PRESETS: Array<{ id: string; label: string; hint: string; scenario: TwinScenario }> = [
  { id: "clear", label: "All clear", hint: "Baseline, no shock", scenario: { demandDeltaPct: 0, providerDeltaPct: 0, trafficDeltaPct: 0, rainStart: false, festival: false } },
  { id: "rain", label: "Rain rush", hint: "Demand up, fleet thins", scenario: { demandDeltaPct: 40, providerDeltaPct: -10, trafficDeltaPct: 25, rainStart: true, festival: false } },
  { id: "fest", label: "Festival", hint: "Peak demand + traffic", scenario: { demandDeltaPct: 80, providerDeltaPct: 0, trafficDeltaPct: 15, rainStart: false, festival: true } },
  { id: "crash", label: "Supply crash", hint: "Partners drop out", scenario: { demandDeltaPct: 20, providerDeltaPct: -40, trafficDeltaPct: 10, rainStart: false, festival: false } },
  { id: "grid", label: "Gridlock", hint: "Roads seize up", scenario: { demandDeltaPct: 10, providerDeltaPct: 0, trafficDeltaPct: 80, rainStart: true, festival: false } },
];

function signed(n: number, suffix = "%") {
  const v = Number.isFinite(n) ? n : 0;
  return `${v > 0 ? "+" : ""}${v}${suffix}`;
}

function heatFor(n: number, invert = false): "good" | "warn" | "bad" {
  const v = invert ? -n : n;
  if (v >= 10) return "good";
  if (v <= -10) return "bad";
  return "warn";
}

function cityBrief(city: string, L: TwinLayers) {
  const shortage = L.supply.shortageRisk;
  const surge = L.pricing.predictedSurge;
  const rain = L.weather && (L.weather.floodRisk !== "low" || ["severe", "extreme", "moderate"].includes(L.weather.severity));
  if (L.fraud.events > 0) {
    return {
      state: "critical" as const,
      meaning: `${city} has GPS-fraud pressure on the twin. ${L.fraud.events} event${L.fraud.events === 1 ? "" : "s"} in the window.`,
      impact: `Risk score ${L.fraud.riskScore}. Dispatch and ETA labels from those partners should be treated as suspect.`,
      action: "Open Live Ops and Fraud, freeze the high-speed jumps, keep surge honest.",
    };
  }
  if (shortage >= 70 || L.supply.available === 0) {
    return {
      state: "critical" as const,
      meaning: `${city} is supply-constrained. ${L.supply.available} partners free of ${L.supply.online} online.`,
      impact: `Shortage risk ${shortage}. Surge ×${surge.toFixed(2)} · ETA +${L.eta.inflationPct}%. Extra demand will not convert.`,
      action: "Pull idle partners in, hold non-urgent slots, keep rain/festival surge on.",
    };
  }
  if (L.traffic.congestionIndex >= 66 || rain) {
    return {
      state: "watch" as const,
      meaning: `${city} is slowing. Traffic is ${L.traffic.level}${rain ? " and weather is off baseline" : ""}.`,
      impact: `Congestion ${L.traffic.congestionIndex} · ETA +${L.eta.inflationPct}% · weather impact ${L.weather?.weatherImpactScore ?? 0}.`,
      action: "Pad ETAs, avoid tight back-to-backs, watch Weather Center.",
    };
  }
  if (surge >= 1.4) {
    return {
      state: "watch" as const,
      meaning: `${city} is in a capture window. Predicted surge is ×${surge.toFixed(2)}.`,
      impact: `${inr(L.revenue.projectedDaily, true)} projected today vs ${inr(L.revenue.current24h, true)} last 24h.`,
      action: "Keep elite partners staged. Do not dump surge until available supply recovers.",
    };
  }
  return {
    state: "stable" as const,
    meaning: `${city} is operating near baseline. The twin is not the constraint.`,
    impact: `${L.supply.online} online · ${formatNumber(L.demand.current)} demand · surge ×${L.pricing.currentSurge.toFixed(2)}.`,
    action: "No twin action. Continue normal dispatch.",
  };
}

function simVerdict(sim: TwinSimulation) {
  const r = sim.impact.revenuePct;
  if (r < -8) return "This shock loses money — supply cannot fulfil the extra demand.";
  if (r > 8) return "This shock is a capture window if partners stay online.";
  return "Impact is contained. Watch ETA and the supply gap more than revenue.";
}

function LayerCard({
  icon: Icon,
  tone,
  title,
  value,
  sub,
  meter,
  meterTone,
  children,
}: {
  icon: typeof Activity;
  tone: Icon3DTone;
  title: string;
  value: string;
  sub: string;
  meter?: number;
  meterTone?: "success" | "warning" | "danger";
  children?: ReactNode;
}) {
  return (
    <article className={cn("dt-layer", `dt-layer--${tone}`)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">{title}</p>
          <p data-stat-value className="dt-layer__value">
            {value}
          </p>
          <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{sub}</p>
        </div>
        <Icon3D icon={Icon} size="sm" tone={tone} />
      </div>
      {meter != null ? (
        <div className={cn("biz-meter mt-3", meterTone === "warning" ? "biz-meter--warning" : meterTone === "danger" ? "biz-meter--danger" : "biz-meter--success")}>
          <span style={{ width: `${Math.max(6, Math.min(100, meter))}%` }} />
        </div>
      ) : null}
      {children ? <div className="dt-layer__meta">{children}</div> : null}
    </article>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11px] text-[var(--color-biz-muted)]">{label}</span>
      <span data-stat-value className="text-[11px] font-bold tabular-nums">
        {value}
      </span>
    </div>
  );
}

export default function DigitalTwinPage() {
  useRenderProbe("DigitalTwinPage");
  useMountProbe("DigitalTwinPage");
  const [city, setCity] = useState("Gurugram");
  const [scenario, setScenario] = useState<TwinScenario>(PRESETS[1]!.scenario);
  const [presetId, setPresetId] = useState("rain");

  const citiesQ = useQuery({
    queryKey: ["dt-cities"],
    queryFn: () => adminApi.digitalTwin.cities(),
    refetchInterval: DIGITAL_TWIN_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const bundleQ = useQuery({
    queryKey: ["dt-bundle", city],
    queryFn: async () => {
      const [twin, insights] = await Promise.all([adminApi.digitalTwin.city(city), adminApi.digitalTwin.insights(city)]);
      return { twin, insights };
    },
    staleTime: 30_000,
    refetchInterval: DIGITAL_TWIN_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const sim = useMutation({ mutationFn: () => adminApi.digitalTwin.simulate(city, scenario) });

  const L = bundleQ.data?.twin.data.layers;
  const twinMeta = bundleQ.data?.twin;
  const cities = citiesQ.data?.data.cities ?? [];
  const insights = bundleQ.data?.insights.data.insights ?? [];
  const simulation = sim.data?.data?.city === city ? sim.data.data : null;
  const brief = L ? cityBrief(city, L) : null;
  const confidence = Math.round((twinMeta?.confidence ?? 0) * 100);
  const generated = twinMeta?.freshness
    ? new Date(twinMeta.freshness).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  const demandSeries = useMemo(() => {
    if (!L) return [];
    return [
      { label: "Now", value: L.demand.current },
      { label: "1h", value: L.demand.forecast1h },
      { label: "6h", value: L.demand.forecast6h },
      { label: "24h", value: L.demand.forecast24h },
    ];
  }, [L]);

  const citySurgeSeries = useMemo(
    () =>
      [...cities]
        .sort((a, b) => b.surge - a.surge)
        .map((c) => ({ label: c.city.slice(0, 8), value: Number(c.surge.toFixed(2)) })),
    [cities],
  );

  const impactSeries = useMemo(() => {
    if (!simulation) return [];
    return [
      { label: "Revenue", value: Math.abs(simulation.impact.revenuePct) },
      { label: "ETA", value: Math.abs(simulation.impact.etaPct) },
      { label: "Gap", value: Math.abs(simulation.impact.supplyGapPct) },
      { label: "CX", value: Math.abs(simulation.impact.customerPct) },
    ];
  }, [simulation]);

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setScenario({ ...p.scenario });
  };

  const fulfilment = L && L.supply.online > 0 ? Math.round((L.supply.available / L.supply.online) * 100) : 0;
  const headerTone: Icon3DTone = brief?.state === "critical" ? "danger" : brief?.state === "watch" ? "warning" : "cyan";

  const refresh = () => {
    void citiesQ.refetch();
    void bundleQ.refetch();
  };

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      <header className="dt-masthead">
        <div className="flex min-w-0 items-start gap-4">
          <Icon3D icon={Globe2} tone={headerTone} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">City Twin</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                Live model
              </span>
              {generated ? <span className="ops-alert-pill is-good">as of {generated}</span> : null}
              {twinMeta ? <span className="ops-alert-pill is-warm">{confidence}% confidence</span> : null}
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Per-city digital twin — demand, supply, traffic, weather, pricing, and a what-if engine on live ops data.
            </p>
          </div>
        </div>
        <button type="button" onClick={refresh} className="biz-btn shrink-0">
          <RefreshCw size={14} className={bundleQ.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      <section className="flex flex-wrap gap-2">
        {cities.map((c) => (
          <button
            key={c.city}
            type="button"
            onClick={() => setCity(c.city)}
            className={cn("dt-city", city === c.city && "is-on")}
          >
            <span className="dt-city__tier">T{c.tier}</span>
            <span className="dt-city__name">{c.city}</span>
            <span className="dt-city__meta">×{c.surge.toFixed(2)}</span>
          </button>
        ))}
      </section>

      {bundleQ.isLoading || !L ? (
        <div className="flex items-center justify-center py-24 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Composing {city} twin…
        </div>
      ) : bundleQ.isError ? (
        <div className="biz-glass-panel border-[var(--color-biz-danger)]/30 p-6 text-[var(--color-biz-danger)]">
          City twin unavailable. Retry refresh.
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Model confidence"
              value={`${confidence}%`}
              sub={`${twinMeta?.source ?? "geo-intel + weather"}`}
              icon={Brain}
              tone={confidence >= 70 ? "success" : "accent"}
            />
            <StatTile
              label="Online supply"
              value={formatNumber(L.supply.online)}
              sub={`${L.supply.available} free · ${L.supply.busy} busy`}
              icon={Users}
              tone={L.supply.available > 0 ? "success" : "danger"}
            />
            <StatTile
              label="Shortage risk"
              value={`${L.supply.shortageRisk}`}
              sub={`${twinMeta?.data.zones ?? 0} zones in the twin`}
              icon={AlertTriangle}
              tone={L.supply.shortageRisk >= 70 ? "danger" : L.supply.shortageRisk >= 40 ? "accent" : "success"}
            />
            <StatTile
              label="Projected day"
              value={inr(L.revenue.projectedDaily, true)}
              sub={`${inr(L.revenue.current24h, true)} last 24h`}
              icon={IndianRupee}
              tone={L.revenue.projectedDaily > 0 ? "success" : "default"}
            />
          </section>

          {brief ? (
            <section className={cn("dt-hero", `dt-hero--${brief.state}`)}>
              <div className="wx-hero__grid">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Icon3D icon={brief.state === "critical" ? AlertTriangle : Globe2} size="md" tone={headerTone} />
                    <span className={cn("ops-alert-pill", brief.state === "critical" ? "is-hot" : brief.state === "watch" ? "is-warm" : "is-good")}>
                      {brief.state}
                    </span>
                    <span className="ops-alert-pill is-warm">×{L.pricing.currentSurge.toFixed(2)}</span>
                  </div>
                  <h2 className="mt-4 text-[1.55rem] font-bold leading-tight tracking-tight">{city}</h2>
                  <p className="mt-1.5 text-sm capitalize text-[var(--color-biz-muted)]">
                    {L.weather ? `${L.weather.description} · traffic ${L.traffic.level}` : `Traffic ${L.traffic.level}`}
                  </p>
                  <p data-stat-value className="dt-hero__metric">
                    +{L.eta.inflationPct}
                    <span>ETA</span>
                  </p>
                </div>
                <dl className="wx-stat-grid">
                  <div className="wx-stat">
                    <dt>Demand now</dt>
                    <dd>{formatNumber(L.demand.current)}</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Forecast 1h</dt>
                    <dd>{formatNumber(L.demand.forecast1h)}</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Congestion</dt>
                    <dd>{L.traffic.congestionIndex}</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Surge</dt>
                    <dd>×{L.pricing.predictedSurge.toFixed(2)}</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Fraud</dt>
                    <dd>{formatNumber(L.fraud.events)}</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Density</dt>
                    <dd>{L.supply.density}/km²</dd>
                  </div>
                </dl>
                <div className="wx-brief">
                  <article>
                    <h3>Meaning</h3>
                    <p>{brief.meaning}</p>
                  </article>
                  <article>
                    <h3>Impact</h3>
                    <p>{brief.impact}</p>
                  </article>
                  <article>
                    <h3>Action</h3>
                    <p>{brief.action}</p>
                  </article>
                  <div className="flex flex-wrap gap-x-4 gap-y-2 px-1 pt-1">
                    <Link href="/weather" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                      Weather Center <ExternalLink size={11} />
                    </Link>
                    <Link href="/operations" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                      Live Ops <ExternalLink size={11} />
                    </Link>
                    <Link href="/command-center" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                      Command Center <ExternalLink size={11} />
                    </Link>
                  </div>
                </div>
              </div>
            </section>
          ) : null}

          <section className="grid gap-4 lg:grid-cols-3">
            <div className="biz-glass-panel p-6">
              <SectionHead icon={AlertTriangle} tone={L.supply.shortageRisk >= 70 ? "danger" : "warning"} title="Shortage" subtitle="Will this city run dry" />
              <GlassRing3D
                value={L.supply.shortageRisk}
                label="Risk"
                sub={`${L.supply.available} partners free`}
                tone={L.supply.shortageRisk >= 70 ? "danger" : L.supply.shortageRisk >= 40 ? "warning" : "success"}
              />
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead icon={Car} tone={L.traffic.congestionIndex >= 66 ? "danger" : "warning"} title="Congestion" subtitle="Ops traffic proxy" />
              <GlassRing3D
                value={L.traffic.congestionIndex}
                label={L.traffic.level}
                sub={`ETA +${L.eta.inflationPct}%`}
                tone={L.traffic.congestionIndex >= 66 ? "danger" : L.traffic.congestionIndex >= 33 ? "warning" : "success"}
              />
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead icon={Users} tone={fulfilment >= 30 ? "success" : "danger"} title="Spare fleet" subtitle="Available vs online" />
              <GlassRing3D
                value={fulfilment}
                label="Free"
                sub={`${L.supply.busy} currently busy`}
                tone={fulfilment >= 30 ? "success" : fulfilment >= 10 ? "warning" : "danger"}
              />
            </div>
          </section>

          <section className="dt-board">
            <LayerCard
              icon={Activity}
              tone="warning"
              title="Demand"
              value={formatNumber(L.demand.current)}
              sub="Now in this city"
              meter={Math.min(100, L.demand.forecast24h)}
              meterTone="warning"
            >
              <Mini label="1h" value={formatNumber(L.demand.forecast1h)} />
              <Mini label="6h" value={formatNumber(L.demand.forecast6h)} />
              <Mini label="24h" value={formatNumber(L.demand.forecast24h)} />
            </LayerCard>
            <LayerCard
              icon={Users}
              tone={L.supply.available > 0 ? "success" : "danger"}
              title="Supply"
              value={formatNumber(L.supply.online)}
              sub="Online providers"
              meter={100 - L.supply.shortageRisk}
              meterTone={L.supply.shortageRisk >= 70 ? "danger" : "success"}
            >
              <Mini label="Busy" value={formatNumber(L.supply.busy)} />
              <Mini label="Available" value={formatNumber(L.supply.available)} />
              <Mini label="Shortage" value={String(L.supply.shortageRisk)} />
            </LayerCard>
            <LayerCard
              icon={Car}
              tone={L.traffic.congestionIndex >= 66 ? "danger" : "warning"}
              title="Traffic"
              value={L.traffic.level}
              sub={`Congestion ${L.traffic.congestionIndex}`}
              meter={L.traffic.congestionIndex}
              meterTone={L.traffic.congestionIndex >= 66 ? "danger" : "warning"}
            >
              <Mini label="ETA inflation" value={`+${L.eta.inflationPct}%`} />
            </LayerCard>
            <LayerCard
              icon={CloudRain}
              tone={L.weather && L.weather.floodRisk !== "low" ? "warning" : "cyan"}
              title="Weather"
              value={L.weather?.condition ?? "—"}
              sub={L.weather?.description ?? "No live weather"}
              meter={L.weather?.weatherImpactScore ?? 0}
              meterTone={(L.weather?.weatherImpactScore ?? 0) >= 50 ? "warning" : "success"}
            >
              <Mini label="Impact" value={String(L.weather?.weatherImpactScore ?? 0)} />
              <Mini label="Flood" value={L.weather?.floodRisk ?? "—"} />
              <Mini label="Rain 1h" value={`${L.weather?.rain1hMm ?? 0} mm`} />
            </LayerCard>
            <LayerCard
              icon={IndianRupee}
              tone="success"
              title="Revenue"
              value={inr(L.revenue.current24h, true)}
              sub="Last 24 hours"
              meter={L.revenue.projectedDaily > 0 ? Math.min(100, (L.revenue.current24h / L.revenue.projectedDaily) * 100) : 0}
              meterTone="success"
            >
              <Mini label="Proj / day" value={inr(L.revenue.projectedDaily, true)} />
              <Mini label="Proj / month" value={inr(L.revenue.projectedMonthly, true)} />
            </LayerCard>
            <LayerCard
              icon={Zap}
              tone={L.pricing.predictedSurge >= 1.5 ? "danger" : "warning"}
              title="Pricing"
              value={`×${L.pricing.currentSurge.toFixed(2)}`}
              sub="Current surge"
              meter={Math.min(100, ((L.pricing.predictedSurge - 1) / 2) * 100)}
              meterTone={L.pricing.predictedSurge >= 1.5 ? "danger" : "warning"}
            >
              <Mini label="Predicted" value={`×${L.pricing.predictedSurge.toFixed(2)}`} />
              <Mini label="Confidence" value={formatPercent(L.pricing.confidence, 0)} />
            </LayerCard>
            <LayerCard
              icon={Timer}
              tone="cyan"
              title="ETA"
              value={`+${L.eta.inflationPct}%`}
              sub="Travel-time inflation"
              meter={Math.min(100, L.eta.inflationPct)}
              meterTone={L.eta.inflationPct >= 30 ? "warning" : "success"}
            >
              {(L.eta.slowZones.length ? L.eta.slowZones : ["No slow zones"]).slice(0, 3).map((z) => (
                <Mini key={z} label="Slow" value={z} />
              ))}
            </LayerCard>
            <LayerCard
              icon={ShieldAlert}
              tone={L.fraud.events > 0 ? "danger" : "success"}
              title="Fraud"
              value={formatNumber(L.fraud.events)}
              sub="GPS-fraud events"
              meter={L.fraud.riskScore}
              meterTone={L.fraud.events > 0 ? "danger" : "success"}
            >
              <Mini label="Risk score" value={String(L.fraud.riskScore)} />
              <Mini label="Pins" value={String(L.fraud.pins.length)} />
            </LayerCard>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="biz-glass-panel min-w-0 p-6">
              <SectionHead icon={Activity} tone="warning" title="Demand horizon" subtitle="Now vs 1h / 6h / 24h forecast" meta={city} />
              {demandSeries.some((d) => d.value > 0) ? (
                <IsoBarChart data={demandSeries} format={formatNumber} accent="amber" layout="area" height={240} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">Quiet city — forecast will populate as bookings land.</p>
              )}
            </div>
            <div className="biz-glass-panel min-w-0 p-6">
              <SectionHead icon={Zap} tone="cyan" title="Surge by city" subtitle="Live twin across the network" meta="7 cities" />
              {citySurgeSeries.length ? (
                <IsoBarChart data={citySurgeSeries} format={(v) => `×${v.toFixed(2)}`} accent="blue" layout="bar" height={240} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">City summaries still loading.</p>
              )}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="biz-glass-panel flex min-h-0 flex-col p-6">
              <SectionHead icon={Brain} tone="cyan" title="Executive intelligence" subtitle="Twin-authored, with confidence" meta={`${insights.length}`} />
              <div className="space-y-2">
                {insights.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--color-biz-line)] px-4 py-8 text-center text-sm text-[var(--color-biz-muted)]">
                    No actionable twin signals in {city}.
                  </p>
                ) : (
                  insights.map((item, i) => (
                    <article
                      key={`${item.severity}-${i}`}
                      className={cn("ops-alert", item.severity === "critical" ? "ops-alert--critical" : item.severity === "warning" ? "ops-alert--warning" : "")}
                    >
                      <Icon3D
                        icon={item.severity === "critical" ? ShieldAlert : item.severity === "warning" ? AlertTriangle : Brain}
                        size="sm"
                        tone={item.severity === "critical" ? "danger" : item.severity === "warning" ? "warning" : "cyan"}
                      />
                      <div className="min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[11px] font-bold uppercase tracking-[0.12em]">{item.severity}</p>
                          <span className={cn("ops-alert-pill", item.severity === "critical" ? "is-hot" : item.severity === "warning" ? "is-warm" : "is-good")}>
                            {Math.round(item.confidence * 100)}%
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-relaxed">{item.text}</p>
                      </div>
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="biz-glass-panel p-6">
              <SectionHead icon={FlaskConical} tone="warning" title="Scenario engine" subtitle="Shock the live twin — supply-capped revenue" meta="What if" />
              <div className="mb-4 flex flex-wrap gap-1.5">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" onClick={() => applyPreset(p.id)} className={cn("dt-chip", presetId === p.id && "is-on")} title={p.hint}>
                    {p.label}
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Slider
                  label="Demand"
                  value={scenario.demandDeltaPct ?? 0}
                  onChange={(v) => {
                    setPresetId("custom");
                    setScenario((s) => ({ ...s, demandDeltaPct: v }));
                  }}
                />
                <Slider
                  label="Providers"
                  value={scenario.providerDeltaPct ?? 0}
                  onChange={(v) => {
                    setPresetId("custom");
                    setScenario((s) => ({ ...s, providerDeltaPct: v }));
                  }}
                />
                <Slider
                  label="Traffic"
                  value={scenario.trafficDeltaPct ?? 0}
                  onChange={(v) => {
                    setPresetId("custom");
                    setScenario((s) => ({ ...s, trafficDeltaPct: v }));
                  }}
                />
                <div className="flex items-end gap-4 pb-1">
                  <label className="dt-check">
                    <input
                      type="checkbox"
                      checked={!!scenario.rainStart}
                      onChange={(e) => {
                        setPresetId("custom");
                        setScenario((s) => ({ ...s, rainStart: e.target.checked }));
                      }}
                    />
                    Rain
                  </label>
                  <label className="dt-check">
                    <input
                      type="checkbox"
                      checked={!!scenario.festival}
                      onChange={(e) => {
                        setPresetId("custom");
                        setScenario((s) => ({ ...s, festival: e.target.checked }));
                      }}
                    />
                    Festival
                  </label>
                </div>
              </div>
              <button type="button" onClick={() => sim.mutate()} disabled={sim.isPending} className="biz-btn biz-btn-primary mt-4 w-full justify-center [&_svg]:text-white">
                {sim.isPending ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
                {sim.isPending ? "Simulating…" : "Simulate impact"}
              </button>

              {simulation ? (
                <div className="mt-5 border-t border-[var(--color-biz-line)] pt-4">
                  <p className="text-sm leading-relaxed text-[var(--color-biz-muted)]">{simVerdict(simulation)}</p>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Impact label="Revenue" value={signed(simulation.impact.revenuePct)} heat={heatFor(simulation.impact.revenuePct)} />
                    <Impact label="ETA" value={signed(simulation.impact.etaPct)} heat={heatFor(simulation.impact.etaPct, true)} />
                    <Impact label="Supply gap" value={signed(simulation.impact.supplyGapPct)} heat={heatFor(simulation.impact.supplyGapPct, true)} />
                    <Impact label="Surge" value={signed(simulation.impact.surgeShift, "×")} heat={heatFor(simulation.impact.surgeShift * 50, true)} />
                  </div>
                  <p className="mt-3 text-[11px] text-[var(--color-biz-muted)]">
                    Baseline {formatNumber(simulation.baseline.demand)} demand · {formatNumber(simulation.baseline.supply)} supply · ×{simulation.baseline.surge.toFixed(2)}
                    {" → "}
                    {formatNumber(simulation.projected.demand)} · {formatNumber(simulation.projected.supply)} · ×{simulation.projected.surge.toFixed(2)}
                  </p>
                  {impactSeries.some((d) => d.value > 0) ? (
                    <div className="mt-3">
                      <IsoBarChart data={impactSeries} format={(v) => `${v}`} accent="amber" layout="column" height={160} />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[11px]">
        <span className="font-bold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">{label}</span>
        <span className="font-bold tabular-nums">{signed(value)}</span>
      </div>
      <input type="range" min={-50} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="dt-range" />
    </div>
  );
}

function Impact({ label, value, heat }: { label: string; value: string; heat: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2.5">
      <p
        data-stat-value
        className={cn(
          "text-sm font-bold tabular-nums",
          heat === "good" && "text-[var(--color-biz-success)]",
          heat === "warn" && "text-[var(--color-biz-warning)]",
          heat === "bad" && "text-[var(--color-biz-danger)]",
        )}
      >
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--color-biz-muted)]">{label}</p>
    </div>
  );
}
