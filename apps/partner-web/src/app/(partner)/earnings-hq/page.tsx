"use client";

import Link from "next/link";
import { usePartnerDashboardQuery, usePartnerEarningsQuery } from "@/hooks/use-partner-data";

const formatInr = (value: number) => `₹${value.toLocaleString("en-IN")}`;

export default function EarningsHqPage() {
  const dashboard = usePartnerDashboardQuery();
  const earnings = usePartnerEarningsQuery(30);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Earnings HQ</h1>
        <p className="text-sm text-partner-muted">
          Real-time earnings, payouts, incentives, tax, and forecast intelligence.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Today", value: formatInr(dashboard.data?.earnings.today ?? 0) },
          { label: "This Week", value: formatInr(dashboard.data?.earnings.thisWeek ?? 0) },
          { label: "This Month", value: formatInr(dashboard.data?.earnings.thisMonth ?? 0) },
          { label: "Avg / Job", value: formatInr(earnings.data?.averagePerJob ?? 0) },
        ].map((metric) => (
          <article key={metric.label} className="partner-card p-4">
            <p className="text-xs uppercase tracking-wide text-partner-muted">{metric.label}</p>
            <p className="mt-2 font-display text-2xl font-bold">{metric.value}</p>
          </article>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Link href="/earnings-hq/incentives" className="partner-card partner-card-hover p-4">
          <p className="font-semibold">Incentives Center</p>
          <p className="mt-1 text-sm text-partner-muted">Daily/weekly/monthly bonus eligibility from live metrics.</p>
        </Link>
        <Link href="/earnings-hq/tax-center" className="partner-card partner-card-hover p-4">
          <p className="font-semibold">Tax Center</p>
          <p className="mt-1 text-sm text-partner-muted">GST/TDS summary sourced from provider tax APIs.</p>
        </Link>
        <Link href="/earnings-hq/forecast" className="partner-card partner-card-hover p-4">
          <p className="font-semibold">Forecast Center</p>
          <p className="mt-1 text-sm text-partner-muted">Today/weekly/monthly projection from earnings and demand forecast.</p>
        </Link>
      </div>
    </div>
  );
}
