import { BadgeCheck, CreditCard, ListChecks, MapPinned, ReceiptText, Home } from "lucide-react";
import { HOW_IT_WORKS } from "@/lib/catalog";
import { cn } from "@/lib/utils";

/**
 * The booking sequence — a real sequence, so it is numbered. Steps sit on one continuous
 * rule instead of in four boxes. `compact` is the in-page variant used on service detail pages.
 */
export function HowItWorks({ compact = false, title = "How it works" }: { compact?: boolean; title?: string }) {
  return (
    <section aria-labelledby="how-heading">
      <h2
        id="how-heading"
        className={cn(
          "font-display font-bold tracking-tight text-content",
          compact ? "mb-5 text-xl sm:text-2xl" : "mb-8 max-w-xl text-2xl sm:mb-10 sm:text-3xl",
        )}
      >
        {compact ? title : "Booked in minutes. Handled with care."}
      </h2>
      <ol className={cn("grid gap-y-8", compact ? "sm:grid-cols-2 lg:grid-cols-4" : "sm:grid-cols-2 lg:grid-cols-4")}>
        {HOW_IT_WORKS.map((step) => (
          <li key={step.n} className="relative border-t border-line pr-6 pt-5">
            {/* The marker rides the rule: a filled dot per step. */}
            <span aria-hidden className="absolute -top-[5px] left-0 size-[9px] rounded-full bg-emerald-500" />
            <span
              className={cn(
                "block font-display font-bold tabular-nums leading-none text-brand",
                compact ? "text-2xl" : "text-4xl",
              )}
            >
              {step.n}
            </span>
            <p className={cn("font-display font-semibold text-content", compact ? "mt-3 text-base" : "mt-4 text-lg")}>
              {step.title}
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{step.body}</p>
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
    <section aria-labelledby="trust-heading" className="grid gap-x-16 gap-y-8 lg:grid-cols-[0.7fr_1.6fr]">
      <h2 id="trust-heading" className="font-display text-2xl font-bold tracking-tight text-content sm:text-3xl">
        Built on transparency
      </h2>
      <dl className="grid gap-x-12 border-b border-line sm:grid-cols-2">
        {TRUST.map(({ icon: Icon, title, body }) => (
          <div key={title} className="flex gap-4 border-t border-line py-5">
            <Icon className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden strokeWidth={1.75} />
            <div>
              <dt className="font-semibold text-content">{title}</dt>
              <dd className="mt-1 text-sm leading-relaxed text-muted">{body}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
