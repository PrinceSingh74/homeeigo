import { RouteSkeletonShell } from "@/components/ui/RouteSkeletonShell";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";

export default function MembershipLoading() {
  return (
    <RouteSkeletonShell label="Loading membership">
      {/* Hero band */}
      <StaticSkeleton shimmer className="mb-6 h-36 rounded-3xl sm:h-44" />
      {/* Plan cards */}
      <div className="grid gap-4 sm:grid-cols-3 sm:gap-5">
        {Array.from({ length: 3 }).map((_, i) => (
          <StaticSkeleton key={i} shimmer className="h-72 rounded-3xl" />
        ))}
      </div>
    </RouteSkeletonShell>
  );
}
