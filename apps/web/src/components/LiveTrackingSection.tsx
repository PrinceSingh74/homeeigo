"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Bike, Check, Navigation, Star } from "lucide-react";
import { LiveTrackingMapView } from "@/components/LiveTrackingMapView";
import { DEMO_TRACKING, HOMIGO_RIDER_IMAGE } from "@/lib/demo-tracking-booking";
import { pageSection } from "@/lib/page-layout";
import { cn } from "@/lib/utils";

type Step = { label: string; done: boolean; active?: boolean };

const STEPS: Step[] = [
  { label: "Confirmed", done: true },
  { label: "En route", done: true, active: true },
  { label: "Arrived", done: false },
];

export function LiveTrackingSection() {
  const reduce = useReducedMotion() ?? false;

  return (
    <section
      id="tracking"
      className={cn(pageSection, "scroll-mt-20", "mt-12 sm:mt-16 lg:mt-20")}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative mx-auto w-full min-w-0 max-w-content"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-2 rounded-[36px] halo opacity-30 sm:-inset-3"
        />

        <article className="relative w-full min-w-0 overflow-hidden rounded-[26px] glass-card ring-aurora shadow-[0_24px_60px_-28px_rgb(30_27_75/0.4)] sm:rounded-[30px]">
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-14 sheen opacity-45"
          />

          {/* Header */}
          <header className="relative z-10 flex items-center justify-between gap-3 border-b border-line/70 px-4 py-3 sm:px-5 sm:py-3.5">
            <div className="flex min-w-0 items-center gap-3">
              <span className="relative flex size-2.5 shrink-0">
                {!reduce && (
                  <span className="absolute size-full animate-ping rounded-full bg-emerald-500 opacity-50" />
                )}
                <span className="relative size-2.5 rounded-full bg-emerald-500" />
              </span>
              <div className="min-w-0">
                <h2 className="font-display text-lg font-bold tracking-tight text-content sm:text-xl">
                  Live <span className="text-aurora">Tracking</span>
                </h2>
                <p className="truncate text-xs text-muted">
                  {DEMO_TRACKING.bookingRef} · {DEMO_TRACKING.serviceTitle}
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-500/25 dark:text-emerald-300">
              LIVE
            </span>
          </header>

          {/* Stack mobile · side-by-side desktop — height clamped to viewport */}
          <div className="flex min-h-0 w-full flex-col lg:max-h-[min(52dvh,20rem)] lg:flex-row lg:items-stretch xl:max-h-[min(48dvh,22rem)]">
            <div className="relative min-h-0 w-full shrink-0 border-b border-line/70 lg:flex-[1.15] lg:border-b-0 lg:border-r lg:min-h-[13rem]">
              <div className="relative h-[clamp(9.5rem,28dvh,13.5rem)] w-full min-h-0 sm:h-[clamp(10.5rem,30dvh,14.5rem)] md:h-[clamp(11rem,32dvh,15.5rem)] lg:absolute lg:inset-0 lg:h-full lg:min-h-[13rem]">
                <LiveTrackingMapView className="absolute inset-0 size-full" />
              </div>
            </div>

            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-3.5 sm:gap-3.5 sm:p-4 lg:justify-between lg:overflow-y-auto lg:overscroll-contain lg:p-4 xl:gap-4 xl:p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted">
                    Arriving in
                  </p>
                  <p className="mt-0.5 font-display text-[clamp(1.75rem,7vw,2.75rem)] font-bold leading-none text-aurora">
                    {DEMO_TRACKING.etaMins}
                    <span className="ml-1 text-base font-semibold text-muted sm:text-lg">
                      min
                    </span>
                  </p>
                </div>
                <div className="rounded-2xl bg-primary/8 px-3 py-2 text-center ring-1 ring-primary/15">
                  <Navigation size={16} className="mx-auto text-primary" />
                  <p className="mt-1 text-sm font-bold text-content">2.4</p>
                  <p className="text-[10px] font-medium text-muted">km</p>
                </div>
              </div>

              <div className="flex min-w-0 items-center gap-2.5 rounded-2xl bg-canvas/70 p-2.5 ring-1 ring-line sm:gap-3 sm:p-3 dark:bg-white/[0.04]">
                <div className="relative h-12 w-14 shrink-0 sm:h-14 sm:w-[4.5rem]">
                  <Image
                    src={HOMIGO_RIDER_IMAGE}
                    alt=""
                    fill
                    className="object-contain object-bottom"
                    sizes="72px"
                  />
                </div>
                <span className="relative size-10 shrink-0 overflow-hidden rounded-xl ring-2 ring-line sm:size-11">
                  <Image
                    src="/svc-ac.png"
                    alt=""
                    fill
                    className="object-cover"
                    sizes="44px"
                  />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-sm font-bold text-content sm:text-base">
                    {DEMO_TRACKING.proName}
                  </p>
                  <p className="text-xs text-muted">AC expert + HOMIGO rider</p>
                  <p className="mt-1 flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400">
                    <Star size={12} className="fill-amber-400 text-amber-400" />
                    {DEMO_TRACKING.proRating} rating
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-surface/50 px-1 py-2 ring-1 ring-line/80 dark:bg-white/[0.03]">
                <div className="flex items-center">
                  {STEPS.map((s, i) => (
                    <div key={s.label} className="flex flex-1 items-center">
                      <div className="flex flex-col items-center gap-1 px-1">
                        <span
                          className={cn(
                            "grid size-6 place-items-center rounded-full",
                            s.done
                              ? "bg-primary text-white shadow-sm"
                              : "border-2 border-dashed border-line bg-surface",
                            s.active && "ring-2 ring-primary/30 ring-offset-2",
                          )}
                        >
                          {s.done && <Check size={12} strokeWidth={3} />}
                        </span>
                        <span
                          className={cn(
                            "text-[10px] font-semibold",
                            s.done ? "text-content" : "text-muted",
                          )}
                        >
                          {s.label}
                        </span>
                      </div>
                      {i < STEPS.length - 1 && (
                        <span
                          className={cn(
                            "mx-1 mb-5 h-0.5 flex-1 rounded-full",
                            STEPS[i + 1]!.done || STEPS[i + 1]!.active
                              ? "bg-gradient-to-r from-primary/50 to-primary"
                              : "bg-line",
                          )}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <Link
                href="/bookings"
                className="group flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary via-blue-600 to-violet-600 text-sm font-bold text-white shadow-glow-blue transition hover:brightness-105 sm:h-12"
              >
                <Bike size={18} />
                Open full map
                <ArrowRight
                  size={16}
                  className="transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </div>
          </div>
        </article>
      </motion.div>
    </section>
  );
}
