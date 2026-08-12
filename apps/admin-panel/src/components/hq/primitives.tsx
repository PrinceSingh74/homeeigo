"use client";

import { memo } from "react";
import { Info, Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** Small metric tile used across HQ dashboards. */
export const StatTile = memo(function StatTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
  loading,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: LucideIcon;
  tone?: "default" | "success" | "danger" | "accent";
  loading?: boolean;
}) {
  const toneClass =
    tone === "success"
      ? "text-[var(--color-biz-success)]"
      : tone === "danger"
        ? "text-[var(--color-biz-danger)]"
        : tone === "accent"
          ? "text-[var(--color-biz-accent)]"
          : "text-[var(--color-biz-text)]";

  return (
    <div className="biz-glass-panel biz-kpi p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
          {label}
        </span>
        {Icon ? <Icon className="h-4 w-4 text-[var(--color-biz-faint)]" /> : null}
      </div>
      <p data-stat-value className={cn("mt-2 text-2xl font-bold tabular-nums tracking-tight", toneClass)}>
        {loading ? "—" : value}
      </p>
      {sub ? <p className="mt-1 text-xs text-[var(--color-biz-muted)]">{sub}</p> : null}
    </div>
  );
});

/** Lightweight inline SVG bar chart — no chart library, GPU-cheap. */
export const SparkBars = memo(function SparkBars({
  data,
  height = 56,
  color = "var(--color-biz-accent)",
  label,
}: {
  data: number[];
  height?: number;
  color?: string;
  label?: string;
}) {
  const max = Math.max(1, ...data);
  const barW = data.length > 0 ? 100 / data.length : 100;

  return (
    <div>
      {label ? (
        <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-biz-muted)]">
          {label}
        </p>
      ) : null}
      <svg
        viewBox={`0 0 100 ${height}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={label ?? "trend"}
      >
        {/* baseline grid for an analytics-terminal read */}
        <line
          x1="0"
          y1={height - 0.5}
          x2="100"
          y2={height - 0.5}
          stroke="var(--color-biz-line)"
          strokeWidth="0.5"
        />
        {data.map((v, i) => {
          const h = (v / max) * (height - 6);
          return (
            <rect
              key={i}
              x={i * barW + barW * 0.18}
              y={height - h}
              width={barW * 0.64}
              height={Math.max(1, h)}
              rx={0.8}
              fill={color}
              opacity={0.3 + (v / max) * 0.7}
            />
          );
        })}
      </svg>
    </div>
  );
});

/** Horizontal progress meter. */
export const MeterBar = memo(function MeterBar({
  label,
  value,
  max = 100,
  suffix = "%",
  tone = "accent",
}: {
  label: string;
  value: number;
  max?: number;
  suffix?: string;
  tone?: "accent" | "success" | "danger";
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const bar =
    tone === "success"
      ? "bg-gradient-to-r from-emerald-600 to-emerald-400"
      : tone === "danger"
        ? "bg-gradient-to-r from-red-600 to-red-400"
        : "bg-gradient-to-r from-blue-600 to-cyan-400";

  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-[var(--color-biz-muted)]">{label}</span>
        <span className="biz-num font-semibold tabular-nums">
          {value.toFixed(suffix === "%" ? 1 : 0)}
          {suffix}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-biz-elevated)] ring-1 ring-inset ring-[var(--color-biz-line)]">
        <div className={cn("h-full rounded-full transition-all duration-500", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
});

/** Shown when a backend data source is intentionally not available (no fake data). */
export const DataUnavailable = memo(function DataUnavailable({
  title,
  reason,
}: {
  title: string;
  reason: string;
}) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-dashed border-[var(--color-biz-line)] bg-[var(--color-biz-surface)]/50 p-4">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-biz-muted)]" />
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--color-biz-muted)]">{reason}</p>
      </div>
    </div>
  );
});

export const HqLoading = memo(function HqLoading({ label = "Loading live data…" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-[var(--color-biz-muted)]">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
});

export const SectionHeading = memo(function SectionHeading({
  title,
  hint,
}: {
  title: string;
  hint?: string;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-2">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
        <span className="h-3 w-0.5 rounded-full bg-[var(--color-biz-accent)]" aria-hidden />
        {title}
      </h2>
      {hint ? <span className="text-[10px] text-[var(--color-biz-faint)]">{hint}</span> : null}
    </div>
  );
});
