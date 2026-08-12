"use client";

import dynamic from "next/dynamic";
import { Suspense } from "react";
import { RouteLoadingSkeleton } from "@/components/ui/RouteLoadingSkeleton";

function SectionFallback() {
  return (
    <div className="mx-auto max-w-content px-4 py-8 sm:px-6">
      <div className="h-32 animate-pulse rounded-2xl bg-surface/60" aria-hidden />
    </div>
  );
}

const AccountSummaryStrip = dynamic(
  () => import("@/components/AccountSummaryStrip").then((m) => m.AccountSummaryStrip),
  { loading: () => <SectionFallback /> },
);

const FeatureBanner = dynamic(
  () => import("@/components/FeatureBanner").then((m) => m.FeatureBanner),
  { loading: () => <SectionFallback /> },
);

const OffersSection = dynamic(
  () => import("@/components/OffersSection").then((m) => m.OffersSection),
  { loading: () => <SectionFallback /> },
);

const TrustSection = dynamic(
  () => import("@/components/TrustSection").then((m) => m.TrustSection),
  { loading: () => <SectionFallback /> },
);

const PremiumSection = dynamic(
  () => import("@/components/PremiumSection").then((m) => m.PremiumSection),
  { loading: () => <SectionFallback /> },
);

const LiveTrackingSection = dynamic(
  () => import("@/components/LiveTrackingSection").then((m) => m.LiveTrackingSection),
  { loading: () => <SectionFallback /> },
);

const FinalCtaSection = dynamic(
  () => import("@/components/FinalCtaSection").then((m) => m.FinalCtaSection),
  { loading: () => <SectionFallback /> },
);

/** Below-fold homepage sections — wallet/tracking/realtime stay client-only and lazy. */
export function HomeBelowFold() {
  return (
    <Suspense fallback={<RouteLoadingSkeleton label="Loading sections…" />}>
      <AccountSummaryStrip />
      <FeatureBanner />
      <div id="offers">
        <OffersSection />
      </div>
      <TrustSection />
      <PremiumSection />
      <div id="tracking">
        <LiveTrackingSection />
      </div>
      <FinalCtaSection />
    </Suspense>
  );
}
