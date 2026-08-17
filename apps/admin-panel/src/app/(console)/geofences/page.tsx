"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Circle,
  ExternalLink,
  Hexagon,
  IndianRupee,
  Loader2,
  MapPinned,
  Plus,
  Power,
  Radio,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D, type Icon3DTone } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { MapDOMIsolationBoundary } from "@/components/perf/MapDOMIsolationBoundary";
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";
import { adminApi, type Geofence, type GeofenceInput, type ZoneAnalyticsRow } from "@/services/admin-api";
import { formatNumber, inr } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { DrawMode, GeofenceDraft } from "@/components/geo/GeofenceOpsMap";

const GeofenceOpsMap = dynamic(
  () => import("@/components/geo/GeofenceOpsMap").then((m) => m.GeofenceOpsMap),
  {
    ssr: false,
    loading: () => (
      <div className="cmd-card cmd-map-frame geo-map-frame grid place-items-center text-sm" style={{ color: "var(--cmd-muted)" }}>
        Loading zone map…
      </div>
    ),
  },
);

const EMPTY: GeofenceInput = {
  name: "",
  centerLat: 28.4595,
  centerLng: 77.0269,
  radiusMeters: 800,
  city: "Gurugram",
  state: "Haryana",
  zoneType: "SERVICE_ZONE",
  shape: "CIRCLE",
  surgeMultiplier: 1,
};

const inIndia = (lat: number, lng: number) => lat >= 6.5 && lat <= 37.5 && lng >= 67.5 && lng <= 97.5;

const ZONE_META: Record<
  string,
  { label: string; tone: Icon3DTone; pill: "is-good" | "is-warm" | "is-hot"; hint: string }
> = {
  SERVICE_ZONE: { label: "Service", tone: "success", pill: "is-good", hint: "Bookable coverage ring" },
  SOCIETY: { label: "Society", tone: "warning", pill: "is-warm", hint: "Gated community" },
  PREMIUM_AREA: { label: "Premium", tone: "cyan", pill: "is-good", hint: "High-value cluster" },
  CITY: { label: "City", tone: "default", pill: "is-good", hint: "Metro boundary" },
};

const RADIUS_PRESETS = [
  { label: "Society", m: 300 },
  { label: "Colony", m: 800 },
  { label: "District", m: 2500 },
  { label: "City", m: 8000 },
] as const;

const TYPES = ["SERVICE_ZONE", "SOCIETY", "PREMIUM_AREA", "CITY"] as const;

function tidyZone(name: string) {
  return (
    name
      .replace(/\b(polygon|geofence|smoke zone|ncr|zone)\b/gi, " ")
      .replace(/[—–_|]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || name
  );
}

function formatRadius(m: number) {
  if (m >= 1000) return `${(m / 1000).toFixed(m >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(m)} m`;
}

function coverageKm2(zones: Geofence[]) {
  const m2 = zones.filter((z) => z.isActive).reduce((s, z) => s + Math.PI * z.radiusMeters ** 2, 0);
  return m2 / 1_000_000;
}

function relTime(iso: string) {
  const d = Date.now() - new Date(iso).getTime();
  if (d < 45_000) return "just now";
  if (d < 3_600_000) return `${Math.max(1, Math.floor(d / 60_000))}m ago`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
  return new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function zoneBrief(g: Geofence, row?: ZoneAnalyticsRow) {
  if (!g.isActive) {
    return {
      meaning: `${tidyZone(g.name)} is offline. Tracking and serviceability ignore it.`,
      impact: "Partners can pass through without ENTER/EXIT. Bookings will not treat this as coverage.",
      action: "Turn it on when this area should count as live coverage again.",
    };
  }
  const util = row?.utilization ?? 0;
  const surge = g.surgeMultiplier ?? 1;
  if (g.zoneType === "PREMIUM_AREA") {
    return {
      meaning: "Premium cluster — high-intent homes, tight SLA expectation.",
      impact: `Surge ×${surge.toFixed(2)} · ${formatNumber(row?.supply ?? 0)} partners inside · ${formatNumber(row?.demand ?? 0)} jobs / 24h.`,
      action: "Keep elite partners staged nearby. Do not widen the radius unless supply is thin.",
    };
  }
  if (util >= 2) {
    return {
      meaning: "Demand is outrunning supply inside this fence.",
      impact: `${formatNumber(row?.demand ?? 0)} bookings vs ${formatNumber(row?.supply ?? 0)} online partners. Utilization ${util}.`,
      action: "Raise surge or pull idle partners in from neighbouring zones.",
    };
  }
  if ((row?.demand ?? 0) === 0) {
    return {
      meaning: "Fence is live but quiet in the last 24 hours.",
      impact: "No booking signal inside the ring. Coverage still counts for serviceability.",
      action: "Confirm the pin and radius match the real catchment, or pause it.",
    };
  }
  return {
    meaning: `${ZONE_META[g.zoneType]?.hint ?? "Service coverage"} is operating normally.`,
    impact: `${formatNumber(row?.supply ?? 0)} supply · ${formatNumber(row?.demand ?? 0)} demand · ${inr(row?.revenue ?? 0, true)} / 24h.`,
    action: "No fence action. Watch Live Ops if utilization climbs.",
  };
}

const field =
  "w-full rounded-xl border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] px-3 py-2.5 text-sm text-[var(--color-biz-text)] placeholder:text-[var(--color-biz-muted)] outline-none transition focus:border-[var(--color-biz-accent)] focus:ring-2 focus:ring-[var(--color-biz-accent)]/20";
const fieldLabel = "mb-1.5 block text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]";

export default function GeofencesPage() {
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "create" | "inspect">("idle");
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [pulse, setPulse] = useState(false);
  const [form, setForm] = useState<GeofenceInput>(EMPTY);
  const [err, setErr] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "off">("all");
  const [pendingDelete, setPendingDelete] = useState<Geofence | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLElement>(null);

  const list = useQuery({
    queryKey: ["admin", "geofences"],
    queryFn: () => adminApi.geofences.list({}),
    staleTime: 20_000,
  });
  const analyticsQ = useQuery({
    queryKey: ["geo-zone-analytics"],
    queryFn: () => adminApi.zoneAnalytics(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const eventsQ = useQuery({
    queryKey: ["admin", "geofence-events"],
    queryFn: () => adminApi.geofences.events({ limit: 100 }),
    staleTime: 10_000,
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
  });

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ["admin", "geofences"] });
    void qc.invalidateQueries({ queryKey: ["geo-zone-analytics"] });
    void qc.invalidateQueries({ queryKey: ["admin", "geofence-events"] });
  };

  const createM = useMutation({
    mutationFn: (b: GeofenceInput) => adminApi.geofences.create(b),
    onSuccess: (g) => {
      setForm(EMPTY);
      setSelectedId(g.id);
      setMode("inspect");
      setErr("");
      invalidate();
    },
    onError: () => setErr("Could not create this geofence"),
  });
  const updateM = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<GeofenceInput> & { isActive?: boolean } }) =>
      adminApi.geofences.update(id, body),
    onSuccess: invalidate,
    onError: () => setErr("Could not save changes"),
  });
  const toggleM = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => adminApi.geofences.update(id, { isActive }),
    onSuccess: invalidate,
  });
  const deleteM = useMutation({
    mutationFn: (id: string) => adminApi.geofences.remove(id),
    onSuccess: () => {
      setSelectedId(null);
      setMode("idle");
      setForm(EMPTY);
      setDrawMode("none");
      setPendingDelete(null);
      invalidate();
    },
  });

  const geofences = list.data ?? [];
  const analyticsById = useMemo(() => {
    const map = new Map<string, ZoneAnalyticsRow>();
    for (const z of analyticsQ.data?.zones ?? []) map.set(z.id, z);
    return map;
  }, [analyticsQ.data]);

  const selected = geofences.find((g) => g.id === selectedId) ?? null;
  const selectedRow = selected ? analyticsById.get(selected.id) : undefined;
  const brief = selected ? zoneBrief(selected, selectedRow) : null;
  const selectedMeta = selected ? (ZONE_META[selected.zoneType] ?? ZONE_META.SERVICE_ZONE) : null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return geofences.filter((g) => {
      if (typeFilter !== "ALL" && g.zoneType !== typeFilter) return false;
      if (statusFilter === "active" && !g.isActive) return false;
      if (statusFilter === "off" && g.isActive) return false;
      if (!q) return true;
      return `${g.name} ${g.city ?? ""} ${g.state ?? ""} ${g.zoneType}`.toLowerCase().includes(q);
    });
  }, [geofences, search, typeFilter, statusFilter]);

  const events = eventsQ.data ?? [];
  const events24h = useMemo(() => {
    const since = Date.now() - 86_400_000;
    return events.filter((e) => new Date(e.createdAt).getTime() >= since);
  }, [events]);
  const selectedEvents = selectedId ? events.filter((e) => e.geofenceId === selectedId) : events;
  const enters = events24h.filter((e) => e.eventType === "ENTER").length;

  const cities = useMemo(() => {
    const set = new Set<string>();
    for (const g of geofences) if (g.city) set.add(g.city);
    return [...set].sort();
  }, [geofences]);

  const demandSeries = useMemo(
    () =>
      [...(analyticsQ.data?.zones ?? [])]
        .sort((a, b) => b.demand - a.demand)
        .slice(0, 8)
        .map((z) => ({ label: tidyZone(z.name).slice(0, 12), value: z.demand })),
    [analyticsQ.data],
  );
  const typeSeries = useMemo(() => {
    const counts: Record<string, number> = { Service: 0, Society: 0, Premium: 0, City: 0 };
    for (const g of geofences) {
      const label = ZONE_META[g.zoneType]?.label ?? "Service";
      counts[label] = (counts[label] ?? 0) + 1;
    }
    return Object.entries(counts).map(([label, value]) => ({ label, value }));
  }, [geofences]);

  const active = geofences.filter((g) => g.isActive);
  const coverage = coverageKm2(active);
  const peakSurge = Math.max(1, ...active.map((g) => g.surgeMultiplier ?? 1));

  const closePanel = useCallback(() => {
    setSelectedId(null);
    setMode("idle");
    setForm(EMPTY);
    setErr("");
    setDrawMode("none");
  }, []);

  const startCreate = useCallback((shape: DrawMode = "circle") => {
    setSelectedId(null);
    setMode("create");
    setForm(EMPTY);
    setErr("");
    setDrawMode(shape === "none" ? "circle" : shape);
    setPulse(true);
    window.setTimeout(() => setPulse(false), 1400);
    stageRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => nameRef.current?.focus(), 280);
  }, []);

  const onDrawModeChange = useCallback((next: DrawMode) => {
    setDrawMode(next);
    if (next !== "none") {
      setSelectedId(null);
      setMode("create");
    }
  }, []);

  const onDraft = useCallback((d: GeofenceDraft) => {
    setSelectedId(null);
    setMode("create");
    setDrawMode("none");
    setErr("");
    setForm((f) => ({
      ...f,
      centerLat: Number(d.centerLat.toFixed(5)),
      centerLng: Number(d.centerLng.toFixed(5)),
      radiusMeters: d.radiusMeters,
      shape: d.shape,
      polygon: d.shape === "POLYGON" ? d.polygon : undefined,
    }));
    window.setTimeout(() => nameRef.current?.focus(), 80);
  }, []);

  const onPickCenter = useCallback((p: { lat: number; lng: number }) => {
    setForm((f) => ({ ...f, centerLat: Number(p.lat.toFixed(5)), centerLng: Number(p.lng.toFixed(5)) }));
  }, []);

  const hydrateInspect = useCallback((g: Geofence) => {
    setSelectedId(g.id);
    setMode("inspect");
    setDrawMode("none");
    setErr("");
    setForm({
      name: g.name,
      centerLat: g.centerLat,
      centerLng: g.centerLng,
      radiusMeters: g.radiusMeters,
      city: g.city ?? "",
      state: g.state ?? "",
      zoneType: g.zoneType,
      shape: g.shape ?? "CIRCLE",
      polygon: g.polygon ?? undefined,
      surgeMultiplier: g.surgeMultiplier ?? 1,
    });
  }, []);

  const selectById = useCallback(
    (id: string) => {
      const g = geofences.find((z) => z.id === id);
      if (g) hydrateInspect(g);
    },
    [geofences, hydrateInspect],
  );

  const submit = () => {
    setErr("");
    if (form.name.trim().length < 2) return setErr("Name required");
    if (!inIndia(form.centerLat, form.centerLng)) return setErr("Centre must be inside India");
    if (form.radiusMeters <= 0 || form.radiusMeters > 100_000) return setErr("Radius must be 1–100000 m");
    const payload: GeofenceInput = {
      ...form,
      name: form.name.trim(),
      city: form.city?.trim() || undefined,
      state: form.state?.trim() || undefined,
      surgeMultiplier: form.surgeMultiplier ?? 1,
    };
    if (mode === "inspect" && selectedId) {
      updateM.mutate({
        id: selectedId,
        body: {
          name: payload.name,
          centerLat: payload.centerLat,
          centerLng: payload.centerLng,
          radiusMeters: payload.radiusMeters,
          city: payload.city,
          state: payload.state,
          zoneType: payload.zoneType,
          surgeMultiplier: payload.surgeMultiplier,
        },
      });
      return;
    }
    if (
      geofences.some(
        (g) =>
          g.name.toLowerCase() === payload.name.toLowerCase() &&
          Math.abs(g.centerLat - payload.centerLat) < 1e-4 &&
          Math.abs(g.centerLng - payload.centerLng) < 1e-4,
      )
    ) {
      return setErr("A geofence with this name + centre already exists");
    }
    createM.mutate(payload);
  };

  const busy = createM.isPending || updateM.isPending;
  const preview = {
    centerLat: form.centerLat,
    centerLng: form.centerLng,
    radiusMeters: form.radiusMeters,
    visible: mode !== "idle" && (form.shape ?? "CIRCLE") !== "POLYGON" && drawMode === "none",
  };

  const refresh = () => {
    void list.refetch();
    void analyticsQ.refetch();
    void eventsQ.refetch();
  };

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      <header className="gf-masthead">
        <div className="flex min-w-0 items-start gap-4">
          <Icon3D icon={MapPinned} tone="cyan" size="lg" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Zone Control</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                Live fences
              </span>
            </div>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Draw coverage on the map. Click New zone, drop a circle, name it — entry/exit and surge run off these fences.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => startCreate("circle")} className="biz-btn biz-btn-primary [&_svg]:text-white">
            <Plus size={14} />
            New zone
          </button>
          <button type="button" onClick={refresh} className="biz-btn">
            <RefreshCw size={14} className={list.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Active zones"
          value={`${formatNumber(active.length)}/${formatNumber(geofences.length)}`}
          sub={`${cities.length} cities on the board`}
          icon={MapPinned}
          tone="accent"
          loading={list.isLoading}
        />
        <StatTile
          label="Gross coverage"
          value={coverage >= 10 ? `${coverage.toFixed(0)} km²` : `${coverage.toFixed(1)} km²`}
          sub="Active circles, overlaps included"
          icon={Hexagon}
          tone="success"
          loading={list.isLoading}
        />
        <StatTile
          label="Zone crossings"
          value={formatNumber(events24h.length)}
          sub={`${enters} enter · ${events24h.length - enters} exit · 24h`}
          icon={Radio}
          tone={events24h.length > 0 ? "accent" : "default"}
          loading={eventsQ.isLoading}
        />
        <StatTile
          label="Zone revenue"
          value={analyticsQ.data ? inr(analyticsQ.data.totals.revenue, true) : "—"}
          sub={`Peak surge ×${peakSurge.toFixed(2)}`}
          icon={IndianRupee}
          tone={analyticsQ.data && analyticsQ.data.totals.revenue > 0 ? "success" : "default"}
          loading={analyticsQ.isLoading}
        />
      </section>

      {selected && selectedMeta && brief ? (
        <section className={cn("gf-hero", `gf-hero--${selected.zoneType.toLowerCase()}`)}>
            <div className="wx-hero__grid">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <Icon3D icon={selected.zoneType === "PREMIUM_AREA" ? Sparkles : MapPinned} size="md" tone={selectedMeta.tone} />
                <span className={cn("ops-alert-pill", selectedMeta.pill)}>{selectedMeta.label}</span>
                <span className={cn("ops-alert-pill", selected.isActive ? "is-good" : "is-hot")}>
                  {selected.isActive ? "Active" : "Offline"}
                </span>
                <span className="ops-alert-pill is-warm">{selected.shape ?? "CIRCLE"}</span>
              </div>
              <h2 className="mt-4 truncate text-[1.55rem] font-bold leading-tight tracking-tight">{tidyZone(selected.name)}</h2>
              <p className="mt-1.5 text-sm text-[var(--color-biz-muted)]">
                {[selected.city, selected.state].filter(Boolean).join(" · ") || "Unassigned city"} · {formatRadius(selected.radiusMeters)}
              </p>
              <p data-stat-value className="gf-hero__metric">
                ×{(selected.surgeMultiplier ?? 1).toFixed(2)}
                <span>surge</span>
              </p>
            </div>
            <dl className="wx-stat-grid">
              <div className="wx-stat">
                <dt>Supply</dt>
                <dd>{formatNumber(selectedRow?.supply ?? 0)}</dd>
              </div>
              <div className="wx-stat">
                <dt>Demand 24h</dt>
                <dd>{formatNumber(selectedRow?.demand ?? 0)}</dd>
              </div>
              <div className="wx-stat">
                <dt>Revenue</dt>
                <dd>{inr(selectedRow?.revenue ?? 0, true)}</dd>
              </div>
              <div className="wx-stat">
                <dt>Utilization</dt>
                <dd>{selectedRow?.utilization ?? 0}</dd>
              </div>
              <div className="wx-stat">
                <dt>Completed</dt>
                <dd>{formatNumber(selectedRow?.completed ?? 0)}</dd>
              </div>
              <div className="wx-stat">
                <dt>Cancelled</dt>
                <dd>{formatNumber(selectedRow?.cancelled ?? 0)}</dd>
              </div>
            </dl>
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
                <Link href="/geospatial" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                  Geo Command <ExternalLink size={11} />
                </Link>
                <Link href="/operations" className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--color-biz-accent)]">
                  Live Ops <ExternalLink size={11} />
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      <section ref={stageRef} className={cn("gf-stage", mode === "create" && "is-composing")}>
        <MapPerformanceBoundary label="GeofenceOpsMap" className="h-full min-h-0 w-full" deferAfterPaint rootMargin="80px">
          <MapDOMIsolationBoundary label="GeofenceOpsMap" className="flex h-full min-h-0 w-full">
            <GeofenceOpsMap
              zones={geofences}
              selectedId={selectedId}
              preview={preview}
              drawMode={drawMode}
              onDrawModeChange={onDrawModeChange}
              onSelect={selectById}
              onDraft={onDraft}
              onPickCenter={mode === "idle" ? undefined : onPickCenter}
              className="h-full w-full"
            />
          </MapDOMIsolationBoundary>
        </MapPerformanceBoundary>

        <aside className={cn("biz-glass-panel gf-dock flex min-h-0 flex-col overflow-hidden p-5", mode === "create" && "is-compose", pulse && "is-pulse")}>
          {mode === "idle" ? (
            <>
              <SectionHead
                icon={Radio}
                tone="cyan"
                title="Live crossings"
                subtitle="Partner and customer enter / exit"
                meta={`${events24h.length} / 24h`}
              />
              <button type="button" onClick={() => startCreate("circle")} className="gf-cta">
                <Icon3D icon={Plus} size="md" tone="cyan" />
                <span className="min-w-0 text-left">
                  <span className="block text-sm font-bold tracking-tight">New zone</span>
                  <span className="mt-1 block text-xs leading-relaxed text-[var(--color-biz-muted)]">
                    Draw a circle on the map, name it, and go live.
                  </span>
                </span>
              </button>
              <div className="mb-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => startCreate("circle")} className="gf-type">
                  <Circle size={12} /> Circle
                </button>
                <button type="button" onClick={() => startCreate("polygon")} className="gf-type">
                  <Hexagon size={12} /> Polygon
                </button>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-auto pr-1">
                {eventsQ.isLoading ? (
                  <p className="text-xs text-[var(--color-biz-muted)]">Loading events…</p>
                ) : events.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-[var(--color-biz-line)] px-3 py-8 text-center text-xs text-[var(--color-biz-muted)]">
                    No entry/exit events yet. New zones start recording as soon as partners cross them.
                  </p>
                ) : (
                  events.slice(0, 14).map((ev) => (
                    <button
                      key={ev.id}
                      type="button"
                      className="gf-event w-full text-left"
                      onClick={() => {
                        const g = geofences.find((z) => z.id === ev.geofenceId);
                        if (g) hydrateInspect(g);
                      }}
                    >
                      <span className={cn("ops-alert-pill", ev.eventType === "ENTER" ? "is-good" : "is-warm")}>{ev.eventType}</span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{ev.geofence?.name ?? tidyZone(geofences.find((g) => g.id === ev.geofenceId)?.name ?? "Zone")}</p>
                        <p className="text-[10px] text-[var(--color-biz-muted)]">{relTime(ev.createdAt)}</p>
                      </div>
                    </button>
                  ))
                )}
              </div>
            </>
          ) : (
            <>
          <SectionHead
            icon={mode === "create" ? Plus : Activity}
            tone={mode === "create" ? "cyan" : "success"}
            title={mode === "create" ? "Compose zone" : "Zone inspector"}
            subtitle={
              drawMode !== "none"
                ? "Click the map — centre first, then the edge"
                : mode === "create"
                  ? "Name the fence, then create it"
                  : "Tune radius, surge, and status"
            }
            meta={mode === "create" ? form.shape ?? "CIRCLE" : selectedMeta?.label}
            action={
              <button type="button" onClick={closePanel} className="rounded-lg p-1.5 text-[var(--color-biz-muted)] hover:bg-[var(--color-biz-elevated)]" aria-label="Close composer">
                <X size={16} />
              </button>
            }
          />

          <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
            <div>
              <label className={fieldLabel}>Name</label>
              <input ref={nameRef} className={field} placeholder="e.g. DLF Camellias" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              {mode === "create" && drawMode !== "none" ? (
                <p className="gf-compose-hint">Map is armed. Click the centre, then drag to the edge.</p>
              ) : null}
            </div>
            <div>
              <p className={fieldLabel}>Zone type</p>
              <div className="grid grid-cols-2 gap-1.5">
                {TYPES.map((t) => {
                  const meta = ZONE_META[t]!;
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm({ ...form, zoneType: t })}
                      className={cn("gf-type", form.zoneType === t && "is-on")}
                    >
                      {meta.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>City</label>
                <input className={field} list="gf-cities" placeholder="Gurugram" value={form.city ?? ""} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                <datalist id="gf-cities">
                  {cities.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className={fieldLabel}>State</label>
                <input className={field} placeholder="Haryana" value={form.state ?? ""} onChange={(e) => setForm({ ...form, state: e.target.value })} />
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">Radius</label>
                <span className="text-xs font-bold tabular-nums">{formatRadius(form.radiusMeters)}</span>
              </div>
              <input
                type="range"
                min={80}
                max={20000}
                step={20}
                value={Math.min(20_000, form.radiusMeters)}
                onChange={(e) => setForm({ ...form, radiusMeters: Number(e.target.value) })}
                className="gf-range"
              />
              <div className="mt-2 flex flex-wrap gap-1.5">
                {RADIUS_PRESETS.map((p) => (
                  <button key={p.m} type="button" onClick={() => setForm({ ...form, radiusMeters: p.m })} className={cn("gf-chip", form.radiusMeters === p.m && "is-on")}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">Surge</label>
                <span className="text-xs font-bold tabular-nums">×{(form.surgeMultiplier ?? 1).toFixed(2)}</span>
              </div>
              <input
                type="range"
                min={1}
                max={2.5}
                step={0.05}
                value={form.surgeMultiplier ?? 1}
                onChange={(e) => setForm({ ...form, surgeMultiplier: Number(e.target.value) })}
                className="gf-range"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={fieldLabel}>Latitude</label>
                <input className={field} type="number" step="0.0001" value={form.centerLat} onChange={(e) => setForm({ ...form, centerLat: Number(e.target.value) })} />
              </div>
              <div>
                <label className={fieldLabel}>Longitude</label>
                <input className={field} type="number" step="0.0001" value={form.centerLng} onChange={(e) => setForm({ ...form, centerLng: Number(e.target.value) })} />
              </div>
            </div>
            {err ? <p className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-400">{err}</p> : null}
            <button type="button" onClick={submit} disabled={busy} className="biz-btn biz-btn-primary w-full justify-center [&_svg]:text-white">
              {busy ? <Loader2 size={14} className="animate-spin" /> : mode === "create" ? <Plus size={14} /> : <Circle size={14} />}
              {busy ? "Saving…" : mode === "create" ? "Create geofence" : "Save changes"}
            </button>
            {mode === "inspect" && selected ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => toggleM.mutate({ id: selected.id, isActive: !selected.isActive })}
                  className="biz-btn flex-1 justify-center"
                >
                  <Power size={14} />
                  {selected.isActive ? "Pause" : "Activate"}
                </button>
                <button type="button" onClick={() => setPendingDelete(selected)} className="biz-btn flex-1 justify-center text-[var(--color-biz-danger)]">
                  <Trash2 size={14} />
                  Delete
                </button>
              </div>
            ) : null}

            <div className="border-t border-[var(--color-biz-line)] pt-3">
              <p className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
                <Radio size={12} /> {selected ? "This fence" : "Live crossings"}
              </p>
              {eventsQ.isLoading ? (
                <p className="text-xs text-[var(--color-biz-muted)]">Loading events…</p>
              ) : selectedEvents.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--color-biz-line)] px-3 py-6 text-center text-xs text-[var(--color-biz-muted)]">
                  No entry/exit events yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {selectedEvents.slice(0, 12).map((ev) => (
                    <div key={ev.id} className="gf-event">
                      <span className={cn("ops-alert-pill", ev.eventType === "ENTER" ? "is-good" : "is-warm")}>{ev.eventType}</span>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{ev.geofence?.name ?? tidyZone(geofences.find((g) => g.id === ev.geofenceId)?.name ?? "Zone")}</p>
                        <p className="text-[10px] text-[var(--color-biz-muted)]">{relTime(ev.createdAt)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
            </>
          )}
        </aside>
      </section>

      <section className="biz-glass-panel p-6">
        <SectionHead
          icon={MapPinned}
          tone="cyan"
          title="Zone registry"
          subtitle="Search, filter, and jump to a fence"
          meta={`${filtered.length}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative">
                <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-biz-muted)]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or city…"
                  className="h-9 w-48 rounded-lg border border-[var(--color-biz-line)] bg-[var(--color-biz-bg)] pl-8 pr-3 text-sm outline-none focus:border-[var(--color-biz-accent)]"
                />
              </label>
            </div>
          }
        />
        <div className="mb-4 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setTypeFilter("ALL")} className={cn("gf-chip", typeFilter === "ALL" && "is-on")}>
            All types
          </button>
          {TYPES.map((t) => (
            <button key={t} type="button" onClick={() => setTypeFilter(t)} className={cn("gf-chip", typeFilter === t && "is-on")}>
              {ZONE_META[t]?.label}
            </button>
          ))}
          <span className="mx-1 h-6 w-px bg-[var(--color-biz-line)]" />
          {(["all", "active", "off"] as const).map((s) => (
            <button key={s} type="button" onClick={() => setStatusFilter(s)} className={cn("gf-chip", statusFilter === s && "is-on")}>
              {s === "all" ? "Any status" : s === "active" ? "Active" : "Offline"}
            </button>
          ))}
        </div>

        {list.isLoading ? (
          <div className="flex items-center gap-2 py-10 text-[var(--color-biz-muted)]">
            <Loader2 className="animate-spin" size={16} /> Loading zones…
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border border-dashed border-[var(--color-biz-line)] px-4 py-10 text-center text-sm text-[var(--color-biz-muted)]">
            No geofences match. Draw a circle on the map to define coverage.
          </p>
        ) : (
          <div className="gf-board">
            {filtered.map((g) => {
              const meta = ZONE_META[g.zoneType] ?? ZONE_META.SERVICE_ZONE!;
              const row = analyticsById.get(g.id);
              const on = selectedId === g.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => (on ? closePanel() : hydrateInspect(g))}
                  className={cn("gf-card", `gf-card--${g.zoneType.toLowerCase()}`, on && "is-on", !g.isActive && "is-off")}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 text-left">
                      <p className="gf-card__name">{tidyZone(g.name)}</p>
                      <p className="gf-card__meta">
                        {g.city ?? "—"} · {formatRadius(g.radiusMeters)}
                      </p>
                    </div>
                    <span className={cn("ops-alert-pill shrink-0", meta.pill)}>{meta.label}</span>
                  </div>
                  <dl className="gf-card__stats">
                    <div>
                      <dt>Supply</dt>
                      <dd>{formatNumber(row?.supply ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Demand</dt>
                      <dd>{formatNumber(row?.demand ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>Surge</dt>
                      <dd>×{(g.surgeMultiplier ?? 1).toFixed(2)}</dd>
                    </div>
                  </dl>
                  <div className="mt-3 flex items-center justify-between">
                    <span className={cn("ops-alert-pill", g.isActive ? "is-good" : "is-hot")}>{g.isActive ? "Active" : "Offline"}</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-biz-muted)]">
                      {g.shape === "POLYGON" ? "Polygon" : "Circle"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="biz-glass-panel min-w-0 p-6">
          <SectionHead icon={Users} tone="warning" title="Demand by zone" subtitle="Live booking signal inside each fence" meta="24h" />
          {demandSeries.some((d) => d.value > 0) ? (
            <IsoBarChart data={demandSeries} format={formatNumber} accent="amber" layout="area" height={240} />
          ) : (
            <p className="text-sm text-[var(--color-biz-muted)]">No demand inside fences yet.</p>
          )}
        </div>
        <div className="biz-glass-panel min-w-0 p-6">
          <SectionHead icon={Hexagon} tone="cyan" title="Fence mix" subtitle="How coverage is typed across the network" meta={`${geofences.length}`} />
          {geofences.length ? (
            <IsoBarChart data={typeSeries} format={formatNumber} accent="blue" layout="column" height={240} />
          ) : (
            <p className="text-sm text-[var(--color-biz-muted)]">Create a zone to see the mix.</p>
          )}
        </div>
      </section>

      <ConfirmDialog
        open={!!pendingDelete}
        title="Delete this geofence?"
        description={
          pendingDelete
            ? `${tidyZone(pendingDelete.name)} and its entry/exit history will be removed. Serviceability for this ring stops immediately.`
            : undefined
        }
        confirmLabel="Delete zone"
        destructive
        isLoading={deleteM.isPending}
        onConfirm={() => pendingDelete && deleteM.mutate(pendingDelete.id)}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
