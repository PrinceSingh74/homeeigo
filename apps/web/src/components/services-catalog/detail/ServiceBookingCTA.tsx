"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { ArrowRight } from "lucide-react";
import { formatInr, spokenInr } from "@/lib/catalog";
import { trackFunnelEvent } from "@/lib/analytics/funnel";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/buttons/Button";
import { AnimatedPrice } from "@/components/services-catalog/primitives";
import { PRICE_FOOTNOTE } from "@/components/services-catalog/detail/sections";
import { cn } from "@/lib/utils";

export type BookingSummary = {
  serviceName: string;
  optionLabel: string;
  /** Server-resolved subtotal before tax; null while pricing or when the selection cannot be priced. */
  amount: number | null;
  addonTotal: number;
  /** Shown instead of an amount (e.g. "Pricing unavailable for this configuration"). */
  priceNote?: string;
  /** null → the current selection cannot be booked online. */
  href: string | null;
  /** Why booking is blocked (e.g. "Choose who this is for"). */
  blockedReason?: string;
  /** Phase 15.2 — what the booking_started event attributes: the backend service and the version on screen. */
  funnel?: { serviceId?: string; variantId?: string; addonCount: number };
};

function BookLink({ summary, className }: { summary: BookingSummary; className?: string }) {
  const cls = cn(buttonBase, buttonVariants.primary, buttonSizes.xl, "group w-full motion-safe:active:scale-[0.98]", className);
  if (!summary.href || summary.amount == null) {
    return (
      <span className={cn(cls, "cursor-not-allowed opacity-50")} aria-disabled="true">
        {summary.blockedReason ?? "Not bookable online yet"}
      </span>
    );
  }
  return (
    <Link
      href={summary.href}
      className={cls}
      aria-label={`Book ${summary.serviceName}, ${summary.optionLabel}, for ${spokenInr(summary.amount)} before taxes`}
      onClick={() => {
        // The customer is entering the booking flow: the click, not the page load, is the event.
        // Identity is (session, service) — no version — so the /book page, which has no version
        // yet, reaches the same id and the server keeps one row. The server stamps the version.
        if (summary.funnel?.serviceId) {
          trackFunnelEvent("BOOKING_STARTED", {
            serviceId: summary.funnel.serviceId,
            metadata: { entry: "service-detail-cta", hasVariant: Boolean(summary.funnel.variantId), addonCount: summary.funnel.addonCount },
          });
        }
      }}
    >
      Book Now — {formatInr(summary.amount)}*
      <ArrowRight className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

/**
 * Sticky booking CTA. `card` sits in the desktop sidebar; `bar` is fixed above
 * the mobile bottom navigation. Both always reflect the current selection.
 */
export function ServiceBookingCTA({ summary, variant }: { summary: BookingSummary; variant: "card" | "bar" | "stub" }) {
  if (variant === "bar") {
    return (
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_rgb(6_78_59/0.10)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-content items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">{selectionLines(summary).join(", ") || summary.serviceName}</p>
            {summary.amount != null ? (
              <AnimatedPrice amount={summary.amount} className="font-display text-2xl font-bold leading-tight tracking-tight text-content" />
            ) : (
              <p className="text-sm font-semibold text-muted">{summary.priceNote ?? "Calculating price…"}</p>
            )}
          </div>
          <div className="w-[58%] max-w-72">
            <BookLink summary={summary} className="h-12 px-4 text-sm" />
          </div>
        </div>
      </div>
    );
  }

  // `stub` is the same ticket without the button: on small screens it sits in the page so the
  // breakdown and the estimate small print are readable, while the fixed bar carries the CTA.
  const stub = variant === "stub";
  const lines = selectionLines(summary);

  return (
    <div
      className={cn(
        "[filter:drop-shadow(0_0_1px_rgb(15_23_42/0.25))_drop-shadow(0_14px_28px_rgb(6_78_59/0.14))]",
        "dark:[filter:drop-shadow(0_0_1px_rgb(110_231_183/0.45))]",
      )}
    >
      {/* Upper half: what you chose. Its lower corners are bitten out to form the perforation. */}
      <div className="overflow-hidden rounded-t-2xl bg-surface" style={notch("bottom")}>
        <div className="bg-emerald-900 px-6 py-5 text-white dark:bg-emerald-950">
          <p className="text-sm text-emerald-100">{stub ? "Your booking so far" : "You're booking"}</p>
          <p className="mt-0.5 font-display text-xl font-bold leading-snug tracking-tight">{summary.serviceName}</p>
        </div>
        <div className="px-6 pb-6 pt-5">
          {lines.length > 0 && (
            <ul className="mb-4 space-y-1 font-semibold text-content" aria-label="Your selection">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Service</dt>
              <dd className="tabular-nums text-content">{summary.amount != null ? formatInr(summary.amount - summary.addonTotal) : "—"}</dd>
            </div>
            {summary.addonTotal > 0 && (
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Add-ons</dt>
                <dd className="tabular-nums text-content">+{formatInr(summary.addonTotal)}</dd>
              </div>
            )}
          </dl>
        </div>
      </div>

      {/* Lower half: what you pay. The dashed rule is the tear line between the two notches. */}
      <div className="rounded-b-2xl bg-surface px-6 pb-6" style={notch("top")}>
        <div aria-hidden className="mx-2 border-t-2 border-dashed border-line" />
        <div className="pt-5">
          <p className="text-sm text-muted">Estimated total before taxes</p>
          {summary.amount != null ? (
            stub ? (
              <p className="mt-1 font-display text-4xl font-bold tabular-nums tracking-tight text-content">
                <span aria-hidden>{formatInr(summary.amount)}</span>
                <span className="sr-only">{spokenInr(summary.amount)}</span>
              </p>
            ) : (
              <AnimatedPrice amount={summary.amount} className="mt-1 font-display text-5xl font-bold tracking-tight text-content" />
            )
          ) : (
            <p className="mt-2 text-base font-semibold text-muted">{summary.priceNote ?? "Calculating price…"}</p>
          )}
        </div>
        {!stub && (
          <div className="mt-5">
            <BookLink summary={summary} />
          </div>
        )}
        <p className="mt-4 text-xs leading-relaxed text-muted">
          {stub ? "" : "* "}Estimate. {PRICE_FOOTNOTE}
        </p>
      </div>
    </div>
  );
}

const NOTCH = "0.75rem";

/**
 * Bites a quarter circle out of two corners. Two halves stacked — one bitten at the bottom, one at
 * the top — give the semicircular notches of a perforated ticket, whatever is behind the card.
 */
function notch(edge: "top" | "bottom"): CSSProperties {
  const y = edge === "top" ? "0" : "100%";
  const hole = (x: string) => `radial-gradient(circle ${NOTCH} at ${x} ${y}, transparent calc(${NOTCH} - 0.5px), #000 ${NOTCH})`;
  const image = `${hole("0")}, ${hole("100%")}`;
  return { maskImage: image, WebkitMaskImage: image, maskComposite: "intersect", WebkitMaskComposite: "source-in" };
}

/** The selection as separate lines (the label joins its parts with a middle dot for the bar). */
function selectionLines(summary: BookingSummary): string[] {
  return summary.optionLabel
    .split(" · ")
    .map((s) => s.trim())
    .filter((s) => s && s !== summary.serviceName);
}
