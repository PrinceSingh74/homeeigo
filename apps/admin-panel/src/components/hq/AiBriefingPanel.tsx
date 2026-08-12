"use client";

import { memo, useMemo } from "react";
import { Bot, Sparkles } from "lucide-react";
import { formatNumber, inr } from "@/lib/format";
import type { DashboardStats } from "@/types/admin";
import { GlassPanel } from "./GlassPanel";

export const AiBriefingPanel = memo(function AiBriefingPanel({
  stats,
  isLoading,
}: {
  stats?: DashboardStats | null;
  isLoading: boolean;
}) {
  const briefing = useMemo(() => {
    if (isLoading || !stats) return null;

    const completion =
      stats.totalBookings > 0
        ? Math.round((stats.completedBookings / stats.totalBookings) * 100)
        : 0;
    const onlinePct =
      stats.totalProviders > 0
        ? Math.round((stats.activeNow / stats.totalProviders) * 100)
        : 0;

    const lines: string[] = [
      `Platform processed ${formatNumber(stats.totalBookings)} bookings with ${completion}% completion.`,
      `Revenue stands at ${inr(stats.totalRevenue, true)} (${inr(stats.thisMonthRevenue, true)} this month).`,
      `${formatNumber(stats.activeNow)} partners online (${onlinePct}% of ${formatNumber(stats.totalProviders)} total).`,
      `Customer base: ${formatNumber(stats.totalUsers)} users · avg rating ${stats.averageRating.toFixed(1)}★.`,
    ];

    if (completion < 70) {
      lines.push("⚠ Completion rate below target — review ops alerts and partner availability.");
    } else if (stats.activeNow === 0) {
      lines.push("⚠ No partners online — check marketplace supply in Operations HQ.");
    } else {
      lines.push("✓ Platform operating within normal parameters.");
    }

    return lines;
  }, [stats, isLoading]);

  return (
    <GlassPanel glow="amber" className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15">
          <Bot className="h-4 w-4 text-[var(--color-biz-accent)]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold">AI Daily Briefing</h2>
          <p className="text-[10px] text-[var(--color-biz-muted)]">Derived from live platform data</p>
        </div>
        <Sparkles className="ml-auto h-4 w-4 text-amber-400/60" />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="biz-skeleton h-4 w-full rounded" />
          ))}
        </div>
      ) : briefing ? (
        <ul className="space-y-2 text-sm leading-relaxed text-[var(--color-biz-text)]">
          {briefing.map((line) => (
            <li key={line} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-biz-accent)]" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-biz-muted)]">No briefing data available.</p>
      )}
    </GlassPanel>
  );
});
