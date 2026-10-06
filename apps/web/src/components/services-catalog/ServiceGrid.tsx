"use client";

import { useEffect, useState } from "react";
import { serviceHrefFor, type ServiceView } from "@/lib/catalog";
import { ServiceCard, ServiceSoonList } from "@/components/services-catalog/ServiceCard";
import { Button } from "@/components/buttons/Button";
import { cn } from "@/lib/utils";

const PAGE = 12;

const isLive = (s: ServiceView) => s.status === "live";

/**
 * Responsive service grid with controlled rendering: a page of services at a time
 * so a catalogue of hundreds never floods the DOM. Resets when the list changes.
 * Bookable services are cards; services that are not bookable yet follow as a quiet list.
 */
export function ServiceGrid({
  services,
  cardContext,
  priorityCount = 0,
  className,
  label,
  linkAudience,
  statusStated = false,
}: {
  /** On an audience page, cards open the service with that audience preselected. */
  linkAudience?: string;
  services: ServiceView[];
  cardContext?: (s: ServiceView) => string | undefined;
  priorityCount?: number;
  className?: string;
  label?: string;
  /** The section heading already says these services are coming soon. */
  statusStated?: boolean;
}) {
  const [visible, setVisible] = useState(PAGE);
  const signature = services.map((s) => s.slug).join("|");
  useEffect(() => setVisible(PAGE), [signature]);

  const shown = services.slice(0, visible);
  const remaining = services.length - shown.length;
  const live = shown.filter(isLive);
  const soon = shown.filter((s) => !isLive(s));

  return (
    <div className={className}>
      {live.length > 0 && (
        <ul
          aria-label={label}
          className="grid grid-cols-1 gap-4 min-[460px]:grid-cols-2 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4"
        >
          {live.map((svc, i) => (
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
      )}
      <ServiceSoonList
        services={soon}
        label={live.length > 0 || !label ? "Not bookable yet" : label}
        linkAudience={linkAudience}
        columns={3}
        className={live.length > 0 ? "mt-8" : undefined}
        // Mixed with cards above, every row needs its own status; alone under a heading
        // that already says "coming soon", the status is for screen readers only.
        statusStated={live.length === 0 && statusStated}
      />
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

/**
 * Bookable services as a horizontal swipe rail on mobile and a grid from `sm` up;
 * anything not bookable yet follows as a compact list.
 */
export function ServiceRail({
  services,
  label,
  className,
  priorityCount = 0,
  columns = 4,
  statusStated = false,
}: {
  services: ServiceView[];
  label: string;
  className?: string;
  priorityCount?: number;
  /** Columns at `lg` — 1 or 2 when the rail sits in a fraction of the page width. */
  columns?: 1 | 2 | 4;
  /** The section heading already says these services are coming soon. */
  statusStated?: boolean;
}) {
  const live = services.filter(isLive);
  const soon = services.filter((s) => !isLive(s));
  return (
    <div className={className}>
      {live.length > 0 && (
        <ul
          aria-label={label}
          className={cn(
            "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 scrollbar-none",
            "sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0",
            columns === 4 && "lg:grid-cols-4",
            columns === 1 && "lg:grid-cols-1",
          )}
        >
          {live.map((svc, i) => (
            <li key={svc.slug} className="w-[78vw] max-w-[300px] shrink-0 snap-start sm:w-auto sm:max-w-none">
              <ServiceCard service={svc} priority={i < priorityCount} />
            </li>
          ))}
        </ul>
      )}
      <ServiceSoonList
        services={soon}
        label={live.length > 0 ? `${label}, not bookable yet` : label}
        columns={3}
        className={live.length > 0 ? "mt-6" : undefined}
        statusStated={live.length === 0 && statusStated}
      />
    </div>
  );
}

/**
 * Feature layout for the lead rail: one large card beside a 2×2 of regular cards.
 * Falls back to the plain rail when there are too few bookable services to fill it.
 */
export function ServiceFeature({ services, label }: { services: ServiceView[]; label: string }) {
  const live = services.filter(isLive);
  const soon = services.filter((s) => !isLive(s));
  if (live.length < 3) return <ServiceRail services={services} label={label} />;
  // Photo cards lead the feature; a bookable service without a photo follows as a text card.
  const hasMedia = (s: ServiceView) => Boolean(s.image || s.video);
  const [lead, ...rest] = [...live.filter(hasMedia), ...live.filter((s) => !hasMedia(s))];
  const railItem = "w-[78vw] max-w-[300px] shrink-0 snap-start sm:w-auto sm:max-w-none min-w-0";
  return (
    <div>
      {/* One flat list: a swipe rail on mobile, a 2-column grid on tablets, and from `lg`
          the lead card takes the left half (2×2 cells) beside four regular cards. */}
      <ul
        aria-label={label}
        className={cn(
          "-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2 scrollbar-none",
          "sm:mx-0 sm:grid sm:snap-none sm:grid-cols-2 sm:gap-5 sm:overflow-visible sm:px-0 sm:pb-0",
          "lg:grid-cols-4 lg:grid-rows-2",
        )}
      >
        <li className={cn(railItem, "lg:col-span-2 lg:row-span-2")}>
          <ServiceCard service={lead!} feature />
        </li>
        {rest.slice(0, 4).map((svc) => (
          <li key={svc.slug} className={railItem}>
            <ServiceCard service={svc} />
          </li>
        ))}
      </ul>
      <ServiceSoonList services={soon} label={`${label}, not bookable yet`} columns={3} className="mt-6" />
    </div>
  );
}
