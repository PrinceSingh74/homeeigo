"use client";

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Activity, Users, Car, CloudRain, IndianRupee, Timer, Zap, ShieldAlert, Brain, FlaskConical, Loader2 } from "lucide-react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { DIGITAL_TWIN_POLL_MS } from "@/lib/query-polling";
import { adminApi, type TwinScenario } from "@/services/admin-api";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const sevColor = (s: string) => (s === "critical" ? "text-red-400 border-red-500/30" : s === "warning" ? "text-amber-400 border-amber-500/30" : "text-sky-400 border-sky-500/30");
const lvlColor = (n: number) => (n > 66 ? "text-red-400" : n > 33 ? "text-amber-400" : "text-emerald-400");

export default function DigitalTwinPage() {
  useRenderProbe("DigitalTwinPage");
  useMountProbe("DigitalTwinPage");
  const [city, setCity] = useState("Gurugram");
  const [scenario, setScenario] = useState<TwinScenario>({ demandDeltaPct: 60, providerDeltaPct: -20, rainStart: true });

  const citiesQ = useQuery({
    queryKey: ["dt-cities"],
    queryFn: () => adminApi.digitalTwin.cities(),
    refetchInterval: DIGITAL_TWIN_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const bundleQ = useQuery({
    queryKey: ["dt-bundle", city],
    queryFn: async () => {
      const [twin, insights] = await Promise.all([
        adminApi.digitalTwin.city(city),
        adminApi.digitalTwin.insights(city),
      ]);
      return { twin, insights };
    },
    staleTime: 30_000,
    refetchInterval: DIGITAL_TWIN_POLL_MS,
    refetchIntervalInBackground: false,
  });
  const sim = useMutation({ mutationFn: () => adminApi.digitalTwin.simulate(city, scenario) });

  const L = bundleQ.data?.twin.data.layers;
  const cities = citiesQ.data?.data.cities ?? [];
  const insights = bundleQ.data?.insights.data.insights ?? [];

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-zinc-100"><Activity size={20} className="text-sky-400" /> City Digital Twin</h1>
          <p className="text-xs text-zinc-500">{bundleQ.data?.twin ? `Live · ${new Date(bundleQ.data.twin.freshness).toLocaleTimeString()} · ${Math.round(bundleQ.data.twin.confidence * 100)}% confidence` : "Live city simulation"}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cities.map((c) => (
            <button key={c.city} onClick={() => setCity(c.city)} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${city === c.city ? "bg-sky-500 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"}`}>
              <span className="opacity-60">T{c.tier}</span> {c.city}
            </button>
          ))}
        </div>
      </header>

      {!L ? (
        <div className="flex items-center gap-2 rounded-2xl border border-zinc-800 p-8 text-sm text-zinc-500"><Loader2 size={16} className="animate-spin" /> Composing {city} twin…</div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Layer icon={<Activity size={14} />} title="Demand" accent="text-amber-400">
              <Big v={String(L.demand.current)} sub="now (24h zone)" />
              <Mini a="1h" b={String(L.demand.forecast1h)} /><Mini a="6h" b={String(L.demand.forecast6h)} /><Mini a="24h" b={String(L.demand.forecast24h)} />
            </Layer>
            <Layer icon={<Users size={14} />} title="Supply" accent="text-emerald-400">
              <Big v={String(L.supply.online)} sub="online providers" />
              <Mini a="Busy" b={String(L.supply.busy)} /><Mini a="Available" b={String(L.supply.available)} /><Mini a="Shortage risk" b={`${L.supply.shortageRisk}`} />
            </Layer>
            <Layer icon={<Car size={14} />} title="Traffic" accent="text-orange-400">
              <Big v={<span className={lvlColor(L.traffic.congestionIndex)}>{L.traffic.level}</span>} sub={`congestion ${L.traffic.congestionIndex}`} />
              <Mini a="ETA inflation" b={`${L.eta.inflationPct}%`} />
            </Layer>
            <Layer icon={<CloudRain size={14} />} title="Weather" accent="text-cyan-400">
              {L.weather ? (<><Big v={L.weather.condition} sub={L.weather.description} /><Mini a="Impact" b={String(L.weather.weatherImpactScore)} /><Mini a="Flood risk" b={L.weather.floodRisk} /></>) : <p className="text-xs text-zinc-500">n/a</p>}
            </Layer>
            <Layer icon={<IndianRupee size={14} />} title="Revenue" accent="text-green-400">
              <Big v={inr(L.revenue.current24h)} sub="last 24h" />
              <Mini a="Proj/day" b={inr(L.revenue.projectedDaily)} /><Mini a="Proj/mo" b={inr(L.revenue.projectedMonthly)} />
            </Layer>
            <Layer icon={<Zap size={14} />} title="Pricing" accent="text-red-400">
              <Big v={`×${L.pricing.currentSurge}`} sub="current surge" />
              <Mini a="Predicted" b={`×${L.pricing.predictedSurge}`} /><Mini a="Confidence" b={`${Math.round(L.pricing.confidence * 100)}%`} />
            </Layer>
            <Layer icon={<Timer size={14} />} title="ETA" accent="text-violet-400">
              <Big v={`+${L.eta.inflationPct}%`} sub="travel-time inflation" />
              {L.eta.slowZones.slice(0, 2).map((z) => <Mini key={z} a="Slow" b={z} />)}
            </Layer>
            <Layer icon={<ShieldAlert size={14} />} title="Fraud" accent="text-red-400">
              <Big v={String(L.fraud.events)} sub="GPS-fraud events" />
              <Mini a="Risk score" b={String(L.fraud.riskScore)} />
            </Layer>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-sky-300"><Brain size={13} /> Executive Intelligence</p>
              {insights.length ? (
                <ul className="space-y-2">
                  {insights.map((i, k) => (
                    <li key={k} className={`rounded-lg border bg-zinc-900/60 px-3 py-2 text-xs leading-snug ${sevColor(i.severity)}`}>
                      <span className="font-semibold uppercase opacity-70">{i.severity}</span> · {Math.round(i.confidence * 100)}%<br /><span className="text-zinc-200">{i.text}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-xs text-zinc-500">No actionable signals.</p>}
            </div>

            <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-4">
              <p className="mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-fuchsia-300"><FlaskConical size={13} /> Scenario Engine — “what if”</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <Slider label="Demand Δ%" value={scenario.demandDeltaPct ?? 0} onChange={(v) => setScenario((s) => ({ ...s, demandDeltaPct: v }))} />
                <Slider label="Providers Δ%" value={scenario.providerDeltaPct ?? 0} onChange={(v) => setScenario((s) => ({ ...s, providerDeltaPct: v }))} />
                <Slider label="Traffic Δ%" value={scenario.trafficDeltaPct ?? 0} onChange={(v) => setScenario((s) => ({ ...s, trafficDeltaPct: v }))} />
                <div className="flex items-end gap-3 pb-1">
                  <label className="flex items-center gap-1.5 text-zinc-300"><input type="checkbox" checked={!!scenario.rainStart} onChange={(e) => setScenario((s) => ({ ...s, rainStart: e.target.checked }))} /> Rain</label>
                  <label className="flex items-center gap-1.5 text-zinc-300"><input type="checkbox" checked={!!scenario.festival} onChange={(e) => setScenario((s) => ({ ...s, festival: e.target.checked }))} /> Festival</label>
                </div>
              </div>
              <button onClick={() => sim.mutate()} disabled={sim.isPending} className="mt-3 flex items-center gap-1.5 rounded-lg bg-fuchsia-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-fuchsia-500 disabled:opacity-50">
                {sim.isPending ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />} Simulate impact
              </button>
              {sim.data ? (
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-800 pt-3 text-center sm:grid-cols-4">
                  <Impact label="Revenue" v={sim.data.data.impact.revenuePct} />
                  <Impact label="ETA" v={sim.data.data.impact.etaPct} invert />
                  <Impact label="Supply gap" v={sim.data.data.impact.supplyGapPct} invert />
                  <Impact label="Surge" v={Math.round(sim.data.data.impact.surgeShift * 100)} suffix="×" />
                </div>
              ) : null}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Layer({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/40 p-3.5">
      <p className={`mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide ${accent}`}>{icon}{title}</p>
      {children}
    </div>
  );
}
const Big = ({ v, sub }: { v: React.ReactNode; sub: string }) => (<div className="mb-1"><p className="text-xl font-bold text-zinc-100">{v}</p><p className="text-[10px] text-zinc-500">{sub}</p></div>);
const Mini = ({ a, b }: { a: string; b: string }) => (<div className="flex items-center justify-between text-[11px]"><span className="text-zinc-500">{a}</span><span className="truncate font-mono text-zinc-300">{b}</span></div>);
function Slider({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div>
      <div className="flex justify-between text-[11px] text-zinc-400"><span>{label}</span><span className="font-mono text-zinc-200">{value > 0 ? "+" : ""}{value}%</span></div>
      <input type="range" min={-50} max={100} step={5} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-fuchsia-500" />
    </div>
  );
}
function Impact({ label, v, invert, suffix }: { label: string; v: number; invert?: boolean; suffix?: string }) {
  const good = invert ? v <= 0 : v >= 0;
  return (
    <div className="rounded-lg bg-zinc-800/40 p-2">
      <p className={`font-mono text-sm font-bold ${good ? "text-emerald-400" : "text-red-400"}`}>{v > 0 ? "+" : ""}{v}{suffix ?? "%"}</p>
      <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
    </div>
  );
}
