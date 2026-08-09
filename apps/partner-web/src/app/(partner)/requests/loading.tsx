import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

export default function RequestsLoading() {
  return (
    <div className={cn(partnerLayout.page, "flex flex-col gap-6 py-2")} aria-busy="true" aria-label="Loading requests">
      <div className="space-y-3">
        <StaticSkeleton shimmer className="h-8 w-48 rounded-xl" />
        <StaticSkeleton className="h-4 w-72 rounded-full" />
      </div>
      {/* Tabs */}
      <div className="flex gap-2">
        {["w-28", "w-20", "w-28"].map((w, i) => (
          <StaticSkeleton key={i} className={`h-10 shrink-0 rounded-xl ${w}`} />
        ))}
      </div>
      {/* Job cards */}
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <StaticSkeleton key={i} shimmer className="h-44 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
