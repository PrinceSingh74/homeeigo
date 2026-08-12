"use client";

import { useQuery } from "@tanstack/react-query";
import { CloudRain, Wind, Droplets, Thermometer, AlertTriangle, Loader2, Gauge, Users } from "lucide-react";
import { adminApi, type WeatherCity } from "@/services/admin-api";

const NCR = new Set(["Delhi,IN", "Gurugram,IN", "Noida,IN"]);
const SEV_TONE: Record<string, string> = {
  clear: "border-emerald-500/30 bg-emerald-500/5",
  mild: "border-emerald-500/30 bg-emerald-500/5",
  moderate: "border-amber-500/30 bg-amber-500/10",
  severe: "border-orange-500/40 bg-orange-500/10",
  extreme: "border-red-500/50 bg-red-500/10",
};
const SEV_TEXT: Record<string, string> = {
  clear: "text-emerald-400", mild: "text-emerald-400", moderate: "text-amber-400", severe: "text-orange-400", extreme: "text-red-400",
};

function CityCard({ c }: { c: WeatherCity }) {
  const name = c.city.replace(",IN", "");
  if (!c.available) {
    return (
      <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/40 p-4 opacity-60">
        <p className="font-semibold text-zinc-200">{name}</p>
        <p className="text-xs text-zinc-500">No data</p>
      </div>
    );
  }
  const sev = c.severity ?? "clear";
  return (
    <div className={`rounded-2xl border p-4 ${SEV_TONE[sev] ?? SEV_TONE.clear}`}>
      <div className="flex items-center justify-between">
        <p className="font-semibold text-zinc-100">{name}{NCR.has(c.city) && <span className="ml-2 rounded bg-blue-500/20 px-1.5 py-0.5 text-[10px] font-medium text-blue-300">NCR</span>}</p>
        <span className={`text-xs font-semibold uppercase ${SEV_TEXT[sev]}`}>{sev}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-zinc-300">
        <span className="flex items-center gap-1.5"><Thermometer size={14} />{c.tempC}°C</span>
        <span className="flex items-center gap-1.5"><Droplets size={14} />{c.humidity}%</span>
        <span className="flex items-center gap-1.5"><Wind size={14} />{c.windSpeedKmh} km/h</span>
        <span className="flex items-center gap-1.5"><CloudRain size={14} />{c.rain1hMm ?? 0} mm</span>
      </div>
      <p className="mt-2 text-xs capitalize text-zinc-400">{c.description}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 border-t border-zinc-700/50 pt-3 text-xs">
        <span className="flex items-center gap-1.5 text-zinc-300"><Gauge size={13} />Surge ×{c.surgeMultiplier}</span>
        <span className="flex items-center gap-1.5 text-zinc-300"><Users size={13} />Supply {Math.round((c.vendorImpact?.factor ?? 1) * 100)}%</span>
      </div>
      {(c.alerts?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1">
          {c.alerts!.map((a, i) => (
            <p key={i} className="flex items-start gap-1.5 rounded-lg bg-black/20 px-2 py-1 text-[11px] text-amber-200">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />{a.message}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

export default function WeatherCenterPage() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-weather-overview"],
    queryFn: () => adminApi.weatherOverview(),
    refetchInterval: 10 * 60 * 1000,
    staleTime: 9 * 60 * 1000,
  });

  if (isLoading) return <div className="flex items-center gap-2 p-8 text-sm text-zinc-400"><Loader2 className="animate-spin" size={16} /> Loading weather intelligence…</div>;
  if (isError || !data?.available) return <div className="rounded-2xl border border-zinc-700 bg-zinc-900/40 p-6 text-sm text-zinc-400">Weather intelligence unavailable {data?.reason ? `(${data.reason})` : ""}.</div>;

  const cities = data.cities ?? [];
  const ncr = cities.filter((c) => NCR.has(c.city));
  const rest = cities.filter((c) => !NCR.has(c.city));

  return (
    <div className="space-y-6 p-1">
      <div>
        <h1 className="text-xl font-bold text-zinc-100">Weather Intelligence Center</h1>
        <p className="text-sm text-zinc-400">
          {data.citiesWithData}/{data.citiesTracked} cities live · {data.severeAreas ?? 0} severe areas · live OpenWeather → surge + ETA + vendor impact
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-blue-300">NCR — Tier 0</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{ncr.map((c) => <CityCard key={c.city} c={c} />)}</div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-400">Other metros</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{rest.map((c) => <CityCard key={c.city} c={c} />)}</div>
      </section>
    </div>
  );
}
