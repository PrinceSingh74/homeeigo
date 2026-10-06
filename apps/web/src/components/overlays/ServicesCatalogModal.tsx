"use client";

import Image from "next/image";
import { ArrowRight, Star } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { SERVICES_IMAGE_QUALITY } from "@/components/services-page/services-page-layout";
import { useFeaturedServicesQuery, useServicesQuery } from "@/hooks/use-core-data";
import { useServicesDiscovery } from "@/hooks/use-services-discovery";
import type { BackendService } from "@/types/backend";

type CatalogMode = "services-categories" | "services-trending" | "services-ai" | "services-reviews";

// Titles say what each list IS. "Trending" is the catalogue's featured flag, not a booking count;
// the "AI" list is the same featured services, not a personalised model output.
const META: Record<
  CatalogMode,
  { title: string; description: string }
> = {
  "services-categories": {
    title: "All services",
    description: "Pick a service to see its options and book.",
  },
  "services-trending": {
    title: "Featured services",
    description: "Services our team currently features — tap any to continue.",
  },
  "services-ai": {
    title: "Suggested services",
    description: "From our featured services.",
  },
  "services-reviews": {
    title: "Customer reviews",
    description: "Reviews from customers are shown on each service's page.",
  },
};

/** The API's price, or null — never "₹0" for a service the server gave no price. */
function priceOf(svc: BackendService): string | null {
  const price = svc.basePrice ?? svc.minPrice;
  return price != null && price > 0 ? `₹${price.toLocaleString("en-IN")}` : null;
}

/** Shown when the server has nothing for a list; nothing built-in stands in for it. */
function EmptyNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">{children}</p>;
}

export function ServicesCatalogModal({
  open,
  mode,
}: {
  open: boolean;
  mode: CatalogMode | null;
}) {
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const { book } = useServicesNavigation();
  const servicesQuery = useServicesQuery();
  const featuredQuery = useFeaturedServicesQuery();
  const { aiRecommendations } = useServicesDiscovery();

  if (!mode) return null;

  const meta = META[mode];
  const liveServices = servicesQuery.data?.services ?? [];
  const liveFeatured = featuredQuery.data?.services ?? [];

  return (
    <Modal open={open} onClose={closeOverlay} title={meta.title} size="lg">
      <p className="mb-4 text-sm text-muted">{meta.description}</p>

      <div className="max-h-[min(60vh,520px)] space-y-2 overflow-y-auto pr-1">
        {mode === "services-categories" && (
          servicesQuery.isLoading ? (
            <p className="text-sm text-muted">Loading services…</p>
          ) : liveServices.length > 0 ? (
            liveServices.map((svc) => {
              const price = priceOf(svc);
              return (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => book({ service: svc.id })}
                  className="flex w-full items-center gap-4 rounded-xl border border-line p-3 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                    {svc.thumbnail || svc.icon ? (
                      <Image
                        src={svc.thumbnail ?? svc.icon!}
                        alt=""
                        width={32}
                        height={32}
                        quality={SERVICES_IMAGE_QUALITY}
                        className="size-8 object-contain"
                      />
                    ) : (
                      <span className="text-base font-bold">{svc.name.slice(0, 2).toUpperCase()}</span>
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-content">{svc.name}</span>
                    {price ? <span className="text-xs text-muted">From {price}</span> : null}
                  </span>
                  <span className="text-sm font-semibold text-primary">Book</span>
                </button>
              );
            })
          ) : (
            <EmptyNote>
              {servicesQuery.isError ? "Services could not be loaded right now." : "No services are available right now."}
            </EmptyNote>
          )
        )}

        {mode === "services-trending" && (
          featuredQuery.isLoading ? (
            <p className="text-sm text-muted">Loading featured services…</p>
          ) : liveFeatured.length > 0 ? (
            liveFeatured.map((svc) => {
              const price = priceOf(svc);
              const rated = svc.rating != null && svc.rating > 0 && (svc.reviewCount ?? 0) > 0;
              return (
                <button
                  key={svc.id}
                  type="button"
                  onClick={() => book({ service: svc.id })}
                  className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-primary/10">
                    {svc.thumbnail ? (
                      <Image
                        src={svc.thumbnail}
                        alt=""
                        fill
                        quality={SERVICES_IMAGE_QUALITY}
                        className="object-cover"
                        sizes="64px"
                      />
                    ) : null}
                  </div>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-content">{svc.name}</span>
                    {rated || price ? (
                      <span className="flex items-center gap-1 text-xs text-muted">
                        {rated ? (
                          <>
                            <Star size={12} className="fill-amber-400 text-amber-400" />
                            {svc.rating!.toFixed(1)}
                            {price ? " · " : ""}
                          </>
                        ) : null}
                        {price}
                      </span>
                    ) : null}
                  </span>
                  <ArrowRight size={18} className="shrink-0 text-primary" />
                </button>
              );
            })
          ) : (
            <EmptyNote>
              {featuredQuery.isError ? "Featured services could not be loaded right now." : "No services are featured right now."}
            </EmptyNote>
          )
        )}

        {mode === "services-ai" &&
          (aiRecommendations.length > 0 ? (
            aiRecommendations.map((rec) => {
              const Icon = rec.icon;
              return (
                <button
                  key={rec.id}
                  type="button"
                  onClick={() => book({ service: rec.serviceId })}
                  className="flex w-full items-start gap-3 rounded-xl border border-line p-4 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-aurora text-white">
                    <Icon size={20} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="font-semibold text-content">{rec.title}</span>
                      {rec.badge ? (
                        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                          {rec.badge}
                        </span>
                      ) : null}
                    </span>
                    {rec.description ? <span className="mt-1 block text-xs text-muted">{rec.description}</span> : null}
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyNote>No suggestions right now.</EmptyNote>
          ))}

        {/* No review list here: reviews are per service and come from the server on the service
            page. The curated five-star testimonials and the fixed promo button that used to fill
            this mode were not customer data. */}
        {mode === "services-reviews" && (
          <button
            type="button"
            onClick={() => book()}
            className="w-full rounded-xl border border-primary py-3 text-sm font-semibold text-primary transition hover:bg-primary/5"
          >
            Browse services
          </button>
        )}
      </div>
    </Modal>
  );
}
