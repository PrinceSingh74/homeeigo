"use client";

import { Crown } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { className?: string };

/** Diagonal ribbon for premium-only services. */
export function PremiumRibbon({ className }: Props) {
  return (
    <span
      className={cn(
        "absolute -right-8 top-3 z-20 rotate-45 bg-gradient-to-r from-amber-500 to-teal-600-600 px-10 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-md",
        className,
      )}
    >
      <Crown size={10} className="mr-1 inline" aria-hidden />
      Premium
    </span>
  );
}
