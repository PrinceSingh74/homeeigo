"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { ChevronRight, MapPin } from "lucide-react";
import { ServicesSectionHeader } from "@/components/services-page/ServicesSectionHeader";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  SERVICES_IMAGE_QUALITY,
  servicesSection,
  svcCatCard,
  svcCatCardSize,
  svcCatScroll,
  svcSplitAside,
  svcSplitMain,
} from "@/components/services-page/services-page-layout";
import {
  LIVE_TRACKING_MAP_IMAGE,
  SERVICE_CATEGORIES,
} from "@/lib/services-page-data";
import { bookUrl } from "@/lib/booking-url";
import { cn } from "@/lib/utils";

export function ServicesCategoriesSection() {
  const nav = useServicesNavigation();

  return (
    <section className={servicesSection()}>
      <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,350px)] lg:items-start lg:gap-10">
        <div className={svcSplitMain}>
          <ServicesSectionHeader
            title="Browse by Categories"
            subtitle="Explore curated services with verified professionals near you."
            onViewAll={nav.openCategories}
            linkLabel="View All Categories"
            linkLabelShort="View All"
          />
          <div className={svcCatScroll}>
            {SERVICE_CATEGORIES.map((cat, i) => {
              const Icon = cat.icon;
              return (
                <motion.div
                  key={cat.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06, duration: 0.4 }}
                  className="snap-start"
                >
                  <Link
                    href={bookUrl({ service: cat.serviceId })}
                    className={cn(
                      svcCatCard,
                      svcCatCardSize,
                      "group relative items-center justify-center gap-2.5 overflow-hidden border border-[#E5E7EB] p-4 text-center sm:gap-3 sm:p-5",
                      "hover:border-[#2563EB] dark:border-line",
                    )}
                  >
                    <Image
                      src={cat.image}
                      alt=""
                      fill
                      quality={SERVICES_IMAGE_QUALITY}
                      sizes="(max-width: 640px) 42vw, 148px"
                      className="svc-cat-card-bg object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-white via-white/85 to-white/40 dark:from-slate-900 dark:via-slate-900/90 dark:to-slate-900/50" />
                    <span
                      className="relative z-10 grid size-12 place-items-center rounded-xl shadow-md ring-2 ring-white/80 transition-transform duration-200 group-hover:scale-110 sm:size-14 sm:rounded-2xl dark:ring-slate-800/80"
                      style={{ backgroundColor: cat.iconBg }}
                    >
                      <Icon
                        size={24}
                        className="sm:hidden"
                        style={{ color: cat.iconColor }}
                        aria-hidden
                      />
                      <Icon
                        size={28}
                        className="hidden sm:block"
                        style={{ color: cat.iconColor }}
                        aria-hidden
                      />
                    </span>
                    <div className="relative z-10 min-w-0">
                      <p className="truncate font-display text-xs font-bold tracking-[-0.02em] text-[#0F172A] dark:text-content sm:text-sm">
                        {cat.name}
                      </p>
                      <p className="mt-0.5 text-[10px] text-[#64748B] dark:text-muted sm:text-[11px]">
                        {cat.count} Services
                      </p>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>

        <motion.aside
          initial={{ opacity: 0, x: 30 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className={cn(
            svcSplitAside,
            "svc-live-card w-full rounded-2xl bg-darkviolet p-5 text-white sm:rounded-[18px] sm:p-6",
          )}
        >
          <h3 className="font-display text-sm font-bold sm:text-base">
            Live Tracking Preview
          </h3>
          <button
            type="button"
            onClick={nav.openHowItWorks}
            className="mt-1.5 text-[11px] text-white/85 underline-offset-2 hover:underline sm:text-xs"
          >
            See how it works
          </button>

          <div className="relative mt-4 h-[160px] overflow-hidden rounded-xl sm:mt-5 sm:h-[200px]">
            <Image
              src={LIVE_TRACKING_MAP_IMAGE}
              alt=""
              fill
              quality={SERVICES_IMAGE_QUALITY}
              sizes="(max-width: 1024px) 100vw, 350px"
              className="object-cover opacity-40"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-slate-900/70 to-indigo-950/80" />
            <svg
              className="absolute inset-0 h-full w-full opacity-60"
              viewBox="0 0 320 200"
              preserveAspectRatio="none"
              aria-hidden
            >
              <path
                d="M40 160 Q120 80 200 100 T280 60"
                fill="none"
                stroke="url(#services-route)"
                strokeWidth="3"
                strokeDasharray="8 6"
              />
              <defs>
                <linearGradient
                  id="services-route"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stopColor="#34D399" />
                  <stop offset="100%" stopColor="#60A5FA" />
                </linearGradient>
              </defs>
            </svg>
            <span className="absolute bottom-12 left-8 size-3 rounded-full bg-emerald-400 shadow-[0_0_12px_#34D399]" />
            <span className="absolute right-10 top-14 size-3 rounded-full bg-sky-400 shadow-[0_0_12px_#60A5FA]" />
            <motion.div
              className="absolute left-[45%] top-[42%] flex size-9 items-center justify-center rounded-full border-2 border-white bg-violet-600 shadow-lg sm:size-10"
              animate={{ x: [0, 24, 8, 0], y: [0, -12, 6, 0] }}
              transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
            >
              <MapPin size={16} className="text-white sm:hidden" aria-hidden />
              <MapPin size={18} className="hidden text-white sm:block" aria-hidden />
            </motion.div>
          </div>

          <p className="mt-3 font-display text-lg font-bold sm:mt-4 sm:text-xl">
            Expert arriving in
          </p>
          <p
            className="font-display font-bold leading-none tracking-[-0.02em]"
            style={{ fontSize: "clamp(1.75rem, 6vw, 2rem)" }}
          >
            12 mins
          </p>

          <button
            type="button"
            onClick={nav.openBookingsWithTracking}
            className="mt-3 flex h-11 w-full items-center justify-center gap-1 rounded-[10px] bg-[#7C3AED] text-sm font-semibold text-white transition hover:scale-[1.02] active:scale-[0.96] sm:mt-4"
          >
            Track My Booking
            <ChevronRight size={14} aria-hidden />
          </button>
        </motion.aside>
      </div>
    </section>
  );
}
