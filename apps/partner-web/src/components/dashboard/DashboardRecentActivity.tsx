"use client";

import { usePartnerBookingsQuery } from "@/hooks/use-partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { partnerLayout } from "@/lib/partner-layout";
import { formatInr, relativeTime } from "@/lib/format";

export function DashboardRecentActivity() {
  const { data, isLoading, isError } = usePartnerBookingsQuery({
    page: 1,
    limit: 5,
    status: "completed",
    sortBy: "recent",
  });

  const items = data?.bookings ?? [];

  return (
    <DashboardPanel title="Recent Activity" href="/wallet">
      {isLoading ? (
        <ul className={partnerLayout.listGap}>
          {Array.from({ length: 3 }).map((_, i) => (
            <li
              key={i}
              className="h-12 animate-pulse rounded-xl bg-white/[0.03]"
            />
          ))}
        </ul>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-partner-muted">
          Couldn&apos;t load activity.
        </p>
      ) : items.length === 0 ? (
        <p className="py-8 text-center text-sm text-partner-muted">
          No completed jobs yet — accept your first request to get started.
        </p>
      ) : (
        <ul className={partnerLayout.listGap}>
          {items.map((b) => {
            const customer =
              `${b.customer.firstName ?? ""} ${b.customer.lastName ?? ""}`.trim() ||
              "Customer";
            return (
              <li key={b.id} className="flex items-center gap-3.5">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-partner-primary/25 bg-partner-primary/10 text-xs font-bold text-partner-primary">
                  {customer.charAt(0)}
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold leading-tight text-partner-text">
                    {customer}
                  </p>
                  <p className="truncate text-xs text-partner-muted">
                    {b.service.name} completed
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold tabular-nums text-partner-success">
                    +{formatInr(b.finalAmount)}
                  </p>
                  <p className="text-[10px] text-partner-muted-dim">
                    {relativeTime(b.completedAt) || "recently"}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </DashboardPanel>
  );
}
