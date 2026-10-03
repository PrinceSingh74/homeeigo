import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { ServiceSkeleton } from "@/components/services-catalog/ServiceStates";
import { pageMainBottom, pageSection } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

/** Mirrors the services hub (hero → search → category rail → grid). */
export default function ServicesLoading() {
  return (
    <main className={cn("relative overflow-x-clip bg-canvas", pageMainBottom)} aria-busy="true" aria-label="Loading services">
      <section className="border-b border-line/60 bg-surface">
        <div className={cn(pageSection, "pb-20 pt-6 sm:pb-24 sm:pt-8")}>
          <StaticSkeleton className="h-9 w-full max-w-xl rounded-full" />
          <div className="mt-12 grid items-center gap-12 lg:grid-cols-[1.05fr_1fr]">
            <div className="space-y-5">
              <StaticSkeleton className="h-4 w-48 rounded-full" />
              <StaticSkeleton shimmer className="h-14 w-full max-w-lg rounded-xl" />
              <StaticSkeleton shimmer className="h-14 w-2/3 rounded-xl" />
              <StaticSkeleton className="h-5 w-full max-w-md rounded-full" />
              <div className="flex gap-3 pt-3">
                <StaticSkeleton className="h-14 w-44 rounded-xl" />
                <StaticSkeleton className="h-14 w-44 rounded-xl" />
              </div>
            </div>
            <StaticSkeleton shimmer className="hidden aspect-square rounded-3xl lg:block" />
          </div>
        </div>
      </section>
      <div className={cn(pageSection, "-mt-8")}>
        <StaticSkeleton className="mx-auto h-16 max-w-3xl rounded-2xl bg-surface shadow-e3 sm:h-[4.5rem]" />
      </div>
      <div className={cn(pageSection, "mt-8 flex gap-2 overflow-hidden py-3")}>
        {Array.from({ length: 8 }).map((_, i) => (
          <StaticSkeleton key={i} className="h-11 w-28 shrink-0 rounded-full" />
        ))}
      </div>
      <div className={cn(pageSection, "pt-10")}>
        <ServiceSkeleton count={8} />
      </div>
    </main>
  );
}
