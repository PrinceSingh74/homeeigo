"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CATEGORY_BY_ID,
  addonsFor,
  audienceName,
  categoryHref,
  detailContent,
  formatDuration,
  quantityBounds,
  tierOptions,
  unitWord,
  type Addon,
  type Audience,
  type Catalog,
  type ServiceView,
} from "@/lib/catalog";
import { bookUrl } from "@/lib/booking-url";
import { coreApi } from "@/services/core/api";
import { useCatalog } from "@/hooks/use-catalog";
import { useEntitlements } from "@/hooks/use-entitlements";
import type { BackendService, BackendServiceDetail, ServiceSelectionRequest } from "@/types/backend";
import { pageMainBottom, pageSection } from "@/lib/page-layout";
import { StaticSkeleton } from "@/components/ui/StaticSkeleton";
import { ServiceCategoryNav } from "@/components/services-catalog/ServiceCategoryNav";
import { CatalogError, ServiceEmptyState } from "@/components/services-catalog/ServiceStates";
import { Breadcrumbs } from "@/components/services-catalog/primitives";
import { ServiceVisit } from "@/components/services-catalog/detail/ServiceVisit";
import { ServiceReviews } from "@/components/services-catalog/detail/ServiceReviews";
import { HourlyHelpModule, hourlyBooking, type HourlySelection } from "@/components/services-catalog/HourlyHelpModule";
import { BeautyAudienceSelector } from "@/components/services-catalog/beauty/BeautySelectors";
import { ServiceHero } from "@/components/services-catalog/detail/ServiceHero";
import { HomeHelpHero } from "@/components/services-catalog/home-help/HomeHelpHero";
import { HomeHelpShapes } from "@/components/services-catalog/home-help/HomeHelpShapes";
import { BrandHeroWash, BrandMesh } from "@/components/layout/BrandCanvas";
import { ComingSoonDetail } from "@/components/services-catalog/detail/ComingSoonDetail";
import {
  QuantitySelector,
  ServiceAddons,
  ServiceVariantSelector,
  type OptionChoice,
} from "@/components/services-catalog/detail/ServiceOptions";
import { ServiceBookingCTA, type BookingSummary } from "@/components/services-catalog/detail/ServiceBookingCTA";
import {
  BookingSteps,
  DetailSection,
  ServiceAvailability,
  ServiceDurationBreakdown,
  durationAddsDetail,
  ServiceFAQ,
  ServiceProfessional,
  ServiceHighlights,
  ServiceNotes,
  ServicePolicies,
  ServiceRequirements,
  ServiceSafety,
  ServiceScope,
} from "@/components/services-catalog/detail/sections";
import { ServicePreparation, hasPreparation } from "@/components/services-catalog/detail/ServicePreparation";
import { cn } from "@/lib/utils";

/**
 * One service's full detail module. Only this service's content is rendered —
 * never the whole category.
 */
export function ServiceDetail({
  initialServices,
  slug,
  detail,
}: {
  initialServices: BackendService[] | null;
  slug: string;
  detail: BackendServiceDetail | null;
}) {
  const state = useCatalog(initialServices);
  const service = state.status === "ready" ? state.catalog.bySlug.get(slug) : undefined;

  return (
    <main className={cn("relative overflow-x-clip bg-transparent", pageMainBottom, "pb-[calc(10rem+env(safe-area-inset-bottom,0px))] lg:pb-20")}>
      <BrandMesh />
      {state.status === "ready" && service ? (
        <Loaded catalog={state.catalog} service={service} serverDetail={detail} />
      ) : (
        <div className={cn(pageSection, "py-10")}>
          {state.status === "error" ? (
            <CatalogError onRetry={state.retry} />
          ) : state.status === "ready" ? (
            <ServiceEmptyState title="Service unavailable" body="This service isn't available right now. Browse other services instead." />
          ) : (
            <DetailSkeleton />
          )}
        </div>
      )}
    </main>
  );
}

function DetailSkeleton() {
  return (
    <div role="status" aria-label="Loading service" aria-busy="true" className="max-w-4xl space-y-5">
      <StaticSkeleton className="h-4 w-40 rounded-full" />
      <StaticSkeleton shimmer className="h-14 w-4/5 rounded-xl sm:h-16" />
      <StaticSkeleton className="h-5 w-full rounded-lg" />
      <StaticSkeleton className="h-5 w-2/3 rounded-lg" />
      <div className="flex gap-10 border-t border-line pt-7">
        <StaticSkeleton className="h-12 w-36 rounded-xl" />
        <StaticSkeleton className="h-12 w-28 rounded-xl" />
      </div>
    </div>
  );
}

function Loaded({
  catalog,
  service,
  serverDetail,
}: {
  catalog: Catalog;
  service: ServiceView;
  serverDetail: BackendServiceDetail | null;
}) {
  const cat = CATEGORY_BY_ID.get(service.category)!;
  const live = service.status === "live";

  // SSR normally supplies the detail; fetch on the client only if it could not.
  const detailQuery = useQuery({
    queryKey: ["services", "detail", service.backendId],
    queryFn: async () => (await coreApi.services.details(service.backendId!)).service as BackendServiceDetail,
    enabled: live && !serverDetail && Boolean(service.backendId),
    staleTime: 5 * 60_000,
  });
  const detail = serverDetail ?? detailQuery.data ?? null;
  const content = useMemo(() => detailContent(service, detail), [service, detail]);

  const crumbs = [
    { label: "Services", href: "/services" },
    { label: cat.name, href: categoryHref(cat.id) },
    { label: service.name },
  ];

  const homeHelp = service.category === "home-help";

  return (
    <>
      {homeHelp ? (
        <div className="relative overflow-hidden">
          <BrandHeroWash />
          <HomeHelpShapes />
          <div className={cn(pageSection, "relative pb-12 pt-6 sm:pb-16 sm:pt-8")}>
            <Breadcrumbs items={crumbs} />
            <div className="mt-8 sm:mt-10">
              <HomeHelpHero service={service} rating={content.rating} image={content.images[0]} />
            </div>
          </div>
        </div>
      ) : (
        <div className={cn(pageSection, "pt-6 sm:pt-8")}>
          <Breadcrumbs items={crumbs} />
          <div className="mt-6 sm:mt-8">
            <ServiceHero service={service} rating={content.rating} image={content.images[0]} />
          </div>
        </div>
      )}

      <div className="mt-10 sm:mt-14">
        <ServiceCategoryNav active={service.category} />
      </div>

      <div className={cn(pageSection, "pt-10 sm:pt-12")}>
        {live ? <LiveBody service={service} content={content} detail={detail} /> : <ComingSoonDetail service={service} catalog={catalog} />}
      </div>
    </>
  );
}

function readAudienceParam(): Audience | undefined {
  if (typeof window === "undefined") return undefined;
  const v = new URLSearchParams(window.location.search).get("for");
  return v ? (v as Audience) : undefined;
}

function LiveBody({
  service,
  content,
  detail,
}: {
  service: ServiceView;
  content: ReturnType<typeof detailContent>;
  detail: BackendServiceDetail | null;
}) {
  const tiers = useMemo(() => tierOptions(service.price!), [service.price]);
  const { data: entitlements } = useEntitlements();
  // The server's add-on list (own catalogue or the shared one) when the detail is loaded; the
  // catalogue-derived list only until then.
  // Names and prices come from the server; WHICH shared add-ons a service offers stays the
  // catalogue's curation (def.addons / excludeAddons), exactly as before. A service with its own
  // configured add-ons shows those.
  const addons = useMemo<Addon[]>(() => {
    const offered = addonsFor(service);
    if (!detail?.addons) return offered;
    const allowed = service.config?.addons ? null : new Set(offered.map((a) => a.id));
    return detail.addons
      .filter((a) => !allowed || allowed.has(a.id))
      .map((a) => ({ id: a.id, name: a.name, price: a.price, durationMin: a.durationMin ?? undefined }));
  }, [detail?.addons, service]);
  const rule = service.quantity;
  const isBeauty = service.category === "beauty";
  // Audiences only need choosing when there is more than one.
  const audiences = service.audiences;
  const [audience, setAudience] = useState<Audience | undefined>(audiences.length === 1 ? audiences[0] : undefined);
  useEffect(() => {
    const fromUrl = readAudienceParam();
    if (fromUrl && audiences.includes(fromUrl)) setAudience(fromUrl);
  }, [audiences]);

  // Variants the chosen audience may book (all when no audience restriction applies).
  const variants = useMemo(
    () => service.variants.filter((v) => !audience || !v.audiences?.length || v.audiences.includes(audience)),
    [service.variants, audience],
  );
  // No business default is invented: a variant is preselected only when it is the only one.
  const [variantId, setVariantId] = useState<string | undefined>(service.variants.length === 1 ? service.variants[0]!.id : undefined);
  const variant = service.variants.find((v) => v.id === variantId) ?? null;
  // A choice that stops fitting (e.g. the audience changed) is kept and explained — never swapped.
  const variantMismatch = Boolean(variant && !variants.some((v) => v.id === variant.id));

  const bounds = rule ? quantityBounds(rule, variant) : null;
  const [quantity, setQuantity] = useState(rule?.default ?? bounds?.min ?? 1);
  const q = bounds ? Math.min(Math.max(quantity, bounds.min), bounds.max) : 1;

  // Legacy price tiers only apply without variants and without a quantity rule.
  const useTiers = service.variants.length === 0 && !rule && tiers.length > 1;
  const [tier, setTier] = useState(() => (tiers.some((t) => t.index === 1) ? 1 : tiers[0]!.index));
  const tierChoice = tiers.find((t) => t.index === tier) ?? tiers[0]!;

  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [hourly, setHourly] = useState<HourlySelection>({ hours: rule?.default ?? rule?.min ?? 1, tasks: [] });
  const hourMode = service.hourly && (!rule || rule.type === "HOUR");

  const chosenAddons = useMemo(() => addons.filter((a) => picked.has(a.id)), [addons, picked]);
  const needsAudience = isBeauty && audiences.length > 1 && !audience;
  const configAudience = audience && service.config?.audiences?.includes(audience) ? audience : undefined;

  // The server's verdict on the current selection: price lines, duration and every issue.
  const request: ServiceSelectionRequest = {
    variantId: variant?.id,
    quantity: rule ? (hourMode ? hourly.hours : q) : undefined,
    audience: configAudience,
    addonIds: chosenAddons.map((a) => a.id),
    packagePrice: useTiers ? tierChoice.price : undefined,
    serviceVersion: detail?.version,
  };
  const resolution = useQuery({
    queryKey: ["services", "resolve", service.backendId, request],
    queryFn: () => coreApi.services.resolveSelection(service.backendId!, request),
    enabled: Boolean(service.backendId),
    placeholderData: (prev) => prev,
    staleTime: 30_000,
    retry: false,
  });
  const verdict = resolution.data;
  const staleVersion = (resolution.error as { code?: string } | null)?.code === "SERVICE_VERSION_CHANGED";
  const availability = useMemo(
    () => new Map((verdict?.addonAvailability ?? []).map((a) => [a.id, { available: a.available, reason: a.reason }])),
    [verdict?.addonAvailability],
  );
  const serverIssues = useMemo(
    () => (verdict && !verdict.ok ? verdict.issues : []),
    [verdict],
  );

  const summary: BookingSummary = useMemo(() => {
    const addonIds = chosenAddons.map((a) => a.id);
    // Money shown here is only ever the server's resolution — never computed in the browser.
    // Until it answers the CTA says "Calculating price…"; if the selection cannot be priced it
    // says so instead of showing an amount.
    const amount = verdict?.pricing?.subtotal ?? null;
    const addonTotal = verdict?.pricing?.addonTotal ?? 0;
    const priceNote =
      verdict && !verdict.pricing
        ? serverIssues.some((i) => i.code === "PRICING_CONFIG_MISSING")
          ? "Pricing unavailable for this configuration"
          : "Choose a valid option to see the price"
        : resolution.isError && !staleVersion
          ? "Pricing unavailable right now"
          : undefined;
    const blockedReason = needsAudience
      ? "Choose who this is for"
      : staleVersion
        ? "This service was updated — refresh the page"
        : variantMismatch
          ? "Choose an option available for this person"
          : service.config?.variantRequired && !variant && service.variants.length > 0
            ? "Choose an option"
            : serverIssues[0]?.message;
    if (hourMode) {
      const { href } = hourlyBooking(service, hourly);
      return {
        serviceName: service.name,
        optionLabel: `${hourly.hours} ${hourly.hours === 1 ? "hour" : "hours"}`,
        amount,
        addonTotal,
        priceNote,
        href: blockedReason ? null : href && addonIds.length ? `${href}&addons=${encodeURIComponent(addonIds.join(","))}` : href,
        blockedReason,
      };
    }
    const parts = [
      variant?.name ?? (useTiers ? tierChoice.name : null),
      rule ? `${q} ${unitWord(rule, q)}` : null,
      audience && isBeauty ? audienceName(audience) : null,
    ].filter(Boolean);
    return {
      serviceName: service.name,
      optionLabel: parts.join(" · ") || service.name,
      amount,
      addonTotal,
      priceNote,
      href: blockedReason
        ? null
        : bookUrl({
            service: service.backendId,
            variant: variant?.id,
            quantity: rule ? q : undefined,
            package: useTiers ? tierChoice.index : undefined,
            // The server only accepts an audience the backend config lists; otherwise it
            // travels as a note for the professional instead of being rejected.
            audience: configAudience,
            notes:
              audience && isBeauty && !service.config?.audiences?.includes(audience)
                ? `For: ${audienceName(audience)}.`
                : undefined,
            addons: addonIds,
          }),
      blockedReason,
    };
  }, [
    service,
    hourly,
    hourMode,
    rule,
    variant,
    variantMismatch,
    q,
    useTiers,
    tierChoice,
    chosenAddons,
    audience,
    configAudience,
    isBeauty,
    needsAudience,
    verdict,
    serverIssues,
    staleVersion,
    resolution.isError,
  ]);

  const toggleAddon = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const variantChoices: OptionChoice[] = variants.map((v) => ({
    id: v.id,
    name: v.name,
    tag: v.durationMin ? (formatDuration(v.durationMin) ?? undefined) : undefined,
    price: v.quantity?.unitPrice ?? v.price,
    priceSuffix: rule ? `/ ${rule.unitLabel}` : undefined,
  }));
  const tierChoices: OptionChoice[] = tiers.map((t) => ({ id: String(t.index), name: t.name, price: t.price }));
  const showOptions = (isBeauty && audiences.length > 1) || variantChoices.length > 1 || useTiers || Boolean(rule);
  const duration = verdict?.duration ?? detail?.duration ?? null;
  const media = detail?.content;
  const heroDuration = formatDuration(service.durationMin);
  const overviewAdds = content.overview.trim() !== service.description.trim();
  const durationAdds = durationAddsDetail(duration, heroDuration);

  return (
    <>
      <div className="grid gap-10 lg:grid-cols-[1fr_360px] lg:gap-14">
        {/* Whichever section comes first sits directly under the category nav: no rule above it. */}
        <div className="min-w-0 space-y-10 sm:space-y-12 [&>section:first-child]:border-t-0 [&>section:first-child]:pt-0">
          {/* The hero already carries the lead line, price, pricing model and time. This section
              exists only for what it adds: a fuller overview, the value proposition, or a duration
              range / breakdown. With nothing to add, the page goes straight on to the next section. */}
          {(overviewAdds || media?.valueProposition || durationAdds) && (
            <DetailSection id="overview" title="Service overview">
              <div className="space-y-4">
                {overviewAdds && <p className="max-w-2xl text-lg leading-relaxed text-content">{content.overview}</p>}
                {media?.valueProposition && <p className="max-w-2xl text-base leading-relaxed text-muted">{media.valueProposition}</p>}
                {durationAdds && <ServiceDurationBreakdown duration={duration} alreadyShown={heroDuration} />}
              </div>
            </DetailSection>
          )}

          {media && (media.highlights.length > 0 || media.keyBenefits.length > 0) && (
            <DetailSection id="what-you-get" title="What you get">
              <ServiceHighlights highlights={media.highlights} benefits={media.keyBenefits} />
            </DetailSection>
          )}

          {hourMode ? (
            <HourlyHelpModule
              service={service}
              tone="light"
              headingLevel="h2"
              showDetailsLink={false}
              value={hourly}
              onChange={setHourly}
              hideCta
            />
          ) : (
            showOptions && (
              <DetailSection id="options" title="Choose your option">
                <div className="space-y-7">
                  {isBeauty && audiences.length > 1 && (
                    <BeautyAudienceSelector mode="select" active={audience} onSelect={setAudience} allowed={audiences} />
                  )}
                  {variantChoices.length > 1 && (
                    <ServiceVariantSelector options={variantChoices} value={variantMismatch ? "" : (variant?.id ?? "")} onChange={setVariantId} />
                  )}
                  {variantMismatch && variant && (
                    <p role="alert" className="text-sm font-medium text-amber-700 dark:text-amber-400">
                      “{variant.name}” isn’t available{audience ? ` for ${audienceName(audience)}` : ""}. Choose another option.
                    </p>
                  )}
                  {useTiers && (
                    <ServiceVariantSelector options={tierChoices} value={String(tier)} onChange={(id) => setTier(Number(id))} />
                  )}
                  {rule && bounds && (
                    <fieldset>
                      <legend className="mb-3 text-base font-semibold text-content">
                        How many {rule.unitLabelPlural ?? rule.unitLabel}?
                      </legend>
                      <QuantitySelector rule={rule} {...bounds} value={q} onChange={setQuantity} />
                    </fieldset>
                  )}
                  {/* No professional-preference control: the backend offers none while assignment
                      cannot honour one (PROFESSIONAL_PREFERENCE_SUPPORTED is false; the public
                      config carries no preferences and the resolver refuses any but "no preference"). */}
                  {content.eligibility && <p className="text-sm text-muted">{content.eligibility}</p>}
                </div>
              </DetailSection>
            )
          )}

          {serverIssues.length > 1 && (
            <ul role="alert" className="-mt-6 space-y-1 text-sm font-medium text-amber-700 dark:text-amber-400">
              {serverIssues.map((i) => (
                <li key={`${i.code}-${i.id ?? ""}`}>{i.message}</li>
              ))}
            </ul>
          )}

          <DetailSection id="scope" title="Scope of service">
            <ServiceScope scope={content.scope} />
            {media && (
              <div className="mt-6">
                <ServiceNotes limitations={media.limitations} notes={media.importantNotes} disclosures={media.customerDisclosures} />
              </div>
            )}
          </DetailSection>

          {hasPreparation(detail?.preparation) ? (
            <DetailSection id="preparation" title="What you need before we arrive">
              <ServicePreparation view={detail.preparation} />
            </DetailSection>
          ) : (
            <DetailSection id="materials" title="Materials & equipment">
              <ServicePolicies rows={content.policies} />
            </DetailSection>
          )}

          {addons.length > 0 && (
            <DetailSection id="addons" title="Add-ons">
              <ServiceAddons addons={addons} selected={picked} onToggle={toggleAddon} availability={availability} />
            </DetailSection>
          )}

          {/* Small screens: the ticket's breakdown and small print, in the page. The fixed bar holds the button. */}
          <div className="mx-auto max-w-md lg:hidden">
            <ServiceBookingCTA summary={summary} variant="stub" />
          </div>

          <DetailSection id="availability" title="Availability">
            <ServiceAvailability service={service} cities={content.cities} member={Boolean(entitlements?.premiumAccess)} />
          </DetailSection>

          {detail?.visit ? (
            <ServiceVisit visit={detail.visit} omitRepeatedRequirements={hasPreparation(detail.preparation)} />
          ) : (
            (content.prepare.length > 0 || content.safety.length > 0) && (
              <DetailSection id="prepare" title="Before your service">
                <div className="space-y-4">
                  <ServiceRequirements items={content.prepare} />
                  <ServiceSafety items={content.safety} />
                </div>
              </DetailSection>
            )
          )}

          {detail?.visit && (content.prepare.length > 0) && (
            <DetailSection id="prepare" title="Before your service">
              <ServiceRequirements items={content.prepare} />
            </DetailSection>
          )}

          <BookingSteps title={detail?.visit ? "How booking works" : "How it works"} />

          {detail?.professional?.statements.length ? (
            <DetailSection id="professional" title="Your professional" lead="Checked before a professional can be given this job.">
              <ServiceProfessional statements={detail.professional.statements} />
            </DetailSection>
          ) : null}

          {detail?.id ? <ServiceReviews serviceId={detail.id} /> : null}

          <DetailSection id="faq" title="Frequently asked questions">
            <ServiceFAQ faqs={content.faqs} />
          </DetailSection>
        </div>

        <aside aria-label="Book this service" className="hidden lg:block">
          <div className="sticky top-[calc(var(--navbar-offset,3.5rem)+5rem)]">
            <ServiceBookingCTA summary={summary} variant="card" />
          </div>
        </aside>
      </div>
      <ServiceBookingCTA summary={summary} variant="bar" />
    </>
  );
}
