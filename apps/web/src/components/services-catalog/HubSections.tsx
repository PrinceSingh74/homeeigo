"use client";

import Link from "next/link";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { HUB_RAIL_ORDER, categoryHref, type Catalog, type CategoryId } from "@/lib/catalog";
import { SectionActionLink } from "@/components/layout/SectionActionLink";
import { ServiceRail } from "@/components/services-catalog/ServiceGrid";
import { HourlyHelpModule } from "@/components/services-catalog/HourlyHelpModule";
import { BeautyAudienceSelector } from "@/components/services-catalog/beauty/BeautySelectors";
import { ServiceCard } from "@/components/services-catalog/ServiceCard";
import { ComingSoonCard } from "@/components/services-catalog/ComingSoonCard";
import { NotifyMeButton } from "@/components/services-catalog/NotifyMe";
import { HowItWorks, TrustSection } from "@/components/services-catalog/TrustSections";
import { CoverageSection } from "@/components/services-catalog/CoverageSection";
import { IconTile, SectionHeading, focusRing } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

/** Everything below the popular rail: split out so the hub's first load stays light. */
export default function HubSections({ catalog }: { catalog: Catalog }) {
  const byId = (id: CategoryId) => catalog.categories.find((c) => c.def.id === id)!;
  const homeHelp = byId("home-help").services.filter((s) => s.status === "live" && !s.hourly).slice(0, 4);
  const hourly = catalog.bySlug.get("hourly-home-help");
  const beauty = byId("beauty");
  const beautyLive = beauty.services.filter((s) => s.status === "live");
  const senior = byId("senior-care");
  const launching = (["pet-care", "executive-concierge", "special-services"] as CategoryId[]).map(byId);
  const alsoSoon = catalog.categories
    .filter((c) => c.liveCount > 0 && c.def.id !== "beauty")
    .flatMap((c) => c.services.filter((s) => s.status !== "live" && s.category === c.def.id))
    .slice(0, 14);

  return (
    <>
      {/* Hourly */}
      <section id="hourly" aria-label="Hourly home help" className="scroll-mt-32 space-y-8">
        <HourlyHelpModule service={hourly} tone="dark" />
        {homeHelp.length > 0 && (
          <div>
            <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
              <h3 className="font-display text-xl font-semibold text-content">Or book a single task</h3>
              <SectionActionLink href={categoryHref("home-help")}>All home help</SectionActionLink>
            </div>
            <ServiceRail services={homeHelp} label="Home help tasks" />
          </div>
        )}
      </section>

      {/* Category rails */}
      {HUB_RAIL_ORDER.map((id) => {
        const cat = byId(id);
        const items = cat.services.filter((s) => s.category === id).slice(0, 4);
        if (!items.length) return null;
        return (
          <section key={id} aria-labelledby={`rail-${id}`}>
            <SectionHeading
              id={`rail-${id}`}
              kicker={cat.liveCount ? `${cat.liveCount} bookable now` : "Coming soon"}
              title={cat.def.name}
              subtitle={cat.def.tagline}
              action={
                <SectionActionLink href={categoryHref(id)}>
                  View all {cat.services.length}
                  <span className="sr-only"> {cat.def.name} services</span>
                </SectionActionLink>
              }
            />
            <ServiceRail services={items} label={`${cat.def.name} services`} />
          </section>
        );
      })}

      {/* Beauty */}
      <section id="beauty" aria-labelledby="beauty-heading" className="scroll-mt-32">
        <SectionHeading
          id="beauty-heading"
          kicker="Beauty & Grooming"
          title="Personal care, delivered to your doorstep."
          subtitle="Start with who it's for — then choose hair, skin, nails, makeup or grooming."
          action={<SectionActionLink href={categoryHref("beauty")}>Explore beauty</SectionActionLink>}
        />
        <BeautyAudienceSelector />
        {beautyLive.length > 0 && (
          <div className="mt-6 grid items-center gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {beautyLive.slice(0, 1).map((s) => (
              <ServiceCard key={s.slug} service={s} context="Bookable today" />
            ))}
            <div className="max-w-xl space-y-2 sm:col-span-1 lg:col-span-3 lg:pl-6">
              <p className="font-display text-lg font-semibold text-content">Audience-specific menus are on the way</p>
              <p className="text-base leading-relaxed text-muted">
                {beautyLive[0]!.name} is bookable today. Dedicated menus for women, men, kids and seniors will open
                service by service — explore them now and ask to be notified.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* Senior care */}
      <section
        aria-labelledby="senior-heading"
        className="overflow-hidden rounded-3xl border border-amber-200/70 bg-amber-50/60 p-6 sm:p-10 dark:border-amber-500/20 dark:bg-amber-500/[0.06]"
      >
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-amber-800 dark:text-amber-300">
              Senior Care · {senior.liveCount ? `${senior.liveCount} bookable` : "Coming soon"}
            </p>
            <h2 id="senior-heading" className="mt-3 font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
              {senior.def.tagline}
            </h2>
            <p className="mt-3 text-base leading-relaxed text-muted">{senior.def.description}</p>
            {senior.def.notice && (
              <p className="mt-5 flex gap-3 rounded-2xl bg-surface/80 p-4 text-sm text-content shadow-e1">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
                {senior.def.notice}
              </p>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <NotifyMeButton sourceKey="category:senior-care" serviceName="Senior Care" variant="primary" />
              <SectionActionLink href={categoryHref("senior-care")}>See all senior care</SectionActionLink>
            </div>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {senior.services.map((s) => (
              <li key={s.slug}>
                <Link
                  href={s.href}
                  prefetch={false}
                  className={cn(
                    "flex h-full items-center gap-3 rounded-2xl bg-surface/90 p-3.5 shadow-e1 motion-safe:transition-shadow hover:shadow-e3",
                    focusRing,
                  )}
                >
                  <IconTile icon={s.icon} tone={s.tone} className="size-10" />
                  <span className="min-w-0 flex-1 text-sm font-semibold text-content">{s.name}</span>
                  <ArrowUpRight className="size-4 shrink-0 text-muted" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pet, Executive, Special */}
      <section id="coming-soon" aria-labelledby="soon-heading" className="scroll-mt-32">
        <SectionHeading
          id="soon-heading"
          kicker="Coming soon"
          title="Launching next"
          subtitle="Pet care, concierge help and more. Tell us you're interested and we'll let you know when they open near you."
        />
        <div className="grid gap-4 md:grid-cols-3">
          {launching.map((c) => (
            <ComingSoonCard key={c.def.id} category={c} />
          ))}
        </div>
        {alsoSoon.length > 0 && (
          <div className="mt-8">
            <p className="mb-3 text-sm font-semibold text-content">Also on the way</p>
            <ul className="flex flex-wrap gap-2">
              {alsoSoon.map((s) => (
                <li key={s.slug}>
                  <Link
                    href={s.href}
                    prefetch={false}
                    className={cn(
                      "inline-flex min-h-10 items-center rounded-full border border-line bg-surface px-3.5 text-sm text-content hover:border-emerald-300",
                      focusRing,
                    )}
                  >
                    {s.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <HowItWorks />
      <TrustSection />
      <CoverageSection />
    </>
  );
}
