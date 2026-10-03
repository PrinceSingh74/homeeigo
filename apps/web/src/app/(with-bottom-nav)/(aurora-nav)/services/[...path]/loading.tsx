import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { ServiceSkeleton } from "@/components/services-catalog/ServiceStates";
import { pageMainBottom, pageSection } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

/** Category and service pages share this header-then-content skeleton. */
export default function ServicesPathLoading() {
  return (
    <main className={cn("relative overflow-x-clip bg-canvas", pageMainBottom)} aria-busy="true" aria-label="Loading">
      <div className={cn(pageSection, "pt-6 sm:pt-8")}>
        <StaticSkeleton className="h-4 w-56 rounded-full" />
        <div className="mt-8 space-y-4">
          <StaticSkeleton className="h-4 w-40 rounded-full" />
          <StaticSkeleton shimmer className="h-12 w-full max-w-md rounded-xl" />
          <StaticSkeleton className="h-5 w-full max-w-xl rounded-full" />
        </div>
      </div>
      <div className={cn(pageSection, "mt-10 flex gap-2 overflow-hidden py-3")}>
        {Array.from({ length: 8 }).map((_, i) => (
          <StaticSkeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <div className={cn(pageSection, "pt-8")}>
        <ServiceSkeleton count={8} />
      </div>
    </main>
  );
}
