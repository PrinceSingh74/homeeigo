"use client";

import { PartnerCard } from "@/components/ui/PartnerCard";
import { cn } from "@/lib/cn";
import type { PartnerOperations } from "@/types/partner";

export function CapacityCard({
  ops,
  loading,
}: {
  ops?: PartnerOperations;
  loading?: boolean;
}) {
  if (loading || !ops) {
    return (
      <PartnerCard glass className="min-h-[180px]">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-partner-muted">Capacity</p>
        <p className="mt-4 text-sm text-partner-muted">Loading capacity…</p>
        <div className="mt-6 h-2 animate-pulse rounded-full bg-partner-line" />
      </PartnerCard>
    );
  }

  const { capacity } = ops;
  const max = Math.max(1, capacity.maxConcurrentJobs);
  const pct = Math.min(100, capacity.utilization);
  const next = capacity.nextAvailableAt
    ? new Date(capacity.nextAvailableAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <PartnerCard glass className="min-h-[180px]">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-partner-muted">Capacity</p>
      <p className="font-display mt-3 text-3xl font-semibold tracking-tight text-partner-text">
        {capacity.currentJobs} / {max}
      </p>
      <p className="mt-1 text-sm text-partner-muted">
        {capacity.availableSlots === 1
          ? "1 slot available"
          : `${capacity.availableSlots} slots available`}
      </p>
      <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-partner-line">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            pct >= 100 ? "bg-partner-warning" : "bg-partner-success",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-partner-muted">
        <span>Utilization {pct}%</span>
        {next ? <span>Next available {next}</span> : <span>{capacity.jobsToday} jobs today</span>}
      </div>
    </PartnerCard>
  );
}
