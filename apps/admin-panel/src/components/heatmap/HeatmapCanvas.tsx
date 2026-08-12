"use client";

import { memo, useEffect, useRef } from "react";
import { useRenderProbe, useMountProbe } from "@/lib/render-probe";
import type { HeatmapCell } from "@/services/admin-api";

type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const pct = (v: number, min: number, max: number) => (max === min ? 50 : ((v - min) / (max - min)) * 100);

function drawCells(ctx: CanvasRenderingContext2D, cells: HeatmapCell[], bounds: Bounds, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  for (const c of cells) {
    const t = Math.min(1, Math.max(0, c.demandScore / 100));
    const size = 44 + t * 36;
    const x = (pct(c.lng, bounds.minLng, bounds.maxLng) / 100) * w;
    const y = (pct(c.lat, bounds.maxLat, bounds.minLat) / 100) * h;
    const r = size / 2;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(239,68,68,${0.85 + t * 0.15})`);
    grad.addColorStop(0.38, `rgba(245,158,11,${0.55 + t * 0.3})`);
    grad.addColorStop(0.62, `rgba(239,68,68,${0.2 + t * 0.15})`);
    grad.addColorStop(0.78, "rgba(239,68,68,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();

    if (c.supplyGap > 0) {
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x, y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function HeatmapCanvasInner({
  cells,
  bounds,
}: {
  cells: HeatmapCell[];
  bounds: Bounds;
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

    const ro = new ResizeObserver(() => {
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawCells(ctx, cells, bounds, rect.width, rect.height);
    });
    ro.observe(parent);
    return () => ro.disconnect();
  }, [cellsKey, bounds, cells]);

  return <canvas ref={canvasRef} className="block h-full w-full" aria-label="Demand heatmap" />;
}

export const HeatmapCanvas = memo(HeatmapCanvasInner);
