"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = { planRequired?: string | null; className?: string };

/** Compact tag showing plan requirement from entitlements. */
export function PremiumOnlyTag({ planRequired, className }: Props) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-700",
        className,
      )}
    >
      <Lock size={10} aria-hidden />
      {planRequired ? `${planRequired} required` : "Premium only"}
    </span>
  );
}
