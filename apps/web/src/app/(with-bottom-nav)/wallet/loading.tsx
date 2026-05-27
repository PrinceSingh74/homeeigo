import { pageMax, pagePadX } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

export default function WalletLoading() {
  return (
    <div
      className="wallet-page flex min-h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-canvas lg:min-h-[calc(100dvh-var(--site-nav-offset,4rem))] lg:max-h-[calc(100dvh-var(--site-nav-offset,4rem))]"
      aria-busy="true"
      aria-label="Loading wallet"
    >
      <div className="h-12 shrink-0 animate-pulse border-b border-line bg-surface/80 pt-[env(safe-area-inset-top,0px)] sm:h-14 lg:hidden" />
      <div
        className={cn(
          pageMax,
          pagePadX,
          "min-h-0 w-full flex-1 space-y-4 overflow-y-auto py-4 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:space-y-6 sm:py-6 lg:pb-8",
        )}
      >
        <div className="h-20 animate-pulse rounded-xl bg-line/30 sm:h-24" />
        <div className="h-44 animate-pulse rounded-2xl bg-gradient-to-br from-violet/20 to-pink/20 sm:h-52" />
        <div className="flex gap-3 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 w-24 shrink-0 animate-pulse rounded-2xl bg-line/25" />
          ))}
        </div>
        <div className="h-64 animate-pulse rounded-2xl bg-line/20" />
      </div>
    </div>
  );
}
