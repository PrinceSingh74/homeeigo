import { pageShellMain } from "@/lib/page-layout";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { cn } from "@/lib/utils";

/**
 * Shared route-level loading shell for customer app segments without a
 * route-specific skeleton. A neutral content silhouette (header + blocks)
 * reads far more premium than a lone centered spinner during navigation.
 */
export function RouteLoadingSkeleton({ label = "Loading…" }: { label?: string }) {
  return (
    <main
      className={cn(pageShellMain, "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]")}
      aria-busy="true"
      aria-label={label}
    >
      <div className="mb-6 space-y-3 pt-2 sm:mb-8">
        <StaticSkeleton className="h-4 w-24 rounded-full" />
        <StaticSkeleton shimmer className="h-9 w-56 rounded-xl sm:h-11 sm:w-72" />
        <StaticSkeleton className="h-4 w-40 rounded-full sm:w-52" />
      </div>
      <StaticSkeleton shimmer className="mb-4 h-32 rounded-3xl sm:h-40" />
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <StaticSkeleton key={i} className="h-28 rounded-2xl sm:h-32" />
        ))}
      </div>
    </main>
  );
}
