"use client";

import { CircularProgress } from "@/components/ui/CircularProgress";
import { DEMO_DASHBOARD } from "@/lib/partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

const metrics = [
  { label: "Completion Rate", value: DEMO_DASHBOARD.completionRate, color: "bg-partner-success" },
  { label: "Response Rate", value: DEMO_DASHBOARD.responseRate, color: "bg-partner-primary" },
  { label: "On-time Rate", value: DEMO_DASHBOARD.onTimeRate, color: "bg-partner-accent" },
  {
    label: "Cancellation Rate",
    value: DEMO_DASHBOARD.cancellationRate,
    color: "bg-partner-danger",
    invert: true,
  },
];

export function DashboardPerformance() {
  const score = DEMO_DASHBOARD.completionRate;

  return (
    <DashboardPanel
      title="Performance Overview"
      action={
        <button
          type="button"
          className="rounded-lg border border-partner-line px-2.5 py-1 text-xs font-medium text-partner-text-secondary"
        >
          This Week ▾
        </button>
      }
      bodyClassName="gap-6"
    >
      <div className="flex justify-center py-2">
        <CircularProgress value={score} size={120} strokeWidth={8}>
          <span className="font-display text-2xl font-bold leading-none text-partner-success">
            {score}%
          </span>
          <span className="mt-0.5 text-[11px] font-semibold text-partner-success">Excellent</span>
        </CircularProgress>
      </div>

      <ul className={partnerLayout.listGap}>
        {metrics.map((m) => (
          <li key={m.label} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-partner-text-secondary">{m.label}</span>
              <span className="font-semibold tabular-nums text-partner-text">{m.value}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-partner-bg">
              <div
                className={cn("h-full rounded-full transition-all duration-700", m.color)}
                style={{
                  width: `${m.invert ? Math.min(m.value * 8, 100) : m.value}%`,
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}
