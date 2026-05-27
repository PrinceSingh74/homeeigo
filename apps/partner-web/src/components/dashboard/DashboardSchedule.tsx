"use client";

import { CheckCircle2, Clock } from "lucide-react";
import { DEMO_SCHEDULE, formatInr } from "@/lib/partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

export function DashboardSchedule() {
  const total = DEMO_SCHEDULE.reduce((s, i) => s + i.earning, 0);

  return (
    <DashboardPanel title="Today's Schedule" href="/requests">
      <ul className={partnerLayout.listGap}>
        {DEMO_SCHEDULE.map((item) => (
          <li
            key={item.id}
            className={cn(
              "flex items-center gap-4",
              partnerLayout.itemPad,
              "transition hover:bg-white/[0.03]"
            )}
          >
            {item.status === "completed" ? (
              <CheckCircle2 className="h-6 w-6 shrink-0 text-partner-success" />
            ) : (
              <Clock className="h-6 w-6 shrink-0 text-partner-warning" />
            )}
            <span className="w-[72px] shrink-0 text-xs font-semibold tabular-nums text-partner-text">
              {item.time}
            </span>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-[13px] font-semibold leading-tight text-partner-text">
                {item.service}
              </p>
              <p
                className={cn(
                  "text-[11px] font-medium",
                  item.status === "completed"
                    ? "text-partner-success"
                    : "text-partner-warning"
                )}
              >
                {item.status === "completed" ? "✓ Completed" : "⏳ Upcoming"}
              </p>
            </div>
            <span className="shrink-0 font-display text-sm font-bold tabular-nums text-partner-accent">
              {formatInr(item.earning)}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-5 flex items-center justify-between border-t border-partner-line pt-5 text-sm">
        <span className="text-partner-text-secondary">
          {DEMO_SCHEDULE.length} Jobs Scheduled
        </span>
        <span className="font-display font-bold tabular-nums text-partner-accent">
          {formatInr(total)} Total
        </span>
      </div>
    </DashboardPanel>
  );
}
