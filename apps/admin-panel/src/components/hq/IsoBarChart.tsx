"use client";

import { memo, useId, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";

export type IsoPoint = { label: string; value: number };

type Accent = "blue" | "emerald" | "amber";
type Layout = "column" | "area" | "bar";

const PALETTE: Record<Accent, { fill: string; soft: string; line: string }> = {
  blue: { fill: "#3d7eff", soft: "rgb(61 126 255 / 0.18)", line: "#93c5fd" },
  emerald: { fill: "#10b981", soft: "rgb(16 185 129 / 0.18)", line: "#6ee7b7" },
  amber: { fill: "#f59e0b", soft: "rgb(245 158 11 / 0.18)", line: "#fcd34d" },
};

function niceMax(n: number) {
  if (n <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(n));
  const f = n / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nice * exp;
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
  const uid = useId();
  const reduce = useReducedMotion();
  const palette = PALETTE[accent];
  const [hover, setHover] = useState<number | null>(null);

  const source = useMemo(
    () =>
      isLoading || data.length === 0
        ? Array.from({ length: 7 }).map((_, i) => ({ label: "—", value: 0 }))
        : data,
    [data, isLoading],
  );

  const max = niceMax(Math.max(1, ...source.map((d) => d.value)));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);

  if (layout === "bar") {
    const rowH = 28;
    const chartH = Math.max(height, source.length * rowH + 8);
    return (
      <div className="biz-chart2d" style={{ minHeight: chartH }}>
        <ul className="space-y-2">
          {source.map((item, i) => {
            const pct = Math.max(item.value > 0 ? 4 : 0, (item.value / max) * 100);
            const active = hover === i;
            return (
              <li
                key={`${item.label}-${i}`}
                className="grid grid-cols-[7.5rem_minmax(0,1fr)_auto] items-center gap-2"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="truncate text-[11px] font-medium text-[var(--color-biz-text)]" title={item.label}>
                  {item.label}
                </span>
                <div className="h-3.5 overflow-hidden rounded-full bg-[var(--color-biz-elevated)] ring-1 ring-inset ring-[var(--color-biz-line)]">
                  <motion.span
                    className="block h-full rounded-full"
                    style={{
                      background: `linear-gradient(90deg, ${palette.fill}, ${palette.line})`,
                      opacity: isLoading ? 0.25 : active ? 1 : 0.92,
                    }}
                    initial={reduce ? false : { width: 0 }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.45, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <span data-stat-value className="min-w-[3.25rem] text-right text-[11px] font-semibold tabular-nums">
                  {isLoading ? "—" : format(item.value)}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const pad = { l: 52, r: 10, t: 24, b: 28 };
  const w = 360;
  const h = height;
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const n = Math.max(1, source.length);
  const gap = n <= 8 ? 10 : 6;
  const barW = Math.max(10, Math.min(36, (innerW - gap * (n - 1)) / n));
  const step = n === 1 ? 0 : innerW / (n - 1);

  const xAt = (i: number) => {
    if (layout === "area") return pad.l + (n === 1 ? innerW / 2 : i * step);
    const track = n * barW + (n - 1) * gap;
    const origin = pad.l + (innerW - track) / 2;
    return origin + i * (barW + gap);
  };
  const yAt = (v: number) => pad.t + innerH - (v / max) * innerH;

  const areaPath = source
    .map((item, i) => `${i === 0 ? "M" : "L"} ${xAt(i).toFixed(1)} ${yAt(item.value).toFixed(1)}`)
    .join(" ");
  const areaFill = `${areaPath} L ${xAt(n - 1).toFixed(1)} ${(pad.t + innerH).toFixed(1)} L ${xAt(0).toFixed(1)} ${(pad.t + innerH).toFixed(1)} Z`;

  return (
    <div className="biz-chart2d" style={{ height }}>
      <svg viewBox={`0 0 ${w} ${h}`} className="h-full w-full" role="img" aria-label="Chart">
        <defs>
          <linearGradient id={`${uid}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.line} />
            <stop offset="100%" stopColor={palette.fill} />
          </linearGradient>
          <linearGradient id={`${uid}-area`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={palette.fill} stopOpacity="0.35" />
            <stop offset="100%" stopColor={palette.fill} stopOpacity="0.02" />
          </linearGradient>
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
                className="biz-chart2d-grid"
              />
              {tick > 0 ? (
                <text x={pad.l - 8} y={y + 3} textAnchor="end" className="biz-chart2d-axis">
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
              d={areaPath}
              fill="none"
              stroke={palette.fill}
              strokeWidth="2.4"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </>
        ) : null}

        {source.map((item, i) => {
          const x = xAt(i);
          const y = yAt(item.value);
          const bh = Math.max(item.value > 0 ? 3 : 0, pad.t + innerH - y);
          const active = hover === i;
          const showVal = !isLoading && (active || n <= 10);
          return (
            <g
              key={`${item.label}-${i}`}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              className="cursor-default"
            >
              <title>
                {item.label}: {format(item.value)}
              </title>
              {layout === "column" ? (
                <motion.rect
                  x={x}
                  width={barW}
                  rx={5}
                  fill={`url(#${uid}-bar)`}
                  opacity={isLoading ? 0.22 : active ? 1 : 0.92}
                  initial={reduce ? false : { y: pad.t + innerH, height: 0 }}
                  animate={{ y, height: bh }}
                  transition={{ duration: 0.4, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }}
                />
              ) : (
                <circle
                  cx={x}
                  cy={y}
                  r={active ? 5 : 3.5}
                  fill={palette.fill}
                  stroke="var(--color-biz-surface)"
                  strokeWidth="2"
                  opacity={isLoading ? 0.25 : 1}
                />
              )}
              {showVal && item.value > 0 ? (
                <text
                  x={layout === "column" ? x + barW / 2 : x}
                  y={y - 7}
                  textAnchor="middle"
                  className="biz-chart2d-value"
                >
                  {format(item.value)}
                </text>
              ) : null}
              <text
                x={layout === "column" ? x + barW / 2 : x}
                y={h - 8}
                textAnchor="middle"
                className="biz-chart2d-axis"
              >
                {item.label.length > 8 ? `${item.label.slice(0, 7)}…` : item.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
