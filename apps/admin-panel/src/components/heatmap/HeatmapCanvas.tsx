"use client";

import { memo, useEffect, useRef } from "react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { HeatmapCell } from "@/services/admin-api";

export type HeatBounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const pct = (v: number, min: number, max: number) => (max === min ? 50 : ((v - min) / (max - min)) * 100);

function cellKey(c: HeatmapCell) {
  return `${c.lat.toFixed(3)}:${c.lng.toFixed(3)}`;
}

function drawCells(
  ctx: CanvasRenderingContext2D,
  cells: HeatmapCell[],
  bounds: HeatBounds,
  w: number,
  h: number,
  light: boolean,
  selected: string | null,
) {
  ctx.clearRect(0, 0, w, h);

  for (const c of cells) {
    const t = Math.min(1, Math.max(0, c.demandScore / 100));
    const size = 36 + t * 42;
    const x = (pct(c.lng, bounds.minLng, bounds.maxLng) / 100) * w;
    const y = (pct(c.lat, bounds.maxLat, bounds.minLat) / 100) * h;
    const r = size / 2;
    const on = selected === cellKey(c);
    const hot = c.supplyGap > 0;

    const core = light ? [239, 68, 68] : [248, 113, 113];
    const mid = light ? [245, 158, 11] : [251, 191, 36];
    const alpha = light ? 0.72 : 0.9;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${core.join(",")},${(0.75 + t * 0.2) * alpha})`);
    grad.addColorStop(0.34, `rgba(${mid.join(",")},${(0.5 + t * 0.28) * alpha})`);
    grad.addColorStop(0.62, `rgba(${core.join(",")},${(0.16 + t * 0.12) * alpha})`);
    grad.addColorStop(1, `rgba(${core.join(",")},0)`);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (hot) {
      ctx.strokeStyle = light ? "#b91c1c" : "#f87171";
      ctx.lineWidth = on ? 3.5 : 2.4;
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (on) {
      ctx.strokeStyle = light ? "#047857" : "#34d399";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(x, y, r + 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }
}

function nearestCell(cells: HeatmapCell[], bounds: HeatBounds, x: number, y: number, w: number, h: number) {
  let best: HeatmapCell | null = null;
  let dist = Infinity;
  for (const c of cells) {
    const cx = (pct(c.lng, bounds.minLng, bounds.maxLng) / 100) * w;
    const cy = (pct(c.lat, bounds.maxLat, bounds.minLat) / 100) * h;
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < dist) {
      dist = d;
      best = c;
    }
  }
  const hitR = 28;
  return best && dist <= hitR * hitR ? best : null;
}

function HeatmapCanvasInner({
  cells,
  bounds,
  selectedKey,
  onSelect,
}: {
  cells: HeatmapCell[];
  bounds: HeatBounds;
  selectedKey?: string | null;
  onSelect?: (cell: HeatmapCell) => void;
}) {
  useRenderProbe("HeatmapCanvas");
  useMountProbe("HeatmapCanvas");
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cellsKey = cells.map((c) => `${c.lat}:${c.lng}:${c.demandScore}:${c.supplyGap}`).join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;
    const light = document.documentElement.getAttribute("data-theme") === "light";

    const paint = () => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCells(ctx, cells, bounds, rect.width, rect.height, light, selectedKey ?? null);
    };

    const ro = new ResizeObserver(paint);
    ro.observe(parent);
    const obs = new MutationObserver(paint);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    paint();
    return () => {
      ro.disconnect();
      obs.disconnect();
    };
  }, [cellsKey, bounds, cells, selectedKey]);

  return (
    <canvas
      ref={canvasRef}
      className="block h-full w-full cursor-pointer"
      aria-label="Demand heatmap"
      onClick={(e) => {
        if (!onSelect) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const hit = nearestCell(cells, bounds, e.clientX - rect.left, e.clientY - rect.top, rect.width, rect.height);
        if (hit) onSelect(hit);
      }}
    />
  );
}

export const HeatmapCanvas = memo(HeatmapCanvasInner);
export { cellKey as heatmapCellKey };
