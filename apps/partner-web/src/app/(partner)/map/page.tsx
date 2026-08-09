"use client";

import dynamic from "next/dynamic";

const LiveMapView = dynamic(
  () => import("@/components/map/LiveMapView").then((m) => m.LiveMapView),
  { ssr: false, loading: () => <div className="h-[420px] w-full rounded-2xl bg-white/[0.03]" aria-hidden /> },
);

export default function MapPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Live map</h1>
        <p className="text-sm text-partner-muted">
          Navigation, customer pin, and route intelligence
        </p>
      </div>
      <LiveMapView />
    </div>
  );
}
