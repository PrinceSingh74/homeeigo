"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  Clock,
  Wifi,
  WifiOff,
  Loader2,
  Navigation,
  Gauge,
  MessageSquare,
  Phone,
  Route as RouteIcon,
  Star,
} from "lucide-react";
import { useBookingTracking } from "@/hooks/use-booking-tracking";
import type { RouteInfo } from "./LiveTrackingMap";
import { BookingJourney, toJourneyStage } from "./BookingJourney";

export type TrackedPartner = {
  name: string;
  rating?: number | null;
  phoneNumber?: string | null;
  profileImage?: string | null;
};

const LiveTrackingMap = dynamic(
  () => import("./LiveTrackingMap").then((m) => m.LiveTrackingMap),
  { ssr: false, loading: () => <div className="h-64 w-full rounded-2xl bg-slate-900/60" aria-hidden /> },
);

const TRAFFIC_LABEL: Record<RouteInfo["trafficLevel"], { text: string; cls: string }> = {
  light: { text: "Clear roads", cls: "text-emerald-400" },
  moderate: { text: "Moderate traffic", cls: "text-amber-400" },
  heavy: { text: "Heavy traffic", cls: "text-red-400" },
};

/**
 * Customer live tracking — premium dark experience. Real Google Maps with a Kalman-smoothed,
 * heading-rotated HOMEEIGO bike marker + traffic-aware route, the 6-stage booking journey, and a
 * live ETA card driven by the EXACT Google route distance/ETA (falls back to the WS estimate).
 */
export function CustomerTrackingMap({
  bookingId,
  destination,
  partner,
}: {
  bookingId: string;
  destination?: { lat: number; lng: number };
  partner?: TrackedPartner | null;
}) {
  const t = useBookingTracking(bookingId);
  const [marker, setMarker] = useState<{ lat: number; lng: number } | null>(null);
  const [route, setRoute] = useState<RouteInfo | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Forward provider fixes to the map promptly (the map's Kalman filter + rAF loop handle
  // smoothing); a light 80ms debounce coalesces bursty WS pings.
  useEffect(() => {
    if (!t.providerPosition) return;
    if (debounce.current) clearTimeout(debounce.current);
    const pos = t.providerPosition;
    debounce.current = setTimeout(() => setMarker(pos), 80);
    return () => {
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [t.providerPosition?.lat, t.providerPosition?.lng]); // eslint-disable-line react-hooks/exhaustive-deps

  if (t.isError) {
    return <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">Tracking is unavailable for this booking.</div>;
  }
  if (t.isLoading) {
    return <div className="flex items-center gap-2 rounded-2xl border p-6 text-sm text-gray-500"><Loader2 size={16} className="animate-spin" /> Loading live tracking…</div>;
  }

  const stage = toJourneyStage(t.status);
  const center = marker ?? destination ?? null;
  // Prefer the exact Google route ETA/distance; fall back to the server WS estimate.
  const etaMin = route?.etaMin ?? t.eta ?? null;
  const distanceKm = route?.distanceKm ?? t.distance ?? null;
  const speedKmh = t.speed != null ? Math.round(t.speed * 3.6) : null;
  const traffic = route ? TRAFFIC_LABEL[route.trafficLevel] : null;

  return (
    <div className="mx-auto w-full max-w-xl space-y-4">
      {/* Live map */}
      <div className="overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-slate-950/40">
        <LiveTrackingMap
          provider={marker ?? center}
          destination={destination}
          bearing={t.bearing}
          onRoute={setRoute}
          className="h-72 w-full sm:h-96"
        />
      </div>

      {/* Partner action bar — real name/rating/phone from the booking (Uber-style) */}
      {partner ? (
        <div className="flex items-center gap-3 rounded-3xl border border-white/10 bg-slate-900/60 p-3.5 backdrop-blur-xl">
          <span className="relative grid size-12 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-sky-500/30 to-blue-600/20 text-base font-bold text-sky-300 ring-2 ring-sky-400/30">
            {partner.profileImage ? (
              <Image
                src={partner.profileImage}
                alt=""
                fill
                sizes="48px"
                className="object-cover"
              />
            ) : (
              partner.name.charAt(0).toUpperCase()
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold text-white">{partner.name}</p>
            <p className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
              {partner.rating != null ? (
                <span className="inline-flex items-center gap-1 font-semibold text-amber-400">
                  <Star size={11} className="fill-amber-400" />
                  {Number(partner.rating).toFixed(1)}
                </span>
              ) : null}
              <span>Your HOMEEIGO professional</span>
            </p>
          </div>
          {partner.phoneNumber ? (
            <div className="flex shrink-0 items-center gap-2">
              <a
                href={`sms:${partner.phoneNumber}`}
                aria-label={`Message ${partner.name}`}
                title={`Message ${partner.name}`}
                className="grid size-11 place-items-center rounded-full border border-white/15 bg-white/10 text-white transition hover:bg-white/20 active:scale-95"
              >
                <MessageSquare size={18} />
              </a>
              <a
                href={`tel:${partner.phoneNumber}`}
                aria-label={`Call ${partner.name}`}
                title={`Call ${partner.name}`}
                className="grid size-11 place-items-center rounded-full bg-gradient-to-br from-emerald-500 to-emerald-600 text-white shadow-lg shadow-emerald-500/30 transition hover:brightness-110 active:scale-95"
              >
                <Phone size={18} />
              </a>
            </div>
          ) : (
            <span className="shrink-0 rounded-full bg-slate-800 px-2.5 py-1 text-[10px] font-medium text-slate-400">
              Contact via support
            </span>
          )}
        </div>
      ) : null}

      {/* 6-stage journey */}
      <BookingJourney status={t.status} />

      {/* Live ETA + telemetry card */}
      <div className="rounded-3xl border border-white/10 bg-slate-900/60 p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Clock size={13} aria-hidden /> {stage === "ARRIVED" ? "Provider has arrived" : stage === "STARTED" ? "Service in progress" : "Estimated arrival"}
            </p>
            <p className="mt-0.5 text-3xl font-bold text-white">{etaMin != null ? `${etaMin} min` : "—"}</p>
            {traffic ? <p className={`mt-0.5 text-xs font-medium ${traffic.cls}`}>{traffic.text}{route?.withTraffic ? " · live traffic" : ""}</p> : null}
          </div>
          <span className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${t.connected ? "bg-emerald-500/15 text-emerald-400" : t.reconnecting ? "bg-amber-500/15 text-amber-400" : "bg-slate-700/50 text-slate-400"}`}>
            {t.connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {t.connected ? "Live" : t.reconnecting ? "Reconnecting" : "Offline"}
          </span>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/10 pt-3">
          <Telemetry Icon={RouteIcon} label="Distance" value={distanceKm != null ? `${distanceKm} km` : "—"} />
          <Telemetry Icon={Gauge} label="Speed" value={speedKmh != null ? `${speedKmh} km/h` : "—"} />
          <Telemetry Icon={Navigation} label="Heading" value={t.bearing != null ? compass(t.bearing) : "—"} />
        </div>
      </div>
    </div>
  );
}

function Telemetry({ Icon, label, value }: { Icon: typeof Clock; label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <Icon size={15} className="text-sky-400" aria-hidden />
      <span className="text-sm font-semibold text-white">{value}</span>
      <span className="text-[10px] uppercase tracking-wide text-slate-500">{label}</span>
    </div>
  );
}

/** Degrees → 8-point compass label. */
function compass(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round((deg % 360) / 45) % 8];
}
