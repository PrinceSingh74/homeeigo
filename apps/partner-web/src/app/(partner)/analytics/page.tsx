"use client";

import dynamic from "next/dynamic";

const PerformanceAnalytics = dynamic(
  () =>
    import("@/components/analytics/PerformanceAnalytics").then((m) => ({
      default: m.PerformanceAnalytics,
    })),
  {
    ssr: false,
    loading: () => <div className="h-96 w-full rounded-2xl bg-white/[0.03]" aria-hidden />,
  },
);

export default function AnalyticsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Analytics</h1>
        <p className="text-sm text-partner-muted">
          Earnings, bookings, acceptance, and service performance
        </p>
      </div>
      <PerformanceAnalytics />
    </div>
  );
}
