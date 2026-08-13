"use client";

import { CircularProgress } from "@/components/ui/CircularProgress";
import { usePartnerDashboardQuery } from "@/hooks/use-partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

/** Rates arrive as percentages (0–100). `invert` widens low-is-good bars. */
function toPct(value: number, invert = false): number {
  const v = Math.round(value);
  return invert ? Math.min(100, v * 4) : v;
}

export function DashboardPerformance() {
  const { data, isLoading } = usePartnerDashboardQuery();
  const rates = data?.rates;

  const completion = Math.round(rates?.completionRate ?? 0);
  const response = Math.round(rates?.responseRate ?? 0);
  const onTime = Math.round(rates?.onTimeRate ?? 0);
  const cancellation = Math.round(rates?.cancellationRate ?? 0);

  const score = completion;
  const scoreLabel =
    score >= 90
      ? "Excellent"
      : score >= 75
        ? "Good"
        : score >= 50
          ? "Needs work"
          : "Critical";
  const scoreClass =
    score >= 90
      ? "text-partner-success"
      : score >= 75
        ? "text-partner-primary"
        : score >= 50
          ? "text-partner-warning"
          : "text-partner-danger";

  const metrics = [
    {
      label: "Completion Rate",
      value: completion,
      pct: completion,
      color: "bg-partner-success",
    },
    {
      label: "Response Rate",
      value: response,
      pct: response,
      color: "bg-partner-primary",
    },
    {
      label: "On-time Rate",
      value: onTime,
      pct: onTime,
      color: "bg-partner-accent",
    },
    {
      label: "Cancellation Rate",
      value: cancellation,
      pct: toPct(rates?.cancellationRate ?? 0, true),
      color: "bg-partner-danger",
    },
  ];

  return (
    <DashboardPanel
      title="Performance Overview"
      action={
        <span className="rounded-lg border border-partner-line px-2.5 py-1 text-xs font-medium text-partner-text-secondary">
          Lifetime
        </span>
      }
      bodyClassName="gap-6"
    >
      <div className="flex justify-center py-2">
        <CircularProgress value={score} size={120} strokeWidth={8}>
          <span
            className={cn("font-display text-2xl font-bold leading-none", scoreClass)}
          >
            {isLoading ? "…" : `${score}%`}
          </span>
          <span className={cn("mt-0.5 text-[11px] font-semibold", scoreClass)}>
            {isLoading ? "Loading" : scoreLabel}
          </span>
        </CircularProgress>
      </div>

      <ul className={partnerLayout.listGap}>
        {metrics.map((m) => (
          <li key={m.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-partner-text-secondary">{m.label}</span>
              <span className="font-semibold tabular-nums text-partner-text">
                {isLoading ? "—" : `${m.value}%`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-partner-bg">
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-700",
                  m.color,
                )}
                style={{ width: `${isLoading ? 0 : m.pct}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}
