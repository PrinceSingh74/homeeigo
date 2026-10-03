import type { ServiceDuration } from "@/types/backend";
import type { ReactNode } from "react";
import { CalendarClock, Check, ChevronDown, Crown, Info, MapPin, Minus, Package, ShieldAlert, Wrench } from "lucide-react";
import {
  DETAILS_CONFIRMED_AT_BOOKING,
  PRICING_MODEL_LABEL,
  formatDuration,
  priceText,
  type Faq,
  type PolicyRow,
  type ServiceView,
} from "@/lib/catalog";
import { ModelChip, cardSurface } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

export function DetailSection({
  id,
  title,
  children,
  className,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} className={cn("scroll-mt-32", className)}>
      <h2 id={id} className="mb-4 font-display text-xl font-bold tracking-tight text-content sm:text-2xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function List({ items, kind }: { items: string[]; kind: "yes" | "no" }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-base leading-relaxed text-content">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
              kind === "yes"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"
                : "bg-canvas text-muted",
            )}
          >
            {kind === "yes" ? <Check className="size-3.5" strokeWidth={2.5} /> : <Minus className="size-3.5" strokeWidth={2.5} />}
          </span>
          <span>
            <span className="sr-only">{kind === "yes" ? "Included: " : "Not included: "}</span>
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ServiceIncludes({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={cn("p-5 sm:p-6", cardSurface)}>
      <h3 className="mb-4 font-semibold text-content">What&apos;s included</h3>
      <List items={items} kind="yes" />
    </div>
  );
}

export function ServiceExclusions({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div className={cn("p-5 sm:p-6", cardSurface)}>
      <h3 className="mb-4 font-semibold text-content">What&apos;s not included</h3>
      <List items={items} kind="no" />
    </div>
  );
}

function PolicyRows({ rows, icon: Icon }: { rows: PolicyRow[]; icon: typeof Package }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3.5">
          <dt className="flex items-center gap-2.5 text-sm text-muted">
            <Icon className="size-4" aria-hidden />
            {r.label}
          </dt>
          <dd className="text-sm font-semibold text-content">{r.value}</dd>
        </div>
      ))}
    </>
  );
}

/** Materials / products row — only when the backend policy says something real. */
export function ServiceMaterialPolicy({ rows }: { rows: PolicyRow[] }) {
  const own = rows.filter((r) => r.label === "Materials & products" || r.label === "Products");
  return own.length ? <PolicyRows rows={own} icon={Package} /> : null;
}

/** Tools/equipment and spare-parts rows. */
export function ServiceEquipmentPolicy({ rows }: { rows: PolicyRow[] }) {
  const own = rows.filter((r) => r.label === "Tools & equipment" || r.label === "Spare parts");
  return own.length ? <PolicyRows rows={own} icon={Wrench} /> : null;
}

/**
 * Materials & equipment, from the admin-configured policies. Nothing configured
 * → one honest line instead of a guess.
 */
export function ServicePolicies({ rows }: { rows: PolicyRow[] }) {
  if (!rows.length) return <ConfirmedLater />;
  return (
    <dl className={cn("divide-y divide-line px-5", cardSurface)}>
      <ServiceMaterialPolicy rows={rows} />
      <ServiceEquipmentPolicy rows={rows} />
    </dl>
  );
}

export function ConfirmedLater() {
  return (
    <p className={cn("flex gap-3 p-5 text-sm leading-relaxed text-muted", cardSurface)}>
      <Info className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
      <span>{DETAILS_CONFIRMED_AT_BOOKING}</span>
    </p>
  );
}

export function ServiceScope({ scope }: { scope: { includes: string[]; excludes: string[] } | null }) {
  if (!scope) return <ConfirmedLater />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ServiceIncludes items={scope.includes} />
      <ServiceExclusions items={scope.excludes} />
    </div>
  );
}

export function ServiceSafety({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className={cn("space-y-2 p-5 text-sm leading-relaxed text-content", cardSurface)}>
      {items.map((i) => (
        <li key={i} className="flex gap-3">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden />
          {i}
        </li>
      ))}
    </ul>
  );
}

export function ServiceRequirements({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ol className="grid gap-3 sm:grid-cols-2">
      {items.map((item, i) => (
        <li key={item} className={cn("flex gap-3 p-4 text-sm leading-relaxed text-content", cardSurface)}>
          <span className="font-display text-sm font-bold tabular-nums text-brand">{String(i + 1).padStart(2, "0")}</span>
          {item}
        </li>
      ))}
    </ol>
  );
}

/** Native details/summary: keyboard and screen-reader accessible with no JS. */
export function ServiceFAQ({ faqs }: { faqs: Faq[] }) {
  if (!faqs.length) return null;
  return (
    <div className={cn("divide-y divide-line", cardSurface)}>
      {faqs.map((f) => (
        <details key={f.q} className="group px-5 [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-4 font-semibold text-content outline-none focus-visible:underline">
            {f.q}
            <ChevronDown
              className="size-5 shrink-0 text-muted motion-safe:transition-transform group-open:rotate-180"
              aria-hidden
            />
          </summary>
          <p className="pb-5 text-sm leading-relaxed text-muted">{f.a}</p>
        </details>
      ))}
    </div>
  );
}

export function ServiceAvailability({
  service,
  cities,
  member = false,
}: {
  service: ServiceView;
  cities: string[];
  /** Viewer already has an active membership that unlocks members-only services. */
  member?: boolean;
}) {
  return (
    <ul className="space-y-3 text-sm text-content">
      <li className="flex gap-3">
        <CalendarClock className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
        <span>Pick your date and time slot in the next step — slots depend on professionals available near you.</span>
      </li>
      {cities.length > 0 && (
        <li className="flex gap-3">
          <MapPin className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span>Available in {cities.join(", ")}.</span>
        </li>
      )}
      {service.premiumOnly && (
        <li className="flex gap-3">
          <Crown className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
          <span>
            {member
              ? "Included with your active membership."
              : "Members-only service — requires an active HOMEEIGO membership."}
          </span>
        </li>
      )}
    </ul>
  );
}

export function ServicePricing({ service }: { service: ServiceView }) {
  const price = priceText(service);
  const duration = formatDuration(service.durationMin);
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <p className="font-display text-2xl font-bold tabular-nums text-content">
        <span aria-hidden>{price.label}</span>
        <span className="sr-only">Price: {price.spoken}</span>
      </p>
      <ModelChip model={service.pricingModel} />
      {duration && (
        <span className="text-sm text-muted">
          <span className="sr-only">Estimated duration: </span>
          {duration}
        </span>
      )}
    </div>
  );
}

/** At-a-glance facts, all from live data: duration, pricing model and price, location. */
export function ServiceFacts({ service }: { service: ServiceView }) {
  const duration = formatDuration(service.durationMin);
  const facts = [
    duration && { label: "Duration", value: `About ${duration}` },
    { label: "Pricing", value: `${PRICING_MODEL_LABEL[service.pricingModel]} · ${priceText(service).label}` },
    { label: "Where", value: service.category === "vehicle-care" ? "Where your vehicle is parked" : "At your home" },
  ].filter(Boolean) as { label: string; value: string }[];
  return (
    <dl className="mt-5 grid gap-3 sm:grid-cols-3">
      {facts.map((f) => (
        <div key={f.label} className={cn("px-4 py-3.5", cardSurface)}>
          <dt className="text-xs text-muted">{f.label}</dt>
          <dd className="mt-0.5 text-sm font-semibold text-content">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const PRICE_FOOTNOTE =
  "The final price is calculated by our servers at checkout — taxes, any visit fee, discounts and any demand or weather adjustment are shown before you pay.";

/** "What you get": highlights and benefits the admin configured. Nothing is shown when none exist. */
export function ServiceHighlights({ highlights, benefits }: { highlights: string[]; benefits: string[] }) {
  const items = [...highlights, ...benefits];
  if (!items.length) return null;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {items.map((t, i) => (
        <li key={`${i}-${t}`} className="flex items-start gap-2 text-sm text-content">
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-emerald-500" />
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Limitations, notes and mandatory disclosures — shown verbatim, never paraphrased. */
export function ServiceNotes({
  limitations,
  notes,
  disclosures,
}: {
  limitations: string[];
  notes: string[];
  disclosures: string[];
}) {
  if (!limitations.length && !notes.length && !disclosures.length) return null;
  return (
    <div className="space-y-4 text-sm">
      {limitations.length > 0 && (
        <div>
          <h3 className="font-semibold text-content">Limitations</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
            {limitations.map((t, i) => (
              <li key={`${i}-${t}`}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <div>
          <h3 className="font-semibold text-content">Good to know</h3>
          <ul className="mt-1.5 list-disc space-y-1 pl-5 text-muted">
            {notes.map((t, i) => (
              <li key={`${i}-${t}`}>{t}</li>
            ))}
          </ul>
        </div>
      )}
      {disclosures.length > 0 && (
        <div role="note" className="rounded-xl border border-amber-300/60 bg-amber-50/60 p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <h3 className="font-semibold text-content">Please read before booking</h3>
          <ul className="mt-1.5 space-y-1 text-content">
            {disclosures.map((t, i) => (
              <li key={`${i}-${t}`}>{t}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Estimated service time, and the appointment breakdown when preparation or clean-up applies.
 * The partner's calendar reservation is internal scheduling and is deliberately not shown.
 */
export function ServiceDurationBreakdown({ duration }: { duration: ServiceDuration | null | undefined }) {
  if (!duration || duration.totalMinutes <= 0) return null;
  const est = duration.customerEstimate;
  const range =
    est.minMinutes != null && est.maxMinutes != null && est.minMinutes !== est.maxMinutes
      ? `${formatDuration(est.minMinutes)}–${formatDuration(est.maxMinutes)}`
      : null;
  const hasParts = duration.preparationMinutes > 0 || duration.cleanupMinutes > 0 || duration.addonMinutes > 0;
  return (
    <div className="text-sm">
      <p className="text-content">
        <span className="text-muted">Estimated service time: </span>
        <span className="font-semibold">{range ?? formatDuration(est.estimatedMinutes)}</span>
      </p>
      {hasParts && (
        <dl className="mt-3 max-w-xs space-y-1 tabular-nums">
          {duration.preparationMinutes > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Preparation</dt>
              <dd>{formatDuration(duration.preparationMinutes)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-muted">Service</dt>
            <dd>{formatDuration(duration.serviceMinutes)}</dd>
          </div>
          {duration.addonMinutes > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Add-ons</dt>
              <dd>{formatDuration(duration.addonMinutes)}</dd>
            </div>
          )}
          {duration.cleanupMinutes > 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">Clean-up</dt>
              <dd>{formatDuration(duration.cleanupMinutes)}</dd>
            </div>
          )}
          <div className="flex justify-between border-t border-line pt-1 font-semibold text-content">
            <dt>Total appointment</dt>
            <dd>{formatDuration(duration.totalMinutes)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
