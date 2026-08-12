import { pageMax, pagePadX } from "@/lib/page-layout";
import { cn } from "@/lib/utils";
import { StaticShimmerCard, StaticSkeleton } from "@/components/ui/StaticSkeleton";

export default function WalletLoading() {
  return (
    <div
      className="wallet-page flex min-h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-canvas lg:min-h-[calc(100dvh-var(--site-nav-offset,4rem))] lg:max-h-[calc(100dvh-var(--site-nav-offset,4rem))]"
      aria-busy="true"
      aria-label="Loading wallet"
    >
      <StaticSkeleton className="h-12 shrink-0 border-b border-line bg-surface/80 pt-[env(safe-area-inset-top,0px)] sm:h-14 lg:hidden" />
      <div
        className={cn(
          pageMax,
          pagePadX,
          "min-h-0 w-full flex-1 space-y-4 overflow-y-auto py-4 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:space-y-6 sm:py-6 lg:pb-8",
        )}
      >
        <StaticSkeleton className="h-20 rounded-xl sm:h-24" />
        <StaticShimmerCard className="h-44 sm:h-52" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <StaticSkeleton key={i} className="h-24 w-24 shrink-0 rounded-2xl" />
          ))}
        </div>
        <StaticSkeleton className="h-64 rounded-2xl" />
      </div>
    </div>
  );
}
