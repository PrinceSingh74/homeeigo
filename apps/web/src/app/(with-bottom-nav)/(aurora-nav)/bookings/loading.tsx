import { RouteSkeletonShell } from "@/components/ui/RouteSkeletonShell";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";

export default function BookingsLoading() {
  return (
    <RouteSkeletonShell label="Loading your bookings">
      {/* Filter pills */}
      <div className="mb-6 flex gap-2 sm:gap-3">
        {["w-14", "w-24", "w-28", "w-24"].map((w, i) => (
          <StaticSkeleton key={i} className={`h-9 shrink-0 rounded-full ${w}`} />
        ))}
      </div>
      {/* Booking cards */}
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <StaticSkeleton key={i} shimmer className="h-40 rounded-3xl sm:h-44" />
        ))}
      </div>
    </RouteSkeletonShell>
  );
}
