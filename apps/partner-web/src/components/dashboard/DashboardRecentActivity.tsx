"use client";

import { DEMO_RECENT_ACTIVITY, formatInr } from "@/lib/partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { partnerLayout } from "@/lib/partner-layout";

export function DashboardRecentActivity() {
  return (
    <DashboardPanel title="Recent Activity" href="/wallet">
      <ul className={partnerLayout.listGap}>
        {DEMO_RECENT_ACTIVITY.map((item) => (
          <li key={item.id} className="flex items-center gap-3.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-partner-primary/25 bg-partner-primary/10 text-xs font-bold text-partner-primary">
              {item.customerName.charAt(0)}
            </div>
            <div className="min-w-0 flex-1 space-y-0.5">
              <p className="text-sm font-semibold leading-tight text-partner-text">
                {item.customerName}
              </p>
              <p className="truncate text-xs text-partner-muted">{item.service}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-bold tabular-nums text-partner-success">
                +{formatInr(item.amount)}
              </p>
              <p className="text-[10px] text-partner-muted-dim">{item.time}</p>
            </div>
          </li>
        ))}
      </ul>
    </DashboardPanel>
  );
}
