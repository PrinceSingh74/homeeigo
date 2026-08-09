"use client";

import dynamic from "next/dynamic";
import { DashboardStatsRow } from "./DashboardStatsRow";
import { DashboardRequestCard } from "./DashboardRequestCard";
import { DashboardSchedule } from "./DashboardSchedule";
import { DashboardLiveTracking } from "./DashboardLiveTracking";
import { DashboardAiCard } from "./DashboardAiCard";
import { DashboardPerformance } from "./DashboardPerformance";
import { DashboardRecentActivity } from "./DashboardRecentActivity";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { PartnerWeatherWarning } from "@/components/weather/PartnerWeatherWarning";
import { usePartnerBookingsQuery } from "@/hooks/use-partner-data";
import { partnerLayout } from "@/lib/partner-layout";

const DashboardEarningsChart = dynamic(
  () => import("./DashboardEarningsChart").then((m) => m.DashboardEarningsChart),
  { ssr: false, loading: () => <div className="biz-card h-64" aria-hidden /> },
);

export function PartnerDashboard() {
  const requestsQuery = usePartnerBookingsQuery({
    page: 1,
    limit: 5,
    status: "pending",
    sortBy: "recent",
  });

  const pending = requestsQuery.data?.bookings ?? [];

  return (
    <div className={partnerLayout.pageStack}>
      <PartnerWeatherWarning />
      <DashboardStatsRow />

      <div className={partnerLayout.mainGrid}>
        <div className={partnerLayout.sectionStack}>
          <DashboardPanel title="New Booking Requests" href="/requests" hover>
            <div className={partnerLayout.listGap}>
              {requestsQuery.isLoading ? (
                <p className="py-12 text-center text-sm text-partner-muted">
                  Loading new requests…
                </p>
              ) : requestsQuery.isError ? (
                <p className="py-12 text-center text-sm text-partner-danger">
                  Couldn&apos;t load incoming requests.
                </p>
              ) : pending.length === 0 ? (
                <p className="py-12 text-center text-sm text-partner-muted">
                  No pending requests — you&apos;re all caught up!
                </p>
              ) : (
                pending
                  .slice(0, 3)
                  .map((req, i) => (
                    <DashboardRequestCard key={req.id} request={req} index={i} />
                  ))
              )}
            </div>
          </DashboardPanel>

          <DashboardSchedule />
        </div>

        <div className={partnerLayout.sectionStack}>
          <DashboardLiveTracking />
          <DashboardRecentActivity />
        </div>
      </div>

      <div className={partnerLayout.bottomGrid}>
        <DashboardEarningsChart />
        <DashboardAiCard />
        <DashboardPerformance />
      </div>
    </div>
  );
}
