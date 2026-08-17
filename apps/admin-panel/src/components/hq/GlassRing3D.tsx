"use client";

import { memo, useId } from "react";
import { cn } from "@/lib/cn";

export const GlassRing3D = memo(function GlassRing3D({
  value,
  label,
  sub,
  tone = "success",
}: {
  value: number;
  label: string;
  sub?: string;
  tone?: "success" | "warning" | "danger" | "accent";
}) {
  const uid = useId();
  const pct = Math.max(0, Math.min(100, value));
  const r = 54;
  const c = 2 * Math.PI * r;
  const dash = (pct / 100) * c;

  return (
    <div className={cn("biz-ring2d", `biz-ring2d--${tone}`)}>
      <div className="relative mx-auto h-[148px] w-[148px]">
        <svg viewBox="0 0 140 140" className="h-full w-full -rotate-90">
          <circle
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke="var(--color-biz-elevated)"
            strokeWidth="12"
          />
          <circle
            cx="70"
            cy="70"
            r={r}
            fill="none"
            stroke={`url(#${uid}-ring)`}
            strokeWidth="12"
            strokeLinecap="round"
            strokeDasharray={`${dash} ${c - dash}`}
          />
          <defs>
            <linearGradient id={`${uid}-ring`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--ring-a)" />
              <stop offset="100%" stopColor="var(--ring-b)" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span data-stat-value className="text-[1.65rem] font-bold leading-none tracking-tight">
            {Math.round(pct)}%
          </span>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
            {label}
          </span>
        </div>
      </div>
      {sub ? <p className="mt-2 text-center text-[11px] leading-snug text-[var(--color-biz-muted)]">{sub}</p> : null}
    </div>
  );
});
