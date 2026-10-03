import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { sectionHeaderRow, sectionTitle } from "@/lib/page-layout";

type SectionHeaderProps = {
  title: ReactNode;
  /** Optional one-line lead under the heading (kept inside the heading block). */
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
  titleClassName?: string;
};

/** Consistent section heading + optional lead + optional action (See all, View All, etc.). */
export function SectionHeader({
  title,
  subtitle,
  action,
  className,
  titleClassName,
}: SectionHeaderProps) {
  const heading =
    typeof title === "string" ? (
      <div className="min-w-0">
        <span aria-hidden className="mb-3 block h-1 w-10 rounded-full bg-gradient-to-r from-emerald-500 to-teal-500" />
        <h2 className={cn(sectionTitle, titleClassName)}>{title}</h2>
        {subtitle ? (
          <p className="mt-2 max-w-xl text-sm text-muted sm:text-base">{subtitle}</p>
        ) : null}
      </div>
    ) : (
      <div className={cn("min-w-0", titleClassName)}>{title}</div>
    );

  return (
    <div className={cn(sectionHeaderRow, className)}>
      {heading}
      {action}
    </div>
  );
}
