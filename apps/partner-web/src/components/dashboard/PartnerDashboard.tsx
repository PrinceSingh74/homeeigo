"use client";

import { DashboardStatsRow } from "./DashboardStatsRow";
import { DashboardRequestCard } from "./DashboardRequestCard";
import { DashboardSchedule } from "./DashboardSchedule";
import { DashboardLiveTracking } from "./DashboardLiveTracking";
import { DashboardEarningsChart } from "./DashboardEarningsChart";
import { DashboardAiCard } from "./DashboardAiCard";
import { DashboardPerformance } from "./DashboardPerformance";
import { DashboardRecentActivity } from "./DashboardRecentActivity";
import { DashboardPanel } from "@/components/ui/DashboardPanel";
import { usePartnerStore } from "@/stores/partner-store";
import { partnerLayout } from "@/lib/partner-layout";

export function PartnerDashboard() {
  const requests = usePartnerStore((s) => s.requests);

  return (
    <div className={partnerLayout.pageStack}>
      <DashboardStatsRow />

      <div className={partnerLayout.mainGrid}>
        <div className={partnerLayout.sectionStack}>
          <DashboardPanel title="New Booking Requests" href="/requests" hover>
            <div className={partnerLayout.listGap}>
              {requests.length === 0 ? (
                <p className="py-12 text-center text-sm text-partner-muted">
                  No pending requests — you&apos;re all caught up!
                </p>
              ) : (
                requests.slice(0, 3).map((req, i) => (
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
