import { pageShellMain } from "@/lib/page-layout";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { cn } from "@/lib/utils";

/**
 * Standalone route skeleton wrapper — matches PageShell (same max-width + padding
 * + bottom-nav clearance) so the real page slots in with zero layout shift.
 * Renders an instant title block; children draw the route-specific shape.
 */
export function RouteSkeletonShell({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(pageShellMain, "pb-[calc(5rem+env(safe-area-inset-bottom,0px))]", className)}
      aria-busy="true"
      aria-label={label}
    >
      {/* Header: back chip + big title + lead line */}
      <div className="mb-6 space-y-3 pt-2 sm:mb-8">
        <StaticSkeleton className="h-4 w-24 rounded-full" />
        <StaticSkeleton shimmer className="h-9 w-56 rounded-xl sm:h-11 sm:w-72" />
        <StaticSkeleton className="h-4 w-40 rounded-full sm:w-52" />
      </div>
      {children}
    </main>
  );
}
