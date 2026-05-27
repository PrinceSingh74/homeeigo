"use client";

import Image from "next/image";
import Link from "next/link";
import { Bike, Home, MapPin, Navigation, Star } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { DEMO_TRACKING, HOMIGO_RIDER_IMAGE } from "@/lib/demo-tracking-booking";
import { AI_SECTION_IDS } from "@/lib/ai-page-actions";
import { cn } from "@/lib/utils";

type AiLiveTrackingCardProps = {
  embedded?: boolean;
  className?: string;
};

export function AiLiveTrackingCard({ embedded, className }: AiLiveTrackingCardProps) {
  const reduce = useReducedMotion();

  return (
    <div
      id={AI_SECTION_IDS.liveTracking}
      className={cn(!embedded && "w-full min-w-0 scroll-mt-24", className)}
    >
      {/* HOMIGO Rider — hero strip */}
      <div className="relative mb-3 overflow-hidden rounded-xl bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 shadow-[0_12px_32px_-12px_rgb(37_99_235/0.35)] ring-1 ring-indigo-500/25 dark:ring-indigo-400/20">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              "linear-gradient(rgb(99_102_241/0.12)_1px,transparent_1px),linear-gradient(90deg,rgb(99_102_241/0.12)_1px,transparent_1px)",
            backgroundSize: "24px 24px",
          }}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -right-8 -top-8 size-32 rounded-full bg-cyan-500/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-6 -left-6 size-28 rounded-full bg-violet-500/25 blur-3xl"
          aria-hidden
        />

        <div className="relative flex items-end justify-between gap-2 px-3 pt-3 sm:px-4">
          <div className="min-w-0 pb-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-300 ring-1 ring-emerald-400/30">
              <span className="relative flex size-1.5">
                {!reduce && (
                  <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                )}
                <span className="relative size-1.5 rounded-full bg-emerald-400" />
              </span>
              Live · On the way
            </span>
            <p className="mt-2 font-display text-sm font-bold tracking-tight text-white sm:text-base">
              HOMIGO Rider
            </p>
            <p className="text-[11px] text-white/70">Heading to your home now</p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-[10px] font-bold text-cyan-200 backdrop-blur-sm">
            <Bike size={12} />
            {DEMO_TRACKING.etaMins} min
          </span>
        </div>

        <div className="relative flex h-[120px] items-end justify-center sm:h-[132px]">
          {!reduce && (
            <motion.span
              aria-hidden
              className="absolute bottom-6 left-1/2 size-24 -translate-x-1/2 rounded-full bg-cyan-400/25"
              animate={{ scale: [0.85, 1.35, 0.85], opacity: [0.45, 0, 0.45] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: "easeOut" }}
            />
          )}
          <motion.div
            animate={reduce ? undefined : { y: [0, -5, 0] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
            className="relative z-[1] h-full w-full max-w-[220px] sm:max-w-[260px]"
          >
            <Image
              src={HOMIGO_RIDER_IMAGE}
              alt="HOMIGO delivery rider"
              width={260}
              height={200}
              className="h-full w-full object-contain object-bottom drop-shadow-[0_12px_28px_rgb(0_0_0/0.45)]"
              priority={embedded}
            />
          </motion.div>
        </div>
      </div>

      {/* Expert details */}
      <div className="mb-3 flex min-w-0 items-center gap-3">
        <span className="relative size-11 shrink-0 overflow-hidden rounded-xl ring-2 ring-white shadow-md dark:ring-slate-600">
          <Image src="/svc-ac.png" alt="" fill className="object-cover" sizes="44px" />
          <span className="absolute bottom-0 right-0 size-3 rounded-full border-2 border-white bg-emerald-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink dark:text-slate-100">
            {DEMO_TRACKING.proName}
          </p>
          <p className="truncate text-[11px] text-slate">
            AC Technician · {DEMO_TRACKING.serviceTitle}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            <Star size={11} className="fill-amber-400 text-amber-400" />
            {DEMO_TRACKING.proRating}
            <span className="text-slate">· Assigned expert</span>
          </p>
        </div>
      </div>

      {/* Live tracking map */}
      <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate dark:text-slate-400">
        Live route
      </p>
      <div className="relative h-[148px] overflow-hidden rounded-xl bg-gradient-to-br from-slate-800 via-slate-900 to-slate-950 shadow-[inset_0_1px_0_rgb(255_255_255/0.1),0_16px_40px_-12px_rgb(0_0_0/0.5)] ring-1 ring-slate-600/50">
        <div
          className="absolute inset-0 opacity-30"
          style={{
            backgroundImage:
              "linear-gradient(rgb(148_163_184/0.15)_1px,transparent_1px),linear-gradient(90deg,rgb(148_163_184/0.15)_1px,transparent_1px)",
            backgroundSize: "20px 20px",
          }}
          aria-hidden
        />
        <div className="absolute inset-0 opacity-50">
          <svg className="h-full w-full" viewBox="0 0 320 148" preserveAspectRatio="none" aria-hidden>
            <defs>
              <linearGradient id="ai-track-route" x1="0%" y1="100%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="50%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
            </defs>
            <path
              d="M 24 110 Q 100 35 180 75 T 296 42"
              fill="none"
              stroke="#1e40af"
              strokeWidth="10"
              strokeLinecap="round"
              opacity="0.35"
            />
            <path
              d="M 24 110 Q 100 35 180 75 T 296 42"
              fill="none"
              stroke="url(#ai-track-route)"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeDasharray="8 5"
            />
            <circle cx="24" cy="110" r="7" fill="#22c55e" stroke="#fff" strokeWidth="2" />
            <circle cx="296" cy="42" r="7" fill="#2563eb" stroke="#fff" strokeWidth="2" />
          </svg>
        </div>

        {/* Rider pin on map */}
        <motion.div
          className="absolute left-[22%] top-[48%] z-[2] -translate-x-1/2 -translate-y-1/2"
          animate={reduce ? undefined : { x: [0, 28, 48], y: [0, -18, -32] }}
          transition={{ duration: 2.6, repeat: Infinity, repeatType: "reverse", ease: "easeInOut" }}
        >
          <span className="relative block size-11 sm:size-12">
            <Image
              src={HOMIGO_RIDER_IMAGE}
              alt=""
              width={48}
              height={48}
              className="size-11 object-contain drop-shadow-lg sm:size-12"
            />
          </span>
        </motion.div>

        <span className="absolute right-[10%] top-[18%] grid size-7 place-items-center rounded-full border border-cyan-500/50 bg-cyan-500/15 text-cyan-200">
          <Home size={13} />
        </span>

        <motion.span
          className="absolute left-[8%] top-[68%] grid size-7 place-items-center rounded-full bg-emerald-500/90 text-white shadow-md"
          animate={reduce ? undefined : { scale: [1, 1.06, 1] }}
          transition={{ duration: 2, repeat: Infinity }}
        >
          <MapPin size={12} className="fill-white" />
        </motion.span>

        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1 text-[11px] font-semibold text-white">
              <Navigation size={12} className="shrink-0 text-cyan-300" />
              <span className="truncate">Arriving in {DEMO_TRACKING.etaMins} mins</span>
            </span>
            <Link
              href="/bookings"
              className="shrink-0 rounded-md bg-white/15 px-2 py-1 text-[10px] font-semibold text-white backdrop-blur-sm transition hover:bg-white/25"
            >
              Track
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
