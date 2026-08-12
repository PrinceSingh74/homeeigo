"use client";

import { useEffect, useState } from "react";
import { m as motion, useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import { Star } from "lucide-react";
import { PageSection } from "@/components/layout/PageSection";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { ServiceImage } from "@/components/ui/ServiceImage";
import { RECOMMENDED } from "@/lib/services";
import { useFeaturedServicesQuery, useProvidersQuery } from "@/hooks/use-core-data";
import { bookUrl } from "@/lib/booking-url";
import { sectionAction } from "@/lib/page-layout";

type RecommendedItem = {
  title: string;
  price: string;
  rating: string;
  serviceId: string;
  packageIndex: number;
  img: string;
};

const STATIC_RECOMMENDED: RecommendedItem[] = RECOMMENDED.length
  ? RECOMMENDED.map((r) => ({ ...r }))
  : [
      {
        title: "Service",
        price: "₹0",
        rating: "4.8",
        serviceId: "service-unavailable",
        packageIndex: 0,
        img: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?w=600&q=75",
      },
    ];

export function RecommendedSection() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const { data, isLoading } = useFeaturedServicesQuery();
  const firstServiceId = data?.services?.[0]?.id ?? STATIC_RECOMMENDED[0]!.serviceId;
  const { data: providersData } = useProvidersQuery(mounted ? firstServiceId : "");

  useEffect(() => setMounted(true), []);

  const apiRecommended: RecommendedItem[] =
    data?.services?.slice(0, 4).map((s, i) => ({
      title: s.name,
      price: `₹${s.basePrice ?? s.minPrice ?? 0}`,
      rating: s.rating != null ? String(s.rating) : "New",
      serviceId: s.id,
      packageIndex: 1,
      img:
        providersData?.providers?.[i]?.profileImage ??
        s.thumbnail ??
        s.icon ??
        STATIC_RECOMMENDED[i % STATIC_RECOMMENDED.length]!.img,
    })) ?? STATIC_RECOMMENDED;

  const items = !mounted || isLoading ? STATIC_RECOMMENDED : apiRecommended;

  return (
    <PageSection>
      <SectionHeader
        title="Recommended for You"
        action={
          <button
            type="button"
            onClick={() => router.push(bookUrl())}
            className={sectionAction}
          >
            See all
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-4">
        {items.map((it, i) => (
          <motion.button
            type="button"
            key={`${it.serviceId}-${i}`}
            onClick={() =>
              router.push(
                bookUrl({
                  service: it.serviceId,
                  package: it.packageIndex,
                }),
              )
            }
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.45, delay: i * 0.08 }}
            whileHover={reduce ? undefined : { y: -10 }}
            className="group relative overflow-hidden rounded-[28px] glass-card text-left outline-none transition-shadow duration-300 hover:shadow-[0_28px_64px_-12px_rgb(15_23_42/0.3)] focus-visible:ring-2 focus-visible:ring-primary/60"
          >
            <div className="relative h-56 w-full overflow-hidden sm:h-64 lg:h-72">
              <ServiceImage
                src={it.img}
                alt={it.title}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                objectFit="cover"
                className="transition-transform duration-700 group-hover:scale-110"
              />
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-t from-ink/30 via-transparent to-transparent"
              />
            </div>
            <div className="p-4 sm:p-6">
              <p className="truncate font-display text-base font-semibold text-content sm:text-lg">
                {it.title}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="font-display text-xl font-bold text-primary sm:text-2xl">
                  {it.price}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm font-medium text-muted sm:text-base">
                  {it.rating === "New" ? (
                    "New"
                  ) : (
                    <>
                      <Star size={16} className="fill-warning text-warning" />
                      {it.rating}
                    </>
                  )}
                </span>
              </div>
            </div>
          </motion.button>
        ))}
      </div>
    </PageSection>
  );
}
