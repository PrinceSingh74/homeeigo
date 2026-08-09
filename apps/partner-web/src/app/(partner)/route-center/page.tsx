"use client";

import { useQuery } from "@tanstack/react-query";
import { Route, Clock, MapPin, Navigation, RefreshCw, Loader2, TrendingDown } from "lucide-react";
import { partnerApi, type RouteStop } from "@/services/partner-api";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

const STATUS_BADGE: Record<string, string> = {
  ARRIVED: "bg-partner-success/20 text-partner-success ring-1 ring-partner-success/30",
  IN_PROGRESS: "bg-partner-primary/20 text-sky-300 ring-1 ring-partner-primary/35",
  ON_THE_WAY: "bg-partner-warning/20 text-amber-200 ring-1 ring-partner-warning/35",
};

/**
 * Phase 17.3 — Partner Route Center. Consumes GET /api/providers/me/route/optimize
 * (route-optimization.service) — no new optimisation logic. Shows the optimised stop
 * sequence, per-stop + total ETA, distance, time saved, with re-optimise + refresh.
 */
export default function RouteCenterPage() {
  const q = useQuery({
    queryKey: ["partner", "route-optimize"],
    queryFn: () => partnerApi.routeOptimize(),
    retry: false,
  });

  const noLocation =
    (q.error as { code?: string } | undefined)?.code === "NO_LOCATION" ||
    (q.error as { status?: number })?.status === 409;
  const data = q.data;

  return (
    <div className={cn(partnerLayout.pageStack, "max-w-4xl")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-partner-text">
            <Route size={22} className="text-partner-accent" />
            Route Center
          </h1>
          <p className="mt-1 text-sm text-partner-text-secondary">
            Today&apos;s optimised multi-stop route · traffic-aware ETA
          </p>
        </div>
        <button
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="partner-glow-btn flex items-center gap-1.5 rounded-xl border border-partner-primary/40 bg-partner-primary/15 px-4 py-2.5 text-sm font-semibold text-partner-text transition hover:bg-partner-primary/25 disabled:opacity-50"
        >
          {q.isFetching ? (
            <Loader2 size={15} className="animate-spin" />
          ) : (
            <RefreshCw size={15} />
          )}
          Re-optimise
        </button>
      </div>

      {q.isLoading ? (
        <div className="partner-card flex items-center gap-2 p-8 text-sm text-partner-text-secondary">
          <Loader2 className="animate-spin text-partner-accent" />
          Optimising your route…
        </div>
      ) : noLocation ? (
        <div className="rounded-2xl border border-partner-warning/40 bg-partner-warning/10 p-6 text-sm text-amber-100">
          Go online and share your location to generate a route. Your live position is needed
          to order the stops.
        </div>
      ) : q.isError ? (
        <div className="rounded-2xl border border-partner-danger/40 bg-partner-danger/10 p-6 text-sm text-red-100">
          Couldn&apos;t build the route.{" "}
          <button type="button" onClick={() => q.refetch()} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : !data || data.sequence.length === 0 ? (
        <div className="partner-card p-8 text-center text-sm text-partner-text-secondary">
          No active jobs to route. New bookings appear here once accepted.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Summary icon={MapPin} label="Stops" value={String(data.metrics.stops)} />
            <Summary icon={Clock} label="Total ETA" value={`${data.metrics.optimizedEtaMin} min`} />
            <Summary
              icon={Navigation}
              label="Distance"
              value={`${data.metrics.optimizedDistanceKm} km`}
            />
            <Summary
              icon={TrendingDown}
              label="Time saved"
              value={`${data.metrics.timeSavedMin} min`}
              accent
            />
          </div>
          <p className="text-xs text-partner-muted">
            Routing source:{" "}
            <span className="font-semibold text-partner-text-secondary">
              {data.metrics.source === "google" ? "Google (traffic-aware)" : "Haversine estimate"}
            </span>
          </p>

          <ol className="space-y-3">
            {data.sequence.map((s: RouteStop) => (
              <li
                key={s.bookingId}
                className="partner-card partner-card-hover flex items-center gap-3 p-4"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-partner-accent/15 text-sm font-bold text-partner-accent ring-1 ring-partner-accent/30">
                  {s.order + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-partner-text">
                      Booking #{s.bookingId.slice(-6).toUpperCase()}
                    </span>
                    {s.status ? (
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          STATUS_BADGE[s.status] ?? "bg-partner-surface text-partner-muted",
                        )}
                      >
                        {s.status.replace(/_/g, " ")}
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className="text-partner-text-secondary">
                      {s.distanceFromPrevKm} km away
                    </span>
                    <span className="font-medium text-partner-success">+{s.etaFromPrevMin} min</span>
                    <span className="text-partner-muted">arrive ~{s.cumulativeEtaMin} min</span>
                  </div>
                </div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 rounded-xl border border-partner-accent/40 bg-partner-accent/10 p-2.5 text-partner-accent transition hover:bg-partner-accent/20"
                  title="Navigate"
                >
                  <Navigation size={16} />
                </a>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}

function Summary({
  icon: Icon,
  label,
  value,
  accent,
}: {
  icon: typeof MapPin;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="partner-card flex flex-col justify-between p-4">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-partner-muted">
        <Icon size={13} className="text-partner-accent" />
        {label}
      </p>
      <p
        className={cn(
          "partner-stat-value mt-2 text-partner-text",
          accent && "text-partner-success",
        )}
      >
        {value}
      </p>
    </div>
  );
}
