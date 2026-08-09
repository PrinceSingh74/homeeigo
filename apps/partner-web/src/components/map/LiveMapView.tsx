"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { Clock, Navigation, TrafficCone } from "lucide-react";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { usePartnerBookingsQuery } from "@/hooks/use-partner-data";
import { formatInr, formatTime } from "@/lib/format";
import { MapPerformanceBoundary } from "@/components/perf/MapPerformanceBoundary";

const PartnerLiveMap = dynamic(
  () => import("./PartnerLiveMap").then((m) => m.PartnerLiveMap),
  { ssr: false, loading: () => <div className="h-full w-full bg-[#0a1628]" aria-hidden /> },
);

/** Real partner live map — GPS + active-job destination + route (Google Maps JS). */
export function LiveMapView() {
  const { data, isLoading } = usePartnerBookingsQuery({
    page: 1,
    limit: 5,
    status: "active",
    sortBy: "upcoming",
  });

  const job = useMemo(
    () =>
      (data?.bookings ?? []).find((b) =>
        ["accepted", "assigned", "en_route", "in_progress"].includes(b.status),
      ),
    [data?.bookings],
  );

  const customerName = job
    ? `${job.customer.firstName ?? ""} ${job.customer.lastName ?? ""}`.trim() ||
      "Customer"
    : "";

  const mapsHref = useMemo(() => {
    if (!job?.address?.latitude || !job?.address?.longitude) return null;
    return `https://www.google.com/maps/dir/?api=1&destination=${job.address.latitude},${job.address.longitude}`;
  }, [job]);

  return (
    <div className="space-y-4">
      <PartnerCard className="relative min-h-[320px] overflow-hidden p-0 md:min-h-[420px]">
        <div className="absolute inset-0">
          <MapPerformanceBoundary label="PartnerLiveMap" className="h-full w-full" deferAfterPaint>
            <PartnerLiveMap
              destination={
                job?.address?.latitude != null && job?.address?.longitude != null
                  ? { lat: job.address.latitude, lng: job.address.longitude }
                  : null
              }
              className="h-full w-full"
            />
          </MapPerformanceBoundary>
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-partner-bg/60 via-transparent to-transparent" />

        <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2">
          <span className="partner-glass rounded-lg px-3 py-1.5 text-xs">
            <Clock className="mr-1 inline h-3.5 w-3.5" />
            {job?.eta != null ? `ETA ${job.eta} min` : "No active route"}
          </span>
          <span className="partner-glass rounded-lg px-3 py-1.5 text-xs text-partner-warning">
            <TrafficCone className="mr-1 inline h-3.5 w-3.5" />
            Traffic estimate not available
          </span>
        </div>
      </PartnerCard>

      <div className="grid gap-3 sm:grid-cols-2">
        <PartnerCard>
          <p className="text-sm font-semibold">
            {isLoading
              ? "Checking active jobs…"
              : job
                ? `Active navigation to ${customerName}`
                : "No active job"}
          </p>
          <p className="mt-1 text-sm text-partner-muted">
            {job ? (
              <>
                {job.service.name} · {formatTime(job.scheduledDate)} ·{" "}
                {formatInr(job.finalAmount)}
              </>
            ) : (
              "Accept a request to start navigation."
            )}
          </p>
          {job?.address?.fullAddress ? (
            <p className="mt-2 text-xs text-partner-muted">
              {job.address.fullAddress}
            </p>
          ) : null}
        </PartnerCard>
        <PartnerButton
          variant="primary"
          className="h-full min-h-[72px] w-full sm:min-h-0"
          disabled={!mapsHref}
          onClick={() => {
            if (mapsHref) window.open(mapsHref, "_blank", "noopener,noreferrer");
          }}
        >
          <Navigation className="h-5 w-5" />
          {mapsHref ? "Open in Maps" : "No destination"}
        </PartnerButton>
      </div>
    </div>
  );
}
