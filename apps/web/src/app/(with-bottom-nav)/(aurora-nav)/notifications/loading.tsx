import { RouteSkeletonShell } from "@/components/ui/RouteSkeletonShell";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";

export default function NotificationsLoading() {
  return (
    <RouteSkeletonShell label="Loading notifications">
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-2xl border border-line/50 p-4">
            <StaticSkeleton className="size-11 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <StaticSkeleton shimmer className="h-4 w-2/3 rounded-full" />
              <StaticSkeleton className="h-3 w-1/2 rounded-full" />
            </div>
            <StaticSkeleton className="h-3 w-10 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </RouteSkeletonShell>
  );
}
