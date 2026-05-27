"use client";

import { MapPin, Navigation } from "lucide-react";
import { DEMO_ACTIVE_JOB, formatInr } from "@/lib/partner-data";
import { DashboardPanel } from "@/components/ui/DashboardPanel";

export function DashboardLiveTracking() {
  const job = DEMO_ACTIVE_JOB;

  return (
    <DashboardPanel
      title="Live Tracking"
      action={
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-partner-success">
          <span className="status-pulse h-2 w-2 rounded-full bg-partner-success" />
          Live
        </span>
      }
      bodyClassName="gap-4"
    >
      <div className="relative h-[280px] overflow-hidden rounded-xl bg-[#0a1628]">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `
              linear-gradient(rgb(37 99 235 / 0.08) 1px, transparent 1px),
              linear-gradient(90deg, rgb(37 99 235 / 0.08) 1px, transparent 1px)
            `,
            backgroundSize: "28px 28px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-partner-bg/90 via-transparent to-transparent" />

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 400 280"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M 50 200 Q 150 150 250 120 T 350 70"
            fill="none"
            stroke="#2563eb"
            strokeWidth="3"
            strokeDasharray="10 8"
            className="route-animate"
            style={{ filter: "drop-shadow(0 0 6px rgb(37 99 235))" }}
          />
        </svg>

        <div className="absolute bottom-[30%] left-[14%]">
          <span className="status-pulse block h-4 w-4 rounded-full border-2 border-white bg-partner-primary shadow-[0_0_12px_rgb(37_99_235)]" />
        </div>
        <div className="absolute right-[16%] top-[24%]">
          <MapPin className="h-7 w-7 text-partner-danger drop-shadow-[0_0_10px_rgb(239_68_68/0.6)]" />
        </div>

        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg bg-partner-card/90 px-3 py-1.5 text-xs font-medium text-partner-text backdrop-blur-sm">
          {job.etaMin} mins to reach customer
        </div>
      </div>

      <div className="grid grid-cols-1 items-center gap-3 rounded-xl border border-partner-primary/20 bg-partner-primary/10 p-4 sm:grid-cols-[1fr_auto_auto] sm:gap-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-semibold text-partner-text">{job.customerName}</p>
          <p className="text-[11px] text-partner-muted">{job.service}</p>
        </div>
        <p className="font-display text-base font-bold tabular-nums text-partner-accent sm:text-right">
          {formatInr(job.amount)}
        </p>
        <button
          type="button"
          className="partner-glow-btn flex h-10 items-center justify-center gap-1.5 rounded-lg bg-partner-primary px-4 text-xs font-semibold text-white sm:shrink-0"
        >
          <Navigation className="h-3.5 w-3.5" />
          Start Navigation
        </button>
      </div>
    </DashboardPanel>
  );
}
