"use client";

import Image from "next/image";
import { m as motion, useReducedMotion } from "framer-motion";
import { Sparkles, ArrowRight, Play, ShieldCheck, Star } from "lucide-react";
import { ButtonLink } from "@/components/buttons/ButtonLink";
import { Badge } from "@/components/Badge";
import { bookUrl } from "@/lib/booking-url";
import { fadeUpShow } from "@/lib/animations";
import { heroTitle, pageMax, pagePadX, sectionSubtitle } from "@/lib/page-layout";
import { useAppStore } from "@/stores/app-store";
import { useStatsOverview } from "@/hooks/use-core-data";
import { cn } from "@/lib/utils";

const PARTICLES = [
  { x: "12%", y: "22%", s: 6, d: 0 },
  { x: "78%", y: "16%", s: 4, d: 0.6 },
  { x: "64%", y: "70%", s: 8, d: 1.1 },
  { x: "30%", y: "82%", s: 5, d: 0.3 },
  { x: "88%", y: "54%", s: 6, d: 0.9 },
  { x: "46%", y: "10%", s: 4, d: 1.4 },
  { x: "8%", y: "62%", s: 5, d: 0.5 },
];

export function HeroSection() {
  const reduce = useReducedMotion();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const { data: stats } = useStatsOverview();
  const nf = (n: number) => n.toLocaleString("en-IN");

  return (
    <section
      className={cn(
        pagePadX,
        "relative flex min-h-[min(85vh,900px)] items-center overflow-hidden py-12 sm:py-16 lg:min-h-[90vh] lg:py-20",
      )}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <motion.div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_30%,rgb(37_99_235/0.10),transparent_70%)]" />
        <div className="absolute -right-24 -top-24 size-136 rounded-full bg-aurora opacity-25 blur-3xl animate-aurora dark:opacity-30" />
        <div className="absolute -bottom-32 left-1/4 size-120 rounded-full bg-premium opacity-20 blur-3xl animate-[aurora_22s_ease-in-out_infinite] dark:opacity-25" />
        <div className="absolute right-1/4 top-1/3 size-88 rounded-full bg-[conic-gradient(from_180deg,#06b6d4,#7c3aed,#2563eb,#06b6d4)] opacity-10 blur-3xl animate-[float_10s_ease-in-out_infinite]" />
      </div>

      <div
        className={cn(
          pageMax,
          "grid w-full grid-cols-1 items-center gap-8 sm:gap-10 lg:grid-cols-2 lg:gap-12",
        )}
      >
        <div className="w-full min-w-0 lg:max-w-xl">
          <motion.div
            variants={fadeUpShow}
            custom={0}
            initial={false}
            animate="show"
          >
            <Badge variant="ai">
              <Sparkles size={14} />
              AI-Powered Home Services
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeUpShow}
            custom={0.1}
            initial={false}
            animate="show"
            className={cn(heroTitle, "mt-5")}
          >
            The Future of <br />
            <span className="text-aurora">Home Services.</span>
          </motion.h1>

          <motion.p
            variants={fadeUpShow}
            custom={0.2}
            initial={false}
            animate="show"
            className={cn(sectionSubtitle, "mt-5 w-full max-w-md")}
          >
            Smart. Fast. Reliable. Book verified professionals in under 60
            seconds with real-time tracking and AI-matched experts.
          </motion.p>

          <motion.div
            variants={fadeUpShow}
            custom={0.3}
            initial={false}
            animate="show"
            className="mt-8 flex flex-wrap gap-3"
          >
            <ButtonLink href={bookUrl()} variant="primary" className="group">
              Book a Service
              <ArrowRight
                size={20}
                className="transition-transform group-hover:translate-x-1"
              />
            </ButtonLink>
            <button
              type="button"
              onClick={() => openOverlay("how-it-works")}
              className="relative inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-line/60 bg-surface/80 px-7 text-base font-semibold text-primary shadow-e2 transition hover:-translate-y-1 hover:border-primary/30"
            >
              <Play size={18} />
              See How It Works
            </button>
          </motion.div>

          <motion.div
            variants={fadeUpShow}
            custom={0.45}
            initial={false}
            animate="show"
            className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3 text-sm text-muted"
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={18} className="text-success" />
              Verified &amp; background-checked
            </span>
            <span className="inline-flex items-center gap-2">
              <Star size={18} className="text-gold" />
              {stats?.averageRating != null
                ? `${stats.averageRating} average rating`
                : stats
                  ? `${nf(stats.activeProviders)} verified pros`
                  : "Top-rated pros"}
            </span>
            {stats && stats.completedBookings > 0 ? (
              <span className="inline-flex items-center gap-2">
                <Sparkles size={18} className="text-primary" />
                {nf(stats.completedBookings)} jobs completed
              </span>
            ) : null}
          </motion.div>
        </div>

        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto w-full max-w-md lg:hidden"
        >
          <Image
            src="/hero-villa.webp"
            alt="HOMEEIGO AI-connected smart home"
            width={768}
            height={512}
            sizes="(max-width: 1023px) 90vw, 0px"
            priority
            className="h-auto w-full object-contain drop-shadow-[0_24px_48px_rgb(124_58_237/0.28)]"
          />
        </motion.div>

        <motion.div
          initial={reduce ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative hidden min-h-[20rem] w-full lg:block lg:min-h-[var(--homigo-hero-h)] xl:min-h-[var(--homigo-hero-h-xl)]"
        >
          <div className="absolute inset-0 grid place-items-center">
            <motion.div
              animate={reduce ? undefined : { y: [0, -16, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="relative w-full max-w-2xl xl:max-w-3xl"
            >
              <Image
                src="/hero-villa.webp"
                alt="HOMEEIGO AI-connected smart home"
                width={1536}
                height={1024}
                sizes="(min-width: 1280px) 768px, (min-width: 1024px) 640px, 0px"
                priority
                className="h-auto w-full object-contain drop-shadow-[0_40px_90px_rgb(124_58_237/0.38)]"
              />

              <button
                type="button"
                onClick={() => {
                  document
                    .getElementById("tracking")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="absolute -right-2 top-8 rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-e4 transition hover:-translate-y-0.5"
              >
                <p className="text-[11px] font-medium text-muted">Arriving in</p>
                <p className="font-display text-lg font-bold text-aurora">
                  12 min
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  document
                    .getElementById("tracking")
                    ?.scrollIntoView({ behavior: "smooth" });
                }}
                className="absolute -bottom-2 -left-2 rounded-2xl border border-line bg-surface px-4 py-3 text-left shadow-e4 transition hover:-translate-y-0.5"
              >
                <p className="text-[11px] font-medium text-muted">
                  Live tracking
                </p>
                <p className="font-display text-sm font-bold text-success">
                  ● On the way
                </p>
              </button>
            </motion.div>
          </div>

          {!reduce &&
            PARTICLES.map((p, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full bg-aurora opacity-60"
                style={{ left: p.x, top: p.y, width: p.s, height: p.s }}
                animate={{ y: [0, -16, 0], opacity: [0.3, 0.8, 0.3] }}
                transition={{
                  duration: 4 + i,
                  delay: p.d,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            ))}
        </motion.div>
      </div>
    </section>
  );
}
