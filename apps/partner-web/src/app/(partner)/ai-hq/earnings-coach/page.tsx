"use client";

import { useQuery } from "@tanstack/react-query";
import { IndianRupee } from "lucide-react";
import { partnerApi } from "@/services/partner-api";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { formatInr } from "@/lib/format";

export default function EarningsCoachPage() {
  const forecast = useQuery({
    queryKey: ["partner", "forecast"],
    queryFn: () => partnerApi.partnerOs.forecast(),
  });
  const data = forecast.data;
  const todayBasis = data?.basis?.todayProjection;
  const weekBasis = data?.basis?.weeklyProjection;

  return (
    <HqPageShell
      title="Earnings Intelligence"
      description="Expected earnings use verified history and zone demand. Nothing here is a guarantee."
      icon={IndianRupee}
      loading={forecast.isLoading}
      stats={[
        { label: "Today (heuristic)", value: data ? formatInr(data.todayProjection) : "—" },
        { label: "Trailing 7 days", value: data ? formatInr(data.weeklyProjection) : "—" },
        { label: "Best opportunity", value: "—" },
        { label: "Demand / supply", value: "—" },
      ]}
    >
      <section className="partner-card space-y-2 p-5">
        <h2 className="font-semibold">Why this forecast</h2>
        <p className="text-sm text-partner-muted">
          {todayBasis?.method
            ? `Today: ${todayBasis.method}${todayBasis.predictive ? " (predictive, not guaranteed)" : ""}.`
            : "Today’s figure is a demand-priced estimate or realised earnings — whichever is higher."}
        </p>
        <p className="text-sm text-partner-muted">
          {weekBasis?.method
            ? `Week: ${weekBasis.method}${weekBasis.state === "INSUFFICIENT_HISTORY" ? " — not enough history yet." : "."}`
            : "Weekly figure is trailing actuals, not a growth projection."}
        </p>
      </section>
      <section className="partner-card p-5">
        <h2 className="font-semibold">Opportunity zones</h2>
        <p className="mt-2 text-sm text-partner-muted">
          Platform zone scores are not part of the partner view. Surge and coverage are on Territory HQ.
        </p>
      </section>
    </HqPageShell>
  );
}
