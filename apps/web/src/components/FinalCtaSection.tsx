"use client";

import { m as motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { bookUrl } from "@/lib/booking-url";
import { PageSection } from "@/components/layout/PageSection";
import { MotionImage } from "@/components/ui/MotionImage";

export function FinalCtaSection() {
  const reduce = useReducedMotion();

  return (
    <PageSection className="mb-10 sm:mb-12">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col items-start gap-6 overflow-hidden rounded-[24px] card-sheen p-6 shadow-e4 ring-1 ring-white/60 sm:flex-row sm:items-center sm:justify-between sm:gap-8 sm:rounded-[32px] sm:p-10 lg:rounded-[40px] lg:p-16"
        style={{
          background:
            "linear-gradient(135deg, #ECFDF5 0%, #F0FDFA 50%, #F0FDF4 100%)",
        }}
      >
        <span aria-hidden className="pointer-events-none absolute inset-0 hero-grid opacity-60" />
        <span
          aria-hidden
          className="pointer-events-none absolute -left-16 -top-16 size-64 rounded-full bg-emerald-400/18 blur-3xl"
        />
        <div className="relative z-10 max-w-2xl">
          <h2
            className="font-display font-bold text-ink"
            style={{ fontSize: "clamp(1.5rem, 5vw, 3.75rem)" }}
          >
            Ready to experience the future?
          </h2>
          <p className="mt-4 text-base text-slate sm:text-xl">
            Book premium AI-powered home services instantly.
          </p>
          <Link
            href={bookUrl()}
            className="mt-8 inline-flex h-14 items-center gap-2 rounded-2xl bg-[linear-gradient(120deg,#10b981_0%,#0d9488_100%)] px-9 text-base font-bold text-white shadow-[0_18px_44px_-14px_rgb(16_185_129/0.55)] outline-none transition hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-emerald-500/60 sm:text-lg"
          >
            Get Started
            <ArrowRight size={18} />
          </Link>
        </div>

        {/* 3D robot mascot */}
        <div className="relative hidden shrink-0 sm:block">
          <span
            aria-hidden
            className="absolute left-1/2 top-1/2 size-64 -translate-x-1/2 -translate-y-1/2 rounded-full halo opacity-40"
          />
          <motion.div
            animate={reduce ? undefined : { rotate: [0, 360] }}
            transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
            className="absolute inset-0 grid place-items-center"
          >
            <span className="size-72 rounded-full border-2 border-dashed border-emerald-400/40" />
          </motion.div>
          <MotionImage
            src="/robot-3d.png"
            alt="HOMEEIGO AI assistant"
            sizes="(min-width: 1024px) 256px, 224px"
            wrapperClassName="size-56 lg:size-64"
            animate={reduce ? undefined : { y: [0, -14, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="drop-shadow-[0_24px_48px_rgb(16_185_129/0.4)]"
          />
        </div>
      </motion.div>
    </PageSection>
  );
}
