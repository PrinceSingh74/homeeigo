"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle,
  Cloud,
  CloudLightning,
  CloudRain,
  CloudSun,
  ExternalLink,
  Gauge,
  Loader2,
  RefreshCw,
  Sun,
  Thermometer,
  type LucideIcon,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { adminApi, type WeatherCity } from "@/services/admin-api";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

const NCR = new Set(["delhi", "gurugram", "gurgaon", "noida", "new delhi"]);

const SEV: Record<string, { label: string; tone: Icon3DTone; pill: "is-good" | "is-warm" | "is-hot" }> = {
  clear: { label: "Clear", tone: "success", pill: "is-good" },
  mild: { label: "Mild", tone: "cyan", pill: "is-good" },
  moderate: { label: "Moderate", tone: "warning", pill: "is-warm" },
  severe: { label: "Severe", tone: "danger", pill: "is-hot" },
  extreme: { label: "Extreme", tone: "danger", pill: "is-hot" },
};

function cityName(raw: string) {
  return raw.replace(/,IN$/i, "").replace(/\bIN\b/gi, "").trim();
}

function cityKey(raw: string) {
  return cityName(raw).toLowerCase();
}

function isNcr(raw: string) {
  return NCR.has(cityKey(raw));
}

function weatherIcon(c: WeatherCity): LucideIcon {
  const blob = `${c.condition ?? ""} ${c.description ?? ""}`.toLowerCase();
  if (blob.includes("thunder") || blob.includes("storm")) return CloudLightning;
  if (blob.includes("rain") || blob.includes("drizzle") || blob.includes("shower")) return CloudRain;
  if (blob.includes("clear") || blob.includes("sun")) return Sun;
  if (blob.includes("cloud")) return Cloud;
  return CloudSun;
}

function skyKind(c: WeatherCity) {
  const blob = `${c.condition ?? ""} ${c.description ?? ""}`.toLowerCase();
  if (blob.includes("thunder") || blob.includes("storm")) return "storm";
  if (blob.includes("rain") || blob.includes("drizzle") || blob.includes("shower")) return "rain";
  if ((c.tempC ?? 0) >= 40) return "heat";
  if (blob.includes("clear") || blob.includes("sun")) return "clear";
  return "cloud";
}

function opsBrief(city: WeatherCity) {
  const name = cityName(city.city);
  const surge = city.surgeMultiplier ?? 1;
  const eta = city.etaFactor ?? 1;
  const supply = Math.round((city.vendorImpact?.factor ?? 1) * 100);
  const sev = city.severity ?? "clear";
  if (sev === "extreme" || sev === "severe") {
    return {
      meaning: `${name} is in ${sev} weather. Field work is off baseline.`,
      impact: `Surge ×${surge.toFixed(2)} · ETA ×${eta.toFixed(2)} · supply ${supply}%. Travel and outdoor jobs will slip.`,
      action: "Hold non-essential outdoor jobs, notify live customers, and keep extra ETA buffer.",
    };
  }
  if (sev === "moderate" || (city.rain1hMm ?? 0) > 0) {
    return {
      meaning: `Weather is slowing travel and on-site work in ${name}.`,
      impact: `Surge ×${surge.toFixed(2)} · ETA ×${eta.toFixed(2)} · supply ${supply}%. Rain or haze can thin the fleet.`,
      action: "Watch Live Ops and ETA. Keep weather surge on and avoid tight back-to-back slots.",
    };
  }
  return {
    meaning: `Conditions in ${name} are stable. Weather is not the constraint.`,
    impact: `Surge ×${surge.toFixed(2)} and ETA ×${eta.toFixed(2)} stay near baseline. Supply is ${supply}%.`,
    action: "No weather action. Continue normal dispatch.",
  };
}

function CityCard({
  city,
  selected,
  onSelect,
}: {
  city: WeatherCity;
  selected?: boolean;
  onSelect: (city: WeatherCity) => void;
}) {
  const name = cityName(city.city);
  const sev = SEV[city.severity ?? "clear"] ?? SEV.clear;
  const Icon = weatherIcon(city);
  const supply = Math.round((city.vendorImpact?.factor ?? 1) * 100);
  const edge =
    city.severity === "severe" || city.severity === "extreme"
      ? "wx-card--severe"
      : city.severity === "moderate"
        ? "wx-card--moderate"
        : "";

  if (!city.available) {
    return (
      <article className="wx-card wx-card--offline">
        <p className="wx-card__name">{name}</p>
        <p className="wx-card__cond">No live weather yet</p>
      </article>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(city)}
      className={cn("wx-card", `wx-card--${skyKind(city)}`, edge, selected && "is-on")}
    >
      <div className="wx-card__top">
        <div className="flex min-w-0 items-start gap-2.5">
          <Icon3D icon={Icon} size="sm" tone={sev.tone} />
          <div className="min-w-0">
            <p className="wx-card__name" title={name}>
              {name}
            </p>
            <p className="wx-card__cond">{city.description ?? city.condition ?? "—"}</p>
          </div>
        </div>
        <span className={cn("ops-alert-pill shrink-0", sev.pill)}>{sev.label}</span>
      </div>

      <p data-stat-value className="wx-card__temp">
        {city.tempC ?? "—"}
        <span className="ml-1 text-base font-semibold text-[var(--color-biz-muted)]">°C</span>
      </p>

      <dl className="wx-metrics">
        <div className="wx-metric">
          <dt>Humidity</dt>
          <dd>{city.humidity ?? 0}%</dd>
        </div>
        <div className="wx-metric">
          <dt>Wind</dt>
          <dd>{city.windSpeedKmh ?? 0} km/h</dd>
        </div>
        <div className="wx-metric">
          <dt>Rain 1h</dt>
          <dd>{city.rain1hMm ?? 0} mm</dd>
        </div>
        <div className="wx-metric">
          <dt>ETA</dt>
          <dd>×{(city.etaFactor ?? 1).toFixed(2)}</dd>
        </div>
      </dl>

      <div className="wx-ops">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">Surge</p>
          <p data-stat-value className="mt-1 text-sm font-bold tabular-nums">
            ×{(city.surgeMultiplier ?? 1).toFixed(2)}
          </p>
          <div className={cn("biz-meter mt-2", (city.surgeMultiplier ?? 1) > 1 ? "biz-meter--warning" : "biz-meter--success")}>
            <span style={{ width: `${Math.min(100, Math.max(10, ((city.surgeMultiplier ?? 1) - 1) * 200 + 14))}%` }} />
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">Supply</p>
          <p data-stat-value className="mt-1 text-sm font-bold tabular-nums">
            {supply}%
          </p>
          <div className={cn("biz-meter mt-2", supply < 90 ? "biz-meter--warning" : "biz-meter--success")}>
            <span style={{ width: `${Math.max(10, supply)}%` }} />
          </div>
        </div>
      </div>

      {city.alerts?.[0]?.message ? (
        <p className="wx-card__alert" title={city.alerts[0].message}>
          {city.alerts[0].message}
        </p>
      ) : null}
    </button>
  );
}

export default function WeatherCenterPage() {
  const weather = useQuery({
    queryKey: ["admin-weather-overview"],
    queryFn: () => adminApi.weatherOverview(),
    refetchInterval: 10 * 60 * 1000,
    staleTime: 9 * 60 * 1000,
  });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const cities = useMemo(() => {
    const seen = new Set<string>();
    const out: WeatherCity[] = [];
    for (const city of weather.data?.cities ?? []) {
      const key = cityKey(city.city);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(city);
    }
    return out;
  }, [weather.data]);

  const ncr = cities.filter((c) => isNcr(c.city));
  const rest = cities.filter((c) => !isNcr(c.city));
  const live = cities.filter((c) => c.available);
  const alerts = live.flatMap((c) => (c.alerts ?? []).map((a) => ({ ...a, city: cityName(c.city), key: cityKey(c.city) })));
  const severe = live.filter((c) => c.severity === "severe" || c.severity === "extreme");
  const watch = live.filter((c) => severe.includes(c) || c.severity === "moderate" || (c.rain1hMm ?? 0) > 0);
  const maxSurge = Math.max(1, ...live.map((c) => c.surgeMultiplier ?? 1));
  const avgTemp = live.length ? live.reduce((s, c) => s + (c.tempC ?? 0), 0) / live.length : 0;
  const avgSupply = live.length ? live.reduce((s, c) => s + (c.vendorImpact?.factor ?? 1), 0) / live.length : 1;

  const selected =
    live.find((c) => cityKey(c.city) === selectedKey) ??
    live.find((c) => (c.alerts?.length ?? 0) > 0) ??
    ncr[0] ??
    live[0] ??
    null;

  const surgeSeries = useMemo(
    () =>
      live
        .map((c) => ({ label: cityName(c.city), value: Number((c.surgeMultiplier ?? 1).toFixed(2)) }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [live],
  );
  const tempSeries = useMemo(
    () =>
      live
        .map((c) => ({ label: cityName(c.city), value: c.tempC ?? 0 }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [live],
  );

  const mix = useMemo(() => {
    const counts = { clear: 0, mild: 0, moderate: 0, severe: 0, extreme: 0 };
    for (const c of live) {
      const k = (c.severity ?? "clear") as keyof typeof counts;
      if (k in counts) counts[k] += 1;
    }
    return counts;
  }, [live]);

  const sev = SEV[selected?.severity ?? "clear"] ?? SEV.clear;
  const brief = selected?.available ? opsBrief(selected) : null;
  const generated = weather.data?.generatedAt
    ? new Date(weather.data.generatedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-10 biz-page-enter">
      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Icon3D icon={CloudSun} tone={watch.length ? "warning" : "cyan"} size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Weather Center</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                OpenWeather
              </span>
              {generated ? <span className="ops-alert-pill is-good">as of {generated}</span> : null}
            </div>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Live city weather for surge, ETA, and partner supply. Select a city to open the briefing.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void weather.refetch()} className="biz-btn shrink-0">
          <RefreshCw size={14} className={weather.isFetching ? "animate-spin" : ""} />
          Refresh
        </button>
      </header>

      {weather.isLoading ? (
        <div className="flex items-center justify-center py-24 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Loading weather intelligence…
        </div>
      ) : weather.isError || !weather.data?.available ? (
        <div className="biz-glass-panel border-[var(--color-biz-danger)]/30 p-6 text-[var(--color-biz-danger)]">
          Weather intelligence unavailable{weather.data?.reason ? ` (${weather.data.reason})` : ""}.
        </div>
      ) : (
        <>
          <section className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Cities live"
              value={`${formatNumber(weather.data.citiesWithData ?? live.length)}/${formatNumber(weather.data.citiesTracked ?? cities.length)}`}
              sub={`${mix.clear + mix.mild} clear · ${mix.moderate} moderate`}
              icon={CloudSun}
              tone="success"
            />
            <StatTile
              label="Watch areas"
              value={formatNumber(watch.length)}
              sub={`${alerts.length} advisories · ${severe.length} severe`}
              icon={AlertTriangle}
              tone={watch.length > 0 ? "danger" : "success"}
            />
            <StatTile
              label="Peak surge"
              value={`×${maxSurge.toFixed(2)}`}
              sub="Highest weather multiplier"
              icon={Gauge}
              tone={maxSurge > 1 ? "accent" : "success"}
            />
            <StatTile
              label="Avg temperature"
              value={`${avgTemp.toFixed(0)}°C`}
              sub={`${Math.round(avgSupply * 100)}% avg partner supply`}
              icon={Thermometer}
              tone="accent"
            />
          </section>

          {selected?.available ? (
            <section className={cn("wx-hero", `wx-hero--${skyKind(selected)}`)}>
              <div className="wx-hero__grid">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <Icon3D icon={weatherIcon(selected)} size="md" tone={sev.tone} />
                    <span className={cn("ops-alert-pill", sev.pill)}>{sev.label}</span>
                    {isNcr(selected.city) ? <span className="ops-alert-pill is-good">NCR</span> : null}
                  </div>
                  <h2 className="mt-4 truncate text-[1.65rem] font-bold leading-tight tracking-tight" title={cityName(selected.city)}>
                    {cityName(selected.city)}
                  </h2>
                  <p className="mt-1.5 truncate text-sm capitalize text-[var(--color-biz-muted)]">
                    {selected.description ?? selected.condition ?? "—"}
                  </p>
                  <p data-stat-value className="wx-temp">
                    {selected.tempC ?? "—"}
                    <span className="ml-1.5 align-top text-2xl font-semibold text-[var(--color-biz-muted)]">°C</span>
                  </p>
                  {selected.feelsLikeC != null ? (
                    <p className="mt-2 text-sm text-[var(--color-biz-muted)]">Feels like {selected.feelsLikeC}°C</p>
                  ) : null}
                </div>

                <dl className="wx-stat-grid">
                  <div className="wx-stat">
                    <dt>Humidity</dt>
                    <dd>{selected.humidity ?? 0}%</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Wind</dt>
                    <dd>{selected.windSpeedKmh ?? 0} km/h</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Rain · 1h</dt>
                    <dd>{selected.rain1hMm ?? 0} mm</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>ETA factor</dt>
                    <dd>×{(selected.etaFactor ?? 1).toFixed(2)}</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Surge</dt>
                    <dd>×{(selected.surgeMultiplier ?? 1).toFixed(2)}</dd>
                  </div>
                  <div className="wx-stat">
                    <dt>Partner supply</dt>
                    <dd>{Math.round((selected.vendorImpact?.factor ?? 1) * 100)}%</dd>
                  </div>
                </dl>

                {brief ? (
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
                      <Link href="/eta-intelligence" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                        ETA Intelligence <ExternalLink size={11} />
                      </Link>
                      <Link href="/operations" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                        Live Ops <ExternalLink size={11} />
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="biz-glass-panel p-7">
            <SectionHead icon={CloudSun} tone="cyan" title="NCR — Tier 0" subtitle="Primary ops cities" meta={`${ncr.length}`} />
            <div className="wx-board wx-board--ncr">
              {ncr.map((c) => (
                <CityCard
                  key={c.city}
                  city={c}
                  selected={selected ? cityKey(selected.city) === cityKey(c.city) : false}
                  onSelect={(city) => setSelectedKey(cityKey(city.city))}
                />
              ))}
            </div>
          </section>

          <section className="biz-glass-panel p-7">
            <SectionHead icon={Cloud} tone="success" title="Other metros" subtitle="National coverage board" meta={`${rest.length}`} />
            <div className="wx-board">
              {rest.map((c) => (
                <CityCard
                  key={c.city}
                  city={c}
                  selected={selected ? cityKey(selected.city) === cityKey(c.city) : false}
                  onSelect={(city) => setSelectedKey(cityKey(city.city))}
                />
              ))}
            </div>
          </section>

          <section className="grid gap-5 lg:grid-cols-2">
            <div className="biz-glass-panel min-w-0 p-7">
              <SectionHead icon={Gauge} tone="warning" title="Weather surge" subtitle="Multiplier by city" meta="Top 8" />
              {surgeSeries.length ? (
                <IsoBarChart data={surgeSeries} format={(v) => `×${v.toFixed(2)}`} accent="amber" layout="bar" height={240} />
              ) : (
                <p className="text-sm leading-relaxed text-[var(--color-biz-muted)]">No surge data yet.</p>
              )}
            </div>
            <div className="biz-glass-panel min-w-0 p-7">
              <SectionHead icon={Thermometer} tone="cyan" title="Temperature" subtitle="Hottest live cities" meta="Top 8" />
              {tempSeries.length ? (
                <IsoBarChart data={tempSeries} format={(v) => `${v}°`} accent="blue" layout="column" height={240} />
              ) : (
                <p className="text-sm leading-relaxed text-[var(--color-biz-muted)]">No temperature samples yet.</p>
              )}
            </div>
          </section>

          {alerts.length ? (
            <section className="biz-glass-panel p-7">
              <SectionHead icon={AlertTriangle} tone="warning" title="Active advisories" subtitle="Rain, wind, heat, and ETA impact" meta={`${alerts.length}`} />
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {alerts.map((a, i) => (
                  <button
                    key={`${a.city}-${i}`}
                    type="button"
                    onClick={() => setSelectedKey(a.key)}
                    className="ops-alert ops-alert--warning min-w-0 text-left"
                  >
                    <Icon3D icon={a.level === "severe" ? CloudLightning : AlertTriangle} size="sm" tone="warning" />
                    <div className="min-w-0">
                      <p className="truncate text-[11px] font-bold uppercase tracking-[0.12em]">{a.city}</p>
                      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed">{a.message}</p>
                    </div>
                  </button>
                ))}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
