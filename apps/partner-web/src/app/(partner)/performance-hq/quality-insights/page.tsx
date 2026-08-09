"use client";

import { usePartnerDashboardQuery } from "@/hooks/use-partner-data";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { Star } from "lucide-react";

export default function QualityInsightsPage() {
  const dashboard = usePartnerDashboardQuery();
  const acceptance = dashboard.data?.rates.acceptanceRate ?? 0;
  const cancellation = dashboard.data?.rates.cancellationRate ?? 0;
  const response = dashboard.data?.rates.responseRate ?? 0;
  const onTime = dashboard.data?.rates.onTimeRate ?? 0;

  const recommendations = [
    acceptance < 85
      ? "Improve acceptance rate by responding to pending requests within 2 minutes."
      : "Acceptance rate is strong — maintain current dispatch discipline.",
    cancellation > 8
      ? "Reduce cancellations by confirming route ETA before accepting long-distance jobs."
      : "Cancellation rate is within healthy range.",
    response < 90
      ? "Keep the app foregrounded during shift hours to improve response SLA."
      : "Response SLA is excellent.",
    onTime < 90
      ? "Plan buffer time between jobs to improve on-time arrival."
      : "On-time performance is a competitive advantage — keep it up.",
  ];

  return (
    <HqPageShell title="Quality Insights" description="Recommendations derived from your live dashboard KPIs." icon={Star}>
      <section className="space-y-2">
        {recommendations.map((item) => (
          <article key={item} className="partner-card p-4 text-sm leading-relaxed text-partner-text-secondary">
            {item}
          </article>
        ))}
      </section>
    </HqPageShell>
  );
}
