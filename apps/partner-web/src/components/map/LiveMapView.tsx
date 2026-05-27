"use client";

import { Navigation, MapPin, Clock, TrafficCone } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { usePartnerStore } from "@/stores/partner-store";

/** Futuristic dark map placeholder — swap for Mapbox/Google Maps in production */
export function LiveMapView() {
  const activeJobId = usePartnerStore((s) => s.activeJobId);
  const hasJob = Boolean(activeJobId);

  return (
    <div className="space-y-4">
      <PartnerCard className="relative min-h-[320px] overflow-hidden p-0 md:min-h-[420px]">
        <div
          className="absolute inset-0 bg-[#0a1628]"
          style={{
            backgroundImage: `
              linear-gradient(rgb(37 99 235 / 0.08) 1px, transparent 1px),
              linear-gradient(90deg, rgb(37 99 235 / 0.08) 1px, transparent 1px)
            `,
            backgroundSize: "32px 32px",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-partner-bg via-transparent to-transparent" />

        {/* Route line mock */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 400 300"
          preserveAspectRatio="none"
          aria-hidden
        >
          <path
            d="M 40 220 Q 120 180 200 140 T 360 80"
            fill="none"
            stroke="url(#routeGrad)"
            strokeWidth="3"
            strokeDasharray="8 6"
            className="animate-[dash_20s_linear_infinite]"
          />
          <defs>
            <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#22c55e" />
            </linearGradient>
          </defs>
        </svg>

        {/* Pins */}
        <div className="absolute left-[12%] bottom-[28%] flex flex-col items-center">
          <span className="status-pulse h-3 w-3 rounded-full bg-partner-success" />
          <span className="mt-1 rounded bg-partner-card/90 px-2 py-0.5 text-[10px] font-medium">
            You
          </span>
        </div>
        <div className="absolute right-[18%] top-[22%] flex flex-col items-center">
          <MapPin className="h-6 w-6 text-partner-primary drop-shadow-[0_0_12px_rgb(37_99_235)]" />
          <span className="mt-1 rounded bg-partner-primary/20 px-2 py-0.5 text-[10px] font-medium text-partner-primary">
            Customer
          </span>
        </div>

        <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
          <span className="partner-glass rounded-lg px-3 py-1.5 text-xs">
            <Clock className="mr-1 inline h-3.5 w-3.5" />
            ETA 12 min
          </span>
          <span className="partner-glass rounded-lg px-3 py-1.5 text-xs text-partner-warning">
            <TrafficCone className="mr-1 inline h-3.5 w-3.5" />
            Light traffic
          </span>
        </div>
      </PartnerCard>

      <div className="grid gap-3 sm:grid-cols-2">
        <PartnerCard>
          <p className="text-sm font-semibold">
            {hasJob ? "Active navigation" : "No active job"}
          </p>
          <p className="mt-1 text-sm text-partner-muted">
            {hasJob
              ? "Head to customer — live route synced."
              : "Accept a request to start navigation."}
          </p>
        </PartnerCard>
        <PartnerButton variant="primary" className="h-full min-h-[72px] w-full sm:min-h-0">
          <Navigation className="h-5 w-5" />
          Open in Maps
        </PartnerButton>
      </div>
    </div>
  );
}
