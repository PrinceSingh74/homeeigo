"use client";

import { memo, useId, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

export type IsoPoint = { label: string; value: number };

type Accent = "blue" | "emerald" | "amber";
type Layout = "column" | "area" | "bar";

function niceMax(n: number) {
  if (n <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(n));
  const f = n / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
}

function smoothPath(points: Array<{ x: number; y: number }>) {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  let d = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export const IsoBarChart = memo(function IsoBarChart({
  data,
  format,
  accent = "blue",
  isLoading,
  height = 220,
  layout = "column",
}: {
  data: IsoPoint[];
  format: (v: number) => string;
  accent?: Accent;
  isLoading?: boolean;
  height?: number;
  layout?: Layout;
}) {
  const uid = useId().replace(/:/g, "");
  const reduce = useReducedMotion();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hover, setHover] = useState<number | null>(null);

  const source = useMemo(
    () =>
      isLoading || data.length === 0
        ? Array.from({ length: 7 }).map((_, i) => ({ label: "—", value: 0 }))
        : data,
    [data, isLoading],
  );

  const max = niceMax(Math.max(1, ...source.map((d) => d.value)));
  const integer = source.every((d) => Number.isInteger(d.value));
  const ticks =
    integer && max <= 6
      ? Array.from({ length: max + 1 }, (_, i) => i)
      : [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(t * max * 100) / 100);
  const active = hover != null ? source[hover] : null;

  if (layout === "bar") {
    const rowH = 34;
    const chartH = Math.max(height, source.length * rowH + 4);
    return (
      <div className={cn("biz-chart2d", `biz-chart2d--${accent}`)} style={{ minHeight: chartH }}>
        <ul className="space-y-2.5">
          {source.map((item, i) => {
            const pct = Math.max(item.value > 0 ? 6 : 0, (item.value / max) * 100);
            const on = hover === i;
            return (
              <li
                key={`${item.label}-${i}`}
                className="grid grid-cols-[minmax(5.5rem,7.5rem)_minmax(0,1fr)_auto] items-center gap-3"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="truncate text-[12px] font-semibold capitalize tracking-tight" title={item.label}>
                  {item.label}
                </span>
                <div className="biz-chart2d-track">
                  <motion.span
                    className="biz-chart2d-fill"
                    style={{ opacity: isLoading ? 0.22 : on ? 1 : 0.92 }}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.5, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span data-stat-value className="min-w-[3.4rem] text-right text-[12px] font-bold tabular-nums">
                  {isLoading ? "—" : format(item.value)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const compact = height < 180;
  const pad = { l: compact ? 34 : 46, r: compact ? 10 : 16, t: compact ? 16 : 26, b: compact ? 26 : 36 };
  const w = 640;
  const h = height;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = Math.max(1, source.length);
  const gap = n <= 8 ? 14 : n <= 14 ? 8 : 5;
  const barW = Math.max(8, Math.min(42, (innerW - gap * (n - 1)) / n));
  const step = n === 1 ? 0 : innerW / (n - 1);
  const labelStep = n > 12 ? 3 : n > 8 ? 2 : 1;

  const xAt = (i: number) => {
    if (layout === "area") return pad.l + (n === 1 ? innerW / 2 : i * step);
    const track = n * barW + (n - 1) * gap;
    const origin = pad.l + (innerW - track) / 2;
    return origin + i * (barW + gap);
  };
  const yAt = (v: number) => pad.t + innerH - (Math.max(0, v) / max) * innerH;

  const points = source.map((item, i) => ({ x: xAt(i), y: yAt(item.value) }));
  const linePath = smoothPath(points);
  const areaFill = `${linePath} L ${xAt(n - 1).toFixed(1)} ${(pad.t + innerH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(pad.t + innerH).toFixed(1)} Z`;

  const nearest = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * w;
    let best = 0;
    let dist = Infinity;
    for (let i = 0; i < n; i += 1) {
      const dx = Math.abs(xAt(i) - x);
      if (dx < dist) {
        dist = dx;
        best = i;
      }
    }
    setHover(best);
  };

  const tipLeft = active ? `${(xAt(hover!) / w) * 100}%` : "50%";

  return (
    <div className={cn("biz-chart2d", `biz-chart2d--${accent}`)} style={{ height: h }}>
      {active && !isLoading ? (
        <div className="biz-chart2d-tip" style={{ left: tipLeft }}>
          <span>{active.label}</span>
          <strong data-stat-value>{format(active.value)}</strong>
        </div>
      ) : null}

      <svg
        ref={svgRef}
        viewBox={`0 0 ${w} ${h}`}
        className="h-full w-full"
        role="img"
        aria-label="Chart"
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => nearest(e.clientX)}
      >
        <defs>
          <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-line)" />
            <stop offset="55%" stopColor="var(--chart-fill)" />
            <stop offset="100%" stopColor="var(--chart-deep)" />
          </linearGradient>
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-fill)" stopOpacity="0.38" />
            <stop offset="70%" stopColor="var(--chart-fill)" stopOpacity="0.08" />
            <stop offset="100%" stopColor="var(--chart-fill)" stopOpacity="0" />
          </linearGradient>
          <filter id={`${uid}-glow`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {ticks.map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line
                x1={pad.l}
                x2={w - pad.r}
                y1={y}
                y2={y}
                className={tick === 0 ? "biz-chart2d-grid biz-chart2d-grid--base" : "biz-chart2d-grid"}
              />
              {tick > 0 ? (
                <text x={pad.l - 10} y={y + 4} textAnchor="end" className="biz-chart2d-axis">
                  {format(tick)}
                </text>
              ) : null}
            </g>
          );
        })}

        {layout === "area" && source.some((d) => d.value > 0) ? (
          <>
            <path d={areaFill} fill={`url(#${uid}-area)`} />
            <path
              d={linePath}
              fill="none"
              stroke="var(--chart-fill)"
              strokeWidth="2.8"
              strokeLinejoin="round"
              strokeLinecap="round"
              filter={`url(#${uid}-glow)`}
            />
          </>
        ) : null}

        {hover != null && !isLoading ? (
          <line
            x1={layout === "column" ? xAt(hover) + barW / 2 : xAt(hover)}
            x2={layout === "column" ? xAt(hover) + barW / 2 : xAt(hover)}
            y1={pad.t}
            y2={pad.t + innerH}
            className="biz-chart2d-cross"
          />
        ) : null}

        {source.map((item, i) => {
          const x = xAt(i);
          const y = yAt(item.value);
          const bh = Math.max(item.value > 0 ? 4 : 0, pad.t + innerH - y);
          const on = hover === i;
          const showLabel = i % labelStep === 0 || i === n - 1;
          return (
            <g key={`${item.label}-${i}`} className="cursor-default">
              {layout === "column" ? (
                <>
                  <motion.rect
                    x={x}
                    width={barW}
                    rx={Math.min(8, barW / 2)}
                    fill={`url(#${uid}-bar)`}
                    opacity={isLoading ? 0.2 : on ? 1 : 0.88}
                    initial={reduce ? false : { y: pad.t + innerH, height: 0 }}
                    animate={{ y, height: bh }}
                    transition={{ duration: 0.45, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                  />
                  <rect
                    x={x + 1.5}
                    y={y + 1.5}
                    width={Math.max(0, barW - 3)}
                    height={Math.min(7, bh * 0.18)}
                    rx={3}
                    fill="white"
                    opacity={isLoading ? 0 : 0.22}
                  />
                </>
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={on ? 5.5 : 3.8}
                  fill="var(--chart-fill)"
                  stroke="var(--color-biz-surface)"
                  strokeWidth="2.2"
                  opacity={isLoading ? 0.2 : 1}
                  filter={on ? `url(#${uid}-glow)` : undefined}
                />
              )}
              {showLabel ? (
                <text
                  x={layout === "column" ? x + barW / 2 : x}
                  y={h - 10}
                  textAnchor="middle"
                  className="biz-chart2d-axis"
                >
                  {item.label.length > 8 ? `${item.label.slice(0, 7)}…` : item.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
});
