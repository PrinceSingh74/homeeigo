"use client";

import dynamic from "next/dynamic";

const EarningsOverview = dynamic(
  () => import("@/components/earnings/EarningsOverview").then((m) => m.EarningsOverview),
  { ssr: false, loading: () => <div className="h-96 w-full rounded-2xl bg-white/[0.03]" aria-hidden /> },
);

export default function EarningsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Earnings</h1>
        <p className="text-sm text-partner-muted">
          Live earnings, trends, breakdowns, and settlement history
        </p>
      </div>
      <EarningsOverview />
    </div>
  );
}
