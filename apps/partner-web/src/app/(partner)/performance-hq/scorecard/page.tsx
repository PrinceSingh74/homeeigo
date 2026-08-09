"use client";

import { BarChart3 } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerDashboardQuery, usePartnerMeQuery } from "@/hooks/use-partner-data";
import { usePartnerIntelligenceQuery } from "@/hooks/use-partner-os";

const pct = (v: number) => `${v.toFixed(1)}%`;

export default function ScorecardPage() {
  const dashboard = usePartnerDashboardQuery();
  const me = usePartnerMeQuery();
  const intel = usePartnerIntelligenceQuery();

  return (
    <HqPageShell
      title="Partner Scorecard"
      description="Live performance KPIs from provider dashboard and intelligence APIs."
      icon={BarChart3}
      stats={[
        { label: "Acceptance Rate", value: pct(dashboard.data?.rates.acceptanceRate ?? 0) },
        { label: "Completion Rate", value: pct(dashboard.data?.rates.completionRate ?? 0) },
        { label: "Cancellation Rate", value: pct(dashboard.data?.rates.cancellationRate ?? 0) },
        { label: "Response Time", value: `${(me.data?.avgResponseTime ?? 0).toFixed(1)} min` },
        { label: "Rating", value: (dashboard.data?.rating ?? 0).toFixed(2) },
        { label: "Repeat Customer %", value: pct(intel.data?.repeatCustomerRatePct ?? 0) },
      ]}
    />
  );
}
