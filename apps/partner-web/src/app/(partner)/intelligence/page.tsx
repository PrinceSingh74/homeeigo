"use client";

import { useMemo } from "react";
import { Brain, Zap, Trophy, TrendingUp, Navigation, IndianRupee, Gauge, Power, CloudRain } from "lucide-react";
import { useGeolocationWatcher } from "@/hooks/use-geolocation-watcher";
import { usePartnerIntelligence, type SmartZone } from "@/hooks/use-partner-intelligence";
import { usePartnerDashboardQuery } from "@/hooks/use-partner-data";

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const range = (lo: number, hi: number) => `${inr(lo)}–${inr(hi)}`;

/** Smart-availability recommendation derived from real demand/online state. */
function availability(isOnline: boolean, best: SmartZone | undefined, current: SmartZone | undefined): { action: string; reason: string; tone: string } {
  const demandHot = best && best.predictedSurge >= 1.3;
  if (!isOnline && demandHot) return { action: "Go Online", reason: `${best!.name} is surging ×${best!.predictedSurge} — strong earning window.`, tone: "text-emerald-400" };
  if (!isOnline) return { action: "Go Online", reason: "You're offline. Live demand is available across zones.", tone: "text-sky-400" };
  if (current && best && best.zoneId !== current.zoneId && best.expectedEarnings2h.hi > current.expectedEarnings2h.hi * 1.25)
    return { action: `Move to ${best.name}`, reason: `~${range(best.expectedEarnings2h.lo, best.expectedEarnings2h.hi)} vs ${range(current.expectedEarnings2h.lo, current.expectedEarnings2h.hi)} here.`, tone: "text-amber-400" };
  if (current && current.demand24h === 0 && (!best || best.predictedSurge < 1.1))
    return { action: "Take a Break", reason: "Demand is low everywhere right now — a good time to rest.", tone: "text-slate-400" };
  return { action: "Stay Online", reason: current ? `${current.name} is performing well for you.` : "Demand is healthy in your area.", tone: "text-emerald-400" };
}

export default function PartnerIntelligencePage() {
  const fix = useGeolocationWatcher({ enabled: true });
  const location = fix ? { lat: fix.latitude, lng: fix.longitude } : null;
  const intel = usePartnerIntelligence(location);
  const dashQ = usePartnerDashboardQuery();
  const dash = dashQ.data;

  // Nearest zone = the partner's "current" zone; best = top expected-earnings zone.
  const sortedByDist = useMemo(() => [...intel.zones].filter((z) => z.distanceKm != null).sort((a, b) => (a.distanceKm! - b.distanceKm!)), [intel.zones]);
  const current = sortedByDist[0];
  const best = useMemo(() => [...intel.zones].sort((a, b) => b.expectedEarnings2h.hi - a.expectedEarnings2h.hi)[0], [intel.zones]);
  const surgeSorted = useMemo(() => [...intel.zones].sort((a, b) => b.predictedSurge - a.predictedSurge), [intel.zones]);
  const avail = availability(dash?.isOnline ?? false, best, current);

  const insights: string[] = [];
  if (best && best.predictedSurge > 1) insights.push(`${best.name}: surge ×${best.predictedSurge} — expected ${range(best.expectedEarnings2h.lo, best.expectedEarnings2h.hi)} next 2h.`);
  const spike = intel.zones.find((z) => (z.demandDeltaPct ?? 0) >= 30);
  if (spike) insights.push(`Demand spike in ${spike.name} (+${spike.demandDeltaPct}% vs supply).`);
  if (current) { const rank = [...intel.zones].sort((a, b) => b.earningScore - a.earningScore).findIndex((z) => z.zoneId === current.zoneId); if (rank >= 0) insights.push(`Your current zone (${current.name}) ranks #${rank + 1} for earnings.`); }
  if (intel.highRisk[0]) insights.push(`Provider shortage likely in ${intel.highRisk[0].name} (risk ${intel.highRisk[0].riskScore}).`);

  return (
    <div className="space-y-4 pb-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white"><Brain size={20} className="text-sky-400" /> Earnings Intelligence</h1>
          <p className="text-xs text-slate-500">{intel.freshness ? `Live · ${new Date(intel.freshness).toLocaleTimeString()} · ${Math.round(intel.confidence * 100)}% confidence` : "Live geo-intelligence"}</p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${dash?.isOnline ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700/50 text-slate-400"}`}>
          <Power size={13} /> {dash?.isOnline ? "Online" : "Offline"}
        </span>
      </header>

      {/* AI Earnings Assistant */}
      <Card icon={<Brain size={14} />} title="AI Earnings Assistant" accent="text-sky-300">
        {best ? (
          <div className="rounded-xl bg-gradient-to-br from-sky-500/15 to-blue-600/10 p-3">
            <p className="flex items-center gap-1.5 text-sm font-bold text-white"><Navigation size={14} className="text-sky-400" /> Move to {best.name}</p>
            <p className="mt-1 text-2xl font-bold text-emerald-400">{range(best.expectedEarnings2h.lo, best.expectedEarnings2h.hi)}<span className="ml-1 text-xs font-medium text-slate-400">next 2 hrs</span></p>
            <p className="mt-0.5 text-xs text-slate-400">{best.distanceKm != null ? `${best.distanceKm} km away · ` : ""}surge ×{best.predictedSurge} · demand {best.demand24h}/24h{intel.surgeConfidence != null ? ` · ${Math.round(intel.surgeConfidence * 100)}% confidence` : ""}</p>
          </div>
        ) : <Empty />}
        {insights.length ? (
          <ul className="mt-2.5 space-y-1.5">{insights.map((t, i) => <li key={i} className="flex gap-2 text-xs leading-snug text-slate-200"><span className="mt-0.5 text-sky-400">▹</span>{t}</li>)}</ul>
        ) : null}
      </Card>

      {/* Smart Availability */}
      <Card icon={<Gauge size={14} />} title="Smart Availability" accent="text-violet-300">
        <p className={`text-lg font-bold ${avail.tone}`}>{avail.action}</p>
        <p className="text-xs text-slate-400">{avail.reason}</p>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Surge Radar */}
        <Card icon={<Zap size={14} />} title="Surge Radar" accent="text-red-300">
          {surgeSorted.slice(0, 5).map((z) => (
            <div key={z.zoneId} className="flex items-center justify-between border-b border-white/5 py-1.5 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm text-slate-200">{z.name}</p>
                <p className="text-[10px] text-slate-500">{z.distanceKm != null ? `${z.distanceKm} km · ` : ""}{range(z.expectedEarnings2h.lo, z.expectedEarnings2h.hi)}</p>
              </div>
              <span className={`ml-2 shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${z.predictedSurge >= 1.5 ? "bg-red-500/20 text-red-300" : z.predictedSurge > 1 ? "bg-amber-500/20 text-amber-300" : "bg-slate-700/50 text-slate-400"}`}>×{z.predictedSurge}</span>
            </div>
          ))}
          {!surgeSorted.length ? <Empty /> : null}
        </Card>

        {/* Zone Ranking */}
        <Card icon={<Trophy size={14} />} title="Zone Ranking" accent="text-amber-300">
          {intel.bestEarning.slice(0, 3).map((z) => <Row key={z.zoneId} a={`🏆 ${z.name}`} b={inr(z.revenue24h)} />)}
          {intel.worstService.slice(0, 1).map((z) => <Row key={z.zoneId} a={`🟢 Low competition: ${z.name}`} b={`${z.supply} live`} />)}
          {intel.highRisk.slice(0, 2).map((z) => <Row key={z.zoneId} a={`⚠ ${z.name}`} b={`risk ${z.riskScore}`} />)}
          {!intel.bestEarning.length ? <Empty /> : null}
        </Card>
      </div>

      {/* Live Earnings Dashboard */}
      <Card icon={<IndianRupee size={14} />} title="Live Earnings" accent="text-emerald-300">
        {dash ? (
          <div className="grid grid-cols-4 gap-2">
            <Metric label="Today" value={inr(dash.earnings.today)} />
            <Metric label="This Week" value={inr(dash.earnings.thisWeek)} />
            <Metric label="This Month" value={inr(dash.earnings.thisMonth)} />
            <Metric label="Projected/mo" value={inr(dash.earnings.thisWeek * 4.3)} />
          </div>
        ) : <Empty />}
      </Card>

      {/* Provider Performance */}
      <Card icon={<TrendingUp size={14} />} title="Performance" accent="text-sky-300">
        {dash ? (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            <Metric label="Acceptance" value={`${dash.rates.acceptanceRate.toFixed(0)}%`} />
            <Metric label="Completion" value={`${dash.rates.completionRate.toFixed(0)}%`} />
            <Metric label="On-time" value={`${dash.rates.onTimeRate.toFixed(0)}%`} />
            <Metric label="Rating" value={dash.rating.toFixed(1)} />
            <Metric label="Trips" value={String(dash.counts.completedLifetime)} />
            <Metric label="Today" value={String(dash.counts.completedToday)} />
          </div>
        ) : <Empty />}
      </Card>

      {/* Weather impact */}
      {current && current.weatherSurge > 1 ? (
        <Card icon={<CloudRain size={14} />} title="Weather Impact" accent="text-amber-300">
          <p className="text-xs text-slate-300">Weather is boosting demand in {current.name} (×{current.weatherSurge.toFixed(2)} surge) — higher earnings likely, ride safe.</p>
        </Card>
      ) : null}
    </div>
  );
}

function Card({ icon, title, accent, children }: { icon: React.ReactNode; title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-xl">
      <p className={`mb-2.5 flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide ${accent}`}>{icon}{title}</p>
      {children}
    </div>
  );
}
const Row = ({ a, b }: { a: string; b: string }) => (
  <div className="flex items-center justify-between py-1 text-sm"><span className="truncate text-slate-300">{a}</span><span className="ml-2 shrink-0 font-mono font-semibold text-white">{b}</span></div>
);
const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-xl bg-slate-800/40 p-2 text-center"><p className="font-mono text-sm font-bold text-white">{value}</p><p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p></div>
);
const Empty = () => <p className="py-2 text-xs text-slate-500">Awaiting live data…</p>;
