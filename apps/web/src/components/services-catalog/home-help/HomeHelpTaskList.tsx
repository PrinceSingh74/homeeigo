"use client";

import Link from "next/link";
import { Clock } from "lucide-react";
import { formatDuration, priceText, serviceHrefFor, type ServiceView } from "@/lib/catalog";
import { focusRing } from "@/components/services-catalog/primitives";
import { HomeHelpPhoto } from "@/components/services-catalog/home-help/HomeHelpPhoto";
import { homeHelpPhoto } from "@/components/services-catalog/home-help/home-help-photo";
import { cn } from "@/lib/utils";

/**
 * Home help tasks as a ruled list: photo, the task as you would ask for it, and its price.
 * Tasks that are not bookable yet have no photo and no price — only their name and status.
 */
export function HomeHelpTaskList({
  services,
  label,
  audience,
  statusStated = false,
}: {
  services: ServiceView[];
  label: string;
  audience?: string;
  /** The heading above already says these tasks are coming soon: speak the status, don't print it. */
  statusStated?: boolean;
}) {
  return (
    <ul aria-label={label} className="border-b border-line">
      {services.map((svc) => {
        const live = svc.status === "live";
        const price = priceText(svc);
        const duration = live ? formatDuration(svc.durationMin) : null;
        return (
          <li key={svc.slug} className="border-t border-line">
            <Link
              href={serviceHrefFor(svc, audience)}
              prefetch={false}
              className={cn(
                "group flex items-center gap-4 rounded-lg sm:gap-6 sm:px-2",
                live ? "py-4 sm:py-5" : "py-3.5",
                "motion-safe:transition-colors hover:bg-emerald-50/60 dark:hover:bg-emerald-500/[0.06]",
                focusRing,
              )}
            >
              {live && (
                <HomeHelpPhoto
                  src={homeHelpPhoto(svc)}
                  alt=""
                  sizes="(max-width: 640px) 80px, 112px"
                  className="size-20 shrink-0 rounded-2xl sm:h-24 sm:w-28"
                />
              )}

              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block leading-snug text-content",
                    live ? "font-display text-lg font-semibold tracking-tight sm:text-xl" : "text-base font-semibold",
                  )}
                >
                  {svc.name}
                </span>
                <span className={cn("mt-1 block max-w-xl text-sm leading-relaxed text-muted", !live && "truncate")}>
                  {svc.description}
                </span>
                {live && (
                  <span className="mt-2 flex items-baseline gap-3 sm:hidden">
                    <span className="font-display text-base font-bold tabular-nums text-content" aria-hidden>
                      {price.label}
                    </span>
                    {duration && <span className="text-xs text-muted">{duration}</span>}
                  </span>
                )}
              </span>

              {live ? (
                <span className="hidden min-w-28 shrink-0 text-right sm:block">
                  <span className="block font-display text-lg font-bold tabular-nums text-content">
                    <span aria-hidden>{price.label}</span>
                    <span className="sr-only">Price: {price.spoken}</span>
                  </span>
                  {duration && (
                    <span className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-muted">
                      <Clock className="size-3.5" aria-hidden />
                      <span className="sr-only">Duration:</span>
                      {duration}
                    </span>
                  )}
                </span>
              ) : (
                <span className={cn("shrink-0 text-xs font-medium text-muted", statusStated && "sr-only")}>Not bookable yet</span>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
