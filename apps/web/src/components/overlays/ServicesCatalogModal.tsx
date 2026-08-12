"use client";

import Image from "next/image";
import { ArrowRight, Star } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { useAppStore } from "@/stores/app-store";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  AI_RECOMMENDATIONS,
  CUSTOMER_REVIEWS,
  SERVICE_CATEGORIES,
  TRENDING_SERVICES,
} from "@/lib/services-page-data";
import { SERVICES_IMAGE_QUALITY } from "@/components/services-page/services-page-layout";
import { useFeaturedServicesQuery, useServicesQuery } from "@/hooks/use-core-data";
import { useServicesDiscovery } from "@/hooks/use-services-discovery";

type CatalogMode = "services-categories" | "services-trending" | "services-ai" | "services-reviews";

const META: Record<
  CatalogMode,
  { title: string; description: string }
> = {
  "services-categories": {
    title: "All categories",
    description: "Pick a category to browse services and book instantly.",
  },
  "services-trending": {
    title: "Trending services",
    description: "Most booked this week — tap any service to continue.",
  },
  "services-ai": {
    title: "AI recommendations",
    description: "Personalized for your home — powered by HOMEEIGO AI.",
  },
  "services-reviews": {
    title: "Customer reviews",
    description: "What homeowners say about HOMEEIGO.",
  },
};

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
  // Live AI recommendations from the catalog; static showcase if the API is empty.
  const aiRecs = aiRecommendations.length > 0 ? aiRecommendations : AI_RECOMMENDATIONS;

  return (
    <Modal open={open} onClose={closeOverlay} title={meta.title} size="lg">
      <p className="mb-4 text-sm text-muted">{meta.description}</p>

      <div className="max-h-[min(60vh,520px)] space-y-2 overflow-y-auto pr-1">
        {mode === "services-categories" && (
          servicesQuery.isLoading ? (
            <p className="text-sm text-muted">Loading categories…</p>
          ) : liveServices.length > 0 ? (
            liveServices.map((svc) => (
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
                  <span className="text-xs text-muted">
                    From ₹{(svc.basePrice ?? svc.minPrice ?? 0).toLocaleString("en-IN")} ·{" "}
                    {svc.bookingCount ?? 0} bookings
                  </span>
                </span>
                <span className="text-sm font-semibold text-primary">Book</span>
              </button>
            ))
          ) : (
            SERVICE_CATEGORIES.map((cat) => {
              const Icon = cat.icon;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => book({ service: cat.serviceId })}
                  className="flex w-full items-center gap-4 rounded-xl border border-line p-3 text-left transition hover:border-primary hover:bg-primary/5"
                >
                  <span
                    className="grid size-12 shrink-0 place-items-center rounded-xl"
                    style={{ backgroundColor: cat.iconBg }}
                  >
                    <Icon size={22} style={{ color: cat.iconColor }} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold text-content">{cat.name}</span>
                    <span className="text-xs text-muted">{cat.count} services</span>
                  </span>
                  <span className="text-sm font-semibold text-primary">Book</span>
                </button>
              );
            })
          )
        )}

        {mode === "services-trending" && (
          featuredQuery.isLoading ? (
            <p className="text-sm text-muted">Loading trending services…</p>
          ) : liveFeatured.length > 0 ? (
            liveFeatured.map((svc) => (
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
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Star size={12} className="fill-amber-400 text-amber-400" />
                    {(svc.rating ?? 4.8).toFixed(1)} · ₹
                    {(svc.basePrice ?? svc.minPrice ?? 0).toLocaleString("en-IN")}
                  </span>
                </span>
                <ArrowRight size={18} className="shrink-0 text-primary" />
              </button>
            ))
          ) : (
            TRENDING_SERVICES.map((svc) => (
              <button
                key={svc.id}
                type="button"
                onClick={() => book({ service: svc.serviceId })}
                className="flex w-full items-center gap-3 rounded-xl border border-line p-3 text-left transition hover:border-primary hover:bg-primary/5"
              >
                <div className="relative size-16 shrink-0 overflow-hidden rounded-lg">
                  <Image
                    src={svc.image}
                    alt=""
                    fill
                    quality={SERVICES_IMAGE_QUALITY}
                    className="object-cover"
                    sizes="64px"
                  />
                </div>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-content">{svc.title}</span>
                  <span className="flex items-center gap-1 text-xs text-muted">
                    <Star size={12} className="fill-amber-400 text-amber-400" />
                    {svc.rating} · ₹{svc.price.toLocaleString("en-IN")}
                  </span>
                </span>
                <ArrowRight size={18} className="shrink-0 text-primary" />
              </button>
            ))
          )
        )}

        {mode === "services-ai" &&
          aiRecs.map((rec) => {
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
                    <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                      {rec.badge}
                    </span>
                  </span>
                  <span className="mt-1 block text-xs text-muted">{rec.description}</span>
                </span>
              </button>
            );
          })}

        {mode === "services-reviews" &&
          CUSTOMER_REVIEWS.map((review) => (
            <div
              key={review.id}
              className="rounded-xl border border-line p-4"
            >
              <div className="flex gap-3">
                <Image
                  src={review.avatar}
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 rounded-full object-cover"
                />
                <div>
                  <p className="text-sm font-semibold text-content">{review.name}</p>
                  <p className="text-xs text-muted">{review.location}</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-content">{review.review}</p>
              <button
                type="button"
                onClick={() => book({ service: "deep-cleaning" })}
                className="mt-3 text-xs font-semibold text-primary hover:underline"
              >
                Book a similar service →
              </button>
            </div>
          ))}
      </div>

      {mode === "services-reviews" && (
        <button
          type="button"
          onClick={() => book({ service: "deep-cleaning", promo: "HOME150" })}
          className="mt-4 w-full rounded-xl border border-primary py-3 text-sm font-semibold text-primary transition hover:bg-primary/5"
        >
          Book with ₹150 off
        </button>
      )}
    </Modal>
  );
}
