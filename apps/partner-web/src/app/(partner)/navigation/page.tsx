"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Navigation2, Clock, Route as RouteIcon, Gauge, Zap, Brain, Flag,
  ArrowUp, CornerUpLeft, CornerUpRight, MoveUpLeft, MoveUpRight,
  RotateCcw, RotateCw, Split, Merge, MapPin, ChevronDown, ChevronUp,
  Volume2, VolumeX, TriangleAlert,
} from "lucide-react";
import { useGeolocationWatcher } from "@/hooks/use-geolocation-watcher";
import { usePartnerActiveBookingsQuery } from "@/hooks/use-partner-data";
import { usePartnerIntelligence } from "@/hooks/use-partner-intelligence";
import { partnerApi } from "@/services/partner-api";
import type { NavGuidance, NavRoute, NavStep } from "@/components/navigation/PartnerNavMap";
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";

const PartnerNavMap = dynamic(
  () => import("@/components/navigation/PartnerNavMap").then((m) => m.PartnerNavMap),
  { ssr: false, loading: () => <div className="absolute inset-0 bg-[#0b1220]" aria-hidden /> },
);

const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
const TRAFFIC: Record<NavRoute["trafficLevel"], { t: string; c: string }> = {
  light: { t: "Clear", c: "text-emerald-400" }, moderate: { t: "Moderate traffic", c: "text-amber-400" }, heavy: { t: "Heavy traffic", c: "text-red-400" },
};

/** Google maneuver string → arrow icon (the visual language every nav app speaks). */
function ManeuverIcon({ maneuver, size = 26, className = "" }: { maneuver: string; size?: number; className?: string }) {
  const m = maneuver.toLowerCase();
  const I =
    m.includes("uturn") ? (m.includes("right") ? RotateCw : RotateCcw)
    : m.includes("slight-left") || m.includes("keep-left") || m.includes("ramp-left") || m.includes("fork-left") ? MoveUpLeft
    : m.includes("slight-right") || m.includes("keep-right") || m.includes("ramp-right") || m.includes("fork-right") ? MoveUpRight
    : m.includes("left") ? CornerUpLeft
    : m.includes("right") ? CornerUpRight
    : m.includes("merge") ? Merge
    : m.includes("fork") ? Split
    : ArrowUp;
  return <I size={size} className={className} aria-hidden />;
}

/** "in 240 m" / "in 1.2 km" countdown label. */
function turnDistLabel(m: number | null): string {
  if (m == null) return "";
  if (m >= 1000) return `in ${(m / 1000).toFixed(1)} km`;
  return `in ${Math.max(10, Math.round(m / 10) * 10)} m`;
}

/** Wall-clock arrival from the live traffic ETA. */
function arrivalClock(etaMin: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(Date.now() + etaMin * 60_000));
}

export default function PartnerNavigationPage() {
  const fix = useGeolocationWatcher({ enabled: true });
  const position = fix ? { lat: fix.latitude, lng: fix.longitude } : null;
  const accuracy = (fix as { accuracy?: number } | null)?.accuracy ?? null;

  const activeQ = usePartnerActiveBookingsQuery();
  const active = (activeQ.data as { bookings?: Array<{ id: string; customer?: { name?: string }; address?: { fullAddress?: string; latitude: number | null; longitude: number | null } }> } | undefined)?.bookings?.find((b) => b.address?.latitude != null && b.address?.longitude != null);
  const destination = active?.address?.latitude != null && active?.address?.longitude != null ? { lat: active.address.latitude, lng: active.address.longitude } : undefined;

  const intel = usePartnerIntelligence(position);
  const best = useMemo(() => [...intel.zones].sort((a, b) => b.expectedEarnings2h.hi - a.expectedEarnings2h.hi)[0], [intel.zones]);
  const surgeZones = useMemo(() => [...intel.zones].filter((z) => z.predictedSurge > 1).sort((a, b) => b.predictedSurge - a.predictedSurge).slice(0, 3), [intel.zones]);

  const [route, setRoute] = useState<NavRoute | null>(null);
  const [guidance, setGuidance] = useState<NavGuidance | null>(null);
  const [stepsOpen, setStepsOpen] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const sessionSent = useRef(false);
  const spokenStep = useRef(-1);
  const spokenNear = useRef(-1);

  // Load the voice preference once (client only).
  useEffect(() => {
    try { setVoiceOn(localStorage.getItem("homigo-nav-voice") !== "off"); } catch { /* private mode */ }
  }, []);
  const toggleVoice = () => {
    setVoiceOn((v) => {
      const next = !v;
      try { localStorage.setItem("homigo-nav-voice", next ? "on" : "off"); } catch { /* private mode */ }
      if (!next && typeof window !== "undefined") window.speechSynthesis?.cancel();
      return next;
    });
  };

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05;
    window.speechSynthesis.speak(u);
  }, []);

  // Voice guidance: announce each new instruction, and again when the turn is close.
  const onGuidance = useCallback((g: NavGuidance) => {
    setGuidance(g);
    if (!voiceOn) return;
    const cur = g.steps[g.stepIndex];
    if (!cur) return;
    if (g.stepIndex !== spokenStep.current) {
      spokenStep.current = g.stepIndex;
      spokenNear.current = -1;
      speak(g.distToTurnM != null && g.distToTurnM > 120 ? `In ${turnDistLabel(g.distToTurnM).replace("in ", "")}, ${cur.instruction}` : cur.instruction);
    } else if (g.distToTurnM != null && g.distToTurnM < 90 && spokenNear.current !== g.stepIndex) {
      spokenNear.current = g.stepIndex;
      speak(cur.instruction);
    }
  }, [voiceOn, speak]);

  useEffect(() => () => { if (typeof window !== "undefined") window.speechSynthesis?.cancel(); }, []);

  // Session-start telemetry once a trip is active.
  useEffect(() => {
    if (destination && !sessionSent.current) { sessionSent.current = true; void partnerApi.navTelemetry({ type: "session", gpsAccuracy: accuracy ?? undefined }); }
  }, [destination, accuracy]);

  const insights: string[] = [];
  if (best && best.predictedSurge > 1) insights.push(`After this trip, head to ${best.name} — surge ×${best.predictedSurge}, expected ${inr(best.expectedEarnings2h.lo)}–${inr(best.expectedEarnings2h.hi)}.`);
  const spike = intel.zones.find((z) => (z.demandDeltaPct ?? 0) >= 30);
  if (spike) insights.push(`Demand spike near ${spike.name} (+${spike.demandDeltaPct}%).`);
  if (route?.trafficLevel === "heavy") insights.push(`Traffic increasing on your current route (+ETA).`);

  const cur: NavStep | null = guidance?.steps[guidance.stepIndex] ?? null;
  const nxt: NavStep | null = guidance ? guidance.steps[guidance.stepIndex + 1] ?? null : null;
  const remaining = guidance ? guidance.steps.slice(guidance.stepIndex) : [];

  return (
    <div className="relative h-[calc(100dvh-1rem)] overflow-hidden rounded-2xl">
      <MapPerformanceBoundary label="PartnerNavMap" className="absolute inset-0 h-full w-full" deferAfterPaint rootMargin="0px">
        <PartnerNavMap
          position={position}
          accuracy={accuracy}
          destination={destination}
          destLabel={active?.customer?.name ?? null}
          onRoute={setRoute}
          onGuidance={onGuidance}
          onArrival={() => { void partnerApi.navTelemetry({ type: "arrival" }); if (voiceOn) speak("You have arrived at the customer's location."); }}
          onReroute={() => { void partnerApi.navTelemetry({ type: "reroute" }); if (voiceOn) speak("Rerouting."); }}
          className="absolute inset-0 h-full w-full"
        />
      </MapPerformanceBoundary>

      {/* ---- Turn-by-turn HUD ---- */}
      {destination && cur ? (
        <div className="absolute left-3 right-3 top-3 z-10 overflow-hidden rounded-2xl border border-white/10 bg-slate-900/90 backdrop-blur-xl">
          {guidance?.offRoute ? (
            <div className="flex items-center gap-2 bg-amber-500/15 px-3 py-1.5 text-xs font-semibold text-amber-300">
              <TriangleAlert size={13} /> Rerouting…
            </div>
          ) : null}
          <div className="flex items-center gap-3 p-3">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-sky-500/15 ring-1 ring-sky-400/30">
              <ManeuverIcon maneuver={cur.maneuver} className="text-sky-300" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-base font-bold leading-snug text-white">
                {guidance?.distToTurnM != null ? <span className="text-sky-300">{turnDistLabel(guidance.distToTurnM)} · </span> : null}
                {cur.instruction || "Continue"}
              </p>
              {nxt ? (
                <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-slate-400">
                  then <ManeuverIcon maneuver={nxt.maneuver} size={12} className="text-slate-400" /> {nxt.instruction}
                </p>
              ) : (
                <p className="mt-0.5 truncate text-xs text-emerald-400">Final stretch — destination ahead</p>
              )}
            </div>
            <button
              onClick={toggleVoice}
              aria-label={voiceOn ? "Mute voice guidance" : "Unmute voice guidance"}
              className="grid size-9 shrink-0 place-items-center rounded-full bg-white/5 text-slate-300 ring-1 ring-white/10 transition hover:bg-white/10"
            >
              {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </button>
          </div>

          {/* Full route steps — the exact turns Google gives, expandable */}
          <button
            onClick={() => setStepsOpen((o) => !o)}
            className="flex w-full items-center justify-between border-t border-white/5 px-3 py-1.5 text-[11px] font-semibold text-slate-400 transition hover:text-slate-200"
          >
            <span>
              {remaining.length} turns to destination
              {route?.summary ? <span className="text-slate-500"> · via {route.summary}</span> : null}
            </span>
            {stepsOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
          </button>
          {stepsOpen ? (
            <ol className="max-h-[34dvh] overflow-y-auto overscroll-contain border-t border-white/5 px-2 py-1.5">
              {remaining.map((s, i) => (
                <li key={`${guidance!.stepIndex + i}-${s.instruction}`} className={`flex items-start gap-2.5 rounded-lg px-2 py-1.5 ${i === 0 ? "bg-sky-500/10" : ""}`}>
                  <ManeuverIcon maneuver={s.maneuver} size={15} className={i === 0 ? "mt-0.5 shrink-0 text-sky-300" : "mt-0.5 shrink-0 text-slate-500"} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs leading-snug ${i === 0 ? "font-semibold text-white" : "text-slate-300"}`}>{s.instruction}</p>
                  </div>
                  <span className="shrink-0 font-mono text-[10px] text-slate-500">{s.distanceText}</span>
                </li>
              ))}
              <li className="flex items-center gap-2.5 px-2 py-1.5">
                <MapPin size={15} className="shrink-0 text-emerald-400" />
                <p className="text-xs font-semibold text-emerald-300">
                  {active?.customer?.name ? `${active.customer.name} · ` : ""}{active?.address?.fullAddress ?? "Destination"}
                </p>
              </li>
            </ol>
          ) : null}
        </div>
      ) : !destination ? (
        <div className="absolute left-3 right-3 top-3 z-10 rounded-2xl border border-white/10 bg-slate-900/85 p-3 text-center text-sm text-slate-300 backdrop-blur-xl">
          <Navigation2 size={16} className="mr-1 inline text-sky-400" /> No active trip — positioning for the best next zone
        </div>
      ) : null}

      {/* ---- Bottom sheet: ETA + earnings merge + insights ---- */}
      <div className="absolute inset-x-0 bottom-0 z-10 space-y-2.5 rounded-t-3xl border-t border-white/10 bg-slate-900/90 p-4 backdrop-blur-xl">
        {destination ? (
          <div className="flex items-center justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400"><Clock size={12} /> ETA to customer</p>
              <p className="text-3xl font-bold text-white">{route ? `${route.etaMin} min` : "—"}</p>
              {route ? (
                <p className="text-xs text-slate-400">
                  by <span className="font-semibold text-white">{arrivalClock(route.etaMin)}</span>
                  <span className={`ml-1.5 ${TRAFFIC[route.trafficLevel].c}`}>· {TRAFFIC[route.trafficLevel].t}</span>
                </p>
              ) : null}
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              <Mini Icon={RouteIcon} label="Distance" value={route?.distanceText ?? "—"} />
              <Mini Icon={Gauge} label="Speed" value={guidance ? `${guidance.speedKmh} km/h` : "—"} />
              <Mini Icon={Navigation2} label="GPS" value={accuracy != null ? `±${Math.round(accuracy)}m` : "—"} />
            </div>
          </div>
        ) : null}

        {/* Earnings + surge merge */}
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl border border-white/10 bg-gradient-to-br from-sky-500/15 to-blue-600/10 p-2.5">
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-sky-300"><Brain size={11} /> Best next zone</p>
            {best ? (<><p className="truncate text-sm font-bold text-white">{best.name}</p><p className="text-xs text-emerald-400">{inr(best.expectedEarnings2h.lo)}–{inr(best.expectedEarnings2h.hi)} · ×{best.predictedSurge}</p></>) : <p className="text-xs text-slate-500">scanning…</p>}
          </div>
          <div className="rounded-xl border border-white/10 bg-slate-800/40 p-2.5">
            <p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-red-300"><Zap size={11} /> Nearby surge</p>
            {surgeZones.length ? surgeZones.map((z) => (
              <div key={z.zoneId} className="flex items-center justify-between text-xs"><span className="truncate text-slate-300">{z.name}</span><span className="ml-1 font-mono text-amber-300">×{z.predictedSurge}</span></div>
            )) : <p className="text-xs text-slate-500">none</p>}
          </div>
        </div>

        {insights.length ? (
          <ul className="space-y-1">
            {insights.slice(0, 2).map((t, i) => (
              <li key={i} className="flex items-start gap-1.5 rounded-lg bg-slate-800/40 px-2.5 py-1.5 text-[11px] leading-snug text-slate-200"><Flag size={11} className="mt-0.5 shrink-0 text-sky-400" />{t}{intel.surgeConfidence != null ? <span className="ml-1 shrink-0 text-slate-500">· {Math.round(intel.surgeConfidence * 100)}%</span> : null}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

function Mini({ Icon, label, value }: { Icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="rounded-xl bg-slate-800/40 p-2">
      <Icon size={13} className="mx-auto text-sky-400" />
      <p className="mt-0.5 text-xs font-semibold text-white">{value}</p>
      <p className="text-[9px] uppercase tracking-wide text-slate-500">{label}</p>
    </div>
  );
}
