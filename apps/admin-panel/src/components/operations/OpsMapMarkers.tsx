"use client";

import { memo } from "react";

const STATUS_COLOR: Record<string, string> = {
  ONLINE: "#10b981",
  BUSY: "#f59e0b",
  OFFLINE: "#9ca3af",
};

export type MapBounds = {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
};

const pct = (v: number, min: number, max: number) => (max === min ? 50 : ((v - min) / (max - min)) * 100);

export const GeofenceMarker = memo(function GeofenceMarker({
  id,
  name,
  centerLat,
  centerLng,
  bounds,
}: {
  id: string;
  name: string;
  centerLat: number;
  centerLng: number;
  bounds: MapBounds;
}) {
  return (
    <span
      title={name}
      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border border-indigo-400/50"
      style={{
        left: `${pct(centerLng, bounds.minLng, bounds.maxLng)}%`,
        top: `${pct(centerLat, bounds.maxLat, bounds.minLat)}%`,
        width: 56,
        height: 56,
        background: "radial-gradient(circle, rgba(129,140,248,0.18), transparent 70%)",
      }}
    />
  );
});

export const BookingMarker = memo(function BookingMarker({
  bookingId,
  status,
  lat,
  lng,
  bounds,
}: {
  bookingId: string;
  status: string;
  lat: number;
  lng: number;
  bounds: MapBounds;
}) {
  return (
    <span
      title={`Booking ${status}`}
      className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[2px] bg-sky-400"
      style={{
        left: `${pct(lng, bounds.minLng, bounds.maxLng)}%`,
        top: `${pct(lat, bounds.maxLat, bounds.minLat)}%`,
        boxShadow: "0 0 8px 1px rgba(56,189,248,0.7)",
      }}
    />
  );
});

export const ProviderMarker = memo(function ProviderMarker({
  providerId,
  name,
  status,
  lat,
  lng,
  bounds,
}: {
  providerId: string;
  name: string;
  status: string;
  lat: number;
  lng: number;
  bounds: MapBounds;
}) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.OFFLINE;
  return (
    <span
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${pct(lng, bounds.minLng, bounds.maxLng)}%`,
        top: `${pct(lat, bounds.maxLat, bounds.minLat)}%`,
      }}
    >
      <span
        title={`${name} · ${status}`}
        className="relative block h-3 w-3 rounded-full ring-2 ring-slate-900"
        style={{ background: color, boxShadow: `0 0 10px 2px ${color}` }}
      />
    </span>
  );
});
