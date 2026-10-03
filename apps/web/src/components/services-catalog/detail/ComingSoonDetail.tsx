import { Check, ShieldCheck } from "lucide-react";
import { CATEGORY_BY_ID, type Catalog, type ServiceView } from "@/lib/catalog";
import { ServiceCard } from "@/components/services-catalog/ServiceCard";
import { HomeHelpTaskList } from "@/components/services-catalog/home-help/HomeHelpTaskList";
import { NotifyMeForm } from "@/components/services-catalog/NotifyMe";
import { cardSurface } from "@/components/services-catalog/primitives";
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
    <div className="grid gap-10 lg:grid-cols-[1fr_380px] lg:gap-14">
      <div className="space-y-12">
        <DetailSection id="overview" title="What to expect">
          <p className="text-base leading-relaxed text-muted">{service.description}</p>
          {cat.notice && (
            <p className={cn("mt-5 flex gap-3 p-4 text-sm text-content", cardSurface)}>
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
              {cat.notice}
            </p>
          )}
        </DetailSection>

        {planned.length > 0 && (
          <DetailSection id="planned" title="Planned booking options">
            <ul className="grid gap-3 sm:grid-cols-2">
              {planned.map((p) => (
                <li key={p} className={cn("flex gap-3 p-4 text-sm text-content", cardSurface)}>
                  <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-muted">Final options and pricing are confirmed at launch.</p>
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

      <aside aria-label="Get notified" className="lg:sticky lg:top-[calc(var(--navbar-offset,3.5rem)+1.5rem)] lg:self-start">
        <div className={cn("p-6", cardSurface, "shadow-e3")}>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand">Coming soon</p>
          <h2 className="mt-2 font-display text-xl font-bold text-content">Be the first to know</h2>
          <div className="mt-5">
            <NotifyMeForm sourceKey={service.slug} serviceName={service.name} />
          </div>
        </div>
      </aside>
    </div>
  );
}
