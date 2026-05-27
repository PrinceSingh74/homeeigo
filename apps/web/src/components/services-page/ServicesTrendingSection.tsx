"use client";

import Image from "next/image";
import Link from "next/link";
import { motion } from "framer-motion";
import { BadgeCheck, Clock, Crown, Star } from "lucide-react";
import { ServicesSectionHeader } from "@/components/services-page/ServicesSectionHeader";
import {
  SERVICES_IMAGE_QUALITY,
  servicesSection,
  svcSplitAside,
  svcTrendCard,
} from "@/components/services-page/services-page-layout";
import { TRENDING_SERVICES } from "@/lib/services-page-data";
import { bookUrl } from "@/lib/booking-url";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { cn } from "@/lib/utils";

function PremiumAside({ onUpgrade }: { onUpgrade: () => void }) {
  return (
    <aside
      className={cn(
        svcSplitAside,
        "depth-3d relative flex flex-col gap-4 overflow-hidden rounded-2xl bg-premium p-5 text-white ring-2 ring-white/20 sm:p-6 lg:top-[120px]",
      )}
    >
      <div
        className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-white/20 blur-2xl"
        aria-hidden
      />
      <div className="flex items-center gap-3">
        <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gold shadow-lg sm:size-14">
          <Crown size={24} className="text-amber-900 sm:hidden" aria-hidden />
          <Crown size={28} className="hidden text-amber-900 sm:block" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-white/80 sm:text-xs">
            HOMIGO
          </p>
          <p className="font-display text-lg font-bold sm:text-xl">Premium</p>
        </div>
      </div>
      <ul className="space-y-2 text-sm text-white/95">
        {[
          "Priority Booking",
          "Elite Experts",
          "Free Revisits",
          "AI Optimization",
        ].map((label) => (
          <li key={label} className="flex items-center gap-2">
            <span className="size-1.5 shrink-0 rounded-full bg-white/90" />
            {label}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onUpgrade}
        className="mt-1 w-full rounded-xl bg-white py-3 text-sm font-semibold text-violet-700 shadow-lg transition hover:-translate-y-0.5 active:scale-[0.98] sm:mt-2"
      >
        Upgrade Now
      </button>
    </aside>
  );
}

export function ServicesTrendingSection() {
  const nav = useServicesNavigation();

  return (
    <section className={servicesSection()}>
      <ServicesSectionHeader
        title="Trending Services"
        subtitle="Most booked this week — premium quality, transparent pricing."
        onViewAll={nav.openTrending}
        linkLabel="View All"
      />

      <div className="grid gap-6 sm:gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(240px,280px)] lg:items-start">
        <div className="order-2 grid min-w-0 grid-cols-1 gap-4 min-[480px]:grid-cols-2 sm:gap-5 md:grid-cols-2 lg:order-1 xl:grid-cols-3 2xl:grid-cols-4">
          {TRENDING_SERVICES.map((svc, i) => (
            <motion.div
              key={svc.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="min-w-0"
            >
              <Link
                href={bookUrl({ service: svc.serviceId })}
                className={cn(
                  svcTrendCard,
                  "group flex min-w-0 flex-col overflow-hidden border border-[#E5E7EB] bg-white dark:border-line dark:bg-surface",
                )}
              >
                <div className="svc-trend-media relative h-[160px] w-full overflow-hidden bg-[#F3F4F6] sm:h-[180px] md:h-[200px] dark:bg-slate-800">
                  <Image
                    src={svc.image}
                    alt={svc.title}
                    fill
                    quality={SERVICES_IMAGE_QUALITY}
                    sizes="(max-width: 640px) 100vw, (max-width: 1024px) 45vw, 280px"
                    className="object-cover"
                  />
                  <span className="svc-trend-shine" aria-hidden />
                  {i === 0 ? (
                    <span className="absolute left-3 top-3 z-10 rounded-md bg-gradient-to-r from-rose-500 to-orange-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-lg">
                      Trending
                    </span>
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-80" />
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3.5 sm:gap-2.5 sm:p-4">
                  <h3 className="line-clamp-2 font-display text-sm font-bold leading-snug text-[#0F172A] dark:text-content">
                    {svc.title}
                  </h3>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#64748B] dark:text-muted">
                    <Image
                      src={svc.providerAvatar}
                      alt=""
                      width={24}
                      height={24}
                      sizes="24px"
                      className="size-6 shrink-0 rounded-full object-cover ring-1 ring-line"
                    />
                    <span className="max-w-[8rem] truncate font-medium text-content/80 sm:max-w-none">
                      {svc.provider}
                    </span>
                    <span className="hidden sm:inline" aria-hidden>
                      •
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <Star
                        size={12}
                        className="fill-[#F59E0B] text-[#F59E0B]"
                        aria-hidden
                      />
                      {svc.rating} ({svc.reviews})
                    </span>
                  </p>
                  <div className="flex flex-wrap gap-2 text-[11px] text-[#9CA3AF]">
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} aria-hidden />
                      {svc.duration}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <BadgeCheck size={12} aria-hidden />
                      {svc.type}
                    </span>
                  </div>
                  <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
                    <p className="font-mono text-base font-bold tabular-nums tracking-[-0.02em] text-[#0F172A] dark:text-content sm:text-lg">
                      ₹{svc.price.toLocaleString("en-IN")}
                    </p>
                    <span className="inline-flex h-9 shrink-0 items-center rounded-lg border-[1.5px] border-[#2563EB] px-3 text-xs font-semibold text-[#2563EB] transition group-hover:bg-[#EFF6FF]">
                      Book Now
                    </span>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>

        <div className="order-1 min-w-0 lg:order-2">
          <PremiumAside onUpgrade={nav.openPremium} />
        </div>
      </div>
    </section>
  );
}
