"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CloudRain, CloudLightning, Wind, AlertTriangle, X } from "lucide-react";
import { useGeolocationWatcher } from "@/hooks/use-geolocation-watcher";
import { partnerApi } from "@/services/partner-api";

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
 * Partner safety weather warning — uses the partner's live GPS fix to surface
 * rain/storm/wind/heat alerts and travel-impact at their current location.
 * Renders null on clear/mild days. Backed by live OpenWeather (/api/weather/alerts).
 */
export function PartnerWeatherWarning() {
  const coords = useGeolocationWatcher({ minMoveMeters: 500 });
  const [dismissed, setDismissed] = useState(false);

  const lat = coords?.latitude;
  const lng = coords?.longitude;
  const query = useQuery({
    queryKey: ["partner-weather", lat?.toFixed(2), lng?.toFixed(2)],
    enabled: lat != null && lng != null,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    queryFn: () => partnerApi.weatherAlerts(lat!, lng!),
  });

  const d = query.data;
  const alerts = d?.available ? (d.alerts ?? []) : [];
  const sev = d?.severity ?? "clear";
  const warn = d?.available === true && (sev === "moderate" || sev === "severe" || sev === "extreme") && alerts.length > 0;
  if (!warn || dismissed) return null;

  const top = alerts[0]!;
  const Icon = ICON[top.type] ?? AlertTriangle;
  const tone = TONE[top.level] ?? TONE.warning;
  const etaPct = Math.round(((d?.etaFactor ?? 1) - 1) * 100);

  return (
    <div className={`mb-3 flex items-start gap-3 rounded-2xl border px-4 py-3 backdrop-blur-md ${tone}`} role="alert">
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="flex-1 text-sm">
        <p className="font-semibold">Safety weather alert</p>
        <p className="opacity-90">{top.message}</p>
        {etaPct > 0 && <p className="mt-0.5 text-xs opacity-75">Allow ~{etaPct}% extra travel time. Drive safely.</p>}
      </div>
      <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="rounded-lg p-1 opacity-70 hover:opacity-100">
        <X className="size-4" />
      </button>
    </div>
  );
}
