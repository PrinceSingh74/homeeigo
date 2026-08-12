"use client";

import { useState } from "react";
import { CloudRain, CloudLightning, Wind, AlertTriangle, X } from "lucide-react";
import { useWeatherAlerts } from "@/hooks/use-weather-alerts";

const ICON: Record<string, typeof CloudRain> = {
  rain: CloudRain,
  storm: CloudLightning,
  wind: Wind,
  heat: AlertTriangle,
  extreme: AlertTriangle,
};

const TONE: Record<string, string> = {
  advisory: "bg-blue-500/10 border-blue-400/30 text-blue-100",
  warning: "bg-amber-500/12 border-amber-400/35 text-amber-100",
  severe: "bg-red-500/12 border-red-400/40 text-red-100",
};

/**
 * Customer-facing weather warning. Renders only when the selected service area
 * has moderate+ weather with active alerts (otherwise null — no clutter on clear days).
 * Backed by live OpenWeather via /api/weather/alerts.
 */
export function WeatherWarningBanner() {
  const { shouldWarn, alerts, cityName, etaFactor } = useWeatherAlerts();
  const [dismissed, setDismissed] = useState(false);

  if (!shouldWarn || dismissed) return null;
  const top = alerts[0]!;
  const Icon = ICON[top.type] ?? AlertTriangle;
  const tone = TONE[top.level] ?? TONE.warning;
  const etaPct = Math.round((etaFactor - 1) * 100);

  return (
    <div className={`mx-auto mb-3 flex max-w-content items-start gap-3 rounded-2xl border px-4 py-3 backdrop-blur-md ${tone}`} role="status">
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex-1 text-sm">
        <p className="font-semibold">
          Weather alert{cityName ? ` · ${cityName}` : ""}
        </p>
        <p className="opacity-90">{top.message}</p>
        {etaPct > 0 && (
          <p className="mt-0.5 text-xs opacity-75">Partner arrival may take ~{etaPct}% longer than usual.</p>
        )}
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="rounded-lg p-1 opacity-70 transition hover:opacity-100">
        <X className="size-4" />
      </button>
    </div>
  );
}
