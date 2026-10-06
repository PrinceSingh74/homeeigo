"use client";

import { AiLiveTrackingCard } from "@/components/ai/AiLiveTrackingCard";
import { AiSectionHeader } from "@/components/ai/AiSectionHeader";
import { aiMobileLiveShell } from "@/components/ai/ai-page-layout";
import { useActiveTracking } from "@/hooks/use-active-tracking";
import { liveTrackingView } from "@/lib/live-tracking-view";

/** Live tracking surfaced early in the main scroll on phone/tablet. */
export function AiMobileLiveSection() {
  const { activeBooking, tracking } = useActiveTracking();
  const live = liveTrackingView(activeBooking, tracking);
  return (
    <section className={aiMobileLiveShell} aria-label="Live tracking">
      <AiSectionHeader
        title="Live Tracking"
        subtitle={live ? "Your professional is on the way." : "Shown when a professional is travelling to you."}
        meta={live?.etaMin != null ? `${live.etaMin} min away` : undefined}
      />
      <div className="mt-3 sm:mt-4">
        <AiLiveTrackingCard embedded />
      </div>
    </section>
  );
}
