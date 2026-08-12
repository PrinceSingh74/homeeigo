"use client";

import { memo, useMemo } from "react";
import { Radio, Loader2, AlertTriangle, Circle } from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { useAdminOpsMapQuery } from "@/hooks/use-admin-data";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { OPS_MAP_POLL_MS } from "@/lib/query-polling";
import {
  BookingMarker,
  GeofenceMarker,
  ProviderMarker,
  type MapBounds,
} from "@/components/operations/OpsMapMarkers";
import { type OpsMapData } from "@/services/admin-api";

function bounds(pts: { lat: number; lng: number }[]): MapBounds {
  if (pts.length === 0) return { minLat: 8, maxLat: 37, minLng: 68, maxLng: 97 };
  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.02;
  return {
    minLat: Math.min(...lats) - pad,
    maxLat: Math.max(...lats) + pad,
    minLng: Math.min(...lngs) - pad,
    maxLng: Math.max(...lngs) + pad,
  };
}

const MARKER_CAP = 48;

function sample<T>(items: T[], cap: number): T[] {
  if (items.length <= cap) return items;
  const step = items.length / cap;
  const out: T[] = [];
  for (let i = 0; i < cap; i += 1) out.push(items[Math.floor(i * step)]!);
  return out;
}

const OpsLiveMap = memo(function OpsLiveMap({ data }: { data: OpsMapData }) {
  useRenderProbe("OpsLiveMap");
  const allPoints = useMemo(
    () => [...(data.providers ?? []), ...(data.bookings ?? [])],
    [data.providers, data.bookings],
  );
  const b = useMemo(() => bounds(allPoints), [allPoints]);
  const geofences = useMemo(() => sample(data.geofences ?? [], MARKER_CAP), [data.geofences]);
  const bookings = useMemo(() => sample(data.bookings ?? [], MARKER_CAP), [data.bookings]);
  const providers = useMemo(() => sample(data.providers ?? [], MARKER_CAP), [data.providers]);

  return (
    <>
      <div
        className="relative aspect-[16/10] w-full overflow-hidden rounded-xl border border-slate-700 shadow-inner"
        style={{
          backgroundColor: "#0b1220",
          backgroundImage:
            "radial-gradient(circle at 50% 40%, rgba(56,189,248,0.10), transparent 60%)," +
            "linear-gradient(rgba(148,163,184,0.10) 1px, transparent 1px)," +
            "linear-gradient(90deg, rgba(148,163,184,0.10) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 40px 40px, 40px 40px",
        }}
      >
        <span className="pointer-events-none absolute left-2 top-2 z-10 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-300">
          ● LIVE · {allPoints.length} units
        </span>
        <span className="pointer-events-none absolute bottom-2 left-2 z-10 text-[10px] text-slate-500">
          {b.minLat.toFixed(2)}, {b.minLng.toFixed(2)}
        </span>
        <span className="pointer-events-none absolute right-2 top-2 z-10 text-[10px] text-slate-500">
          {b.maxLat.toFixed(2)}, {b.maxLng.toFixed(2)}
        </span>

        {geofences.map((g) => (
          <GeofenceMarker
            key={g.id}
            id={g.id}
            name={g.name}
            centerLat={g.centerLat}
            centerLng={g.centerLng}
            bounds={b}
          />
        ))}
        {bookings.map((bk) => (
          <BookingMarker
            key={bk.bookingId}
            bookingId={bk.bookingId}
            status={bk.status}
            lat={bk.lat}
            lng={bk.lng}
            bounds={b}
          />
        ))}
        {providers.map((p) => (
          <ProviderMarker
            key={p.providerId}
            providerId={p.providerId}
            name={p.name}
            status={p.status}
            lat={p.lat}
            lng={p.lng}
            bounds={b}
          />
        ))}
        {allPoints.length === 0 && (
          <div className="grid h-full place-items-center text-sm text-slate-500">
            No live providers or bookings.
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <Circle size={9} fill="#10b981" className="text-emerald-500" /> Online
        </span>
        <span className="flex items-center gap-1">
          <Circle size={9} fill="#f59e0b" className="text-amber-500" /> Busy
        </span>
        <span className="flex items-center gap-1">
          <Circle size={9} fill="#9ca3af" className="text-gray-400" /> Offline
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-2 rotate-45 bg-sky-400" /> Booking
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full border border-indigo-400/60" /> Geofence
        </span>
      </div>
    </>
  );
});

/** Admin > Operations > Live Map. Reuses GET /api/admin/ops-map — 60s poll safety net. */
function OperationsPageInner() {
  useRenderProbe("OperationsPage");
  useMountProbe("OperationsPage");
  const q = useAdminOpsMapQuery(OPS_MAP_POLL_MS);
  const data = q.data as OpsMapData | undefined;

  return (
    <div className="space-y-6 p-1">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900">
            <Radio size={22} className="text-emerald-500" /> Live Operations
          </h1>
          <p className="text-sm text-gray-500">Real-time city command center · auto-refresh 60s</p>
        </div>
        {q.isFetching && <Loader2 size={18} className="animate-spin text-gray-400" />}
      </header>

      {q.isLoading ? (
        <div className="flex items-center gap-2 p-10 text-gray-500">
          <Loader2 className="animate-spin" /> Loading operations…
        </div>
      ) : q.isError || !data ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-700">
          Could not load the operations map.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="Online providers" value={String(data.metrics.onlineProviders)} />
            <KpiCard label="Busy" value={String(data.metrics.busyProviders)} />
            <KpiCard label="Active bookings" value={String(data.metrics.activeBookings)} />
            <KpiCard label="Avg ETA" value={`${data.metrics.averageEtaMin}m`} />
            <KpiCard label="Service gaps" value={String(data.metrics.serviceGaps)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <OpsLiveMap data={data} />
            </div>

            <div className="rounded-xl border bg-white p-4">
              <h2 className="mb-3 flex items-center gap-2 font-semibold text-gray-900">
                <AlertTriangle size={16} className="text-amber-500" /> Alerts ({data.alerts.length})
              </h2>
              <div className="max-h-80 space-y-2 overflow-auto">
                {data.alerts.length === 0 ? (
                  <p className="text-sm text-gray-400">No active alerts.</p>
                ) : (
                  data.alerts.slice(0, 50).map((a, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border-l-4 p-2 text-xs ${a.severity === "critical" ? "border-red-500 bg-red-50 text-red-700" : "border-amber-400 bg-amber-50 text-amber-700"}`}
                    >
                      <span className="font-semibold">{a.type.replace(/_/g, " ")}</span> — {a.message}
                      {a.bookingId && (
                        <span className="block text-[10px] opacity-70">#{a.bookingId.slice(-6)}</span>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default memo(OperationsPageInner);
