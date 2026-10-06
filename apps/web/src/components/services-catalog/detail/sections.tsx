import type { ServiceDuration } from "@/types/backend";
import type { ReactNode } from "react";
import { CalendarClock, Check, Crown, Home, Info, MapPin, Minus, Plus, ShieldAlert, Star } from "lucide-react";
import {
  DETAILS_CONFIRMED_AT_BOOKING,
  HOW_IT_WORKS,
  PRICING_MODEL_LABEL,
  formatDuration,
  priceText,
  type Faq,
  type PolicyRow,
  type ServiceView,
} from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * One block of the editorial column. Sections are separated by a hairline and whitespace, not by
 * boxes: only things that are objects (the ticket, an option, an add-on) get a bordered surface.
 */
export function DetailSection({
  id,
  title,
  children,
  className,
  lead,
}: {
  id: string;
  title: string;
  children: ReactNode;
  className?: string;
  /** One quiet sentence under the heading. */
  lead?: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cn("scroll-mt-32 border-t border-line pt-8 sm:pt-10", className)}>
      <h2 id={id} className="font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
        {title}
      </h2>
      {lead && <p className="mt-2 max-w-2xl text-base leading-relaxed text-muted">{lead}</p>}
      <div className="mt-5 sm:mt-6">{children}</div>
    </section>
  );
}

/** Column title with a short evergreen rule — the "table header" of an open list. */
export function ColumnTitle({ id, children, hint }: { id?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="border-t-2 border-emerald-800 pt-3 dark:border-emerald-400/70">
      <h3 id={id} className="font-display text-base font-semibold text-content">
        {children}
      </h3>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </div>
  );
}

function List({ items, kind, wide = false }: { items: string[]; kind: "yes" | "no"; wide?: boolean }) {
  return (
    <ul className={cn(wide && "gap-x-12 md:grid md:grid-cols-2")}>
      {items.map((item) => (
        <li key={item} className="flex gap-3 border-b border-line py-3 text-base leading-relaxed text-content">
          <span
            aria-hidden
            className={cn(
              "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
              kind === "yes" ? "bg-emerald-700 text-white dark:bg-emerald-400 dark:text-emerald-950" : "border border-line text-muted",
            )}
          >
            {kind === "yes" ? <Check className="size-3.5" strokeWidth={3} /> : <Minus className="size-3.5" strokeWidth={2.5} />}
          </span>
          <span className={cn(kind === "no" && "text-muted")}>
            <span className="sr-only">{kind === "yes" ? "Included: " : "Not included: "}</span>
            {item}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ServiceIncludes({ items, wide }: { items: string[]; wide?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <ColumnTitle>What&apos;s included</ColumnTitle>
      <div className="mt-1">
        <List items={items} kind="yes" wide={wide} />
      </div>
    </div>
  );
}

export function ServiceExclusions({ items, wide }: { items: string[]; wide?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <ColumnTitle>What&apos;s not included</ColumnTitle>
      <div className="mt-1">
        <List items={items} kind="no" wide={wide} />
      </div>
    </div>
  );
}

function PolicyRows({ rows }: { rows: PolicyRow[] }) {
  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-3.5">
          <dt className="text-base text-muted">{r.label}</dt>
          <dd className="text-base font-semibold text-content">{r.value}</dd>
        </div>
      ))}
    </>
  );
}

/** Materials / products row — only when the backend policy says something real. */
export function ServiceMaterialPolicy({ rows }: { rows: PolicyRow[] }) {
  const own = rows.filter((r) => r.label === "Materials & products" || r.label === "Products");
  return own.length ? <PolicyRows rows={own} /> : null;
}

/** Tools/equipment and spare-parts rows. */
export function ServiceEquipmentPolicy({ rows }: { rows: PolicyRow[] }) {
  const own = rows.filter((r) => r.label === "Tools & equipment" || r.label === "Spare parts");
  return own.length ? <PolicyRows rows={own} /> : null;
}

/**
 * Materials & equipment, from the admin-configured policies. Nothing configured
 * → one honest line instead of a guess.
 */
export function ServicePolicies({ rows }: { rows: PolicyRow[] }) {
  if (!rows.length) return <ConfirmedLater />;
  return (
    <dl className="max-w-2xl divide-y divide-line border-y border-line">
      <ServiceMaterialPolicy rows={rows} />
      <ServiceEquipmentPolicy rows={rows} />
    </dl>
  );
}

export function ConfirmedLater() {
  return (
    <p className="flex max-w-2xl gap-3 text-base leading-relaxed text-muted">
      <Info className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
      <span>{DETAILS_CONFIRMED_AT_BOOKING}</span>
    </p>
  );
}

export function ServiceScope({ scope }: { scope: { includes: string[]; excludes: string[] } | null }) {
  if (!scope) return <ConfirmedLater />;
  // Only one of the two lists: let it run across the column instead of leaving half of it empty.
  const single = !scope.includes.length || !scope.excludes.length;
  return (
    <div className={cn("grid gap-x-12 gap-y-8", !single && "md:grid-cols-2")}>
      <ServiceIncludes items={scope.includes} wide={single} />
      <ServiceExclusions items={scope.excludes} wide={single} />
    </div>
  );
}

/** The one calm mint band on the page. Used for everything safety-related. */
export function MintBand({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "rounded-3xl bg-emerald-50 px-5 py-6 text-base leading-relaxed text-content sm:px-8 sm:py-8",
        "dark:bg-emerald-500/10",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ServiceSafety({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <MintBand>
      <ul className="space-y-3">
        {items.map((i) => (
          <li key={i} className="flex gap-3">
            <ShieldAlert className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
            {i}
          </li>
        ))}
      </ul>
    </MintBand>
  );
}

/** What is checked about the professional before they can be given this job. Backend sentences, verbatim. */
export function ServiceProfessional({ statements }: { statements: { code: string; text: string }[] }) {
  if (!statements.length) return null;
  return (
    <ul className="divide-y divide-line border-y border-line">
      {statements.map((s) => (
        <li key={s.code} className="flex gap-3 py-3.5 text-base leading-relaxed text-content">
          <Check className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
          {s.text}
        </li>
      ))}
    </ul>
  );
}

/** Things to do beforehand. Not a strict order, so no numbers — a hairline list. */
export function ServiceRequirements({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="grid gap-x-12 sm:grid-cols-2">
      {items.map((item) => (
        <li key={item} className="flex gap-3 border-b border-line py-3 text-base leading-relaxed text-content">
          <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-emerald-700 dark:bg-emerald-400" />
          {item}
        </li>
      ))}
    </ul>
  );
}

/** Native details/summary: keyboard and screen-reader accessible with no JS. */
export function ServiceFAQ({ faqs }: { faqs: Faq[] }) {
  if (!faqs.length) return null;
  return (
    <div className="divide-y divide-line border-b border-line">
      {faqs.map((f) => (
        <details key={f.q} className="group [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-6 rounded-lg py-4 font-display text-base font-semibold text-content outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-brand/60 sm:text-lg">
            {f.q}
            <span
              aria-hidden
              className="grid size-8 shrink-0 place-items-center rounded-full border border-line text-content motion-safe:transition-transform motion-safe:duration-200 group-open:rotate-45 group-open:border-emerald-700 group-open:text-brand dark:group-open:border-emerald-400"
            >
              <Plus className="size-4" />
            </span>
          </summary>
          <p className="max-w-2xl pb-6 text-base leading-relaxed text-muted">{f.a}</p>
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
    <ul className="max-w-2xl space-y-4 text-base leading-relaxed text-content">
      <li className="flex gap-3">
        <CalendarClock className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
        <span>Pick your date and time slot in the next step — slots depend on professionals available near you.</span>
      </li>
      {/* Price, pricing model and time are the hero's; where the visit happens is said once, here. */}
      <li className="flex gap-3">
        <Home className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
        <span>
          <span className="sr-only">Where: </span>
          {service.category === "vehicle-care" ? "Where your vehicle is parked" : "At your home"}.
        </span>
      </li>
      {cities.length > 0 && (
        <li className="flex gap-3">
          <MapPin className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
          <span>Available in {cities.join(", ")}.</span>
        </li>
      )}
      {service.premiumOnly && (
        <li className="flex gap-3">
          <Crown className="mt-1 size-5 shrink-0 text-brand" aria-hidden />
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

/**
 * The hero's headline numbers: price and duration as large display numerals, the pricing model as
 * a plain word under the price. Every value is the catalogue's; nothing is computed here.
 */
export function ServicePricing({ service }: { service: ServiceView }) {
  const price = priceText(service);
  const duration = formatDuration(service.durationMin);
  // "Pricing at launch" / "Custom quote" are sentences, not numerals — set them a step smaller.
  const numeric = /\d/.test(price.label);
  return (
    <div className="flex flex-wrap items-start gap-x-10 gap-y-5">
      <div>
        <p
          className={cn(
            "font-display font-bold tabular-nums tracking-tight text-content",
            numeric ? "text-4xl sm:text-5xl" : "text-2xl sm:text-3xl",
          )}
        >
          <span aria-hidden>{price.label}</span>
          <span className="sr-only">Price: {price.spoken}</span>
        </p>
        <p className="mt-1.5 text-sm text-muted">{PRICING_MODEL_LABEL[service.pricingModel]}</p>
      </div>
      {duration && (
        <div className="border-l border-line pl-10">
          <p className="font-display text-4xl font-bold tabular-nums tracking-tight text-content sm:text-5xl">
            <span className="sr-only">Estimated duration: </span>
            {duration}
          </p>
          <p className="mt-1.5 text-sm text-muted" aria-hidden>
            Estimated time
          </p>
        </div>
      )}
    </div>
  );
}

/** The real rating, only when the API returned one. */
export function ServiceRating({ rating, live }: { rating: { value: number; count: number } | null; live: boolean }) {
  if (!rating) return live ? <span className="text-sm text-muted">No reviews yet</span> : null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-content">
      <Star className="size-4 fill-gold text-gold" aria-hidden />
      <span className="font-semibold tabular-nums" aria-hidden>
        {rating.value.toFixed(1)}
      </span>
      <span className="text-muted" aria-hidden>
        ({rating.count} {rating.count === 1 ? "review" : "reviews"})
      </span>
      <span className="sr-only">
        Rated {rating.value.toFixed(1)} out of 5 from {rating.count} {rating.count === 1 ? "review" : "reviews"}
      </span>
    </span>
  );
}

export const PRICE_FOOTNOTE =
  "The final price is calculated by our servers at checkout — taxes, any visit fee, discounts and any demand or weather adjustment are shown before you pay.";

/** "What you get": highlights and benefits the admin configured. Nothing is shown when none exist. */
export function ServiceHighlights({ highlights, benefits }: { highlights: string[]; benefits: string[] }) {
  const items = [...highlights, ...benefits];
  if (!items.length) return null;
  return (
    <ul className="grid gap-x-12 sm:grid-cols-2">
      {items.map((t, i) => (
        <li key={`${i}-${t}`} className="flex items-start gap-3 border-b border-line py-3 text-base leading-relaxed text-content">
          <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-emerald-700 dark:bg-emerald-400" />
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
    <div className="space-y-6 text-base leading-relaxed">
      {(limitations.length > 0 || notes.length > 0) && (
        <div className="grid gap-x-12 gap-y-6 md:grid-cols-2">
          {limitations.length > 0 && (
            <div>
              <h3 className="font-semibold text-content">Limitations</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted marker:text-emerald-700 dark:marker:text-emerald-400">
                {limitations.map((t, i) => (
                  <li key={`${i}-${t}`}>{t}</li>
                ))}
              </ul>
            </div>
          )}
          {notes.length > 0 && (
            <div>
              <h3 className="font-semibold text-content">Good to know</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-muted marker:text-emerald-700 dark:marker:text-emerald-400">
                {notes.map((t, i) => (
                  <li key={`${i}-${t}`}>{t}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {disclosures.length > 0 && (
        <div role="note" className="border-l-2 border-amber-500 pl-4 sm:pl-5">
          <h3 className="font-semibold text-content">Please read before booking</h3>
          <ul className="mt-2 space-y-1.5 text-content">
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
/**
 * Whether the duration block says anything the hero has not: a min–max range, a breakdown
 * (preparation / add-ons / clean-up), or an estimate that differs from the one already printed.
 */
export function durationAddsDetail(duration: ServiceDuration | null | undefined, alreadyShown?: string | null): boolean {
  if (!duration || duration.totalMinutes <= 0) return false;
  const est = duration.customerEstimate;
  const ranged = est.minMinutes != null && est.maxMinutes != null && est.minMinutes !== est.maxMinutes;
  const hasParts = duration.preparationMinutes > 0 || duration.cleanupMinutes > 0 || duration.addonMinutes > 0;
  return ranged || hasParts || !alreadyShown || formatDuration(est.estimatedMinutes) !== alreadyShown;
}

export function ServiceDurationBreakdown({
  duration,
  alreadyShown,
}: {
  duration: ServiceDuration | null | undefined;
  /** A duration already printed in the hero; the single-line estimate is skipped when it would only repeat it. */
  alreadyShown?: string | null;
}) {
  if (!duration || !durationAddsDetail(duration, alreadyShown)) return null;
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
        <span className="font-semibold tabular-nums">{range ?? formatDuration(est.estimatedMinutes)}</span>
      </p>
      {hasParts && (
        <dl className="mt-3 max-w-xs space-y-1.5 tabular-nums">
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
          <div className="flex justify-between border-t border-line pt-1.5 font-semibold text-content">
            <dt>Total appointment</dt>
            <dd>{formatDuration(duration.totalMinutes)}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}

/**
 * The four booking steps, set small. On a page that already shows the visit as a timeline this is
 * a footnote-sized reminder, not a second timeline — same content, a quieter register.
 */
export function BookingSteps({ title }: { title: string }) {
  return (
    <section aria-labelledby="how-heading" className="scroll-mt-32 border-t border-line pt-8 sm:pt-10">
      <h2 id="how-heading" className="font-display text-lg font-semibold tracking-tight text-content">
        {title}
      </h2>
      <ol className="mt-4 grid gap-x-8 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.n} className="flex gap-3 text-sm leading-relaxed">
            <span aria-hidden className="font-display font-bold tabular-nums text-brand">
              {i + 1}.
            </span>
            <span>
              <span className="font-semibold text-content">{step.title}</span>
              <span className="block text-muted">{step.body}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
