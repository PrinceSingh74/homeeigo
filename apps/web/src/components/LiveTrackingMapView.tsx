"use client";

import { memo, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";

const MapInner = dynamic(
  () => import("./LiveTrackingMapViewInner").then((m) => m.LiveTrackingMapViewInner),
  { ssr: false, loading: () => <div className="absolute inset-0 bg-slate-900" aria-hidden /> },
);

type LiveTrackingMapViewProps = {
  className?: string;
  position?: { lat: number; lng: number };
};

export const LiveTrackingMapView = memo(function LiveTrackingMapView({
  className,
  position,
}: LiveTrackingMapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return (
      <div className={cn("flex items-center justify-center bg-slate-900 text-center text-xs text-slate-400", className)}>
        Map key not configured
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("relative min-h-0 w-full overflow-hidden", className)}>
      {inView ? <MapInner position={position} className="absolute inset-0 size-full" /> : (
        <div className="absolute inset-0 size-full bg-slate-900" aria-hidden />
      )}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="relative inline-flex h-3.5 w-3.5 rounded-full bg-sky-400 ring-2 ring-white/80 shadow-lg shadow-sky-500/40" />
      </div>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-950/40 via-transparent to-slate-950/20" />
      <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-slate-900/70 px-2.5 py-1 text-[10px] font-semibold text-sky-300 ring-1 ring-white/10 backdrop-blur">
        ● HOMEEIGO coverage
      </span>
    </div>
  );
});
