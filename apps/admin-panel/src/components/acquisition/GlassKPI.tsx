"use client";

import { memo } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

export const GlassKPI = memo(function GlassKPI({
  label,
  value,
  delta,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
  href?: string;
  tone?: "default" | "success" | "danger" | "accent";
}) {
  const showDelta = delta !== undefined;
  const deltaText =
    delta == null ? "Limited history" : `${delta > 0 ? "+" : ""}${delta}%`;
  const deltaTone =
    delta == null ? "text-[var(--color-biz-muted)]" : delta >= 0 ? "text-[var(--color-biz-success)]" : "text-[var(--color-biz-danger)]";
  const inner = (
    <div className="biz-glass-panel biz-kpi min-h-[118px] w-[min(100%,18.5rem)] shrink-0 snap-start p-4 sm:w-full sm:min-w-0 sm:p-5">
      <p className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
        {label}
      </p>
      <p
        data-stat-value
        className={cn(
          "mt-2 text-[clamp(1.35rem,2vw,1.75rem)] font-bold leading-none tabular-nums tracking-tight",
          tone === "success" && "text-[var(--color-biz-success)]",
          tone === "danger" && "text-[var(--color-biz-danger)]",
          tone === "accent" && "text-[var(--color-biz-accent)]",
        )}
      >
        {value}
      </p>
      {showDelta ? <p className={cn("mt-2 text-xs font-semibold tabular-nums", deltaTone)}>{deltaText}</p> : null}
      {hint ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[var(--color-biz-muted)]">{hint}</p>
      ) : null}
    </div>
  );
  if (!href) return inner;
  return (
    <Link href={href} className="block w-[min(100%,18.5rem)] shrink-0 sm:w-full sm:min-w-0 outline-none ring-offset-2 focus-visible:ring-2">
      {inner}
    </Link>
  );
});
