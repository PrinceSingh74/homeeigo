"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";

export function FinalCtaSection() {
  const reduce = useReducedMotion();

  return (
    <section className="mx-auto mt-24 mb-12 max-w-content px-5 sm:px-8">
      <motion.div
        initial={{ opacity: 0, y: 32 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.3 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex items-center justify-between gap-8 overflow-hidden rounded-[40px] p-10 shadow-e4 sm:p-16"
        style={{
          background:
            "linear-gradient(135deg, #EDE9FE 0%, #F5F3FF 50%, #FCE7F3 100%)",
        }}
      >
        <div className="relative z-10 max-w-2xl">
          <h2 className="font-display text-3xl font-bold text-ink sm:text-5xl lg:text-6xl">
            Ready to experience the future?
          </h2>
          <p className="mt-4 text-base text-slate sm:text-xl">
            Book premium AI-powered home services instantly.
          </p>
          <motion.button
            type="button"
            whileHover={{ y: -3 }}
            whileTap={{ scale: 0.98 }}
            className="mt-8 inline-flex h-14 items-center gap-2 rounded-2xl bg-aurora px-9 text-base font-bold text-white shadow-glow-blue outline-none focus-visible:ring-2 focus-visible:ring-primary/60 sm:text-lg"
          >
            Get Started
            <ArrowRight size={18} />
          </motion.button>
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
            <span className="size-72 rounded-full border-2 border-dashed border-violet/35" />
          </motion.div>
          <motion.img
            src="/robot-3d.png"
            alt="HOMIGO AI assistant"
            animate={reduce ? undefined : { y: [0, -14, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="relative size-56 object-contain drop-shadow-[0_24px_48px_rgb(124_58_237/0.4)] lg:size-64"
          />
        </div>
      </motion.div>
    </section>
  );
}
