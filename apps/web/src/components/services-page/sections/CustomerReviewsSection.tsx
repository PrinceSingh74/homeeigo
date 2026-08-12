"use client";

import { memo, useState } from "react";
import Image from "next/image";
import { BadgeCheck, Star } from "lucide-react";
import { ConversionSectionHeader } from "@/components/services-page/sections/ConversionSectionHeader";
import { useSectionVisibility } from "@/hooks/use-section-visibility";
import { REVIEW_TRUST_STATS } from "@/lib/services-marketplace-data";
import { CUSTOMER_REVIEWS, type CustomerReview } from "@/lib/services-page-data";
import {
  SERVICES_IMAGE_QUALITY,
  servicesSection,
  svcConversionCard,
  svcConversionSectionPad,
  svcConversionTrustBar,
} from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

type ReviewCardProps = {
  review: CustomerReview;
};

const ReviewCard = memo(function ReviewCard({ review }: ReviewCardProps) {
  return (
    <article className={cn(svcConversionCard, "flex h-full w-[min(90vw,380px)] shrink-0 flex-col gap-5 p-6 sm:w-[400px] sm:p-7")}>
      <div className="flex gap-4">
        <Image
          src={review.avatar}
          alt=""
          width={112}
          height={112}
          quality={SERVICES_IMAGE_QUALITY}
          className="size-14 shrink-0 rounded-full border-[3px] border-emerald-100 object-cover shadow-[0_4px_16px_-4px_rgb(15_23_42/0.15)] sm:size-16"
        />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="font-display text-base font-bold text-[#0F172A] sm:text-[17px]">
            {review.name}
          </p>
          <p className="mt-0.5 text-sm font-medium text-gray-500">{review.location}</p>
          {review.serviceUsed && (
            <p className="mt-1.5 inline-flex rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 ring-1 ring-emerald-100">
              {review.serviceUsed}
            </p>
          )}
          <div className="mt-2.5 flex gap-1" role="img" aria-label={`${review.rating} stars`}>
            {Array.from({ length: review.rating }).map((_, i) => (
              <Star key={i} className="size-4 fill-amber-400 text-amber-400" aria-hidden />
            ))}
          </div>
        </div>
      </div>

      <p className="flex-1 text-[15px] leading-[1.75] text-gray-700 sm:text-base sm:leading-[1.8]">
        &ldquo;{review.review}&rdquo;
      </p>

      {review.verified !== false && (
        <div className="flex items-center gap-2 border-t border-gray-100 pt-4 text-[13px] font-bold uppercase tracking-wide text-emerald-700">
          <BadgeCheck className="size-4 shrink-0" aria-hidden />
          Verified Customer
        </div>
      )}
    </article>
  );
});

export const CustomerReviewsSection = memo(function CustomerReviewsSection() {
  const { ref, visible } = useSectionVisibility("240px 0px");
  const [paused, setPaused] = useState(false);
  const loopReviews = [...CUSTOMER_REVIEWS, ...CUSTOMER_REVIEWS];

  return (
    <section
      ref={ref}
      className={servicesSection(
        cn(
          svcConversionSectionPad,
          "relative overflow-hidden bg-gradient-to-b from-white via-emerald-50/40 to-white",
        ),
      )}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <ConversionSectionHeader
        eyebrow="Social Proof"
        title="Loved by Thousands of Indian Homes"
        subtitle="Real experiences from customers across India."
      />

      <div className="svc-review-marquee-wrap relative -mx-[var(--svc-page-pad)] overflow-hidden py-2">
        {visible ? (
          <div
            className={cn(
              "svc-review-marquee flex w-max items-stretch gap-5 px-[var(--svc-page-pad)] sm:gap-6",
              paused && "svc-review-marquee-paused",
            )}
            aria-live="off"
          >
            {loopReviews.map((review, i) => (
              <ReviewCard key={`${review.id}-${i}`} review={review} />
            ))}
          </div>
        ) : (
          <div className="flex gap-5 overflow-hidden px-[var(--svc-page-pad)] sm:gap-6">
            {CUSTOMER_REVIEWS.slice(0, 3).map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        )}
      </div>

      <div className={cn(svcConversionTrustBar, "mt-14 sm:mt-16 lg:mt-20")}>
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4 sm:gap-6">
          {REVIEW_TRUST_STATS.map((stat) => (
            <div key={stat.label} className="svc-conversion-stat-divider px-2 text-center">
              <p className="svc-num font-display text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-none tracking-[-0.03em] text-[#1B5E4F]">
                {stat.value}
              </p>
              <p className="mt-2.5 text-sm font-semibold text-gray-600 sm:text-[15px]">
                {stat.label}
              </p>
            </div>
          ))}
          <div className="svc-conversion-stat-divider flex flex-col items-center justify-center px-2 text-center">
            <span className="flex size-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80 sm:size-14">
              <BadgeCheck className="size-6 sm:size-7" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-bold text-emerald-800 sm:text-[15px]">
              Verified Reviews Only
            </p>
          </div>
        </div>
      </div>
    </section>
  );
});
