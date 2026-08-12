"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Zap } from "lucide-react";
import {
  servicesHeroOuter,
  svcHeroInner,
  SERVICES_IMAGE_QUALITY,
  servicesShell,
} from "@/components/services-page/services-page-layout";
import { useServicesNavigation } from "@/hooks/use-services-navigation";
import { useLiveMetrics } from "@/hooks/use-live-metrics";
import {
  HERO_IMAGE,
  HERO_TRUST_PILLS,
} from "@/lib/services-marketplace-data";
import { cn } from "@/lib/utils";

const fadeUp = {
  hidden: { opacity: 0.001, y: 16 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: Math.min(0.05 * i, 0.25),
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
    },
  }),
};

export function ServicesHero() {
  const nav = useServicesNavigation();
  const metrics = useLiveMetrics();
  const reduceMotion = useReducedMotion();
  const [loaded, setLoaded] = useState(false);

  useEffect(() => setLoaded(true), []);

  const scrollToHomeCare = () => {
    document.getElementById("home-care")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <section
      className={cn(
        servicesHeroOuter,
        "svc-hero-premium relative overflow-hidden",
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-0 right-0 size-96 rounded-full bg-emerald-100/30 blur-3xl" />
        <div className="absolute bottom-0 left-0 size-96 rounded-full bg-teal-100/20 blur-3xl" />
      </div>

      <div className={svcHeroInner}>
        <div className="relative grid min-w-0 items-center gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Left content */}
          <div className="z-10 space-y-6 sm:space-y-8">
            <motion.div
              custom={0}
              initial="hidden"
              animate={loaded ? "show" : "hidden"}
              variants={fadeUp}
              className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2"
            >
              <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
              <span className="text-xs font-semibold text-emerald-800 sm:text-sm">
                India&apos;s Most Trusted Home Services Platform
              </span>
            </motion.div>

            <motion.h1
              custom={1}
              initial="hidden"
              animate={loaded ? "show" : "hidden"}
              variants={fadeUp}
              className="font-display text-[clamp(2rem,5.5vw,3.75rem)] font-bold leading-[1.1] tracking-[-0.03em] text-gray-900"
            >
              All your home needs,{" "}
              <span className="text-emerald-600">Handled with Care.</span>
            </motion.h1>

            <motion.p
              custom={2}
              initial="hidden"
              animate={loaded ? "show" : "hidden"}
              variants={fadeUp}
              className="max-w-xl text-base leading-relaxed text-gray-600 sm:text-lg"
            >
              Professional. Reliable. Background-verified partners for a cleaner,
              happier home.
            </motion.p>

            <motion.div
              custom={3}
              initial="hidden"
              animate={loaded ? "show" : "hidden"}
              variants={fadeUp}
              className="flex flex-col gap-3 pt-2 sm:flex-row sm:gap-4"
            >
              <button
                type="button"
                onClick={() => nav.book()}
                className="group inline-flex items-center justify-center gap-2 rounded-xl bg-[#1B5E4F] px-8 py-4 font-semibold text-white shadow-lg transition-all duration-300 hover:bg-[#164a3f] hover:shadow-xl"
              >
                Book a Service
                <ArrowRight className="size-5 transition-transform group-hover:translate-x-1" aria-hidden />
              </button>
              <button
                type="button"
                onClick={scrollToHomeCare}
                className="rounded-xl border-2 border-[#1B5E4F] bg-white px-8 py-4 font-semibold text-[#1B5E4F] transition-all duration-300 hover:bg-emerald-50"
              >
                Explore Services
              </button>
            </motion.div>

            <motion.div
              custom={4}
              initial="hidden"
              animate={loaded ? "show" : "hidden"}
              variants={fadeUp}
              className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-6 sm:gap-6 sm:pt-8"
            >
              {HERO_TRUST_PILLS.map((pill) => {
                const Icon = pill.icon;
                return (
                  <div key={pill.label} className="flex items-center gap-2.5">
                    <Icon className="size-5 shrink-0 text-emerald-600" aria-hidden />
                    <span className="text-xs font-medium text-gray-600 sm:text-sm">
                      {pill.label}
                    </span>
                  </div>
                );
              })}
            </motion.div>
          </div>

          {/* Right — brand welcome portrait in a layered premium frame */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, scale: 0.96 }}
            animate={loaded ? { opacity: 1, scale: 1 } : {}}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            className="relative mx-auto w-full max-w-md lg:max-w-lg"
          >
            {/* Ambient brand glow + offset depth card behind the portrait */}
            <div
              aria-hidden
              className="pointer-events-none absolute -inset-6 rounded-[40px] bg-[radial-gradient(closest-side,rgb(16_185_129/0.22),transparent)] blur-2xl"
            />
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 translate-x-4 translate-y-4 rounded-[32px] bg-gradient-to-br from-emerald-200/70 via-emerald-100/40 to-teal-100/30 sm:translate-x-6 sm:translate-y-6"
            />

            <div className="relative aspect-[4/5] overflow-hidden rounded-[28px] shadow-[0_32px_70px_-24px_rgb(6_78_59/0.45)] ring-1 ring-emerald-900/10 sm:aspect-[3/4] lg:aspect-[4/5]">
              <Image
                src={HERO_IMAGE}
                alt="HOMEEIGO professional welcoming you with a namaste"
                fill
                priority
                quality={SERVICES_IMAGE_QUALITY}
                sizes="(max-width: 1024px) 100vw, 40vw"
                className="object-cover object-[50%_18%] transition-transform duration-700 will-change-transform hover:scale-[1.03]"
              />
              {/* Glass shell: inner ring + top sheen + soft base scrim for the caption */}
              <span aria-hidden className="pointer-events-none absolute inset-0 rounded-[28px] ring-1 ring-inset ring-white/40" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-white/25 to-transparent" />
              <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-36 bg-gradient-to-t from-emerald-950/70 via-emerald-950/25 to-transparent" />

              {/* Instant booking — kept clear of the face & in-image signage */}
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.5, duration: 0.5 }}
                className="svc-glass absolute left-4 top-4 max-w-[190px] rounded-xl px-4 py-3 shadow-lg sm:left-5 sm:top-5"
              >
                <div className="flex items-center gap-2">
                  <Zap className="size-4 text-amber-500" aria-hidden />
                  <span className="text-xs font-bold text-gray-900 sm:text-sm">
                    Instant Booking
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-gray-600 sm:text-xs">
                  Hassle-free in 60 secs
                </p>
              </motion.div>

              {/* Welcome caption on the scrim */}
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 14 }}
                animate={loaded ? { opacity: 1, y: 0 } : {}}
                transition={{ delay: 0.65, duration: 0.5 }}
                className="absolute inset-x-4 bottom-4 flex items-center justify-between gap-3 sm:inset-x-5 sm:bottom-5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-bold text-white drop-shadow sm:text-base">
                    Namaste, welcome home
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-emerald-100/90 sm:text-xs">
                    Background-verified · Uniformed · ID-carded professionals
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-white/15 px-3 py-1.5 text-[11px] font-bold text-white ring-1 ring-white/30 backdrop-blur-md sm:text-xs">
                  ★ 4.9 rated
                </span>
              </motion.div>
            </div>

            {/* Floating service chips — outside the frame edge for 3D depth */}
            {[
              { label: "Cleaning", top: "16%" },
              { label: "Maintenance", top: "38%" },
              { label: "Organization", top: "60%" },
            ].map((pill, idx) => (
              <motion.button
                key={pill.label}
                type="button"
                onClick={() => nav.bookFromSearch(pill.label)}
                initial={reduceMotion ? false : { opacity: 0, x: 14 }}
                animate={loaded ? { opacity: 1, x: 0 } : {}}
                transition={{ delay: 0.6 + idx * 0.15 }}
                className="svc-glass absolute -right-3 z-10 hidden rounded-xl px-3.5 py-2 text-xs font-semibold text-gray-800 shadow-lg ring-1 ring-white/50 transition-transform hover:scale-105 sm:block lg:-right-6"
                style={{ top: pill.top }}
              >
                {pill.label}
              </motion.button>
            ))}
          </motion.div>
        </div>

        {/* Metrics row */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 24 }}
          animate={loaded ? { opacity: 1, y: 0 } : {}}
          transition={{ delay: 0.7, duration: 0.5 }}
          className={cn(
            servicesShell,
            "mt-12 grid grid-cols-2 gap-6 border-t border-gray-200 pt-10 sm:mt-16 sm:grid-cols-4 sm:gap-8 sm:pt-14",
          )}
        >
          {metrics.map((metric) => (
            <div key={metric.label} className="text-center">
              <span className="text-2xl sm:text-3xl" aria-hidden>
                {metric.icon}
              </span>
              <p className="svc-num mt-2 text-2xl font-bold text-gray-900 sm:text-3xl">
                {metric.number}
              </p>
              <p className="mt-1 text-xs text-gray-500 sm:text-sm">{metric.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
