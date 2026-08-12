import { pageShellMain } from "@/lib/page-layout";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { cn } from "@/lib/utils";

/** Booking-flow shaped skeleton: stepper + service strip + summary rail. */
export default function BookLoading() {
  return (
    <main
      className={cn(pageShellMain, "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]")}
      aria-busy="true"
      aria-label="Loading booking"
    >
      {/* Header + step rail */}
      <div className="mb-6 space-y-3 pt-2 sm:mb-8">
        <StaticSkeleton className="h-4 w-28 rounded-full" />
        <StaticSkeleton shimmer className="h-9 w-52 rounded-xl sm:h-11" />
      </div>
      <div className="mb-6 flex items-center gap-2 sm:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex flex-1 items-center gap-2">
            <StaticSkeleton className="size-8 shrink-0 rounded-full" />
            <StaticSkeleton className="hidden h-3 flex-1 rounded-full sm:block" />
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        {/* Main: service strip + package cards */}
        <div className="space-y-5">
          <div className="flex gap-3 overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <StaticSkeleton key={i} shimmer className="h-28 w-40 shrink-0 rounded-2xl" />
            ))}
          </div>
          <StaticSkeleton shimmer className="h-40 rounded-3xl" />
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <StaticSkeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
          <StaticSkeleton className="h-24 rounded-2xl" />
        </div>
        {/* Summary rail */}
        <StaticSkeleton shimmer className="h-80 rounded-3xl lg:sticky lg:top-24" />
      </div>
    </main>
  );
}
