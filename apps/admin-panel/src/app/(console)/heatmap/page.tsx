"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Circle,
  Download,
  FileText,
  Flame,
  IndianRupee,
  Loader2,
  MapPin,
  RefreshCw,
  TrendingUp,
  Users,
} from "lucide-react";
import { StatTile } from "@/components/hq/primitives";
import { SectionHead } from "@/components/hq/SectionHead";
import { Icon3D } from "@/components/hq/Icon3D";
import { IsoBarChart } from "@/components/hq/IsoBarChart";
import { HeatmapCanvas, heatmapCellKey } from "@/components/heatmap/HeatmapCanvas";
import { adminApi, type HeatmapCell, type HeatmapData } from "@/services/admin-api";
import { formatNumber, formatPercent, inr } from "@/lib/format";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import { cn } from "@/lib/cn";

function exportCsv(cells: HeatmapCell[], days: number) {
  const head = [
    "lat",
    "lng",
    "demand",
    "completed",
    "cancelled",
    "cancellationRate",
    "revenue",
    "supplyOnline",
    "supplyTotal",
    "demandScore",
    "supplyGap",
  ];
  const rows = cells.map((c) =>
    [
      c.lat,
      c.lng,
      c.demand,
      c.completed,
      c.cancelled,
      c.cancellationRate,
      c.revenue,
      c.supplyOnline,
      c.supplyTotal,
      c.demandScore,
      c.supplyGap,
    ].join(","),
  );
  const blob = new Blob([head.join(",") + "\n" + rows.join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `homigo-heatmap-${days}d-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

const esc = (s: unknown) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

function exportPdf(data: HeatmapData, days: number) {
  const generated = new Date().toLocaleString("en-IN");
  const under = [...data.cells].filter((c) => c.supplyGap > 0).sort((a, c) => c.supplyGap - a.supplyGap).slice(0, 15);
  const top = [...data.cells].filter((c) => c.revenue > 0).sort((a, c) => c.revenue - a.revenue).slice(0, 15);
  const rows = [...data.cells].sort((a, c) => c.demandScore - a.demandScore);
  const win = window.open("", "_blank", "width=1000,height=800");
  if (!win) {
    alert("Allow pop-ups to export the PDF report.");
    return;
  }
  const zoneRows = (list: HeatmapCell[]) =>
    list
      .map(
        (c) =>
          `<tr><td>${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}</td><td>${c.demand}</td><td>${c.supplyOnline}/${c.supplyTotal}</td><td>${c.supplyGap}</td><td>${esc(inr(c.revenue))}</td><td>${(c.cancellationRate * 100).toFixed(0)}%</td></tr>`,
      )
      .join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>HOMEEIGO Demand Heatmap — ${days}d</title>
  <style>
    *{font-family:Inter,Segoe UI,sans-serif;box-sizing:border-box}
    body{margin:32px;color:#06110c}
    .brand{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #059669;padding-bottom:10px;margin-bottom:18px}
    h1{margin:0;font-size:22px}.sub{color:#3d5249;font-size:12px;margin-top:4px}
    .badge{font-size:11px;color:#047857;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
    .kpi{border:1px solid #d1e7dc;border-radius:10px;padding:10px}.kpi .l{font-size:11px;color:#64766d}.kpi .v{font-size:18px;font-weight:700}
    h2{font-size:14px;margin:22px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border:1px solid #d1e7dc;padding:5px 7px;text-align:left}th{background:#f0fdf4;font-weight:600}
    .gap td{color:#b91c1c}
    footer{margin-top:24px;font-size:10px;color:#64766d;border-top:1px solid #d1e7dc;padding-top:8px}
    @media print{body{margin:14mm}@page{size:A4}}
  </style></head><body>
    <div class="brand"><div><h1>HOMEEIGO — Demand Heatmap</h1><div class="sub">Window: last ${days} day(s) · Generated ${esc(generated)}</div></div><div class="badge">Confidential · Ops Analytics</div></div>
    <div class="kpis">
      <div class="kpi"><div class="l">Total demand</div><div class="v">${data.totals.demand}</div></div>
      <div class="kpi"><div class="l">Revenue</div><div class="v">${esc(inr(data.totals.revenue))}</div></div>
      <div class="kpi"><div class="l">Online supply</div><div class="v">${data.totals.supplyOnline}</div></div>
      <div class="kpi"><div class="l">Active cells</div><div class="v">${data.totals.cells}</div></div>
    </div>
    <h2>Top under-served zones (supply gap)</h2>
    <table><thead><tr><th>Zone (lat,lng)</th><th>Demand</th><th>Supply (on/total)</th><th>Gap</th><th>Revenue</th><th>Cancel%</th></tr></thead><tbody class="gap">${zoneRows(under) || '<tr><td colspan="6">No supply gaps.</td></tr>'}</tbody></table>
    <h2>Top performing zones (revenue)</h2>
    <table><thead><tr><th>Zone (lat,lng)</th><th>Demand</th><th>Supply (on/total)</th><th>Gap</th><th>Revenue</th><th>Cancel%</th></tr></thead><tbody>${zoneRows(top) || '<tr><td colspan="6">No revenue in window.</td></tr>'}</tbody></table>
    <h2>All zones (${rows.length}) — ranked by demand score</h2>
    <table><thead><tr><th>Zone (lat,lng)</th><th>Demand</th><th>Supply (on/total)</th><th>Gap</th><th>Revenue</th><th>Cancel%</th></tr></thead><tbody>${zoneRows(rows)}</tbody></table>
    <footer>HOMEEIGO Business HQ · Source: /api/admin/heatmap · Live aggregated booking data.</footer>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
  </body></html>`);
  win.document.close();
}

const PRESETS = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "90 days", days: 90 },
] as const;

function bounds(cells: { lat: number; lng: number }[]) {
  if (cells.length === 0) return { minLat: 8, maxLat: 37, minLng: 68, maxLng: 97 };
  const lats = cells.map((c) => c.lat);
  const lngs = cells.map((c) => c.lng);
  const pad = 0.05;
  return { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad };
}

function MetricRow({ label, value, heat }: { label: string; value: string; heat?: "good" | "warn" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-biz-line)] py-2.5 last:border-0">
      <span className="text-sm text-[var(--color-biz-muted)]">{label}</span>
      <span
        data-stat-value
        className={cn(
          "text-sm font-bold tabular-nums",
          heat === "good" && "text-[var(--color-biz-success)]",
          heat === "warn" && "text-[var(--color-biz-warning)]",
          heat === "bad" && "text-[var(--color-biz-danger)]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export default function HeatmapPage() {
  useRenderProbe("HeatmapPage");
  useMountProbe("HeatmapPage");
  const [days, setDays] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["admin", "heatmap", days],
    queryFn: () => adminApi.heatmap({ gridSize: 0.05, days }),
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const data = q.data as HeatmapData | undefined;
  const b = useMemo(() => bounds(data?.cells ?? []), [data]);
  const underServed = useMemo(
    () => [...(data?.cells ?? [])].filter((c) => c.supplyGap > 0).sort((a, c) => c.supplyGap - a.supplyGap).slice(0, 8),
    [data],
  );
  const topRevenue = useMemo(
    () => [...(data?.cells ?? [])].filter((c) => c.revenue > 0).sort((a, c) => c.revenue - a.revenue).slice(0, 8),
    [data],
  );
  const selected = useMemo(
    () => (data?.cells ?? []).find((c) => heatmapCellKey(c) === selectedKey) ?? underServed[0] ?? data?.cells[0] ?? null,
    [data, selectedKey, underServed],
  );
  const demandSeries = useMemo(
    () =>
      [...(data?.cells ?? [])]
        .sort((a, c) => c.demandScore - a.demandScore)
        .slice(0, 8)
        .map((c, i) => ({ label: `#${i + 1}`, value: c.demandScore })),
    [data],
  );
  const revenueSeries = useMemo(
    () => topRevenue.slice(0, 8).map((c, i) => ({ label: `#${i + 1}`, value: c.revenue })),
    [topRevenue],
  );
  const cancelRate =
    data && data.cells.length
      ? data.cells.reduce((s, c) => s + c.cancellationRate, 0) / data.cells.length
      : 0;
  const gapCount = data?.cells.filter((c) => c.supplyGap > 0).length ?? 0;

  return (
    <div className="exec-hq cmd-center mx-auto max-w-[1600px] space-y-8 biz-page-enter">
      <header className="flex flex-col gap-5 border-b border-[var(--color-biz-line)] pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-4">
          <Icon3D icon={Flame} tone="warning" size="lg" />
          <div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h1 className="biz-display text-[1.75rem] font-bold leading-none tracking-tight">Demand Heatmap</h1>
              <span className="cmd-live-pill">
                <span className="cmd-live-dot" aria-hidden />
                Live
              </span>
            </div>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-[var(--color-biz-muted)]">
              Demand vs supply · revenue · under-served zones · click a hotspot for the full briefing
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="biz-segment">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDays(p.days)}
                className={`biz-segment-btn${days === p.days ? " is-active" : ""}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => data && exportCsv(data.cells, days)} disabled={!data?.cells.length} className="biz-btn">
            <Download size={14} /> CSV
          </button>
          <button type="button" onClick={() => data && exportPdf(data, days)} disabled={!data?.cells.length} className="biz-btn">
            <FileText size={14} /> PDF
          </button>
          <button type="button" onClick={() => void q.refetch()} className="biz-btn">
            <RefreshCw size={14} className={q.isFetching ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </header>

      {q.isLoading ? (
        <div className="flex items-center justify-center py-20 text-[var(--color-biz-muted)]">
          <Loader2 className="mr-2 animate-spin" size={20} />
          Aggregating demand data…
        </div>
      ) : q.isError || !data ? (
        <div className="biz-glass-panel border-[var(--color-biz-danger)]/30 p-5 text-[var(--color-biz-danger)]">
          Could not load heatmap. Please try again.
        </div>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile
              label="Total demand"
              value={formatNumber(data.totals.demand)}
              sub={`${formatNumber(data.totals.cells)} active cells`}
              icon={Flame}
              tone="accent"
            />
            <StatTile
              label="Revenue"
              value={inr(data.totals.revenue, true)}
              sub={`Last ${days}d window`}
              icon={IndianRupee}
              tone="success"
            />
            <StatTile
              label="Online supply"
              value={formatNumber(data.totals.supplyOnline)}
              sub={`${gapCount} cells with gap`}
              icon={Users}
              tone={gapCount > 0 ? "danger" : "success"}
            />
            <StatTile
              label="Cancel rate"
              value={formatPercent(cancelRate)}
              sub="Average across cells"
              icon={TrendingUp}
              tone={cancelRate > 0.2 ? "danger" : cancelRate > 0.1 ? "accent" : "success"}
            />
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <div className="cmd-card heatmap-canvas heatmap-stage">
              <span className="cmd-live-pill pointer-events-none absolute left-3 top-3 z-10">
                <span className="cmd-live-dot" aria-hidden />
                {data.cells.length} zones · {days}d
              </span>
              <HeatmapCanvas
                cells={data.cells}
                bounds={b}
                selectedKey={selected ? heatmapCellKey(selected) : null}
                onSelect={(c) => setSelectedKey(heatmapCellKey(c))}
              />
              {data.cells.length === 0 ? (
                <div className="absolute inset-0 grid place-items-center text-center">
                  <div>
                    <MapPin className="mx-auto mb-2 text-[var(--color-biz-muted)]" />
                    <p className="text-sm font-semibold">No demand in this window</p>
                    <p className="mt-1 text-xs text-[var(--color-biz-muted)]">Try a longer range.</p>
                  </div>
                </div>
              ) : null}
              <div className="cmd-map-chip absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-3">
                <span className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-full bg-gradient-to-br from-amber-400 to-red-500" /> High demand
                </span>
                <span className="flex items-center gap-1.5">
                  <Circle size={10} className="text-[var(--color-biz-danger)]" /> Supply gap
                </span>
              </div>
            </div>

            <aside className="biz-glass-panel flex min-h-[28rem] flex-col overflow-hidden p-5">
              <SectionHead
                icon={AlertCircle}
                tone={selected?.supplyGap ? "danger" : "warning"}
                title={selected ? "Zone briefing" : "Top gaps"}
                subtitle={selected ? `${selected.lat.toFixed(3)}, ${selected.lng.toFixed(3)}` : "Demand exceeds online supply"}
                meta={selected ? `#${Math.max(1, underServed.findIndex((c) => heatmapCellKey(c) === heatmapCellKey(selected)) + 1)}` : `${underServed.length}`}
              />
              {selected ? (
                <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
                  <p data-stat-value className="text-3xl font-bold tabular-nums tracking-tight">
                    {formatNumber(selected.demand)}
                    <span className="ml-2 text-sm font-semibold text-[var(--color-biz-muted)]">demand</span>
                  </p>
                  <MetricRow label="Demand score" value={`${selected.demandScore}`} heat={selected.demandScore >= 70 ? "bad" : selected.demandScore >= 40 ? "warn" : "good"} />
                  <MetricRow label="Supply gap" value={formatNumber(selected.supplyGap)} heat={selected.supplyGap > 0 ? "bad" : "good"} />
                  <MetricRow label="Online / total" value={`${selected.supplyOnline}/${selected.supplyTotal}`} />
                  <MetricRow label="Completed" value={formatNumber(selected.completed)} heat="good" />
                  <MetricRow label="Cancelled" value={formatNumber(selected.cancelled)} heat={selected.cancelled > 0 ? "warn" : "good"} />
                  <MetricRow label="Revenue" value={inr(selected.revenue, true)} />
                  <MetricRow label="Cancel rate" value={formatPercent(selected.cancellationRate)} heat={selected.cancellationRate > 0.2 ? "bad" : "good"} />
                  <div className={cn("biz-meter mt-2", selected.supplyGap > 0 ? "biz-meter--danger" : "biz-meter--success")}>
                    <span style={{ width: `${Math.max(8, Math.min(100, selected.demandScore))}%` }} />
                  </div>
                  <p className="text-xs leading-relaxed text-[var(--color-biz-muted)]">
                    {selected.supplyGap > 0
                      ? "Demand is outrunning live supply here. Shift idle partners in, or open a geofence surge on Geo Command."
                      : "This cell is covered. Watch cancel rate if it starts climbing."}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">Click a hotspot on the map to inspect the cell.</p>
              )}
            </aside>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="biz-glass-panel p-6">
              <SectionHead icon={Flame} tone="warning" title="Demand score" subtitle="Hottest cells in this window" meta="Top 8" />
              {demandSeries.length ? (
                <IsoBarChart data={demandSeries} format={(v) => `${v}`} accent="amber" layout="column" height={240} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">No demand scores yet.</p>
              )}
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead icon={IndianRupee} tone="success" title="Revenue" subtitle="Highest earning cells" meta="Top 8" />
              {revenueSeries.length ? (
                <IsoBarChart data={revenueSeries} format={(v) => inr(v, true)} accent="emerald" layout="area" height={240} />
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">No revenue in this window.</p>
              )}
            </div>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <div className="biz-glass-panel p-6">
              <SectionHead icon={AlertCircle} tone="danger" title="Under-served" subtitle="Demand exceeds online supply" meta={`${underServed.length}`} />
              {underServed.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {underServed.map((c, i) => (
                    <button
                      key={heatmapCellKey(c)}
                      type="button"
                      onClick={() => setSelectedKey(heatmapCellKey(c))}
                      className={cn(
                        "rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4 text-left",
                        selected && heatmapCellKey(selected) === heatmapCellKey(c) && "ring-2 ring-[var(--color-biz-danger)]/30",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="ops-alert-pill is-hot">#{i + 1}</span>
                        <span className="text-xs font-bold text-[var(--color-biz-danger)]">Gap {c.supplyGap}</span>
                      </div>
                      <p className="mt-2 font-mono text-sm font-semibold">{c.lat.toFixed(2)}, {c.lng.toFixed(2)}</p>
                      <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{formatNumber(c.demand)} demand · {c.supplyOnline} online</p>
                      <div className="biz-meter biz-meter--danger mt-3">
                        <span style={{ width: `${Math.max(8, Math.min(100, c.demandScore))}%` }} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="rounded-[14px] border border-dashed border-[var(--color-biz-line)] px-4 py-8 text-center text-sm text-[var(--color-biz-success)]">
                  No supply gaps — all zones covered.
                </p>
              )}
            </div>
            <div className="biz-glass-panel p-6">
              <SectionHead icon={TrendingUp} tone="success" title="Top revenue" subtitle="Best performing cells" meta={`${topRevenue.length}`} />
              {topRevenue.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {topRevenue.map((c, i) => (
                    <button
                      key={heatmapCellKey(c)}
                      type="button"
                      onClick={() => setSelectedKey(heatmapCellKey(c))}
                      className="rounded-[14px] border border-[var(--color-biz-line)] bg-[var(--color-biz-surface)] p-4 text-left"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="ops-alert-pill is-good">#{i + 1}</span>
                        <span className="text-xs font-bold text-[var(--color-biz-success)]">{inr(c.revenue, true)}</span>
                      </div>
                      <p className="mt-2 font-mono text-sm font-semibold">{c.lat.toFixed(2)}, {c.lng.toFixed(2)}</p>
                      <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{formatNumber(c.completed)} completed</p>
                      <div className="biz-meter biz-meter--success mt-3">
                        <span style={{ width: `${Math.max(8, Math.min(100, c.demandScore))}%` }} />
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[var(--color-biz-muted)]">No revenue recorded in this window.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
