"use client";

import { memo, useMemo } from "react";
import { Bot, CheckCircle2, Sparkles, TriangleAlert } from "lucide-react";
import { formatNumber, inr } from "@/lib/format";
import type { DashboardStats } from "@/types/admin";
import { GlassPanel } from "./GlassPanel";
import { Icon3D } from "./Icon3D";
import { cn } from "@/lib/cn";

export const AiBriefingPanel = memo(function AiBriefingPanel({
  stats,
  isLoading,
}: {
  stats?: DashboardStats | null;
  isLoading: boolean;
}) {
  const model = useMemo(() => {
    if (isLoading || !stats) return null;

    const completion =
      stats.totalBookings > 0
        ? Math.round((stats.completedBookings / stats.totalBookings) * 100)
        : 0;
    const onlinePct =
      stats.totalProviders > 0
        ? Math.round((stats.activeNow / stats.totalProviders) * 100)
        : 0;

    const items: { tone: "ok" | "warn"; text: string }[] = [
      {
        tone: completion >= 70 ? "ok" : "warn",
        text: `Processed ${formatNumber(stats.totalBookings)} bookings at ${completion}% completion.`,
      },
      {
        tone: "ok",
        text: `Revenue ${inr(stats.totalRevenue, true)} · ${inr(stats.thisMonthRevenue, true)} this month.`,
      },
      {
        tone: stats.activeNow > 0 ? "ok" : "warn",
        text: `${formatNumber(stats.activeNow)} partners online (${onlinePct}% of ${formatNumber(stats.totalProviders)}).`,
      },
      {
        tone: stats.averageRating >= 4 ? "ok" : "warn",
        text: `${formatNumber(stats.totalUsers)} customers · ${stats.averageRating.toFixed(1)}★ avg rating.`,
      },
    ];

    const focus =
      completion < 70
        ? "Completion below target — review ops alerts and partner availability."
        : stats.activeNow === 0
          ? "No partners online — check marketplace supply in Operations HQ."
          : "Platform operating within normal parameters.";

    return { completion, onlinePct, items, focus, warn: completion < 70 || stats.activeNow === 0 };
  }, [stats, isLoading]);

  return (
    <GlassPanel glow="amber" className="biz-panel-fill gap-5 p-6">
      <div className="flex items-center gap-3">
        <Icon3D icon={Bot} tone="warning" size="md" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold leading-none">AI Daily Briefing</h2>
          <p className="mt-1.5 text-[11px] leading-none text-[var(--color-biz-muted)]">Derived from live platform data</p>
        </div>
        <Icon3D icon={Sparkles} tone="warning" size="sm" className="ml-auto" />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="biz-skeleton h-4 w-full rounded" />
          ))}
        </div>
      ) : model ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <MeterChip label="Completion" value={`${model.completion}%`} pct={model.completion} />
            <MeterChip label="Fleet online" value={`${model.onlinePct}%`} pct={model.onlinePct} />
          </div>

          <ul className="space-y-3 text-sm leading-relaxed text-[var(--color-biz-text)]">
            {model.items.map((item) => (
              <li key={item.text} className="flex gap-3">
                {item.tone === "ok" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-biz-success)]" />
                ) : (
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-biz-warning)]" />
                )}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>

          <div className="biz-brief-focus">
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
              Status
            </p>
            <p
              className={cn(
                "mt-2 text-sm font-medium leading-relaxed",
                model.warn ? "text-[var(--color-biz-warning)]" : "text-[var(--color-biz-text)]",
              )}
            >
              {model.focus}
            </p>
          </div>
        </>
      ) : (
        <p className="text-sm text-[var(--color-biz-muted)]">No briefing data available.</p>
      )}
    </GlassPanel>
  );
});

function MeterChip({ label, value, pct }: { label: string; value: string; pct: number }) {
  const tone = pct >= 70 ? "biz-meter--success" : pct >= 40 ? "biz-meter--warning" : "biz-meter--danger";
  return (
    <div className="biz-metric-chip">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
          {label}
        </p>
        <p data-stat-value className="text-sm font-semibold tabular-nums">
          {value}
        </p>
      </div>
      <div className={cn("biz-meter !mt-2", tone)} role="meter" aria-label={label} aria-valuenow={pct}>
        <span style={{ width: `${Math.max(4, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}
