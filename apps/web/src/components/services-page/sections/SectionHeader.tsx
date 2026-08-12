"use client";

import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

type SectionHeaderProps = {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  onViewAll?: () => void;
  viewAllHref?: string;
  dark?: boolean;
  className?: string;
};

export function SectionHeader({
  icon,
  title,
  subtitle,
  onViewAll,
  viewAllHref,
  dark = false,
  className,
}: SectionHeaderProps) {
  const viewAllClass = cn(
    "inline-flex items-center gap-2 text-sm font-semibold transition-all hover:gap-3",
    dark ? "text-emerald-400 hover:text-emerald-300" : "text-emerald-700 hover:text-emerald-800",
  );

  return (
    <div className={cn("mb-10 flex items-end justify-between gap-4 sm:mb-12", className)}>
      <div className="min-w-0">
        <div className="mb-2 flex items-center gap-3">
          {icon}
          <h2
            className={cn(
              "font-display text-[clamp(1.5rem,4vw,2.25rem)] font-bold tracking-[-0.02em]",
              dark ? "text-white" : "text-gray-900",
            )}
          >
            {title}
          </h2>
        </div>
        {subtitle && (
          <p className={cn("text-sm sm:text-base", dark ? "text-gray-300" : "text-gray-500")}>
            {subtitle}
          </p>
        )}
      </div>

      {(onViewAll || viewAllHref) && (
        onViewAll ? (
          <button type="button" onClick={onViewAll} className={viewAllClass}>
            View all
            <ArrowRight className="size-5" aria-hidden />
          </button>
        ) : (
          <a href={viewAllHref} className={viewAllClass}>
            View all
            <ArrowRight className="size-5" aria-hidden />
          </a>
        )
      )}
    </div>
  );
}
