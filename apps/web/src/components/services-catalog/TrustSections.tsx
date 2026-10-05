import { BadgeCheck, CreditCard, ListChecks, MapPinned, ReceiptText, Home } from "lucide-react";
import { HOW_IT_WORKS } from "@/lib/catalog";
import { SectionHeading, cardSurface } from "@/components/services-catalog/primitives";
import { cn } from "@/lib/utils";

/** `compact` is the in-page variant used on service detail pages. */
export function HowItWorks({ compact = false, title = "How it works" }: { compact?: boolean; title?: string }) {
  return (
    <section aria-labelledby="how-heading">
      {compact ? (
        <h2 id="how-heading" className="mb-4 font-display text-xl font-bold tracking-tight text-content sm:text-2xl">
          {title}
        </h2>
      ) : (
        <SectionHeading id="how-heading" kicker="How HOMEEIGO works" title="Booked in minutes. Handled with care." />
      )}
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {HOW_IT_WORKS.map((step, i) => (
          <li key={step.n} className={cn("relative p-5 sm:p-6", cardSurface)}>
            <span className="font-display text-sm font-bold tabular-nums text-brand">{step.n}</span>
            <p className="mt-3 font-display text-lg font-semibold text-content">{step.title}</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
            {i < HOW_IT_WORKS.length - 1 && (
              <span aria-hidden className="absolute -right-3 top-1/2 hidden h-px w-6 bg-line lg:block" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * Trust & transparency — product capabilities only (no counts, ratings or
 * guarantees we cannot back with data).
 */
const TRUST = [
  { icon: BadgeCheck, title: "Verified professionals", body: "Every partner is reviewed and approved by our team before they can receive jobs." },
  { icon: ReceiptText, title: "Transparent pricing", body: "See the price before you book. Taxes, fees and discounts are itemised at checkout." },
  { icon: ListChecks, title: "Know what's included", body: "Bookable services spell out what's included and what isn't, before you pay." },
  { icon: Home, title: "At your doorstep", body: "Your professional comes to you, in the time slot you choose." },
  { icon: MapPinned, title: "Live tracking", body: "Follow your professional's arrival on the map and start with a secure PIN." },
  { icon: CreditCard, title: "Secure payments", body: "Pay online through a secure payment gateway, or from your HOMEEIGO wallet." },
] as const;

export function TrustSection() {
  return (
    <section aria-labelledby="trust-heading">
      <SectionHeading id="trust-heading" kicker="Trust & safety" title="Built on transparency" />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TRUST.map(({ icon: Icon, title, body }) => (
          <li key={title} className={cn("flex gap-4 p-5", cardSurface)}>
            <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
              <Icon className="size-5" aria-hidden strokeWidth={1.75} />
            </span>
            <span>
              <span className="block font-semibold text-content">{title}</span>
              <span className="mt-1 block text-sm leading-relaxed text-muted">{body}</span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
