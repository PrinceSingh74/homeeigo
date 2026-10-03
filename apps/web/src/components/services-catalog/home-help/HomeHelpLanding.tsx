"use client";

import Link from "next/link";
import {
  CalendarDays,
  CircleCheck,
  Clock3,
  LayoutGrid,
  Play,
  ShieldCheck,
  UserRound,
  Wallet,
} from "lucide-react";
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
import { Breadcrumbs } from "@/components/services-catalog/primitives";
import { HomeHelpPhoto } from "@/components/services-catalog/home-help/HomeHelpPhoto";
import { HomeHelpTaskList } from "@/components/services-catalog/home-help/HomeHelpTaskList";
import { HomeHelpWatch } from "@/components/services-catalog/home-help/HomeHelpWatch";
import { homeHelpPhoto } from "@/components/services-catalog/home-help/home-help-photo";
import { cn } from "@/lib/utils";

const INK = "text-[#163326] dark:text-content";
const MUTED = "text-[#5c6b63] dark:text-muted";
const YELLOW =
  "!rounded-full !bg-[#F5C518] !text-[#163326] !shadow-none hover:!bg-[#e6b80f] hover:!shadow-none";

const VISIT = [
  { n: "01", title: "Pick a rhythm", body: "By the hour — or one precise task.", icon: LayoutGrid },
  { n: "02", title: "Set the work", body: "Dusting, utensils, laundry, prep. You name it.", icon: CalendarDays },
  { n: "03", title: "They arrive", body: "A trained professional. On your clock.", icon: CircleCheck },
] as const;

const TRUST = [
  { icon: ShieldCheck, label: "Verified professionals" },
  { icon: Wallet, label: "Safe & secure payments" },
  { icon: Clock3, label: "On-time service" },
] as const;

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
  const featured = live.slice(0, 6);
  const heroSrc = homeHelpPhoto(
    live.find((s) => s.slug === "sweeping-mopping") ??
      live.find((s) => s.slug === "dusting-wiping") ??
      hourly ??
      live[0] ?? { slug: "hourly-home-help", name: "Hourly Home Help" },
  );
  const splitSrc = homeHelpPhoto(
    featured.find((s) => s.slug === "kitchen-prep") ??
      featured.find((s) => s.slug === "utensils") ??
      featured[1] ??
      featured[0] ?? { slug: "kitchen-prep", name: "Kitchen Prep" },
  );

  return (
    <>
      <header className="relative overflow-hidden bg-[#FAFAF8] dark:bg-transparent">
        <div className={cn(pageSection, "relative pb-12 pt-6 sm:pb-16 sm:pt-8")}>
          <Breadcrumbs items={crumbs} />
          <div className="mt-10 grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            <div className="motion-safe:animate-catalog-in">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#163326]/55 dark:text-muted">
                Home Help
              </p>
              <h1 className={cn("mt-4 font-display text-[clamp(2.4rem,6.5vw,4.25rem)] font-bold leading-[0.98] tracking-tight", INK)}>
                A trained pair of hands.
                <span className="block">On your clock.</span>
              </h1>
              <p className={cn("mt-5 max-w-md text-lg leading-relaxed", MUTED)}>
                Everyday housework, done by professionals who turn up on time. Book by the hour, or name a
                single task — dusting, utensils, laundry, kitchen prep.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                {hourly && (
                  <ButtonLink href={hourly.href} variant="primary" size="xl" className={cn("group", YELLOW)}>
                    Book a Service
                  </ButtonLink>
                )}
                <HomeHelpWatch className="inline-flex min-h-14 items-center gap-2 rounded-full px-5 text-base font-semibold text-[#163326] hover:bg-[#163326]/5 dark:text-content">
                  <Play className="size-4 fill-current" aria-hidden />
                  Watch Video
                </HomeHelpWatch>
              </div>
              <ul className={cn("mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium", INK)}>
                {TRUST.map((item) => (
                  <li key={item.label} className="inline-flex items-center gap-2">
                    <item.icon className="size-4" aria-hidden />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="relative mx-auto w-full max-w-[32rem]">
              <p className={cn("pointer-events-none absolute -right-1 top-2 z-10 hidden max-w-[7.5rem] text-right font-display text-xl font-semibold leading-tight sm:block", INK)}>
                Your Home.
                <span className="block">Our Care.</span>
              </p>
              <HomeHelpPhoto
                src={heroSrc}
                alt="HOMEEIGO home help professional at work"
                priority
                sizes="(max-width: 1024px) 88vw, 480px"
                className="mx-auto aspect-square w-[92%] rounded-full shadow-[0_32px_90px_-28px_rgb(22_51_38/0.32)] ring-8 ring-white dark:ring-canvas"
              />
              <HomeHelpWatch className="absolute bottom-[10%] right-[2%] grid size-14 place-items-center rounded-full bg-white text-[#163326] shadow-e4 ring-1 ring-black/5 dark:bg-surface dark:text-content">
                <Play className="size-5 fill-current" aria-hidden />
                <span className="sr-only">Watch how home help works</span>
              </HomeHelpWatch>
            </div>
          </div>
        </div>
      </header>

      <nav aria-label="Home help tasks" className={cn(pageSection, "py-5 sm:py-8")}>
        <ul className="-mx-4 flex gap-4 overflow-x-auto px-4 pb-2 scrollbar-none sm:mx-0 sm:flex-wrap sm:justify-center sm:gap-6 sm:overflow-visible sm:px-0">
          {strip.map((svc) => (
            <li key={svc.slug} className="shrink-0">
              <Link
                href={svc.href}
                prefetch={false}
                className={cn("flex w-[5.75rem] flex-col items-center gap-2.5 rounded-2xl text-center sm:w-[6.5rem]", INK)}
              >
                <HomeHelpPhoto
                  src={homeHelpPhoto(svc)}
                  alt={svc.name}
                  sizes="112px"
                  className="size-20 rounded-full shadow-[0_14px_32px_-16px_rgb(22_51_38/0.45)] ring-[3px] ring-white sm:size-24 dark:ring-canvas"
                />
                <span className="text-[12px] font-semibold leading-snug sm:text-[13px]">
                  {svc.name.replace(/\s*(&|\/).*$/, "").replace(/\s+Home Help$/i, "")}
                </span>
              </Link>
            </li>
          ))}
          <li className="shrink-0">
            <a href="#the-work" className={cn("flex w-[5.75rem] flex-col items-center gap-2.5 rounded-2xl text-center sm:w-[6.5rem]", INK)}>
              <span className="grid size-20 place-items-center rounded-full bg-white shadow-[0_14px_32px_-16px_rgb(22_51_38/0.45)] ring-[3px] ring-white sm:size-24 dark:bg-surface dark:ring-canvas">
                <LayoutGrid className="size-6" aria-hidden />
              </span>
              <span className="text-[12px] font-semibold leading-snug sm:text-[13px]">More help</span>
            </a>
          </li>
        </ul>
      </nav>

      <ServiceCategoryNav active="home-help" />

      <section id="how-it-works" className={cn(pageSection, "py-14 sm:py-20")}>
        <div className="grid items-start gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#163326]/55 dark:text-muted">
              Simple steps
            </p>
            <h2 className={cn("mt-3 font-display text-[clamp(1.85rem,4vw,2.75rem)] font-bold leading-[1.05] tracking-tight", INK)}>
              How It Works
            </h2>
          </div>
          <ol className="grid gap-8 sm:grid-cols-3 sm:gap-6">
            {VISIT.map((step) => (
              <li key={step.n}>
                <p className="font-display text-sm font-semibold tabular-nums text-[#163326]/35 dark:text-muted">{step.n}</p>
                <step.icon className={cn("mt-3 size-5", INK)} aria-hidden />
                <p className={cn("mt-3 font-display text-lg font-semibold", INK)}>{step.title}</p>
                <p className={cn("mt-1.5 text-sm leading-relaxed", MUTED)}>{step.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {hourly && browsing && (
        <div className={cn(pageSection, "pb-6")}>
          <HourlyHelpModule service={hourly} tone="light" headingLevel="h2" showDetailsLink />
        </div>
      )}

      {featured.length > 0 && browsing && (
        <section className={cn(pageSection, "py-10 sm:py-16")}>
          <div className="grid items-center gap-10 lg:grid-cols-[0.78fr_1.22fr] lg:gap-14">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#163326]/55 dark:text-muted">
                Our services
              </p>
              <h2 className={cn("mt-3 font-display text-[clamp(1.85rem,4vw,2.75rem)] font-bold leading-[1.05] tracking-tight", INK)}>
                Everything your home needs
              </h2>
              <p className={cn("mt-3 max-w-sm text-base leading-relaxed", MUTED)}>
                From daily chores to specialised help — every task is done by a verified professional.
              </p>
              <ButtonLink href="#the-work" variant="ghost" size="lg" className={cn("mt-6 px-0", INK)}>
                Explore all services
              </ButtonLink>
            </div>
            <div className="flex flex-col items-center gap-8 lg:flex-row lg:items-center xl:gap-10">
              <HomeHelpPhoto
                src={splitSrc}
                alt="HOMEEIGO professional in your kitchen"
                sizes="(min-width: 1280px) 288px, 240px"
                className="size-52 shrink-0 rounded-full shadow-[0_28px_70px_-28px_rgb(22_51_38/0.4)] ring-8 ring-white sm:size-60 lg:order-last lg:size-56 xl:size-72 dark:ring-canvas"
              />
              <ol className="w-full min-w-0 flex-1 divide-y divide-line">
                {featured.map((svc, i) => (
                  <li key={svc.slug}>
                    <Link href={svc.href} prefetch={false} className="flex items-center gap-3 py-3.5 sm:gap-4">
                      <span className="w-7 shrink-0 font-display text-sm font-semibold tabular-nums text-[#163326]/35 dark:text-muted">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <HomeHelpPhoto
                        src={homeHelpPhoto(svc)}
                        alt={svc.name}
                        sizes="88px"
                        className="size-[4.5rem] shrink-0 rounded-full shadow-[0_10px_24px_-14px_rgb(22_51_38/0.5)] ring-2 ring-white sm:size-20 dark:ring-canvas"
                      />
                      <span className="min-w-0">
                        <span className={cn("block font-semibold", INK)}>{svc.name}</span>
                        <span className={cn("mt-0.5 block line-clamp-2 text-sm", MUTED)}>{svc.description}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      )}

      <section className="bg-[#163326] text-white">
        <div className={cn(pageSection, "grid gap-8 py-12 sm:grid-cols-2 sm:items-center sm:py-16 lg:grid-cols-[1.1fr_1fr]")}>
          <h2 className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-[1.05] tracking-tight">
            A better way to care for your home
          </h2>
          <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/55">Bookable now</dt>
              <dd className="mt-1 font-display text-3xl font-bold tabular-nums">{liveHere > 0 ? `${liveHere}` : "Soon"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/55">By the hour</dt>
              <dd className="mt-1 font-display text-3xl font-bold tabular-nums">
                {hourly?.price ? formatInr(hourly.price.base) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-[0.14em] text-white/55">At your door</dt>
              <dd className="mt-1 inline-flex items-center gap-2 font-display text-2xl font-bold">
                <UserRound className="size-6" aria-hidden />
                Trained
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <div id="the-work" className={cn(pageSection, "space-y-10 scroll-mt-32 py-14 sm:py-20")}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-lg">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#163326]/55 dark:text-muted">The work</p>
            <h2 className={cn("mt-2 font-display text-3xl font-bold tracking-tight sm:text-4xl", INK)}>
              Name the job.
              <span className="block">We send the person.</span>
            </h2>
            <p className={cn("mt-2 text-base leading-relaxed", MUTED)}>
              One visit, one task. Listed the way you would ask for it — not a wall of tiles.
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
                <div className="mb-4 flex items-end justify-between gap-3">
                  <div>
                    <h3 className={cn("font-display text-xl font-semibold", INK)}>{g.name}</h3>
                    {g.description && <p className={cn("mt-1 max-w-xl text-sm leading-relaxed", MUTED)}>{g.description}</p>}
                  </div>
                  <p className="text-xs font-medium uppercase tracking-[0.12em] text-[#5c6b63]">
                    {g.items.length} {g.items.length === 1 ? "task" : "tasks"}
                  </p>
                </div>
                <HomeHelpTaskList services={g.items} label={g.name} />
              </div>
            ))}
            {ungrouped.length > 0 && (
              <div>
                {groups.length > 0 && <h3 className={cn("mb-4 font-display text-xl font-semibold", INK)}>More help</h3>}
                <HomeHelpTaskList services={ungrouped} label="Home help services" />
              </div>
            )}
            {soon.length > 0 && (
              <div>
                <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h3 className={cn("font-display text-xl font-semibold", INK)}>Coming soon</h3>
                    <p className={cn("mt-1 text-sm", MUTED)}>Open any task to get notified when it launches.</p>
                  </div>
                  <NotifyMeButton sourceKey="category:home-help" serviceName="Home Help" label="Notify me about launches" />
                </div>
                <HomeHelpTaskList services={soon} label="Home help coming soon" />
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
    </>
  );
}
