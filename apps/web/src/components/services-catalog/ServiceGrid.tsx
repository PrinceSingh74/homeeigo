"use client";

import { useEffect, useState } from "react";
import { serviceHrefFor, type ServiceView } from "@/lib/catalog";
import { ServiceCard } from "@/components/services-catalog/ServiceCard";
import { Button } from "@/components/buttons/Button";
import { cn } from "@/lib/utils";

const PAGE = 12;

/**
 * Responsive service grid with controlled rendering: a page of cards at a time
 * so a catalogue of hundreds never floods the DOM. Resets when the list changes.
 */
export function ServiceGrid({
  services,
  cardContext,
  priorityCount = 0,
  className,
  label,
  linkAudience,
}: {
  /** On an audience page, cards open the service with that audience preselected. */
  linkAudience?: string;
  services: ServiceView[];
  cardContext?: (s: ServiceView) => string | undefined;
  priorityCount?: number;
  className?: string;
  label?: string;
}) {
  const [visible, setVisible] = useState(PAGE);
  const signature = services.map((s) => s.slug).join("|");
  useEffect(() => setVisible(PAGE), [signature]);

  const shown = services.slice(0, visible);
  const remaining = services.length - shown.length;

  return (
    <div className={className}>
      <ul
        aria-label={label}
        className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4"
      >
        {shown.map((svc, i) => (
          <li key={svc.slug} className="min-w-0">
            <ServiceCard
              service={svc}
              context={cardContext?.(svc)}
              priority={i < priorityCount}
              href={serviceHrefFor(svc, linkAudience)}
            />
          </li>
        ))}
      </ul>
      {remaining > 0 && (
        <div className="mt-8 flex justify-center">
          <Button variant="secondary" size="lg" onClick={() => setVisible((v) => v + PAGE)}>
            Show {Math.min(PAGE, remaining)} more
            <span className="sr-only"> of {remaining} remaining services</span>
          </Button>
        </div>
      )}
    </div>
  );
}

/** Horizontal swipe rail on mobile, grid from `sm` up. */
export function ServiceRail({
  services,
  label,
  className,
}: {
  services: ServiceView[];
  label: string;
  className?: string;
}) {
  return (
    <ul
      aria-label={label}
      className={cn(
        "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 scrollbar-none",
        "sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-4 sm:gap-5",
        className,
      )}
    >
      {services.map((svc) => (
        <li key={svc.slug} className="w-[78vw] max-w-[300px] shrink-0 snap-start sm:w-auto sm:max-w-none">
          <ServiceCard service={svc} />
        </li>
      ))}
    </ul>
  );
}
