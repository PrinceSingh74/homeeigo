"use client";

import { AiLiveTrackingCard } from "@/components/ai/AiLiveTrackingCard";
import { AiSectionHeader } from "@/components/ai/AiSectionHeader";
import { aiMobileLiveShell } from "@/components/ai/ai-page-layout";
import { DEMO_TRACKING } from "@/lib/demo-tracking-booking";

/** Live tracking surfaced early in the main scroll on phone/tablet. */
export function AiMobileLiveSection() {
  return (
    <section className={aiMobileLiveShell} aria-label="Live tracking">
      <AiSectionHeader
        title="Live Tracking"
        subtitle="Your HOMIGO rider & expert — en route to you."
        meta={`${DEMO_TRACKING.etaMins} min away`}
      />
      <div className="mt-3 sm:mt-4">
        <AiLiveTrackingCard embedded />
      </div>
    </section>
  );
}
