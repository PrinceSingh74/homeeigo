"use client";

import Image from "next/image";
import { motion } from "framer-motion";
import { Star } from "lucide-react";
import { ServicesSectionHeader } from "@/components/services-page/ServicesSectionHeader";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  SERVICES_IMAGE_QUALITY,
  servicesSection,
  svcCardPremium,
} from "@/components/services-page/services-page-layout";
import { CUSTOMER_REVIEWS } from "@/lib/services-page-data";
import { cn } from "@/lib/utils";

export function ServicesReviewsSection() {
  const nav = useServicesNavigation();

  return (
    <section className={servicesSection()}>
      <ServicesSectionHeader
        title="What Our Customers Say"
        subtitle="Real reviews from homeowners across Gurugram and NCR."
        onViewAll={nav.openReviews}
        linkLabel="View All Reviews"
        linkLabelShort="All Reviews"
      />

      <div
        className={cn(
          "flex gap-4 overflow-x-auto pb-3 scrollbar-none snap-x snap-mandatory sm:gap-5 sm:pb-4",
          "lg:grid lg:grid-cols-3 lg:gap-6 lg:overflow-visible lg:pb-0",
        )}
        style={{ scrollPaddingInline: "var(--svc-page-pad)" }}
      >
        {CUSTOMER_REVIEWS.map((review, i) => (
          <motion.button
            key={review.id}
            type="button"
            onClick={nav.openReviews}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.1, duration: 0.4 }}
            className={cn(
              svcCardPremium,
              "flex w-[min(88vw,320px)] shrink-0 snap-center flex-col gap-3 border border-[#E5E7EB] bg-white p-4 text-left transition hover:border-primary/40 sm:w-[min(80vw,340px)] sm:gap-4 sm:p-5 lg:w-auto lg:shrink dark:border-line dark:bg-surface",
            )}
          >
            <div className="flex gap-3">
              <Image
                src={review.avatar}
                alt=""
                width={96}
                height={96}
                quality={SERVICES_IMAGE_QUALITY}
                className="size-11 shrink-0 rounded-full border-2 border-[#E5E7EB] object-cover shadow-[0_2px_8px_rgb(0_0_0/0.08)] sm:size-12"
              />
              <div className="min-w-0">
                <p className="truncate font-display text-[13px] font-bold text-[#0F172A] dark:text-content">
                  {review.name}
                </p>
                <p className="truncate text-[11px] text-[#64748B] dark:text-muted">
                  {review.location}
                </p>
                <div
                  className="mt-1 flex gap-0.5"
                  aria-label={`${review.rating} stars`}
                >
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Star
                      key={j}
                      size={12}
                      className="fill-[#F59E0B] text-[#F59E0B]"
                      aria-hidden
                    />
                  ))}
                </div>
              </div>
            </div>
            <p className="line-clamp-4 text-[13px] leading-[1.6] tracking-[0.02em] text-[#0F172A] dark:text-content sm:line-clamp-none">
              {review.review}
            </p>
            <span className="text-xs font-semibold text-primary">Read more →</span>
          </motion.button>
        ))}
      </div>
    </section>
  );
}
