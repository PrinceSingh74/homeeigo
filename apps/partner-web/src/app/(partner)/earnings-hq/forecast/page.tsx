"use client";

import { Sparkles } from "lucide-react";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { usePartnerForecastQuery } from "@/hooks/use-partner-os";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

export default function ForecastPage() {
  const forecast = usePartnerForecastQuery();
  const data = forecast.data;

  return (
    <HqPageShell
      title="Forecast Center"
      description="Projections computed from dashboard earnings and geo-intel demand forecast."
      icon={Sparkles}
      stats={[
        { label: "Today Projection", value: inr(data?.todayProjection ?? 0) },
        { label: "Weekly Projection", value: inr(data?.weeklyProjection ?? 0) },
        { label: "Monthly Projection", value: inr(data?.monthlyProjection ?? 0) },
        { label: "Avg / job", value: inr(data?.inputs?.avgPerJob ?? 0) },
      ]}
    >
      <section className="partner-card p-5 text-sm text-partner-muted">
        Inputs: today earnings {inr(data?.inputs?.todayEarnings ?? 0)}, week {inr(data?.inputs?.weekEarnings ?? 0)},
        demand index {data?.inputs?.demandPredicted ?? 0}, confidence {Math.round((data?.inputs?.confidence ?? 0) * 100)}%
      </section>
    </HqPageShell>
  );
}
