"use client";

import { AiLiveTrackingCard } from "@/components/ai/AiLiveTrackingCard";
import { AiSectionHeader } from "@/components/ai/AiSectionHeader";
import { aiMobileLiveShell } from "@/components/ai/ai-page-layout";
import { useActiveTracking } from "@/hooks/use-active-tracking";

/** Live tracking surfaced early in the main scroll on phone/tablet. */
export function AiMobileLiveSection() {
  const { tracking } = useActiveTracking();
  const eta = tracking?.eta ?? 0;
  return (
    <section className={aiMobileLiveShell} aria-label="Live tracking">
      <AiSectionHeader
        title="Live Tracking"
        subtitle="Your HOMEEIGO rider & expert — en route to you."
        meta={`${eta} min away`}
      />
      <div className="mt-3 sm:mt-4">
        <AiLiveTrackingCard embedded />
      </div>
    </section>
  );
}
