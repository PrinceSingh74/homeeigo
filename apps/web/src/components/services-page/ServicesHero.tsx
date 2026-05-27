"use client";

import { motion } from "framer-motion";
import { Award, Check, CheckCircle } from "lucide-react";
import { ServiceSearchInput } from "@/components/ServiceSearchInput";
import { ServicesHouse3D } from "@/components/services-page/ServicesHouse3D";
import {
  servicesHeroOuter,
  svcHeroInner,
  svcHeroTitle,
} from "@/components/services-page/services-page-layout";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import {
  HERO_TRUST_BADGES,
  POPULAR_SEARCHES,
} from "@/lib/services-page-data";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.1 * i, duration: 0.55, ease: [0.22, 1, 0.36, 1] },
  }),
};

export function ServicesHero() {
  const nav = useServicesNavigation();

  const onBadge = (label: string) => {
    switch (label) {
      case "Verified Experts":
        nav.openProfile();
        break;
      case "Background Checked":
        nav.openHowItWorks();
        break;
      case "Secure Payments":
        nav.openWallet();
        break;
      case "On-time Service":
        nav.openBookingsWithTracking();
        break;
      default:
        nav.openHowItWorks();
    }
  };

  return (
    <section
      className={cn(
        servicesHeroOuter,
        "svc-hero-shell relative overflow-hidden ring-1 ring-white/60 dark:ring-white/10",
      )}
    >
      <div className="svc-hero-grid" aria-hidden />
      <div className="svc-hero-beam" aria-hidden />

      <div className={svcHeroInner}>
        <div className="relative grid min-w-0 items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-12 xl:gap-[60px]">
          <div className="z-10 flex min-w-0 max-w-[550px] flex-col gap-4 sm:gap-5 lg:gap-6">
            <motion.button
              type="button"
              custom={0}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              onClick={() => nav.openPremium()}
              className="svc-badge-glass inline-flex w-fit max-w-full items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-semibold tracking-wide text-primary transition hover:scale-[1.02] sm:px-4 sm:py-2 sm:text-xs"
            >
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-primary/15">
                <Check size={12} aria-hidden />
              </span>
              <span className="truncate">100+ Premium Services</span>
              <span className="hidden shrink-0 rounded-full bg-violet-600/10 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-300 sm:inline">
                AI-POWERED
              </span>
            </motion.button>

            <motion.h1
              custom={1}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              className={svcHeroTitle}
            >
              Premium Home Services,{" "}
              <span className="relative inline-block">
                <span className="bg-gradient-to-r from-[#7C3AED] via-[#A855F7] to-[#EC4899] bg-clip-text text-transparent">
                  Simplified.
                </span>
              </span>
            </motion.h1>

            <motion.p
              custom={2}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              className="max-w-md text-sm leading-[1.65] text-[#64748B] dark:text-muted sm:text-base md:text-lg"
            >
              Fast, reliable & AI-powered solutions for your beautiful home.
            </motion.p>

            <motion.ul
              custom={3}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-2 sm:flex sm:flex-wrap sm:gap-x-5 sm:gap-y-3"
            >
              {HERO_TRUST_BADGES.map((label) => (
                <li key={label}>
                  <button
                    type="button"
                    onClick={() => onBadge(label)}
                    className="flex w-full items-center gap-2 text-left text-xs font-medium text-[#0F172A] transition hover:text-primary dark:text-content sm:text-[13px]"
                  >
                    <CheckCircle
                      size={16}
                      className="shrink-0 text-[#2563EB] sm:size-[18px]"
                      strokeWidth={2}
                      aria-hidden
                    />
                    {label}
                  </button>
                </li>
              ))}
            </motion.ul>

            <motion.div
              custom={4}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              className="min-w-0"
            >
              <div className="svc-search-wrap rounded-2xl bg-white/50 p-1 dark:bg-slate-900/40 sm:rounded-[20px]">
                <ServiceSearchInput variant="hero" className="w-full min-w-0" />
              </div>
              <p className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-[#64748B] dark:text-muted sm:mt-4 sm:text-xs">
                Popular Searches
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 sm:mt-2.5 sm:gap-2">
                {POPULAR_SEARCHES.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => nav.bookFromSearch(tag)}
                    className="rounded-lg border border-[#DBEAFE] bg-[#F0F9FF] px-2.5 py-1.5 text-[11px] font-semibold text-[#2563EB] transition-all hover:-translate-y-0.5 hover:border-[#2563EB] hover:bg-[#DBEAFE] hover:shadow-md dark:border-sky-800/50 dark:bg-sky-950/50 sm:px-3.5 sm:py-2 sm:text-xs"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </motion.div>

            <motion.div
              custom={5}
              initial="hidden"
              animate="show"
              variants={fadeUp}
              className="flex items-start gap-2 text-[11px] text-muted sm:text-xs"
            >
              <Award
                size={14}
                className="mt-0.5 shrink-0 text-amber-500"
                aria-hidden
              />
              <span>India&apos;s most trusted premium home services platform</span>
            </motion.div>
          </div>

          <div className="relative flex min-w-0 items-center justify-center lg:justify-end">
            <ServicesHouse3D />
          </div>
        </div>
      </div>
    </section>
  );
}
