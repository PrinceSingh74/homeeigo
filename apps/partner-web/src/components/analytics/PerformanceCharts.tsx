"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import {
  usePartnerDashboardQuery,
  usePartnerEarningsQuery,
  usePartnerMeQuery,
} from "@/hooks/use-partner-data";
import { formatInr, formatNumber } from "@/lib/format";
import { cn } from "@/lib/cn";

const PRESETS = [
  { id: "7d", label: "7d", days: 7 },
  { id: "30d", label: "30d", days: 30 },
  { id: "90d", label: "90d", days: 90 },
] as const;

type PresetId = (typeof PRESETS)[number]["id"];

export function PerformanceCharts() {
  const me = usePartnerMeQuery();
  const dashboard = usePartnerDashboardQuery();
  const [preset, setPreset] = useState<PresetId>("30d");
  const days = PRESETS.find((p) => p.id === preset)?.days ?? 30;
  const earnings = usePartnerEarningsQuery(days);

  const rating = me.data?.rating ?? 0;
  // rates.* are already percentages (0–100) from the provider record.
  const completion = Math.round(dashboard.data?.rates.completionRate ?? 0);
  const response = Math.round(dashboard.data?.rates.responseRate ?? 0);
  const cancellation = Math.round(dashboard.data?.rates.cancellationRate ?? 0);

  const metrics = [
    { label: "Rating", value: rating > 0 ? rating.toFixed(2) : "—", unit: "★" },
    {
      label: "Completion",
      value: dashboard.isLoading ? "—" : `${completion}%`,
      unit: "",
    },
    {
      label: "Response",
      value: dashboard.isLoading ? "—" : `${response}%`,
      unit: "",
    },
    {
      label: "Cancellation",
      value: dashboard.isLoading ? "—" : `${cancellation}%`,
      unit: "",
      warn: cancellation > 10,
    },
  ];

  const series = earnings.data?.series ?? [];
  const dailyJobs = series.map((s) => ({
    label: s.date.slice(5),
    value: s.amount > 0 ? 1 : 0,
  }));
  const maxAmount = Math.max(1, ...series.map((s) => s.amount));
  const days7 = series.slice(-7);
  const max7 = Math.max(1, ...days7.map((s) => s.amount));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end gap-1.5">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setPreset(p.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition",
              preset === p.id
                ? "bg-partner-primary/20 text-partner-primary"
                : "border border-partner-line text-partner-muted hover:text-partner-text",
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metrics.map((m) => (
          <PartnerCard key={m.label}>
            <p className="text-xs text-partner-muted">{m.label}</p>
            <p
              className={cn(
                "font-display mt-1 text-2xl font-bold",
                m.warn && "text-partner-warning",
              )}
            >
              {m.value}
              {m.unit && (
                <span className="text-sm text-partner-muted"> {m.unit}</span>
              )}
            </p>
          </PartnerCard>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PartnerCard>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm font-semibold">Daily earnings ({preset})</p>
            {earnings.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-partner-muted" />
            ) : null}
          </div>
          {earnings.isLoading || series.length === 0 ? (
            <p className="py-12 text-center text-xs text-partner-muted">
              {earnings.isLoading ? "Loading earnings…" : "No earnings in this window."}
            </p>
          ) : (
            <div className="flex h-40 items-end justify-between gap-1">
              {series.map((s, i) => (
                <div
                  key={`${s.date}-${i}`}
                  className="flex flex-1 flex-col items-center"
                  title={`${s.date}: ${formatInr(s.amount)}`}
                >
                  <div
                    className="w-full max-w-[24px] rounded-t-lg bg-partner-success/70"
                    style={{
                      height: `${(s.amount / maxAmount) * 100}%`,
                      minHeight: 4,
                    }}
                  />
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
            <Mini
              label="Total"
              value={formatInr(earnings.data?.totalNet ?? 0, true)}
            />
            <Mini
              label="Jobs"
              value={formatNumber(earnings.data?.totalJobs ?? 0)}
            />
            <Mini
              label="Avg/job"
              value={formatInr(earnings.data?.averagePerJob ?? 0)}
            />
          </div>
        </PartnerCard>

        <PartnerCard>
          <p className="mb-4 text-sm font-semibold">Last 7 days</p>
          {dailyJobs.length === 0 ? (
            <p className="py-12 text-center text-xs text-partner-muted">
              No data yet.
            </p>
          ) : (
            <div className="flex h-40 items-end justify-between gap-2">
              {days7.map((s, i) => (
                <div key={`${s.date}-7d-${i}`} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full max-w-[32px] rounded-t-lg bg-partner-primary/80 transition-all"
                    style={{
                      height: `${(s.amount / max7) * 100}%`,
                      minHeight: 8,
                    }}
                  />
                  <span className="text-[10px] text-partner-muted">
                    {s.date.slice(5)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </PartnerCard>
      </div>

      <PartnerCard>
        <p className="text-sm font-semibold">Commission breakdown</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 text-xs">
          <Mini label="Gross" value={formatInr(earnings.data?.totalGross ?? 0, true)} />
          <Mini
            label="Commission"
            value={formatInr(earnings.data?.totalCommission ?? 0, true)}
          />
          <Mini label="Net" value={formatInr(earnings.data?.totalNet ?? 0, true)} />
        </div>
      </PartnerCard>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-partner-line bg-partner-bg/60 p-3">
      <p className="text-partner-muted">{label}</p>
      <p className="mt-1 font-display font-semibold text-partner-text">{value}</p>
    </div>
  );
}
