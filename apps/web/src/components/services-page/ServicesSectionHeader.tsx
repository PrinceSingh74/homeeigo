"use client";

import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";
import { svcSectionTitle } from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  subtitle?: string;
  href?: string;
  onViewAll?: () => void;
  linkLabel?: string;
  icon?: LucideIcon;
  className?: string;
  linkLabelShort?: string;
};

export function ServicesSectionHeader({
  title,
  subtitle,
  href = "/book",
  onViewAll,
  linkLabel = "View All",
  linkLabelShort,
  icon: Icon,
  className,
}: Props) {
  const actionClass =
    "inline-flex shrink-0 items-center gap-2 self-start rounded-full border border-primary/25 bg-primary/5 px-5 py-2.5 text-sm font-semibold text-primary transition-all hover:border-primary/50 hover:bg-primary/10 hover:shadow-md sm:self-auto";
  return (
    <div className={cn("mb-6 sm:mb-8 lg:mb-10", className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <p className="svc-section-label mb-1.5 sm:mb-2">Discover</p>
          <div className="flex items-start gap-2.5 sm:gap-3">
            {Icon ? (
              <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 via-primary/10 to-cyan-500/10 text-violet-600 shadow-sm ring-1 ring-violet-500/20 sm:mt-1 sm:size-11 sm:rounded-2xl dark:text-violet-400">
                <Icon size={20} className="sm:hidden" aria-hidden />
                <Icon size={22} className="hidden sm:block" aria-hidden />
              </span>
            ) : null}
            <div className="min-w-0">
              <h2 className={svcSectionTitle}>{title}</h2>
              {subtitle ? (
                <p className="mt-1.5 max-w-xl text-xs leading-relaxed text-muted sm:mt-2 sm:text-sm">
                  {subtitle}
                </p>
              ) : null}
              <div className="svc-title-accent mt-4" aria-hidden />
            </div>
          </div>
        </div>
        {onViewAll ? (
          <button type="button" onClick={onViewAll} className={actionClass}>
            <span className="sm:hidden">{linkLabelShort ?? linkLabel}</span>
            <span className="hidden sm:inline">{linkLabel}</span>
            <ArrowRight size={16} aria-hidden />
          </button>
        ) : (
          <Link href={href} className={actionClass}>
            <span className="sm:hidden">{linkLabelShort ?? linkLabel}</span>
            <span className="hidden sm:inline">{linkLabel}</span>
            <ArrowRight size={16} aria-hidden />
          </Link>
        )}
      </div>
    </div>
  );
}
