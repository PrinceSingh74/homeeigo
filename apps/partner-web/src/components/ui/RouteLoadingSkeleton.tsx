import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

/**
 * Console-shaped loading silhouette shown while a partner route's JS/RSC loads.
 * A neutral dashboard shape (page header + KPI stat row + main/side grid) reads
 * far more premium than a lone spinner and matches the real layout → no shift.
 */
export function RouteLoadingSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <div className={cn(partnerLayout.page, "flex flex-col gap-8 py-2")} aria-busy="true" aria-label={label}>
      {/* Page header */}
      <div className="space-y-3">
        <StaticSkeleton shimmer className="h-8 w-56 rounded-xl" />
        <StaticSkeleton className="h-4 w-72 rounded-full" />
      </div>
      {/* KPI stat row */}
      <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <StaticSkeleton key={i} shimmer className="h-28 rounded-2xl" />
        ))}
      </div>
      {/* Main + side grid */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
        <StaticSkeleton shimmer className="h-80 rounded-2xl" />
        <StaticSkeleton className="h-80 rounded-2xl" />
      </div>
      {/* Bottom row */}
      <div className="grid gap-6 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <StaticSkeleton key={i} className="h-40 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
