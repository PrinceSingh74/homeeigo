"use client";

import { memo } from "react";
import Link from "next/link";
import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { Clock, ShieldCheck, Star } from "lucide-react";
import { ConversionSectionHeader } from "@/components/services-page/sections/ConversionSectionHeader";
import {
  PRICING_TRUST_STRIP,
  TRANSPARENT_PRICING_SERVICES,
  type MarketplaceService,
} from "@/lib/services-marketplace-data";
import { bookUrl } from "@/lib/booking-url";
import {
  SERVICES_IMAGE_QUALITY,
  servicesSection,
  svcConversionCard,
  svcConversionSectionPad,
  svcConversionTrustBar,
} from "@/components/services-page/services-page-layout";
import { cn } from "@/lib/utils";

type PricingCardProps = {
  service: MarketplaceService;
  index: number;
  reduceMotion: boolean | null;
};

const PricingCard = memo(function PricingCard({
  service,
  index,
  reduceMotion,
}: PricingCardProps) {
  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ delay: index * 0.06, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      whileHover={reduceMotion ? undefined : { y: -8 }}
      className="group h-full shrink-0 snap-center lg:shrink"
    >
      <Link href={bookUrl({ service: service.serviceId })} className={cn(svcConversionCard, "block h-full")}>
        <div className="relative h-44 overflow-hidden bg-gray-100 sm:h-48">
          <Image
            src={service.image}
            alt={service.name}
            fill
            quality={SERVICES_IMAGE_QUALITY}
            sizes="(max-width: 640px) 85vw, (max-width: 1024px) 45vw, 300px"
            className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/5 to-transparent" />
          {service.badge && (
            <span className="absolute top-4 right-4 rounded-full bg-[#1B5E4F] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-white shadow-lg">
              {service.badge}
            </span>
          )}
        </div>

        <div className="space-y-4 p-5 sm:p-6">
          <h3 className="font-display text-lg font-bold leading-snug text-[#0F172A] sm:text-xl">
            {service.name}
          </h3>

          <p className="svc-num text-[1.625rem] font-bold leading-none tracking-[-0.03em] text-[#1B5E4F] sm:text-[1.875rem]">
            {service.price}
          </p>

          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-3 text-[15px]">
            <span className="flex items-center gap-2 font-medium text-gray-700">
              <Clock className="size-4 shrink-0 text-emerald-600" aria-hidden />
              {service.duration}
            </span>
            <span className="flex items-center gap-1.5">
              <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
              <span className="svc-num font-bold text-[#0F172A]">{service.rating}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 border-t border-gray-100 pt-4 text-[13px] font-bold uppercase tracking-wide text-emerald-700">
            <ShieldCheck className="size-4 shrink-0" aria-hidden />
            No Hidden Charges
          </div>
        </div>
      </Link>
    </motion.div>
  );
});

export const TransparentPricingSection = memo(function TransparentPricingSection() {
  const reduceMotion = useReducedMotion();

  return (
    <section
      className={servicesSection(
        cn(
          svcConversionSectionPad,
          "relative overflow-hidden border-y border-emerald-100/60 bg-gradient-to-b from-emerald-50/70 via-white to-white",
        ),
      )}
    >
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 90% 55% at 50% -10%, rgb(16 185 129 / 0.12), transparent 68%)",
        }}
      />

      <div className="relative z-10">
        <ConversionSectionHeader
          eyebrow="Upfront Pricing"
          title="Transparent Pricing."
          titleAccent="No Surprises."
          subtitle="Know exactly what you pay before booking."
          subtitleSecondary="No hidden charges. No last-minute surprises."
        />

        <div
          className={cn(
            "flex gap-5 overflow-x-auto pb-4 scrollbar-none snap-x snap-mandatory sm:gap-6 sm:pb-5",
            "lg:grid lg:grid-cols-4 lg:gap-7 lg:overflow-visible lg:pb-0",
          )}
          style={{ scrollPaddingInline: "var(--svc-page-pad)" }}
        >
          {TRANSPARENT_PRICING_SERVICES.map((service, i) => (
            <div key={service.id} className="w-[min(82vw,300px)] lg:w-auto">
              <PricingCard service={service} index={i} reduceMotion={reduceMotion} />
            </div>
          ))}
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className={cn(svcConversionTrustBar, "mt-14 sm:mt-16 lg:mt-20")}
        >
          <div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-x-10 sm:gap-y-4">
            {PRICING_TRUST_STRIP.map(({ label, icon: Icon }) => (
              <span
                key={label}
                className="inline-flex items-center gap-3 text-[13px] font-bold text-emerald-900 sm:text-[15px]"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200/80">
                  <Icon className="size-4" aria-hidden />
                </span>
                {label}
              </span>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  );
});
