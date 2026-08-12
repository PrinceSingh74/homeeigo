"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Clock, Gauge, MapPin, Navigation, Wifi, WifiOff } from "lucide-react";
import { useAdminBookingTracking } from "@/hooks/use-admin-booking-tracking";
import type { AdminRouteInfo } from "@/components/tracking/AdminLiveTrackingMap";

const AdminLiveTrackingMap = dynamic(
  () => import("@/components/tracking/AdminLiveTrackingMap").then((m) => m.AdminLiveTrackingMap),
  { ssr: false, loading: () => <div className="h-72 w-full rounded-xl bg-slate-950" aria-hidden /> },
);

/** Booking statuses for which a partner can be moving / on-site. */
const TRACKABLE = new Set(["accepted", "assigned", "en_route", "in_progress"]);
/** Statuses where the partner is still riding — route + ETA are meaningful. */
const EN_ROUTE = new Set(["accepted", "assigned", "en_route"]);

const TRAFFIC_LABEL: Record<AdminRouteInfo["trafficLevel"], { text: string; cls: string }> = {
  light: { text: "Clear roads", cls: "text-emerald-400" },
  moderate: { text: "Moderate traffic", cls: "text-amber-400" },
  heavy: { text: "Heavy traffic", cls: "text-red-400" },
};

/**
 * Admin live-oversight card for one booking — the same real-time picture the
 * customer and partner see: HOMEEIGO rider marker, exact traffic route, live
 * ETA/distance/speed. Renders nothing for non-trackable statuses.
 */
export function BookingLiveTracking({
  bookingId,
  status,
  partnerName,
}: {
  bookingId: string;
  status: string;
  partnerName?: string | null;
}) {
  const normalized = status.toLowerCase();
  const trackable = TRACKABLE.has(normalized);
  const { tracking, connected, isLoading } = useAdminBookingTracking(bookingId, trackable);
  const [route, setRoute] = useState<AdminRouteInfo | null>(null);

  if (!trackable) return null;

  const provider =
    tracking?.providerLatitude != null && tracking?.providerLongitude != null
      ? { lat: tracking.providerLatitude, lng: tracking.providerLongitude }
      : null;
  const destination =
    tracking?.destinationLatitude != null && tracking?.destinationLongitude != null
      ? { lat: tracking.destinationLatitude, lng: tracking.destinationLongitude }
      : undefined;

  const enRoute = EN_ROUTE.has(normalized);
  const etaMin = route?.etaMin ?? tracking?.eta ?? null;
  const distanceText = route?.distanceText ?? (tracking?.distance != null ? `${tracking.distance} km` : null);
  const speedKmh = tracking?.speed != null ? Math.round(tracking.speed * 3.6) : null;
  const traffic = route ? TRAFFIC_LABEL[route.trafficLevel] : null;
  const updatedAt = tracking?.locationUpdatedAt ? new Date(tracking.locationUpdatedAt) : null;
  // `live:false` = partner's last-known position (no active GPS stream for this booking).
  const lastKnown = tracking != null && tracking.live === false;

  return (
    <div className="biz-card space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">
          Live tracking
          {partnerName ? (
            <span className="ml-2 text-sm font-medium text-[var(--color-biz-muted)]">· {partnerName}</span>
          ) : null}
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
            lastKnown
              ? "bg-amber-500/10 text-amber-400 ring-amber-500/25"
              : connected
                ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/25"
                : "bg-slate-500/10 text-[var(--color-biz-muted)] ring-[var(--color-biz-line)]"
          }`}
        >
          {lastKnown ? <MapPin className="h-3 w-3" /> : connected ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
          {lastKnown ? "LAST KNOWN" : connected ? "LIVE" : "CONNECTING"}
        </span>
      </div>

      {isLoading ? (
        <div className="h-72 w-full animate-pulse rounded-xl bg-slate-900/60" aria-hidden />
      ) : !provider && !destination ? (
        <div className="flex h-40 items-center justify-center rounded-xl bg-slate-950 text-sm text-slate-400">
          No partner location yet — waiting for the first GPS fix…
        </div>
      ) : (
        <>
          <AdminLiveTrackingMap
            provider={provider}
            destination={destination}
            bearing={tracking?.bearing}
            routeEnabled={enRoute}
            riderLabel={
              partnerName
                ? enRoute && etaMin != null
                  ? `${partnerName} · ${etaMin} min`
                  : partnerName
                : null
            }
            onRoute={setRoute}
            className="h-72 w-full"
          />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Chip
              icon={<Clock className="h-3.5 w-3.5" />}
              label={enRoute ? "ETA to customer" : "Status"}
              value={enRoute ? (etaMin != null ? `${etaMin} min` : "—") : "On-site"}
              sub={enRoute && traffic ? traffic.text : undefined}
              subCls={traffic?.cls}
            />
            <Chip icon={<Navigation className="h-3.5 w-3.5" />} label="Distance" value={enRoute ? distanceText ?? "—" : "0 km"} />
            <Chip icon={<Gauge className="h-3.5 w-3.5" />} label="Speed" value={speedKmh != null ? `${speedKmh} km/h` : "—"} />
            <Chip
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Last update"
              value={updatedAt ? updatedAt.toLocaleTimeString() : "—"}
            />
          </div>
        </>
      )}
    </div>
  );
}

function Chip({ icon, label, value, sub, subCls }: { icon: React.ReactNode; label: string; value: string; sub?: string; subCls?: string }) {
  return (
    <div className="rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] p-2.5">
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-biz-muted)]">
        {icon} {label}
      </p>
      <p className="mt-1 text-sm font-bold">{value}</p>
      {sub ? <p className={`text-[11px] font-medium ${subCls ?? ""}`}>{sub}</p> : null}
    </div>
  );
}
