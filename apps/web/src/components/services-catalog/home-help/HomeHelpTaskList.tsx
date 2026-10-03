"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { formatDuration, priceText, serviceHrefFor, type ServiceView } from "@/lib/catalog";
import { focusRing } from "@/components/services-catalog/primitives";
import { HomeHelpPhoto } from "@/components/services-catalog/home-help/HomeHelpPhoto";
import { homeHelpPhoto } from "@/components/services-catalog/home-help/home-help-photo";
import { cn } from "@/lib/utils";

export function HomeHelpTaskList({
  services,
  label,
  audience,
}: {
  services: ServiceView[];
  label: string;
  audience?: string;
}) {
  return (
    <ol aria-label={label} className="divide-y divide-line/70">
      {services.map((svc, i) => {
        const price = priceText(svc);
        const duration = svc.status === "live" ? formatDuration(svc.durationMin) : null;
        const live = svc.status === "live";
        const photo = homeHelpPhoto(svc);
        return (
          <li key={svc.slug}>
            <Link
              href={serviceHrefFor(svc, audience)}
              prefetch={false}
              className={cn(
                "group flex items-center gap-3 py-5 sm:gap-5 sm:py-6",
                "motion-safe:transition-colors motion-safe:duration-300",
                "hover:bg-emerald-50/40 dark:hover:bg-emerald-500/[0.04]",
                focusRing,
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "grid size-10 shrink-0 place-items-center text-xs font-semibold tabular-nums sm:size-11 sm:text-sm",
                  i % 2 === 0
                    ? "rounded-xl bg-brand text-white"
                    : "rounded-full bg-gradient-to-br from-emerald-500 to-teal-500 text-white",
                )}
              >
                {String(i + 1).padStart(2, "0")}
              </span>

              <HomeHelpPhoto
                src={photo}
                alt={svc.name}
                sizes="(max-width: 640px) 96px, 128px"
                className="size-24 shrink-0 rounded-[1.35rem] shadow-[0_16px_36px_-20px_rgb(22_51_38/0.45)] ring-1 ring-black/[0.06] sm:size-28 sm:rounded-[1.6rem]"
              />

              <div className="min-w-0 flex-1">
                <p className="font-display text-lg font-semibold leading-snug tracking-tight text-[#163326] dark:text-content sm:text-[1.35rem]">
                  {svc.name}
                </p>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-[#5c6b63] dark:text-muted sm:mt-1.5 sm:text-[0.95rem]">
                  {svc.description}
                </p>
                <p className="mt-2 text-sm font-semibold tabular-nums text-[#163326] dark:text-content sm:hidden">
                  {price.label}
                </p>
              </div>

              <div className="hidden min-w-[7.25rem] shrink-0 text-right sm:block">
                <p className="text-sm font-semibold tabular-nums text-[#163326] dark:text-content">{price.label}</p>
                {duration && <p className="mt-0.5 text-xs text-[#5c6b63] dark:text-muted">{duration}</p>}
                {!live && <p className="mt-0.5 text-xs font-medium text-[#5c6b63] dark:text-muted">Coming soon</p>}
              </div>

              <span
                aria-hidden
                className="grid size-10 shrink-0 place-items-center rounded-full bg-surface text-content ring-1 ring-line motion-safe:transition-transform motion-safe:duration-300 group-hover:rotate-12 group-hover:bg-brand group-hover:text-white group-hover:ring-brand"
              >
                <ArrowUpRight className="size-4" />
              </span>

              <span className="sr-only">
                {svc.name}. {price.spoken}. {live ? duration ?? "" : "Not bookable yet."}
              </span>
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
