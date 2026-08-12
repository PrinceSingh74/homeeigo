import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { servicesHeroOuter, svcHeroInner } from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

/** Matches the services hero (split text/portrait) so it slots in with no shift. */
export default function ServicesLoading() {
  return (
    <main
      className="services-page relative overflow-x-hidden bg-white pb-[calc(5.5rem+env(safe-area-inset-bottom))] lg:pb-20"
      aria-busy="true"
      aria-label="Loading services"
    >
      <section className={cn(servicesHeroOuter, "relative")}>
        <div className={svcHeroInner}>
          <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            {/* Left: headline + CTAs + trust row */}
            <div className="space-y-6 sm:space-y-8">
              <StaticSkeleton className="h-9 w-72 rounded-full bg-emerald-100/70" />
              <div className="space-y-3">
                <StaticSkeleton shimmer className="h-12 w-full max-w-md rounded-xl" />
                <StaticSkeleton shimmer className="h-12 w-2/3 rounded-xl" />
              </div>
              <StaticSkeleton className="h-5 w-full max-w-sm rounded-full" />
              <div className="flex gap-4 pt-2">
                <StaticSkeleton className="h-14 w-40 rounded-xl bg-emerald-100/60" />
                <StaticSkeleton className="h-14 w-40 rounded-xl" />
              </div>
              <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-6">
                {Array.from({ length: 4 }).map((_, i) => (
                  <StaticSkeleton key={i} className="h-5 w-40 rounded-full" />
                ))}
              </div>
            </div>
            {/* Right: portrait frame */}
            <StaticSkeleton shimmer className="mx-auto aspect-[4/5] w-full max-w-md rounded-[28px] sm:aspect-[3/4] lg:max-w-lg" />
          </div>
        </div>
      </section>
    </main>
  );
}
