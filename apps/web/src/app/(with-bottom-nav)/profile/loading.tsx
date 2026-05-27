import { pageMax, pagePadX } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

export default function ProfileLoading() {
  return (
    <div
      className="profile-page flex min-h-[100dvh] max-h-[100dvh] flex-col overflow-hidden bg-canvas lg:min-h-[calc(100dvh-var(--site-nav-offset,4rem))] lg:max-h-[calc(100dvh-var(--site-nav-offset,4rem))]"
      aria-busy="true"
      aria-label="Loading profile"
    >
      <div className="h-12 shrink-0 animate-pulse border-b border-line bg-surface/80 pt-[env(safe-area-inset-top,0px)] sm:h-14 lg:hidden" />
      <div
        className={cn(
          pageMax,
          pagePadX,
          "min-h-0 w-full flex-1 space-y-4 overflow-y-auto py-4 pb-[calc(4.5rem+env(safe-area-inset-bottom,0px))] sm:space-y-6 sm:py-6 lg:pb-8",
        )}
      >
        <div className="h-16 animate-pulse rounded-xl bg-line/20 sm:h-20" />
        <div className="h-48 animate-pulse rounded-2xl bg-line/25 sm:h-56" />
        <div className="h-36 animate-pulse rounded-2xl bg-gradient-to-br from-violet/15 to-pink/15" />
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-line/20" />
          ))}
        </div>
        <div className="h-52 animate-pulse rounded-2xl bg-line/20" />
      </div>
    </div>
  );
}
