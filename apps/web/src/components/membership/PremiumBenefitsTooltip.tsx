"use client";

import { useEntitlements } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

type Props = {
  premiumOnly?: boolean;
  className?: string;
};

/** Hover/focus tooltip listing benefits unlocked with membership. */
export function PremiumBenefitsTooltip({ premiumOnly, className }: Props) {
  const { data: entitlements } = useEntitlements();
  if (!premiumOnly) return null;

  const benefits = [
    entitlements?.discountPct ? `${entitlements.discountPct}% booking discount` : null,
    entitlements?.cashbackPct ? `${entitlements.cashbackPct}% cashback` : null,
    entitlements?.priorityBooking ? "Priority booking queue" : null,
    entitlements?.freeDelivery ? "Free platform visit fee" : null,
    "Premium-only services access",
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "rounded-xl border border-emerald-500/20 bg-white/95 p-3 text-xs text-content shadow-e2 dark:bg-slate-900/95",
        className,
      )}
      role="tooltip"
    >
      <p className="mb-1 font-semibold text-emerald-700">Unlock with membership</p>
      <ul className="list-inside list-disc space-y-0.5 text-muted">
        {benefits.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
    </div>
  );
}
