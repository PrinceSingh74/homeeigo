"use client";

import { PartnerCard } from "@/components/ui/PartnerCard";
import { DEMO_ANALYTICS } from "@/lib/partner-data";

export function PerformanceCharts() {
  const maxJobs = Math.max(...DEMO_ANALYTICS.weeklyJobs);
  const maxEarn = Math.max(...DEMO_ANALYTICS.weeklyEarnings);
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const metrics = [
    { label: "Rating", value: DEMO_ANALYTICS.ratings.toFixed(2), unit: "★" },
    { label: "Completion", value: `${DEMO_ANALYTICS.completionRate}%`, unit: "" },
    { label: "Response", value: `${DEMO_ANALYTICS.responseRate}%`, unit: "" },
    {
      label: "Cancellation",
      value: `${DEMO_ANALYTICS.cancellationRate}%`,
      unit: "",
      warn: true,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <PartnerCard key={m.label}>
            <p className="text-xs text-partner-muted">{m.label}</p>
            <p
              className={`font-display mt-1 text-2xl font-bold ${
                m.warn ? "text-partner-warning" : ""
              }`}
            >
              {m.value}
              {m.unit && (
                <span className="text-sm text-partner-muted">{m.unit}</span>
              )}
            </p>
          </PartnerCard>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PartnerCard>
          <p className="mb-4 text-sm font-semibold">Jobs this week</p>
          <div className="flex h-40 items-end justify-between gap-2">
            {DEMO_ANALYTICS.weeklyJobs.map((v, i) => (
              <div key={days[i]} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full max-w-[32px] rounded-t-lg bg-partner-primary/80 transition-all"
                  style={{ height: `${(v / maxJobs) * 100}%`, minHeight: 8 }}
                />
                <span className="text-[10px] text-partner-muted">{days[i]}</span>
              </div>
            ))}
          </div>
        </PartnerCard>
        <PartnerCard>
          <p className="mb-4 text-sm font-semibold">Earnings this week</p>
          <div className="flex h-40 items-end justify-between gap-2">
            {DEMO_ANALYTICS.weeklyEarnings.map((v, i) => (
              <div key={days[i]} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full max-w-[32px] rounded-t-lg bg-partner-success/70"
                  style={{ height: `${(v / maxEarn) * 100}%`, minHeight: 8 }}
                />
                <span className="text-[10px] text-partner-muted">{days[i]}</span>
              </div>
            ))}
          </div>
        </PartnerCard>
      </div>
    </div>
  );
}
