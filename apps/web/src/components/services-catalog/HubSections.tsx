"use client";

import { ShieldCheck } from "lucide-react";
import { HUB_RAIL_ORDER, categoryHref, type Catalog, type CategoryId, type CategoryView } from "@/lib/catalog";
import { SectionActionLink } from "@/components/layout/SectionActionLink";
import { ServiceFeature, ServiceRail } from "@/components/services-catalog/ServiceGrid";
import { HourlyHelpModule } from "@/components/services-catalog/HourlyHelpModule";
import { BeautyAudienceSelector } from "@/components/services-catalog/beauty/BeautySelectors";
import { ServiceCard, ServiceSoonList } from "@/components/services-catalog/ServiceCard";
import { ComingSoonCard } from "@/components/services-catalog/ComingSoonCard";
import { NotifyMeButton } from "@/components/services-catalog/NotifyMe";
import { HowItWorks, TrustSection } from "@/components/services-catalog/TrustSections";
import { CoverageSection } from "@/components/services-catalog/CoverageSection";
import { SectionHeading, band } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

/** Everything below the popular rail: split out so the hub's first load stays light. */
export default function HubSections({ catalog }: { catalog: Catalog }) {
  const byId = (id: CategoryId) => catalog.categories.find((c) => c.def.id === id)!;
  const hourly = catalog.bySlug.get("hourly-home-help");
  const beauty = byId("beauty");
  const beautyLive = beauty.services.filter((s) => s.status === "live");
  const senior = byId("senior-care");

  // A category with something to book gets a rail of its bookable services. A category with
  // nothing to book yet joins "Launching next" instead of getting a rail of placeholders.
  const rails = HUB_RAIL_ORDER.map((id) => {
    const cat = byId(id);
    const live = cat.services.filter((s) => s.status === "live");
    const own = live.filter((s) => s.category === id);
    // Prefer the category's own services; fall back to bookable cross-listings.
    return { cat, live: own.length ? own : live };
  });
  const wideRails = rails.filter((r) => r.live.length >= 3);
  // Two-card blocks first so the packed rows fill from the left and any gap lands at the end.
  const pairedRails = rails
    .filter((r) => r.live.length > 0 && r.live.length < 3)
    .sort((a, b) => Math.min(2, b.live.length) - Math.min(2, a.live.length));
  const railHeading = (cat: CategoryView) => (
    <SectionHeading
      id={`rail-${cat.def.id}`}
      kicker={`${cat.liveCount} bookable now`}
      title={cat.def.name}
      subtitle={cat.def.tagline}
      action={
        <SectionActionLink href={categoryHref(cat.def.id)}>
          View all {cat.services.length}
          <span className="sr-only"> {cat.def.name} services</span>
        </SectionActionLink>
      }
    />
  );
  const launching = [
    ...rails.filter((r) => r.live.length === 0 && r.cat.services.length > 0).map((r) => r.cat),
    ...(["pet-care", "executive-concierge", "special-services"] as CategoryId[]).map(byId),
  ];
  const alsoSoon = catalog.categories
    .filter((c) => c.liveCount > 0 && c.def.id !== "beauty")
    .flatMap((c) => c.services.filter((s) => s.status !== "live" && s.category === c.def.id))
    .slice(0, 14);

  return (
    <>
      {/* Hourly */}
      {/* The per-task list ("Name the job") lives on the Home Help page; on the hub those
          tasks already appear as Popular cards, so the module stands alone here. */}
      <section id="hourly" aria-label="Hourly home help" className="scroll-mt-32">
        <HourlyHelpModule service={hourly} tone="light" />
      </section>

      {/* Category rails — the first is a feature layout, the rest alternate canvas and band */}
      {wideRails.map(({ cat, live }, i) => (
        <section key={cat.def.id} aria-labelledby={`rail-${cat.def.id}`} className={cn(i % 2 === 1 && band)}>
          {railHeading(cat)}
          {i === 0 ? (
            <ServiceFeature services={live}label={`${cat.def.name} services`} />
          ) : (
            <ServiceRail services={live.slice(0, 4)} label={`${cat.def.name} services`} />
          )}
        </section>
      ))}

      {/* Categories with only one or two bookable services share a row instead of each
          stretching a near-empty rail across the page. */}
      {pairedRails.length > 0 && (
        <div className={cn("grid gap-x-8 gap-y-14 lg:grid-cols-4", wideRails.length % 2 === 1 && band)}>
          {pairedRails.map(({ cat, live }) => {
            // Each block spans as many columns as it has cards, so two-card and one-card
            // categories pack into full rows instead of leaving half a row empty.
            const span = Math.min(2, live.length) as 1 | 2;
            return (
              <section
                key={cat.def.id}
                aria-labelledby={`rail-${cat.def.id}`}
                className={cn("min-w-0", span === 2 ? "lg:col-span-2" : "lg:col-span-1")}
              >
                {railHeading(cat)}
                <ServiceRail services={live.slice(0, 2)} label={`${cat.def.name} services`} columns={span} />
              </section>
            );
          })}
        </div>
      )}

      {/* Beauty */}
      <section id="beauty" aria-labelledby="beauty-heading" className="scroll-mt-32">
        <SectionHeading
          id="beauty-heading"
          title="Personal care, delivered to your doorstep."
          subtitle="Start with who it's for — then choose hair, skin, nails, makeup or grooming."
          action={<SectionActionLink href={categoryHref("beauty")}>Explore beauty</SectionActionLink>}
        />
        <BeautyAudienceSelector />
        {beautyLive.length > 0 && (
          <div className="mt-8 grid items-center gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {beautyLive.slice(0, 1).map((s) => (
              <ServiceCard key={s.slug} service={s} context="Bookable today" />
            ))}
            <div className="max-w-xl space-y-2 sm:col-span-1 lg:col-span-3 lg:pl-6">
              <p className="font-display text-xl font-semibold text-content">Audience-specific menus are on the way</p>
              <p className="text-base leading-relaxed text-muted">
                {beautyLive[0]!.name} is bookable today. Dedicated menus for women, men, kids and seniors will open
                service by service — explore them now and ask to be notified.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Senior care — its own warm band: a different kind of visit */}
      <section
        aria-labelledby="senior-heading"
        className={cn(band, "[--band:#fffbeb] [--band-dark:rgb(245_158_11/0.06)]")}
      >
        <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-16">
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Senior Care, {senior.liveCount ? `${senior.liveCount} bookable now` : "coming soon"}
            </p>
            <h2 id="senior-heading" className="mt-2 font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
              {senior.def.tagline}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-content/80">{senior.def.description}</p>
            {senior.def.notice && (
              <p className="mt-5 flex gap-3 border-l-2 border-amber-500 pl-4 text-sm leading-relaxed text-content">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
                {senior.def.notice}
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3">
              <NotifyMeButton sourceKey="category:senior-care" serviceName="Senior Care" variant="primary" />
              <SectionActionLink href={categoryHref("senior-care")}>See all senior care</SectionActionLink>
            </div>
          </div>
          <div className="self-start space-y-6">
            {senior.liveCount > 0 && (
              <ServiceRail services={senior.services.filter((s) => s.status === "live")} label="Senior care services" />
            )}
            <ServiceSoonList
              services={senior.services.filter((s) => s.status !== "live")}
              label="Senior care, not bookable yet"
              columns={2}
              statusStated={senior.liveCount === 0}
            />
          </div>
        </div>
      </section>

      {/* Everything that is not open yet, in one compact block */}
      <section id="coming-soon" aria-labelledby="soon-heading" className="scroll-mt-32">
        <SectionHeading
          id="soon-heading"
          title="Launching next"
          subtitle="Pet care, concierge help and more. Tell us you're interested and we'll let you know when they open near you."
        />
        <div className="border-b border-line">
          {launching.map((c) => (
            <ComingSoonCard key={c.def.id} category={c} />
          ))}
        </div>
        {alsoSoon.length > 0 && (
          <div className="mt-12">
            <h3 className="mb-4 font-display text-xl font-semibold text-content">Also on the way</h3>
            <ServiceSoonList services={alsoSoon} label="Also on the way" columns={3} statusStated />
          </div>
        )}
      </section>

      <HowItWorks />
      <TrustSection />
      <CoverageSection />
    </>
  );
}
