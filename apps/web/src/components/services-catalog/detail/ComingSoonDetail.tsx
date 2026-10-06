import { ShieldCheck } from "lucide-react";
import { CATEGORY_BY_ID, type Catalog, type ServiceView } from "@/lib/catalog";
import { ServiceCard } from "@/components/services-catalog/ServiceCard";
import { HomeHelpTaskList } from "@/components/services-catalog/home-help/HomeHelpTaskList";
import { NotifyMeForm } from "@/components/services-catalog/NotifyMe";
import { DetailSection } from "@/components/services-catalog/detail/sections";
import { cn } from "@/lib/utils";

/**
 * A service that is not operationally live: what it will be, how it will be
 * priced, and a real launch-notification form. No price, no Book button.
 * It becomes bookable automatically once an admin activates a bound service.
 */
export function ComingSoonDetail({ service, catalog }: { service: ServiceView; catalog: Catalog }) {
  const cat = CATEGORY_BY_ID.get(service.category)!;
  const planned = service.def.planned ?? cat.planned ?? [];
  const alternatives = catalog.categories
    .find((c) => c.def.id === service.category)!
    .services.filter((s) => s.status === "live")
    .slice(0, 3);

  return (
    <div className="grid gap-10 lg:grid-cols-[1fr_400px] lg:gap-14">
      <div className="min-w-0 space-y-10 sm:space-y-12">
        {/* The description is the hero's lead line, directly above; it is not printed a second time. */}
        {cat.notice && (
          <DetailSection id="overview" title="What to expect" className="border-t-0 pt-0 sm:pt-0">
            <p className="flex max-w-2xl gap-3 text-lg leading-relaxed text-content">
              <ShieldCheck className="mt-1 size-6 shrink-0 text-brand" aria-hidden />
              {cat.notice}
            </p>
          </DetailSection>
        )}

        {planned.length > 0 && (
          <DetailSection
            id="planned"
            title="Planned booking options"
            lead="Final options and pricing are confirmed at launch."
            className={cn(!cat.notice && "border-t-0 pt-0 sm:pt-0")}
          >
            <ul className="grid gap-x-12 sm:grid-cols-2">
              {planned.map((p) => (
                <li key={p} className="flex gap-3 border-b border-line py-3.5 text-base leading-relaxed text-content">
                  {/* A hollow ring, not a tick: these are planned, not available. */}
                  <span aria-hidden className="mt-1.5 size-3 shrink-0 rounded-full border-2 border-emerald-700 dark:border-emerald-400" />
                  {p}
                </li>
              ))}
            </ul>
          </DetailSection>
        )}

        {alternatives.length > 0 && (
          <DetailSection id="alternatives" title={`Bookable now in ${cat.shortName}`}>
            {service.category === "home-help" ? (
              <HomeHelpTaskList services={alternatives} label={`Bookable now in ${cat.shortName}`} />
            ) : (
              <ul className="grid gap-4 min-[460px]:grid-cols-2 xl:grid-cols-3">
                {alternatives.map((s) => (
                  <li key={s.slug}>
                    <ServiceCard service={s} />
                  </li>
                ))}
              </ul>
            )}
          </DetailSection>
        )}
      </div>

      {/* The one thing you can do here, so it comes first on small screens. */}
      <aside aria-label="Get notified" className="order-first lg:order-last lg:sticky lg:top-[calc(var(--navbar-offset,3.5rem)+5rem)] lg:self-start">
        <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-e3 dark:border-emerald-400/30">
          <div className="bg-emerald-900 px-6 py-5 text-white dark:bg-emerald-950">
            <p className="flex items-center gap-2 text-sm text-emerald-100">
              <span aria-hidden className="size-2 rounded-full border border-emerald-100" />
              Not bookable yet
            </p>
            <h2 className="mt-1 font-display text-xl font-bold leading-snug tracking-tight">Be the first to know</h2>
          </div>
          <div className="p-6">
            <NotifyMeForm sourceKey={service.slug} serviceName={service.name} />
          </div>
        </div>
      </aside>
    </div>
  );
}
