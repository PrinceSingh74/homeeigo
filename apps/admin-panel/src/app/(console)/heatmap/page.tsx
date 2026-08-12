"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Flame,
  Loader2,
  Download,
  FileText,
  MapPin,
  TrendingUp,
  AlertCircle,
  Circle,
} from "lucide-react";
import { KpiCard } from "@/components/ui/KpiCard";
import { HeatmapCanvas } from "@/components/heatmap/HeatmapCanvas";
import { adminApi, type HeatmapData, type HeatmapCell } from "@/services/admin-api";
import { inr } from "@/lib/format";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";

function exportCsv(cells: HeatmapCell[], days: number) {
  const head = ["lat", "lng", "demand", "completed", "cancelled", "cancellationRate", "revenue", "supplyOnline", "supplyTotal", "demandScore", "supplyGap"];
  const rows = cells.map((c) => [c.lat, c.lng, c.demand, c.completed, c.cancelled, c.cancellationRate, c.revenue, c.supplyOnline, c.supplyTotal, c.demandScore, c.supplyGap].join(","));
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
  if (!win) { alert("Allow pop-ups to export the PDF report."); return; }
  const zoneRows = (list: HeatmapCell[]) => list.map((c) =>
    `<tr><td>${c.lat.toFixed(3)}, ${c.lng.toFixed(3)}</td><td>${c.demand}</td><td>${c.supplyOnline}/${c.supplyTotal}</td><td>${c.supplyGap}</td><td>${esc(inr(c.revenue))}</td><td>${(c.cancellationRate * 100).toFixed(0)}%</td></tr>`).join("");
  win.document.write(`<!doctype html><html><head><meta charset="utf-8"/><title>HOMEEIGO Demand Heatmap — ${days}d</title>
  <style>
    *{font-family:-apple-system,Segoe UI,Roboto,sans-serif;box-sizing:border-box}
    body{margin:32px;color:#111}
    .brand{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:3px solid #ef4444;padding-bottom:10px;margin-bottom:18px}
    h1{margin:0;font-size:22px}.sub{color:#666;font-size:12px;margin-top:4px}
    .badge{font-size:11px;color:#ef4444;font-weight:700;letter-spacing:.08em;text-transform:uppercase}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:16px 0}
    .kpi{border:1px solid #e5e7eb;border-radius:8px;padding:10px}.kpi .l{font-size:11px;color:#6b7280}.kpi .v{font-size:18px;font-weight:700}
    h2{font-size:14px;margin:22px 0 8px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{border:1px solid #e5e7eb;padding:5px 7px;text-align:left}th{background:#f9fafb;font-weight:600}
    tr:nth-child(even) td{background:#fcfcfd}
    .gap td{color:#b91c1c}
    footer{margin-top:24px;font-size:10px;color:#9ca3af;border-top:1px solid #eee;padding-top:8px}
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
    <footer>HOMEEIGO Business HQ · admin.homigo.com · Source: /api/admin/heatmap (heatmap.service) · This report reflects live aggregated booking data.</footer>
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};</script>
  </body></html>`);
  win.document.close();
}

const PRESETS = [
  { id: "today", label: "Today", days: 1 },
  { id: "7d", label: "7 days", days: 7 },
  { id: "30d", label: "30 days", days: 30 },
  { id: "90d", label: "Custom (90d)", days: 90 },
] as const;

function bounds(cells: { lat: number; lng: number }[]) {
  if (cells.length === 0) return { minLat: 8, maxLat: 37, minLng: 68, maxLng: 97 };
  const lats = cells.map((c) => c.lat);
  const lngs = cells.map((c) => c.lng);
  const pad = 0.05;
  return { minLat: Math.min(...lats) - pad, maxLat: Math.max(...lats) + pad, minLng: Math.min(...lngs) - pad, maxLng: Math.max(...lngs) + pad };
}

/** Admin > Analytics > Demand Heatmap. Consumes GET /api/admin/heatmap only (heatmap.service)
 *  — no new aggregation engine, no duplicate tables. */
export default function HeatmapPage() {
  useRenderProbe("HeatmapPage");
  useMountProbe("HeatmapPage");
  const [days, setDays] = useState(30);
  const q = useQuery({
    queryKey: ["admin", "heatmap", days],
    queryFn: () => adminApi.heatmap({ gridSize: 0.05, days }),
    refetchInterval: 60_000,
  });
  const data = q.data as HeatmapData | undefined;
  const b = useMemo(() => bounds(data?.cells ?? []), [data]);
  const underServed = useMemo(
    () => [...(data?.cells ?? [])].filter((c) => c.supplyGap > 0).sort((a, c) => c.supplyGap - a.supplyGap).slice(0, 12),
    [data],
  );
  const topRevenue = useMemo(
    () => [...(data?.cells ?? [])].filter((c) => c.revenue > 0).sort((a, c) => c.revenue - a.revenue).slice(0, 6),
    [data],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-1">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-zinc-50 md:text-3xl">
            <Flame size={24} className="text-amber-400" />
            Demand Heatmap
          </h1>
          <p className="mt-1 text-sm text-zinc-400">
            Demand vs supply · revenue · under-served zones
          </p>
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
          <button
            type="button"
            onClick={() => data && exportCsv(data.cells, days)}
            disabled={!data || data.cells.length === 0}
            className="biz-btn"
            title="Export cells as CSV"
          >
            <Download size={15} /> CSV
          </button>
          <button
            type="button"
            onClick={() => data && exportPdf(data, days)}
            disabled={!data || data.cells.length === 0}
            className="biz-btn"
            title="Export a branded PDF report"
          >
            <FileText size={15} /> PDF
          </button>
        </div>
      </header>

      {q.isLoading ? (
        <div className="flex items-center gap-2 p-10 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" /> Aggregating demand data…
        </div>
      ) : q.isError || !data ? (
        <div className="flex items-start gap-3 rounded-xl border border-red-500/30 bg-red-500/5 p-6">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
          <div>
            <p className="font-medium text-red-300">Could not load heatmap</p>
            <p className="mt-1 text-sm text-zinc-400">Check your connection and try refreshing the page.</p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <KpiCard label="Total demand" value={String(data.totals.demand)} icon={Flame} accent="amber" />
            <KpiCard label="Revenue" value={inr(data.totals.revenue)} icon={TrendingUp} accent="green" />
            <KpiCard label="Online supply" value={String(data.totals.supplyOnline)} icon={Circle} />
            <KpiCard label="Active cells" value={String(data.totals.cells)} icon={MapPin} />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <div className="heatmap-canvas">
                <span className="pointer-events-none absolute left-3 top-3 z-10 rounded-md bg-amber-500/20 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-amber-300">
                  {data.cells.length} zones · last {days}d
                </span>
                <span className="pointer-events-none absolute bottom-3 left-3 z-10 font-mono text-[11px] text-zinc-400">
                  {b.minLat.toFixed(2)}, {b.minLng.toFixed(2)}
                </span>
                <span className="pointer-events-none absolute right-3 top-3 z-10 font-mono text-[11px] text-zinc-400">
                  {b.maxLat.toFixed(2)}, {b.maxLng.toFixed(2)}
                </span>

                <HeatmapCanvas cells={data.cells} bounds={b} />

                {data.cells.length === 0 && (
                  <div className="grid h-full place-items-center px-6 text-center">
                    <div>
                      <MapPin className="mx-auto mb-2 h-8 w-8 text-zinc-500" />
                      <p className="text-sm font-medium text-zinc-100">No demand in this window</p>
                      <p className="mt-1 text-xs text-zinc-400">Try a longer time range or check booking activity.</p>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3.5 w-3.5 rounded-full bg-gradient-to-br from-red-500 to-amber-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]" />
                    Higher demand
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block h-3.5 w-3.5 rounded-full ring-2 ring-red-500 ring-offset-2 ring-offset-zinc-950" />
                    Supply gap
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <span>Low</span>
                  <div className="h-2.5 w-28 rounded-full bg-gradient-to-r from-amber-900 via-orange-500 to-red-500" />
                  <span>High</span>
                </div>
              </div>
            </div>

            <div className="biz-card flex flex-col p-4">
              <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-50">
                <AlertCircle size={16} className="text-red-400" />
                Top under-served zones
              </h2>
              <p className="mb-3 text-xs text-zinc-400">Demand exceeds online supply</p>
              <div className="max-h-80 flex-1 space-y-2 overflow-auto">
                {underServed.length === 0 ? (
                  <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-4 text-center text-sm text-emerald-300">
                    No supply gaps — all zones covered
                  </p>
                ) : (
                  underServed.map((c, i) => (
                    <div key={`${c.lat}-${c.lng}`} className="heatmap-zone-row">
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">
                          #{i + 1}
                        </span>
                        <p className="font-mono text-sm font-semibold text-zinc-100">
                          {c.lat.toFixed(2)}, {c.lng.toFixed(2)}
                        </p>
                      </div>
                      <div className="shrink-0 text-right text-xs">
                        <p className="font-bold text-red-300">
                          Gap <span className="text-base">{c.supplyGap}</span>
                        </p>
                        <p className="text-zinc-400">{c.demand} demand</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="biz-card p-4">
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-zinc-50">
              <TrendingUp size={16} className="text-emerald-400" />
              Top performing zones
            </h2>
            <p className="mb-4 text-xs text-zinc-400">Ranked by revenue in selected window</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {topRevenue.length === 0 ? (
                <p className="col-span-full rounded-lg border border-zinc-700 bg-zinc-800/50 px-4 py-6 text-center text-sm text-zinc-400">
                  No revenue recorded in this window.
                </p>
              ) : (
                topRevenue.map((c, i) => (
                  <div key={`${c.lat}-${c.lng}`} className="heatmap-zone-row heatmap-zone-row--success">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                        #{i + 1}
                      </span>
                      <p className="font-mono text-sm font-semibold text-zinc-100">
                        {c.lat.toFixed(2)}, {c.lng.toFixed(2)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right text-xs">
                      <p className="font-bold text-emerald-300">{inr(c.revenue)}</p>
                      <p className="text-zinc-400">{c.completed} completed</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
