import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { partnerLayout } from "@/lib/partner-layout";
import { cn } from "@/lib/cn";

export default function WalletLoading() {
  return (
    <div className={cn(partnerLayout.page, "flex flex-col gap-6 py-2")} aria-busy="true" aria-label="Loading wallet">
      <div className="space-y-3">
        <StaticSkeleton shimmer className="h-8 w-56 rounded-xl" />
        <StaticSkeleton className="h-4 w-64 rounded-full" />
      </div>
      {/* Balance hero */}
      <StaticSkeleton shimmer className="h-40 rounded-3xl" />
      {/* Action tiles */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <StaticSkeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      {/* Transactions list */}
      <StaticSkeleton className="h-6 w-40 rounded-full" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <StaticSkeleton key={i} shimmer className="h-16 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
