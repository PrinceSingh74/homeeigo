"use client";

import { useQuery } from "@tanstack/react-query";
import { partnerApi } from "@/services/partner-api";
import { HqPageShell } from "@/components/hq/HqPageShell";
import { Route } from "lucide-react";
import Link from "next/link";

export default function RouteOptimizationPage() {
  const route = useQuery({
    queryKey: ["partner", "route-optimize"],
    queryFn: () => partnerApi.routeOptimize(),
    retry: false,
  });

  const metrics = route.data?.metrics;

  return (
    <HqPageShell
      title="AI Route Optimization"
      description="Multi-stop route from /api/providers/me/route/optimize using live GPS and active jobs."
      icon={Route}
      stats={[
        { label: "Stops", value: metrics?.stops ?? 0 },
        { label: "Optimized ETA", value: metrics ? `${metrics.optimizedEtaMin} min` : "—" },
        { label: "Time saved", value: metrics ? `${metrics.timeSavedMin} min` : "—" },
        { label: "Engine", value: metrics?.source ?? "—" },
      ]}
    >
      {route.isError ? (
        <section className="partner-card p-5 text-sm text-partner-muted">
          Route optimization requires an active GPS fix and at least one active job. Open{" "}
          <Link href="/route-center" className="text-partner-primary underline">
            Route Center
          </Link>{" "}
          when you have jobs in progress.
        </section>
      ) : (
        <section className="partner-card p-5">
          <h2 className="font-semibold">Optimized sequence</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {(route.data?.sequence ?? []).map((stop) => (
              <li key={stop.bookingId} className="flex justify-between rounded-lg border border-partner-line px-3 py-2">
                <span>Stop {stop.order}</span>
                <span className="text-partner-muted">{stop.status ?? "active"}</span>
                <span className="font-medium">{stop.cumulativeEtaMin} min</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </HqPageShell>
  );
}
