"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sunrise,
  Sunset,
  CalendarDays,
  CalendarRange,
  Presentation,
  Landmark,
  Crosshair,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { adminApi } from "@/services/admin-api";
import { adminKeys, useAdminDashboardQuery } from "@/hooks/use-admin-data";
import { useAfterFirstPaint } from "@/hooks/use-after-first-paint";
import { inr, formatNumber } from "@/lib/format";
import { GlassPanel } from "./GlassPanel";
import { HqLoading } from "./primitives";
import { Icon3D } from "./Icon3D";
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
  const secondary = useAfterFirstPaint();
  const finance = useQuery({
    queryKey: adminKeys.financeDashboard(30),
    queryFn: () => adminApi.financeDashboard(30),
    staleTime: 120_000,
  });
  const reports = useQuery({
    queryKey: adminKeys.financeReports,
    queryFn: () => adminApi.financeReports(),
    staleTime: 120_000,
    enabled: secondary,
  });
  const unit = useQuery({
    queryKey: adminKeys.financeUnit(30),
    queryFn: () => adminApi.financeUnitEconomics(30),
    staleTime: 120_000,
    enabled: secondary,
  });

  const stats = dashboard.data?.stats;
  const isLoading = dashboard.isLoading || finance.isLoading;

  const derived = useMemo(() => {
    const fo = (finance.data?.overview ?? {}) as Record<string, unknown>;
    const rep = (reports.data ?? {}) as Record<string, unknown>;
    const u = (unit.data ?? {}) as Record<string, unknown>;
    const completion =
      stats && stats.totalBookings > 0
        ? Math.round((stats.completedBookings / stats.totalBookings) * 100)
        : 0;
    return {
      fo,
      completion,
      gmv: num(fo.gmv),
      net: num(fo.netRevenue),
      margin: num(rep.platformMarginPct),
      mrr: num(fo.mrr),
      ltv: num(u.avgLtv),
      cac: num(u.cac),
    };
  }, [stats, finance.data, reports.data, unit.data]);

  const lines = useMemo<string[]>(() => {
    if (isLoading || !stats) return [];
    const { completion, gmv, net, margin, mrr, ltv, cac, fo } = derived;

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
  }, [brief, isLoading, stats, derived]);

  const chips = useMemo(() => {
    if (!stats) {
      return [
        { label: "Online now", value: "—" },
        { label: "MTD revenue", value: "—" },
        { label: "Completion", value: "—" },
        { label: "Avg rating", value: "—" },
      ];
    }
    return [
      { label: "Online now", value: formatNumber(stats.activeNow) },
      { label: "MTD revenue", value: inr(stats.thisMonthRevenue, true) },
      { label: "Completion", value: `${derived.completion}%` },
      { label: "Avg rating", value: `${stats.averageRating.toFixed(1)}★` },
    ];
  }, [stats, derived.completion]);

  const active = BRIEFS.find((b) => b.id === brief)!;
  const narrative = lines.slice(0, -1);
  const focus = lines[lines.length - 1];

  return (
    <GlassPanel glow="amber" className="biz-panel-fill gap-5 p-6">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Icon3D icon={active.icon} tone="warning" size="md" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold leading-none">Executive AI Briefing</h2>
            <p className="mt-1.5 text-[11px] leading-none text-[var(--color-biz-muted)]">
              Board-ready · {active.label} cut
            </p>
          </div>
        </div>
        <div className="biz-segment flex-wrap">
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {chips.map((c) => (
          <div key={c.label} className="biz-metric-chip">
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-biz-muted)]">
              {c.label}
            </p>
            <p data-stat-value className="text-lg font-semibold tabular-nums leading-none">
              {isLoading ? "—" : c.value}
            </p>
          </div>
        ))}
      </div>

      {isLoading ? (
        <HqLoading label="Composing briefing from live data…" />
      ) : narrative.length > 0 ? (
        <ul className="space-y-3 text-sm leading-relaxed">
          {narrative.map((l, i) => (
            <li key={i} className="flex gap-3">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-biz-accent)]" />
              <span>{l}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-[var(--color-biz-muted)]">No data available for this brief.</p>
      )}

      {focus ? (
        <div className="biz-brief-focus">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-biz-muted)]">
            <Crosshair className="h-3 w-3 text-[var(--color-biz-accent)]" />
            Today&apos;s focus
          </p>
          <p className="mt-2 text-sm font-medium leading-relaxed">{focus}</p>
        </div>
      ) : null}

      <p className="border-t border-[var(--color-biz-line)] pt-4 text-[10px] leading-relaxed text-[var(--color-biz-muted)]">
        Generated deterministically from live platform data — no language model, no fabricated figures.
      </p>
    </GlassPanel>
  );
}
