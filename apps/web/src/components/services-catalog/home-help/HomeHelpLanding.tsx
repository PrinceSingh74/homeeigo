"use client";

import Link from "next/link";
import { Clock3, LayoutGrid, Play, ShieldCheck, Wallet } from "lucide-react";
import {
  EMPTY_FILTERS,
  formatInr,
  type Catalog,
  type CategoryView,
  type FilterFacets,
  type FilterState,
  type ServiceView,
} from "@/lib/catalog";
import { pageSection } from "@/lib/page-layout";
import { Button } from "@/components/buttons/Button";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { ServiceCategoryNav } from "@/components/services-catalog/ServiceCategoryNav";
import { ServiceSearch } from "@/components/services-catalog/ServiceSearch";
import { ServiceFilters } from "@/components/services-catalog/ServiceFilters";
import { ServiceEmptyState } from "@/components/services-catalog/ServiceStates";
import { HourlyHelpModule } from "@/components/services-catalog/HourlyHelpModule";
import { NotifyMeButton } from "@/components/services-catalog/NotifyMe";
import { ServiceJobCard } from "@/components/services-catalog/ServiceCard";
import { Breadcrumbs, band, focusRing } from "@/components/services-catalog/primitives";
import { HomeHelpPhoto } from "@/components/services-catalog/home-help/HomeHelpPhoto";
import { HomeHelpTaskList } from "@/components/services-catalog/home-help/HomeHelpTaskList";
import { HomeHelpWatch } from "@/components/services-catalog/home-help/HomeHelpWatch";
import { homeHelpPhoto } from "@/components/services-catalog/home-help/home-help-photo";
import { cn } from "@/lib/utils";

const VISIT = [
  { n: "01", title: "Pick a rhythm", body: "By the hour — or one precise task." },
  { n: "02", title: "Set the work", body: "Dusting, utensils, laundry, prep. You name it." },
  { n: "03", title: "They arrive", body: "An approved professional. On your clock." },
] as const;

// What holds for every booking: admin approval, gateway payments, live tracking of the arrival.
// ("Verified", "trained" and "on-time" were not things the platform checks or promises for all.)
const TRUST = [
  { icon: ShieldCheck, label: "Approved professionals" },
  { icon: Wallet, label: "Safe & secure payments" },
  { icon: Clock3, label: "Live arrival tracking" },
] as const;

const h2 = "font-display type-title font-bold tracking-tight text-content";

export function HomeHelpLanding({
  catalog,
  category,
  query,
  setQuery,
  filters,
  setFilters,
  facets,
  filtered,
  browsing,
  hourly,
  liveHere,
  crumbs,
}: {
  catalog: Catalog;
  category: CategoryView;
  query: string;
  setQuery: (q: string) => void;
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  facets: FilterFacets;
  filtered: ServiceView[];
  browsing: boolean;
  hourly?: ServiceView;
  liveHere: number;
  crumbs: { label: string; href?: string }[];
}) {
  const { def } = category;
  const live = filtered.filter((s) => s.status === "live" && !s.hourly);
  const soon = filtered.filter((s) => s.status !== "live");
  const groups = (def.subgroups ?? [])
    .filter((g) => g.id !== "hourly")
    .map((g) => ({ ...g, items: live.filter((s) => s.subgroup === g.id) }))
    .filter((g) => g.items.length > 0);
  const ungrouped = groups.length ? live.filter((s) => !groups.some((g) => g.id === s.subgroup)) : live;
  const strip = [hourly, ...live].filter((s): s is ServiceView => Boolean(s)).slice(0, 7);
  const heroSrc = homeHelpPhoto(
    live.find((s) => s.slug === "sweeping-mopping") ??
      live.find((s) => s.slug === "dusting-wiping") ??
      hourly ??
      live[0] ?? { slug: "hourly-home-help", name: "Hourly Home Help" },
  );
  const hourlyLive = hourly?.status === "live" ? hourly : undefined;

  return (
    <>
      <header className="relative">
        <div className={cn(pageSection, "relative pb-10 pt-5 sm:pb-14 sm:pt-6")}>
          <Breadcrumbs items={crumbs} />
          <div className="mt-6 grid items-center gap-10 lg:mt-8 lg:grid-cols-[1.08fr_0.92fr] lg:gap-16">
            <div className="min-w-0 motion-safe:animate-catalog-in">
              <h1 className="font-display type-display font-bold tracking-tight text-content">
                A trained pair of hands.
                <span className="block">On your clock.</span>
              </h1>
              <p className="mt-5 max-w-md text-lg leading-relaxed text-muted">
                Everyday housework, done by professionals who turn up on time. Book by the hour, or name a
                single task — dusting, utensils, laundry, kitchen prep.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {hourly && (
                  <ButtonLink href={hourly.href} variant="primary" size="xl">
                    Book a service
                  </ButtonLink>
                )}
                <HomeHelpWatch
                  className={cn(
                    "inline-flex min-h-14 items-center gap-2 rounded-xl px-5 text-base font-semibold text-content hover:bg-content/5",
                    focusRing,
                  )}
                >
                  <Play className="size-4 fill-current" aria-hidden />
                  Watch video
                </HomeHelpWatch>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-content">
                {TRUST.map((item) => (
                  <li key={item.label} className="inline-flex items-center gap-2">
                    <item.icon className="size-4 text-brand" aria-hidden />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative">
              <HomeHelpPhoto
                src={heroSrc}
                alt="HOMEEIGO home help professional at work"
                priority
                sizes="(max-width: 1024px) 92vw, 560px"
                className="aspect-[4/3] w-full rounded-3xl shadow-e3 lg:aspect-[5/5.2]"
              />
              <HomeHelpWatch
                className={cn(
                  "absolute right-4 top-4 grid size-12 place-items-center rounded-full bg-surface text-content shadow-e3",
                  focusRing,
                )}
              >
                <Play className="size-4 fill-current" aria-hidden />
                <span className="sr-only">Watch how home help works</span>
              </HomeHelpWatch>
              {hourlyLive && (
                <ServiceJobCard
                  service={hourlyLive}
                  className="absolute inset-x-3 bottom-3 sm:inset-x-auto sm:bottom-5 sm:left-5 sm:w-[22rem] lg:-left-8 lg:bottom-8"
                />
              )}
            </div>
          </div>
        </div>
      </header>

      <nav aria-label="Home help tasks" className={cn(pageSection, "pb-6 sm:pb-8")}>
        <ul className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-none sm:mx-0 sm:gap-4 sm:px-0 lg:grid lg:grid-cols-8 lg:overflow-visible lg:pb-0">
          {strip.map((svc) => (
            <li key={svc.slug} className="shrink-0">
              <Link
                href={svc.href}
                prefetch={false}
                className={cn("group flex w-24 flex-col gap-2 rounded-2xl text-content lg:w-auto", focusRing)}
              >
                <HomeHelpPhoto
                  src={homeHelpPhoto(svc)}
                  alt=""
                  sizes="(max-width: 1024px) 96px, 150px"
                  className="aspect-square w-full rounded-2xl ring-1 ring-line motion-safe:transition-shadow group-hover:shadow-e3"
                />
                <span className="text-sm font-semibold leading-snug">
                  {svc.name.replace(/\s*(&|\/).*$/, "").replace(/\s+Home Help$/i, "")}
                </span>
              </Link>
            </li>
          ))}
          <li className="shrink-0">
            <a href="#the-work" className={cn("group flex w-24 flex-col gap-2 rounded-2xl text-content lg:w-auto", focusRing)}>
              <span className="grid aspect-square w-full place-items-center rounded-2xl border border-line bg-surface text-brand motion-safe:transition-shadow group-hover:shadow-e3">
                <LayoutGrid className="size-6" aria-hidden />
              </span>
              <span className="text-sm font-semibold leading-snug">More help</span>
            </a>
          </li>
        </ul>
      </nav>

      <ServiceCategoryNav active="home-help" />

      <div className={cn(pageSection, "space-y-16 pt-12 sm:space-y-20 sm:pt-16")}>
        {hourly && browsing && <HourlyHelpModule service={hourly} tone="light" headingLevel="h2" showDetailsLink />}

        <section id="how-it-works" className="grid items-start gap-x-16 gap-y-8 lg:grid-cols-[0.7fr_1.6fr]">
          <h2 className={h2}>How it works</h2>
          <ol className="grid gap-y-8 sm:grid-cols-3">
            {VISIT.map((step) => (
              <li key={step.n} className="relative border-t border-line pr-6 pt-5">
                <span aria-hidden className="absolute -top-[5px] left-0 size-[9px] rounded-full bg-emerald-500" />
                <span className="block font-display text-4xl font-bold tabular-nums leading-none text-brand">{step.n}</span>
                <p className="mt-4 font-display text-lg font-semibold text-content">{step.title}</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="home-help-facts" className={band}>
          <div className="grid gap-x-16 gap-y-8 lg:grid-cols-[0.7fr_1.6fr] lg:items-center">
            <h2 id="home-help-facts" className={h2}>
              A better way to care for your home
            </h2>
            <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3">
              <div className="border-l-2 border-emerald-500 pl-4">
                <dt className="text-sm text-muted">Bookable now</dt>
                <dd className="mt-1 font-display text-3xl font-bold tabular-nums text-content">
                  {liveHere > 0 ? `${liveHere}` : "Soon"}
                </dd>
              </div>
              <div className="border-l-2 border-emerald-500 pl-4">
                <dt className="text-sm text-muted">By the hour</dt>
                <dd className="mt-1 font-display text-3xl font-bold tabular-nums text-content">
                  {hourly?.price ? formatInr(hourly.price.base) : "—"}
                </dd>
              </div>
              <div className="border-l-2 border-emerald-500 pl-4">
                <dt className="text-sm text-muted">At your door</dt>
                <dd className="mt-1 font-display text-3xl font-bold text-content">Trained</dd>
              </div>
            </dl>
          </div>
        </section>

        <div id="the-work" className="scroll-mt-32 space-y-8">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-lg">
              <h2 className={h2}>
                Name the job.
                <span className="block">We send the person.</span>
              </h2>
              <p className="mt-3 text-base leading-relaxed text-muted">
                One visit, one task. Listed the way you would ask for it.
              </p>
            </div>
            <div className="w-full max-w-md">
              <ServiceSearch
                catalog={catalog}
                value={query}
                onChange={setQuery}
                size="md"
                placeholder="Search home help…"
              />
            </div>
          </div>

          <ServiceFilters facets={facets} value={filters} onChange={setFilters} resultCount={filtered.length} />

          {filtered.length === 0 ? (
            <ServiceEmptyState
              body="No services match these filters. Try removing a filter or searching for something else."
              action={
                <Button
                  variant="secondary"
                  onClick={() => {
                    setQuery("");
                    setFilters(EMPTY_FILTERS);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : browsing ? (
            <div className="space-y-12">
              {groups.map((g) => (
                <div key={g.id}>
                  <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="font-display text-xl font-semibold text-content sm:text-2xl">{g.name}</h3>
                    <p className="text-sm font-medium text-brand">
                      {g.items.length} {g.items.length === 1 ? "task" : "tasks"}
                    </p>
                    {g.description && <p className="basis-full text-sm leading-relaxed text-muted">{g.description}</p>}
                  </div>
                  <HomeHelpTaskList services={g.items} label={g.name} />
                </div>
              ))}
              {ungrouped.length > 0 && (
                <div>
                  {groups.length > 0 && (
                    <h3 className="mb-3 font-display text-xl font-semibold text-content sm:text-2xl">More help</h3>
                  )}
                  <HomeHelpTaskList services={ungrouped} label="Home help services" />
                </div>
              )}
              {soon.length > 0 && (
                <div>
                  <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h3 className="font-display text-xl font-semibold text-content sm:text-2xl">Coming soon</h3>
                      <p className="mt-1 text-sm text-muted">Open any task to get notified when it launches.</p>
                    </div>
                    <NotifyMeButton sourceKey="category:home-help" serviceName="Home Help" label="Notify me about launches" />
                  </div>
                  <HomeHelpTaskList services={soon} label="Home help coming soon" statusStated />
                </div>
              )}
            </div>
          ) : (
            <HomeHelpTaskList
              services={filtered.filter((s) => !s.hourly || query.trim().length > 0)}
              label="Home help results"
            />
          )}
        </div>
      </div>
    </>
  );
}
