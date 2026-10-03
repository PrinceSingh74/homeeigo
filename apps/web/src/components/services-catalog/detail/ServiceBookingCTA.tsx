"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatInr, spokenInr } from "@/lib/catalog";
import { buttonBase, buttonSizes, buttonVariants } from "@/components/buttons/Button";
import { AnimatedPrice, cardSurface } from "@/components/services-catalog/primitives";
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
export function ServiceBookingCTA({ summary, variant }: { summary: BookingSummary; variant: "card" | "bar" }) {
  if (variant === "bar") {
    return (
      <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] z-30 border-t border-line bg-surface/95 px-4 py-3 shadow-[0_-8px_24px_rgb(0_0_0/0.08)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-content items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs text-muted">{summary.optionLabel}</p>
            {summary.amount != null ? (
              <AnimatedPrice amount={summary.amount} className="font-display text-xl font-bold text-content" />
            ) : (
              <p className="text-sm font-semibold text-muted">{summary.priceNote ?? "Calculating price…"}</p>
            )}
          </div>
          <div className="w-[58%] max-w-72">
            <BookLink summary={summary} className="h-12 text-sm" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("p-6", cardSurface, "shadow-e3")}>
      <p className="text-sm text-muted">Your selection</p>
      <p className="mt-1 font-semibold text-content">{summary.optionLabel}</p>
      <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted">Service</dt>
          <dd className="tabular-nums text-content">{summary.amount != null ? formatInr(summary.amount - summary.addonTotal) : "—"}</dd>
        </div>
        {summary.addonTotal > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted">Add-ons</dt>
            <dd className="tabular-nums text-content">+{formatInr(summary.addonTotal)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-2">
          <dt className="font-semibold text-content">Estimated total before taxes</dt>
          <dd>
            {summary.amount != null ? (
              <AnimatedPrice amount={summary.amount} className="font-display text-2xl font-bold text-content" />
            ) : (
              <span className="text-sm font-semibold text-muted">{summary.priceNote ?? "Calculating price…"}</span>
            )}
          </dd>
        </div>
      </dl>
      <div className="mt-5">
        <BookLink summary={summary} />
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted">* Estimate. {PRICE_FOOTNOTE}</p>
    </div>
  );
}
