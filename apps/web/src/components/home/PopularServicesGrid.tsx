"use client";

import { ServiceTile } from "@/components/cards/ServiceTile";
import { serviceVisual } from "@/lib/service-visuals";

export type PopularServiceItem = {
  id: string;
  name: string;
  price: string;
  featured: boolean;
  /** Admin-curated artwork from the backend — wins over the curated stock photo. */
  thumbnail?: string | null;
};

/**
 * Client boundary for the home "Popular Services" wall. Receives plain
 * serialisable service data from the server component and resolves each
 * service's icon/colour on the client (component functions can't cross the
 * server→client prop boundary).
 */
export function PopularServicesGrid({ services }: { services: PopularServiceItem[] }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5"
      role="list"
      aria-label="Popular services"
    >
      {services.map((s, i) => {
        const visual = serviceVisual(s.name);
        return (
          <div role="listitem" key={s.id} className="min-w-0">
            <ServiceTile
              serviceId={s.id}
              icon={visual.icon}
              name={s.name}
              price={s.price}
              color={visual.color}
              photo={visual.photo ?? s.thumbnail ?? undefined}
              featured={s.featured}
              index={i}
            />
          </div>
        );
      })}
    </div>
  );
}
