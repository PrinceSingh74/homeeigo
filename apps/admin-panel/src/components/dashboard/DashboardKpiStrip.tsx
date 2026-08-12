"use client";

import { memo, useMemo } from "react";
import { formatNumber, inr } from "@/lib/format";

type DashboardStats = {
  totalRevenue?: number;
  thisMonthRevenue?: number;
  totalBookings?: number;
  completedBookings?: number;
  totalProviders?: number;
  activeNow?: number;
  totalUsers?: number;
  averageRating?: number;
};

export const DashboardKpiStrip = memo(function DashboardKpiStrip({
  stats,
  isLoading,
}: {
  stats?: DashboardStats | null;
  isLoading: boolean;
}) {
  const items = useMemo(
    () => [
      {
        label: "Revenue",
        value: isLoading ? "—" : inr(stats?.totalRevenue ?? 0, true),
        sub: stats ? inr(stats.thisMonthRevenue ?? 0, true) : undefined,
      },
      {
        label: "Bookings",
        value: isLoading ? "—" : formatNumber(stats?.totalBookings ?? 0),
        sub: stats ? `${formatNumber(stats.completedBookings ?? 0)} done` : undefined,
      },
      {
        label: "Providers",
        value: isLoading ? "—" : formatNumber(stats?.totalProviders ?? 0),
        sub: stats ? `${formatNumber(stats.activeNow ?? 0)} online` : undefined,
      },
      {
        label: "Customers",
        value: isLoading ? "—" : formatNumber(stats?.totalUsers ?? 0),
      },
      {
        label: "Rating",
        value: isLoading ? "—" : `${(stats?.averageRating ?? 0).toFixed(1)}★`,
      },
      {
        label: "Completion",
        value:
          isLoading || !stats?.totalBookings
            ? "—"
            : `${Math.round(((stats.completedBookings ?? 0) / Math.max(1, stats.totalBookings)) * 100)}%`,
      },
    ],
    [stats, isLoading],
  );

  return (
    <section
      className="biz-card grid grid-cols-2 gap-px overflow-hidden sm:grid-cols-3 2xl:grid-cols-6"
      data-dashboard-kpi-strip
    >
      {items.map((item) => (
        <div key={item.label} className="bg-[var(--color-biz-bg)] px-3 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-biz-muted)]">
            {item.label}
          </p>
          <p className="text-lg font-bold tabular-nums leading-tight">{item.value}</p>
          {item.sub ? (
            <p className="text-[10px] text-[var(--color-biz-muted)]">{item.sub}</p>
          ) : null}
        </div>
      ))}
    </section>
  );
});
