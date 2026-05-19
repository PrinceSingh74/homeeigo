"use client";

import Image from "next/image";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles, ArrowRight, Play, ShieldCheck, Star } from "lucide-react";
import { Button } from "@/components/buttons/Button";
import { Badge } from "@/components/Badge";

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: (d: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.55, delay: d, ease: [0.22, 1, 0.36, 1] },
  }),
};

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

  return (
    <section className="relative flex min-h-[85vh] items-center overflow-hidden px-5 py-16 sm:px-8 lg:min-h-[90vh] lg:py-20">
      {/* ---- Aurora background (CSS + Framer fallback for 3D) ---- */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_70%_30%,rgb(37_99_235/0.10),transparent_70%)]" />
        <div className="absolute -right-24 -top-24 size-136 rounded-full bg-aurora opacity-25 blur-3xl animate-aurora dark:opacity-30" />
        <div className="absolute -bottom-32 left-1/4 size-120 rounded-full bg-premium opacity-20 blur-3xl animate-[aurora_22s_ease-in-out_infinite] dark:opacity-25" />
        <div className="absolute right-1/4 top-1/3 size-88 rounded-full bg-[conic-gradient(from_180deg,#06b6d4,#7c3aed,#2563eb,#06b6d4)] opacity-10 blur-3xl animate-[float_10s_ease-in-out_infinite]" />
      </div>

      <div className="mx-auto grid w-full max-w-content items-center gap-12 lg:grid-cols-[45%_55%]">
        {/* ---- Left content ---- */}
        <div className="max-w-xl">
          <motion.div variants={fadeUp} custom={0} initial="hidden" animate="show">
            <Badge variant="ai">
              <Sparkles size={14} />
              AI-Powered Home Services
            </Badge>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            custom={0.1}
            initial="hidden"
            animate="show"
            className="mt-5 font-display font-bold leading-[1.08] tracking-tight text-content"
            style={{ fontSize: "clamp(2.5rem,6vw,4rem)" }}
          >
            The Future of <br />
            <span className="text-aurora">Home Services.</span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            custom={0.2}
            initial="hidden"
            animate="show"
            className="mt-5 max-w-md text-lg leading-relaxed text-muted"
          >
            Smart. Fast. Reliable. Book verified professionals in under 60
            seconds with real-time tracking and AI-matched experts.
          </motion.p>

          <motion.div
            variants={fadeUp}
            custom={0.3}
            initial="hidden"
            animate="show"
            className="mt-8 flex flex-wrap gap-3"
          >
            <Button variant="primary" className="group">
              Book a Service
              <ArrowRight
                size={20}
                className="transition-transform group-hover:translate-x-1"
              />
            </Button>
            <Button variant="glass" className="group">
              <Play size={18} className="transition-transform group-hover:scale-110" />
              See How It Works
            </Button>
          </motion.div>

          <motion.div
            variants={fadeUp}
            custom={0.45}
            initial="hidden"
            animate="show"
            className="mt-10 flex flex-wrap items-center gap-x-7 gap-y-3 text-sm text-muted"
          >
            <span className="inline-flex items-center gap-2">
              <ShieldCheck size={18} className="text-success" />
              Verified &amp; background-checked
            </span>
            <span className="inline-flex items-center gap-2">
              <Star size={18} className="text-gold" />
              4.9 average rating
            </span>
          </motion.div>
        </div>

        {/* ---- Right visual: aurora glass scene (3D fallback) ---- */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="relative hidden h-128 lg:block xl:h-144"
        >
          <div className="absolute inset-0 grid place-items-center">
            <motion.div
              animate={reduce ? undefined : { y: [0, -16, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="relative w-full max-w-2xl xl:max-w-3xl"
            >
              <Image
                src="/hero-villa.webp"
                alt="HOMIGO AI-connected smart home"
                width={1536}
                height={1024}
                priority
                className="h-auto w-full object-contain drop-shadow-[0_40px_90px_rgb(124_58_237/0.38)]"
              />

              <div className="absolute -right-2 top-8 rounded-2xl bg-surface px-4 py-3 shadow-e4 border border-line">
                <p className="text-[11px] font-medium text-muted">Arriving in</p>
                <p className="font-display text-lg font-bold text-aurora">
                  12 min
                </p>
              </div>
              <div className="absolute -bottom-2 -left-2 rounded-2xl bg-surface px-4 py-3 shadow-e4 border border-line">
                <p className="text-[11px] font-medium text-muted">Live tracking</p>
                <p className="font-display text-sm font-bold text-success">
                  ● On the way
                </p>
              </div>
            </motion.div>
          </div>

          {/* Floating particles */}
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
