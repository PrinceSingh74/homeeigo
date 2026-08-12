"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sunrise, Sunset, CalendarDays, CalendarRange, Presentation, Landmark } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { inr, formatNumber } from "@/lib/format";
import { GlassPanel } from "./GlassPanel";
import { HqLoading } from "./primitives";
import { cn } from "@/lib/cn";

type BriefId = "morning" | "evening" | "weekly" | "monthly" | "board" | "investor";

const BRIEFS: { id: BriefId; label: string; icon: LucideIcon }[] = [
  { id: "morning", label: "Morning", icon: Sunrise },
  { id: "evening", label: "Evening", icon: Sunset },
  { id: "weekly", label: "Weekly", icon: CalendarDays },
  { id: "monthly", label: "Monthly", icon: CalendarRange },
  { id: "board", label: "Board", icon: Presentation },
  { id: "investor", label: "Investor", icon: Landmark },
];

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function ExecutiveBriefs() {
  const [brief, setBrief] = useState<BriefId>("morning");

  const dashboard = useAdminDashboardQuery();
  const finance = useQuery({
    queryKey: ["hq", "exec", "brief-finance"],
    queryFn: () => adminApi.financeDashboard(30),
    staleTime: 120_000,
  });
  const reports = useQuery({
    queryKey: ["hq", "exec", "brief-reports"],
    queryFn: () => adminApi.financeReports(),
    staleTime: 120_000,
  });
  const unit = useQuery({
    queryKey: ["hq", "exec", "brief-unit"],
    queryFn: () => adminApi.financeUnitEconomics(30),
    staleTime: 120_000,
  });

  const stats = dashboard.data?.stats;
  const isLoading = dashboard.isLoading || finance.isLoading;

  const lines = useMemo<string[]>(() => {
    if (isLoading || !stats) return [];
    const fo = (finance.data?.overview ?? {}) as Record<string, unknown>;
    const rep = (reports.data ?? {}) as Record<string, unknown>;
    const u = (unit.data ?? {}) as Record<string, unknown>;

    const completion =
      stats.totalBookings > 0 ? Math.round((stats.completedBookings / stats.totalBookings) * 100) : 0;
    const gmv = num(fo.gmv);
    const net = num(fo.netRevenue);
    const margin = num(rep.platformMarginPct);
    const mrr = num(fo.mrr);
    const ltv = num(u.avgLtv);
    const cac = num(u.cac);

    switch (brief) {
      case "morning":
        return [
          `Good morning. ${formatNumber(stats.activeNow)} partners are online across the network.`,
          `Lifetime GMV ${inr(stats.totalRevenue, true)}; this month ${inr(stats.thisMonthRevenue, true)}.`,
          `${formatNumber(stats.totalBookings)} bookings to date at ${completion}% completion.`,
          completion < 70
            ? "Focus today: completion is below target — check partner availability in Operations HQ."
            : "Network is healthy — no morning escalations required.",
        ];
      case "evening":
        return [
          `End-of-day: ${inr(stats.thisMonthRevenue, true)} month-to-date revenue.`,
          `${formatNumber(stats.completedBookings)} of ${formatNumber(stats.totalBookings)} bookings completed (${completion}%).`,
          `Avg rating ${stats.averageRating.toFixed(1)}★ across the platform.`,
          "Review the Live Alert Feed in Operations HQ before close.",
        ];
      case "weekly":
        return [
          `Weekly snapshot: 30-day GMV ${inr(gmv, true)}, net revenue ${inr(net, true)}.`,
          `Platform margin ${margin.toFixed(1)}%; MRR ${inr(mrr, true)}.`,
          `${formatNumber(stats.totalUsers)} customers · ${formatNumber(stats.totalProviders)} partners.`,
          "Growth HQ cohorts and retention trends are refreshed for the weekly review.",
        ];
      case "monthly":
        return [
          `Monthly performance: GMV ${inr(gmv, true)}, net revenue ${inr(net, true)}, margin ${margin.toFixed(1)}%.`,
          `Recurring revenue (MRR) ${inr(mrr, true)}; ARR ${inr(num(fo.arr), true)}.`,
          `Unit economics — LTV ${inr(ltv)}${cac > 0 ? `, CAC ${inr(cac)}, ratio ${(ltv / cac).toFixed(1)}x` : " (CAC pending marketing-spend input)"}.`,
          "Liabilities and settlement exposure are detailed in Finance HQ.",
        ];
      case "board":
        return [
          `Board summary — GMV ${inr(gmv, true)} (30d), net revenue ${inr(net, true)}, platform margin ${margin.toFixed(1)}%.`,
          `Scale: ${formatNumber(stats.totalUsers)} customers, ${formatNumber(stats.totalProviders)} partners, ${formatNumber(stats.totalBookings)} lifetime bookings.`,
          `Operational quality: ${completion}% booking completion, ${stats.averageRating.toFixed(1)}★ satisfaction proxy.`,
          "Governance items: EBITDA, burn and runway require the treasury feed (see executive-intelligence-report.md).",
        ];
      case "investor":
        return [
          `Investor view — MRR ${inr(mrr, true)}, ARR ${inr(num(fo.arr), true)}, 30-day GMV ${inr(gmv, true)}.`,
          `Take rate / platform margin ${margin.toFixed(1)}%; net revenue ${inr(net, true)}.`,
          cac > 0
            ? `LTV:CAC ${(ltv / cac).toFixed(1)}x (LTV ${inr(ltv)}, CAC ${inr(cac)}).`
            : `LTV ${inr(ltv)}; CAC requires marketing-spend integration for a reportable ratio.`,
          "Burn, runway and cohort-based retention are flagged in investor-readiness-report.md with proposed data sources.",
        ];
      default:
        return [];
    }
  }, [brief, isLoading, stats, finance.data, reports.data, unit.data]);

  const active = BRIEFS.find((b) => b.id === brief)!;

  return (
    <GlassPanel glow="amber" className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <active.icon className="h-4 w-4 text-[var(--color-biz-accent)]" />
        <h2 className="text-sm font-semibold">Executive AI Briefing</h2>
        <div className="biz-segment ml-auto flex-wrap">
          {BRIEFS.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBrief(b.id)}
              className={cn("biz-segment-btn", brief === b.id && "is-active")}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <HqLoading label="Composing briefing from live data…" />
      ) : lines.length > 0 ? (
        <ul className="space-y-2 text-sm leading-relaxed">
          {lines.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-biz-accent)]" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-biz-muted)]">No data available for this brief.</p>
      )}

      <p className="mt-4 border-t border-[var(--color-biz-line)] pt-3 text-[10px] text-[var(--color-biz-muted)]">
        Generated deterministically from live platform data — no language model, no fabricated figures.
      </p>
    </GlassPanel>
  );
}
